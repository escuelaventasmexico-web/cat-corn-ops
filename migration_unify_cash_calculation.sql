-- ============================================================================
-- Migration: Unify cash register calculation — only sale_origin = 'pos'
-- Run in: Supabase Dashboard → SQL Editor
-- Run AFTER: migration_delivery_platforms.sql
-- ============================================================================
--
-- BUG FIXED: all previous views and the RPC used
--   COALESCE(sale_origin, 'pos') != 'delivery'
-- which included 'order' (pedidos) in cash_sales_total / expected_cash.
--
-- CORRECT RULE:
--   Only sale_origin = 'pos' contributes to the physical cash register.
--   Orders are paid via transfer/card outside the register.
--   Delivery is paid by the platform, never physical cash.
-- ============================================================================

DROP VIEW IF EXISTS public.v_cash_register_session_sales    CASCADE;
DROP VIEW IF EXISTS public.v_open_cash_register_status      CASCADE;
DROP VIEW IF EXISTS public.v_cash_register_sessions_summary CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- v_cash_register_sessions_summary
-- ─────────────────────────────────────────────────────────────────────────────
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
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.cash_amount, 0)
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
    AND COALESCE(sa.sale_origin, 'pos') = 'pos'   -- ★ ONLY physical caja
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total, COUNT(*)::int AS wd_count
  FROM public.cash_withdrawals w WHERE w.session_id = s.id
) wd_agg ON TRUE

ORDER BY s.opened_at DESC;

GRANT SELECT ON public.v_cash_register_sessions_summary TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- v_open_cash_register_status
-- ─────────────────────────────────────────────────────────────────────────────
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
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED' THEN COALESCE(sa.cash_amount, 0)
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
    AND COALESCE(sa.sale_origin, 'pos') = 'pos'   -- ★ ONLY physical caja
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total
  FROM public.cash_withdrawals w WHERE w.session_id = s.id
) wd_agg ON TRUE

WHERE s.closed_at IS NULL
ORDER BY s.opened_at DESC
LIMIT 1;

GRANT SELECT ON public.v_open_cash_register_status TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- v_cash_register_session_sales
-- ─────────────────────────────────────────────────────────────────────────────
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
  AND COALESCE(sa.sale_origin, 'pos') = 'pos';   -- ★ ONLY physical caja

GRANT SELECT ON public.v_cash_register_session_sales TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- close_cash_register_session RPC
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

  -- Only pos sales, not refunded — MIXED uses cash_amount/card_amount split
  SELECT
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'CASH'  THEN total
      WHEN UPPER(payment_method::TEXT) = 'MIXED' THEN COALESCE(cash_amount, 0)
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
     AND COALESCE(sale_origin, 'pos') = 'pos';   -- ★ ONLY physical caja

  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

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
-- VERIFICATION QUERIES
-- Run these after applying the migration to confirm values match:
--
--   -- Should match Dashboard cajaCash + cajaCard:
--   SELECT cash_sales_total, card_sales_total, expected_cash
--     FROM public.v_open_cash_register_status;
--
--   -- Manual cross-check — should equal cash_sales_total above:
--   SELECT
--     SUM(CASE WHEN UPPER(payment_method::TEXT)='CASH'  THEN total
--              WHEN UPPER(payment_method::TEXT)='MIXED' THEN COALESCE(cash_amount,0)
--              ELSE 0 END) AS cash_manual,
--     SUM(CASE WHEN UPPER(payment_method::TEXT)='CARD'  THEN total
--              WHEN UPPER(payment_method::TEXT)='MIXED' THEN COALESCE(card_amount,0)
--              ELSE 0 END) AS card_manual
--   FROM public.sales
--   WHERE cash_session_id = '<CURRENT_SESSION_ID>'
--     AND COALESCE(is_refunded, false) = false
--     AND COALESCE(sale_origin, 'pos') = 'pos';
-- ─────────────────────────────────────────────────────────────────────────────
