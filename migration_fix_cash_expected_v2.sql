-- ============================================================================
-- FIX: Efectivo esperado debe ser SOLO dinero físico en caja
-- ============================================================================
--
-- PROBLEMA:
--   La fórmula anterior era: expected = cash_sales + card_sales − withdrawals
--   Tarjeta NO es efectivo físico → no debe sumarse al esperado.
--
-- FÓRMULA CORRECTA:
--   expected = opening_cash (fondo) + cash_sales − withdrawals
--
-- EJEMPLO REAL:
--   fondo = 200, efectivo ventas = 645, tarjeta = 207, transfer = 72, retiros = 0
--   INCORRECTO: 645 + 207 − 0 = 852 (o peor con fórmulas viejas → 1029)
--   CORRECTO:   200 + 645 − 0 = 845
--
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) Vista resumen de sesiones
--    expected_cash = opening_cash + cash_sales − withdrawals
--    card_sales_total se mantiene para DISPLAY pero NO entra en expected
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

  -- Calculated columns from actual rows
  COALESCE(cash_agg.cash_total, 0)   AS calculated_cash_sales,
  COALESCE(cash_agg.card_total, 0)   AS calculated_card_sales,
  COALESCE(wd_agg.wd_total, 0)       AS calculated_withdrawals_total,

  -- ★ Expected = fondo + cash − withdrawals (card NOT included — not physical cash)
  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS calculated_expected_cash_on_hand,

  s.counted_cash,

  -- Difference = counted − expected
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

  -- Legacy columns (kept for backwards compat)
  COALESCE(cash_agg.cash_total, 0)   AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0)   AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)       AS withdrawals_total,

  -- ★ expected_cash = fondo + cash − withdrawals (card NOT included)
  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS expected_cash,

  s.difference

FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.cash_amount,
             CASE WHEN UPPER(sa.payment_method::TEXT) IN ('CASH','MIXED')
                  THEN sa.total ELSE 0 END)
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.card_amount,
             CASE WHEN UPPER(sa.payment_method::TEXT) = 'CARD'
                  THEN sa.total ELSE 0 END)
    END) AS card_total,
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
-- 2) Vista de sesión abierta (POS status panel)
--    current_cash = opening_cash + cash_sales − withdrawals (ya estaba bien)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_open_cash_register_status AS
SELECT
  s.id                     AS session_id,
  s.opening_cash,
  COALESCE(cash_agg.cash_total, 0) AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0) AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)    AS withdrawals_total,
  -- current_cash = physical cash in register (fondo + cash sales − withdrawals)
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
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.cash_amount,
             CASE WHEN UPPER(sa.payment_method::TEXT) IN ('CASH','MIXED')
                  THEN sa.total ELSE 0 END)
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.card_amount,
             CASE WHEN UPPER(sa.payment_method::TEXT) = 'CARD'
                  THEN sa.total ELSE 0 END)
    END) AS card_total
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
-- 3) RPC cerrar sesión
--    expected = opening_cash + cash_sales − withdrawals (card NOT included)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_cash_register_session(
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_closed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
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
  -- Get opening cash (fondo)
  SELECT opening_cash INTO v_opening_cash
    FROM public.cash_register_sessions
   WHERE id = p_session_id;

  -- Aggregate cash sales (TRANSFER excluded)
  SELECT
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(cash_amount,
             CASE WHEN UPPER(payment_method::TEXT) IN ('CASH','MIXED')
                  THEN total ELSE 0 END)
    END), 0),
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(card_amount,
             CASE WHEN UPPER(payment_method::TEXT) = 'CARD'
                  THEN total ELSE 0 END)
    END), 0)
    INTO v_cash_sales, v_card_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id;

  -- Aggregate withdrawals
  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  -- ★ Expected = fondo + cash − withdrawals (card NOT included)
  v_expected   := v_opening_cash + v_cash_sales - v_withdrawals;
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.close_cash_register_session(UUID, NUMERIC, UUID, TEXT) TO authenticated;
