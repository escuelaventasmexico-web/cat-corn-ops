-- ============================================================================
-- FIX: Efectivo esperado debe ser SOLO dinero físico en caja
-- ============================================================================
--
-- BUG:
--   Para ventas POS con pago en efectivo, cash_amount guarda el monto
--   ENTREGADO por el cliente (antes del cambio), NO el total de la venta.
--   Ejemplo: venta $645, cliente paga $1000 → cash_amount = 1000.
--   La vista sumaba cash_amount → inflaba el efectivo por el cambio devuelto.
--
-- FÓRMULA CORRECTA para cash_total:
--   CASH     → sa.total  (total de la venta, no el efectivo recibido)
--   MIXED    → sa.cash_amount (porción real de efectivo en el split)
--   CARD     → 0 (no es efectivo)
--   TRANSFER → 0 (no es efectivo)
--
-- FÓRMULA CORRECTA para expected_cash:
--   opening_cash + cash_total − withdrawals
--   (tarjeta y transferencia NO entran: no son dinero físico en caja)
--
-- EJEMPLO REAL:
--   fondo=200, ventas efectivo=$645 (pero cashInput total=$822), tarjeta=$207,
--   transfer=$72, retiros=0
--   INCORRECTO (bug): 200 + 822 − 0 = 1022 (o variantes)
--   CORRECTO:         200 + 645 − 0 = 845
--
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) Vista resumen de sesiones
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

  -- ★ Expected = fondo + cash − withdrawals (card/transfer NOT included)
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

  -- Legacy compat columns
  COALESCE(cash_agg.cash_total, 0)   AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0)   AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)       AS withdrawals_total,

  -- ★ expected_cash = fondo + efectivo ventas − retiros
  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS expected_cash,

  s.difference

FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    -- ★ CASH: use sa.total (sale amount), NOT sa.cash_amount (bills received)
    -- ★ MIXED: use sa.cash_amount (actual cash portion of split)
    -- ★ CARD/TRANSFER: 0 (not physical cash)
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CASH'     THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED'    THEN COALESCE(sa.cash_amount, sa.total)
      ELSE 0
    END) AS cash_total,
    -- Card: for display only (does NOT enter expected)
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CARD'     THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED'    THEN COALESCE(sa.card_amount, 0)
      ELSE 0
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
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_open_cash_register_status AS
SELECT
  s.id                     AS session_id,
  s.opening_cash,
  COALESCE(cash_agg.cash_total, 0) AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0) AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)    AS withdrawals_total,
  -- current_cash = physical cash in register
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
    -- ★ Same fix: CASH → sa.total, MIXED → sa.cash_amount
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CASH'     THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED'    THEN COALESCE(sa.cash_amount, sa.total)
      ELSE 0
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'CARD'     THEN sa.total
      WHEN UPPER(sa.payment_method::TEXT) = 'MIXED'    THEN COALESCE(sa.card_amount, 0)
      ELSE 0
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
--    expected = opening_cash + cash (sale totals) − withdrawals
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

  -- ★ CASH → total (sale amount, not bills received)
  -- ★ MIXED → cash_amount (actual cash portion)
  -- ★ CARD/TRANSFER → 0
  SELECT
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'CASH'     THEN total
      WHEN UPPER(payment_method::TEXT) = 'MIXED'    THEN COALESCE(cash_amount, total)
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'CARD'     THEN total
      WHEN UPPER(payment_method::TEXT) = 'MIXED'    THEN COALESCE(card_amount, 0)
      ELSE 0
    END), 0)
    INTO v_cash_sales, v_card_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id;

  -- Aggregate withdrawals
  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  -- ★ Expected = fondo + cash sales − withdrawals (card NOT included)
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
