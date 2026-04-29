-- ============================================================================
-- Migration: Delivery platforms (Uber Eats, DiDi Food, Rappi)
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================================
--
-- What this does:
--   1. Adds 'platform' to the payment_method enum
--   2. Adds sale_origin TEXT ('pos' | 'order' | 'delivery')
--   3. Adds delivery_platform TEXT ('uber_eats' | 'didi_food' | 'rappi')
--   4. Adds platform_amount NUMERIC (amount owed by platform — not physical cash)
--   5. Back-fills existing ORDER_CHECKOUT sales → sale_origin = 'order'
--   6. Drops + recreates the 3 cash register views to exclude delivery
--   7. Updates close_cash_register_session RPC to exclude delivery
--
-- RULE: delivery sales are real revenue but NOT physical cash.
--   They must never enter: expected_cash, cash_sales_total, card_sales_total,
--   or any corte de caja calculation.
--
-- Run AFTER:
--   migration_refunds.sql
--   migration_refunds_filter_cash.sql
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add 'platform' to payment_method enum (safe guard)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'payment_method'::regtype
      AND enumlabel = 'platform'
  ) THEN
    ALTER TYPE payment_method ADD VALUE 'platform';
  END IF;
END$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add new columns to public.sales
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_origin       TEXT    NOT NULL DEFAULT 'pos',
  ADD COLUMN IF NOT EXISTS delivery_platform TEXT,
  ADD COLUMN IF NOT EXISTS platform_amount   NUMERIC NOT NULL DEFAULT 0;

-- Index for fast origin filtering used in all views/RPCs
CREATE INDEX IF NOT EXISTS idx_sales_sale_origin ON public.sales (sale_origin);

COMMENT ON COLUMN public.sales.sale_origin IS
  'Origin of the sale: pos = caja local, order = pedido cobrado, delivery = plataforma delivery';
COMMENT ON COLUMN public.sales.delivery_platform IS
  'Platform name when sale_origin = ''delivery'': uber_eats | didi_food | rappi';
COMMENT ON COLUMN public.sales.platform_amount IS
  'Total owed by the platform (pending liquidation). Not physical cash.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Back-fill existing data
-- ─────────────────────────────────────────────────────────────────────────────

-- Existing ORDER_CHECKOUT sales → sale_origin = 'order'
UPDATE public.sales
   SET sale_origin = 'order'
 WHERE promotion_code = 'ORDER_CHECKOUT'
   AND sale_origin = 'pos';

-- Safety: any existing PLATFORM sales → platform_amount = total
UPDATE public.sales
   SET platform_amount = total
 WHERE UPPER(payment_method::TEXT) = 'PLATFORM'
   AND (platform_amount IS NULL OR platform_amount = 0);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop and recreate cash register views
--    CASCADE handles any internal Supabase dependencies.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_cash_register_session_sales    CASCADE;
DROP VIEW IF EXISTS public.v_open_cash_register_status      CASCADE;
DROP VIEW IF EXISTS public.v_cash_register_sessions_summary CASCADE;


-- 4a. v_cash_register_sessions_summary
--     History of all sessions — caja + pedidos only, no delivery, no refunded
CREATE VIEW public.v_cash_register_sessions_summary AS
SELECT
  s.id                     AS session_id,
  s.status,
  s.opened_at,
  s.closed_at,
  s.opening_cash,
  s.opened_by,
  s.closed_by,
  s.notes,
  s.close_notes,

  COALESCE(cash_agg.cash_total, 0)   AS calculated_cash_sales,
  COALESCE(cash_agg.card_total, 0)   AS calculated_card_sales,
  COALESCE(wd_agg.wd_total, 0)       AS calculated_withdrawals_total,

  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS calculated_expected_cash_on_hand,

  s.counted_cash,

  CASE
    WHEN s.counted_cash IS NOT NULL THEN
      s.counted_cash
        - (s.opening_cash
           + COALESCE(cash_agg.cash_total, 0)
           - COALESCE(wd_agg.wd_total, 0))
    ELSE NULL
  END AS calculated_cash_difference,

  COALESCE(cash_agg.sales_count, 0)  AS sales_count,
  COALESCE(wd_agg.wd_count, 0)       AS withdrawals_count,

  -- Legacy compat names
  COALESCE(cash_agg.cash_total, 0)   AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0)   AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)       AS withdrawals_total,

  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS expected_cash,

  s.difference

FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CASH'  THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.cash_amount, sa.total)
      ELSE 0
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CARD'  THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.card_amount, 0)
      ELSE 0
    END) AS card_total,
    COUNT(*)::int AS sales_count
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
    AND COALESCE(sa.is_refunded, false) = false
    AND COALESCE(sa.sale_origin, 'pos') != 'delivery'   -- ★ exclude delivery
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total, COUNT(*)::int AS wd_count
  FROM public.cash_withdrawals w WHERE w.session_id = s.id
) wd_agg ON TRUE

ORDER BY s.opened_at DESC;

GRANT SELECT ON public.v_cash_register_sessions_summary TO authenticated;


-- 4b. v_open_cash_register_status
--     Live status for the POS panel — caja + pedidos only
CREATE VIEW public.v_open_cash_register_status AS
SELECT
  s.id                     AS session_id,
  s.opening_cash,
  COALESCE(cash_agg.cash_total, 0) AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0) AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)    AS withdrawals_total,
  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0) AS current_cash,
  (s.opening_cash + COALESCE(cash_agg.cash_total, 0) - COALESCE(wd_agg.wd_total, 0)) > 5000
    AS needs_withdrawal,
  s.opened_at,
  s.opened_by,
  s.notes
FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CASH'  THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.cash_amount, sa.total)
      ELSE 0
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CARD'  THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.card_amount, 0)
      ELSE 0
    END) AS card_total
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
    AND COALESCE(sa.is_refunded, false) = false
    AND COALESCE(sa.sale_origin, 'pos') != 'delivery'   -- ★ exclude delivery
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total
  FROM public.cash_withdrawals w WHERE w.session_id = s.id
) wd_agg ON TRUE

WHERE s.closed_at IS NULL
ORDER BY s.opened_at DESC
LIMIT 1;

GRANT SELECT ON public.v_open_cash_register_status TO authenticated;


-- 4c. v_cash_register_session_sales
--     Detail view: non-refunded, non-delivery sales per session
CREATE VIEW public.v_cash_register_session_sales AS
SELECT
  sa.cash_session_id        AS session_id,
  sa.id                     AS sale_id,
  sa.created_at,
  sa.payment_method,
  sa.total,
  sa.customer_id,
  sa.promotion_code,
  COALESCE(sa.loyalty_reward_applied, false) AS loyalty_reward_applied,
  COALESCE(sa.loyalty_discount_amount, 0)    AS loyalty_discount_amount
FROM public.sales sa
WHERE sa.cash_session_id IS NOT NULL
  AND COALESCE(sa.is_refunded, false) = false
  AND COALESCE(sa.sale_origin, 'pos') != 'delivery';  -- ★ exclude delivery

GRANT SELECT ON public.v_cash_register_session_sales TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Update close_cash_register_session RPC
--    Must exclude both refunded AND delivery from expected_cash calculation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_cash_register_session(
  p_session_id   UUID,
  p_counted_cash NUMERIC,
  p_closed_by    UUID    DEFAULT NULL,
  p_notes        TEXT    DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_opening_cash NUMERIC;
  v_cash_sales   NUMERIC;
  v_card_sales   NUMERIC;
  v_withdrawals  NUMERIC;
  v_expected     NUMERIC;
  v_difference   NUMERIC;
BEGIN
  SELECT opening_cash INTO v_opening_cash
    FROM public.cash_register_sessions
   WHERE id = p_session_id;

  -- Only count non-refunded, non-delivery sales
  SELECT
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'CASH'  THEN total
      WHEN UPPER(payment_method::TEXT) = 'MIXED' THEN COALESCE(cash_amount, total)
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'CARD'  THEN total
      WHEN UPPER(payment_method::TEXT) = 'MIXED' THEN COALESCE(card_amount, 0)
      ELSE 0
    END), 0)
    INTO v_cash_sales, v_card_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id
     AND COALESCE(is_refunded, false) = false
     AND COALESCE(sale_origin, 'pos') != 'delivery';   -- ★ exclude delivery

  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  -- expected = fondo + cash sales − withdrawals  (card/transfer/platform NOT included)
  v_expected   := v_opening_cash + v_cash_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  UPDATE public.cash_register_sessions
     SET status        = 'closed',
         closed_at     = NOW(),
         closed_by     = p_closed_by,
         counted_cash  = p_counted_cash,
         expected_cash = v_expected,
         difference    = v_difference,
         close_notes   = p_notes
   WHERE id = p_session_id
     AND closed_at IS NULL;

  RETURN json_build_object(
    'expected_cash', v_expected,
    'counted_cash',  p_counted_cash,
    'difference',    v_difference
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.close_cash_register_session(UUID, NUMERIC, UUID, TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDATION
-- After running, verify a delivery sale is excluded from caja:
--
--   -- Insert a test delivery sale and check it doesn't affect caja status:
--   SELECT cash_sales_total, card_sales_total, sales_count
--     FROM public.v_open_cash_register_status;
--
--   SELECT cash_sales_total, sales_count
--     FROM public.v_cash_register_sessions_summary
--    LIMIT 1;
--
--   -- Confirm sale_origin values:
--   SELECT sale_origin, delivery_platform, COUNT(*), SUM(total)
--     FROM public.sales
--    GROUP BY 1, 2
--    ORDER BY 1, 2;
-- ─────────────────────────────────────────────────────────────────────────────
