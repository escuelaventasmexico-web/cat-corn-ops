-- ============================================================================
-- Migration: Exclude refunded sales from all cash register calculations
-- Run AFTER migration_refunds.sql (which adds the is_refunded column)
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================================
--
-- RULE: Any sale with is_refunded = TRUE must be invisible to:
--   • cash_sales_total / card_sales_total / transfer totals
--   • expected_cash / current_cash
--   • sales_count / ticket_promedio
--   • corte parcial / corte final
--   • session detail view
--
-- COALESCE(is_refunded, false) = false handles rows that existed before the
-- column was added (they have NULL → treated as not-refunded, safe).
--
-- NOTE: CREATE OR REPLACE VIEW fails with "cannot drop columns from view" when
-- the column list changes. We DROP each view first, then recreate from scratch.
-- CASCADE is used in case Supabase has internal dependencies on these views.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- DROP all views first (CASCADE handles any internal Supabase dependencies)
-- Order: leaf views first, then views they depend on.
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_cash_register_session_sales      CASCADE;
DROP VIEW IF EXISTS public.v_open_cash_register_status        CASCADE;
DROP VIEW IF EXISTS public.v_cash_register_sessions_summary   CASCADE;


-- ────────────────────────────────────────────────────────────────────────────
-- 1) v_cash_register_sessions_summary
--    Aggregates all closed + open sessions for the Corte de Caja history page.
-- ────────────────────────────────────────────────────────────────────────────
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

  -- Expected = fondo + cash sales − withdrawals  (card/transfer NOT counted)
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
    AND COALESCE(sa.is_refunded, false) = false   -- ★ exclude refunded
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT
    SUM(w.amount) AS wd_total,
    COUNT(*)::int AS wd_count
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

ORDER BY s.opened_at DESC;


-- Grant access on the recreated view
GRANT SELECT ON public.v_cash_register_sessions_summary TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2) v_open_cash_register_status
--    Live status panel shown in the POS while a session is open.
-- ────────────────────────────────────────────────────────────────────────────
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
    AND COALESCE(sa.is_refunded, false) = false   -- ★ exclude refunded
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

WHERE s.closed_at IS NULL
ORDER BY s.opened_at DESC
LIMIT 1;


-- Grant access on the recreated view
GRANT SELECT ON public.v_open_cash_register_status TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) v_cash_register_session_sales
--    Detail view: all non-refunded sales belonging to a session.
--    Used by CashSessionDetailModal + fetchSessionSales() in cashRegister.ts.
-- ────────────────────────────────────────────────────────────────────────────
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
  AND COALESCE(sa.is_refunded, false) = false;  -- ★ exclude refunded

-- Allow authenticated users to query this view
GRANT SELECT ON public.v_cash_register_session_sales TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 4) close_cash_register_session (RPC)
--    Calculates expected cash at close time — must exclude refunded sales.
-- ────────────────────────────────────────────────────────────────────────────
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

  -- ★ Only count non-refunded sales
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
     AND COALESCE(is_refunded, false) = false;   -- ★ exclude refunded

  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  -- expected = fondo + efectivo ventas − retiros  (card NOT included)
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


-- ────────────────────────────────────────────────────────────────────────────
-- VALIDATION QUERY
-- After running, execute this to verify a refunded sale is excluded:
--
--   SELECT id, total, is_refunded FROM public.sales
--   WHERE cash_session_id = '<your-session-id>'
--   ORDER BY created_at;
--
-- Then compare with:
--   SELECT * FROM public.v_open_cash_register_status;
--   SELECT * FROM public.v_cash_register_sessions_summary WHERE session_id = '<id>';
--
-- Refunded sale should NOT appear in totals or in v_cash_register_session_sales.
-- ────────────────────────────────────────────────────────────────────────────
