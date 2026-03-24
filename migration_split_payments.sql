-- ============================================================================
-- FEATURE: Split Payments (Pago Mixto) support
-- ============================================================================
-- Adds cash_amount and card_amount columns to the sales table so that
-- MIXED payments can be properly accounted for in cash register reports.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Add columns to sales table
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_amount NUMERIC DEFAULT 0;

-- Back-fill existing rows based on payment_method:
-- CASH  → cash_amount = total, card_amount = 0
-- CARD  → cash_amount = 0,     card_amount = total
-- MIXED → cash_amount = total (legacy, no split info available)
UPDATE public.sales SET cash_amount = total, card_amount = 0 WHERE UPPER(payment_method::text) = 'CASH' AND cash_amount = 0;
UPDATE public.sales SET cash_amount = 0, card_amount = total WHERE UPPER(payment_method::text) = 'CARD' AND card_amount = 0;
UPDATE public.sales SET cash_amount = total, card_amount = 0 WHERE UPPER(payment_method::text) = 'MIXED' AND cash_amount = 0;


-- ────────────────────────────────────────────────────────────────────────────
-- 2) UPDATE the sessions-summary view to use cash_amount/card_amount
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_cash_register_sessions_summary AS
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

  -- Calculated columns using cash_amount/card_amount for accuracy
  COALESCE(cash_agg.cash_total, 0)   AS calculated_cash_sales,
  COALESCE(cash_agg.card_total, 0)   AS calculated_card_sales,
  COALESCE(wd_agg.wd_total, 0)       AS calculated_withdrawals_total,

  -- Expected = cash + card − withdrawals (fondo NOT included)
  COALESCE(cash_agg.cash_total, 0)
    + COALESCE(cash_agg.card_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS calculated_expected_cash_on_hand,

  s.counted_cash,

  -- Difference = counted − expected
  CASE
    WHEN s.counted_cash IS NOT NULL THEN
      s.counted_cash
        - (COALESCE(cash_agg.cash_total, 0)
           + COALESCE(cash_agg.card_total, 0)
           - COALESCE(wd_agg.wd_total, 0))
    ELSE NULL
  END AS calculated_cash_difference,

  COALESCE(cash_agg.sales_count, 0)  AS sales_count,
  COALESCE(wd_agg.wd_count, 0)       AS withdrawals_count,

  -- Legacy aliases
  COALESCE(cash_agg.cash_total, 0)   AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0)   AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)       AS withdrawals_total,
  COALESCE(cash_agg.cash_total, 0)
    + COALESCE(cash_agg.card_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS expected_cash,
  s.difference

FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    -- Use cash_amount / card_amount for proper MIXED split accounting
    SUM(COALESCE(sa.cash_amount, CASE WHEN UPPER(sa.payment_method::text) IN ('CASH','MIXED') THEN sa.total ELSE 0 END)) AS cash_total,
    SUM(COALESCE(sa.card_amount, CASE WHEN UPPER(sa.payment_method::text) = 'CARD' THEN sa.total ELSE 0 END))            AS card_total,
    COUNT(*)::int AS sales_count
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT
    SUM(w.amount) AS wd_total,
    COUNT(*)::int AS wd_count
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

ORDER BY s.opened_at DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) UPDATE the live open-session view
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_open_cash_register_status AS
SELECT
  s.id                     AS session_id,
  s.opening_cash,
  COALESCE(cash_agg.cash_total, 0) AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0) AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)    AS withdrawals_total,
  -- current_cash = physical cash in register (includes fondo)
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
    SUM(COALESCE(sa.cash_amount, CASE WHEN UPPER(sa.payment_method::text) IN ('CASH','MIXED') THEN sa.total ELSE 0 END)) AS cash_total,
    SUM(COALESCE(sa.card_amount, CASE WHEN UPPER(sa.payment_method::text) = 'CARD' THEN sa.total ELSE 0 END))            AS card_total
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

WHERE s.closed_at IS NULL
ORDER BY s.opened_at DESC
LIMIT 1;


-- ────────────────────────────────────────────────────────────────────────────
-- 4) UPDATE the close RPC to use cash_amount/card_amount
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_cash_register_session(
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_closed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_cash_sales   NUMERIC;
  v_card_sales   NUMERIC;
  v_withdrawals  NUMERIC;
  v_expected     NUMERIC;
  v_difference   NUMERIC;
BEGIN
  -- Aggregate using cash_amount/card_amount for proper MIXED split
  SELECT
    COALESCE(SUM(COALESCE(cash_amount, CASE WHEN UPPER(payment_method::text) IN ('CASH','MIXED') THEN total ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(card_amount, CASE WHEN UPPER(payment_method::text) = 'CARD' THEN total ELSE 0 END)), 0)
    INTO v_cash_sales, v_card_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id;

  -- Aggregate withdrawals
  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  -- Expected = cash + card − withdrawals (fondo NOT included)
  v_expected   := v_cash_sales + v_card_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  -- Close the session
  UPDATE public.cash_register_sessions
     SET status       = 'closed',
         closed_at    = NOW(),
         closed_by    = p_closed_by,
         counted_cash = p_counted_cash,
         expected_cash = v_expected,
         difference   = v_difference,
         close_notes  = p_notes
   WHERE id = p_session_id
     AND closed_at IS NULL;

  RETURN json_build_object(
    'expected_cash', v_expected,
    'counted_cash',  p_counted_cash,
    'difference',    v_difference
  );
END;
$$ LANGUAGE plpgsql;
