-- CAT CORN · Dinero disponible: cobros confirmados de Pedidos
-- Aplicación: manual en Supabase SQL Editor antes de publicar el frontend.
-- Compatibilidad: agrega una RPC V2; no reemplaza ni elimina la RPC consumida
-- por la interfaz anterior y no modifica ventas, pedidos, gastos ni saldos.

BEGIN;

CREATE OR REPLACE FUNCTION public.finance_month_available_funds_v2(p_month_start DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_base JSONB;
  v_result JSONB;
  v_limitations JSONB;
  v_opening_id UUID;
  v_cutoff_date DATE;
  v_month_end DATE;
  v_order_count INTEGER := 0;
  v_order_cash NUMERIC := 0;
  v_order_card NUMERIC := 0;
  v_order_transfer NUMERIC := 0;
  v_order_total NUMERIC := 0;
  v_unreconciled_count INTEGER := 0;
  v_unreconciled_amount NUMERIC := 0;
  v_known NUMERIC;
  v_exact BOOLEAN;
BEGIN
  IF public.finance_has_available_funds_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;

  IF p_month_start IS NULL
     OR p_month_start <> date_trunc('month', p_month_start)::DATE THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month.';
  END IF;

  -- Reutiliza el contrato vigente para POS, B2B, gastos, pagos de tarjeta,
  -- devoluciones y conciliación del día inicial. Esta función sólo incorpora
  -- los cobros de Pedidos que la etapa anterior dejaba como limitación.
  v_base := public.finance_month_available_funds(p_month_start);

  SELECT opening.id, opening.cutoff_business_date
  INTO v_opening_id, v_cutoff_date
  FROM public.finance_month_opening_balances opening
  WHERE opening.month_start = p_month_start;

  IF NOT FOUND THEN
    RETURN jsonb_set(
      v_base,
      '{inflows}',
      COALESCE(v_base->'inflows', '{}'::JSONB) || jsonb_build_object(
        'order_collections_mxn', 0,
        'order_collections_by_method', jsonb_build_object(
          'count', 0,
          'cash_mxn', 0,
          'card_mxn', 0,
          'transfer_mxn', 0
        )
      ),
      true
    );
  END IF;

  v_month_end := (p_month_start + INTERVAL '1 month')::DATE;

  -- En el flujo de Pedidos una fila de sales con sale_origin='order' se crea
  -- únicamente al accionar "Cobrar pedido". created_at es por ello la fecha
  -- efectiva del cobro en Ciudad de México. Las filas de orders pendientes,
  -- preparadas, canceladas o solamente estimadas no aparecen en esta fuente.
  -- La clasificación es disjunta del POS y cada sales.id se agrega una vez.
  SELECT
    COUNT(*) FILTER (
      WHERE upper(sale.payment_method::TEXT) IN ('CASH','CARD','TRANSFER','MIXED')),
    COALESCE(SUM(CASE upper(sale.payment_method::TEXT)
      WHEN 'CASH' THEN COALESCE(NULLIF(sale.cash_amount, 0), sale.total)
      WHEN 'MIXED' THEN COALESCE(sale.cash_amount, 0)
      ELSE 0 END), 0),
    COALESCE(SUM(CASE upper(sale.payment_method::TEXT)
      WHEN 'CARD' THEN COALESCE(NULLIF(sale.card_amount, 0), sale.total)
      WHEN 'MIXED' THEN COALESCE(sale.card_amount, 0)
      ELSE 0 END), 0),
    COALESCE(SUM(CASE upper(sale.payment_method::TEXT)
      WHEN 'TRANSFER' THEN COALESCE(NULLIF(sale.transfer_amount, 0), sale.total)
      WHEN 'MIXED' THEN COALESCE(sale.transfer_amount, 0)
      ELSE 0 END), 0),
    COUNT(*) FILTER (
      WHERE COALESCE(upper(sale.payment_method::TEXT), '') NOT IN ('CASH','CARD','TRANSFER','MIXED')),
    COALESCE(SUM(sale.total) FILTER (
      WHERE COALESCE(upper(sale.payment_method::TEXT), '') NOT IN ('CASH','CARD','TRANSFER','MIXED')), 0)
  INTO
    v_order_count,
    v_order_cash,
    v_order_card,
    v_order_transfer,
    v_unreconciled_count,
    v_unreconciled_amount
  FROM public.sales sale
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id,
      v_cutoff_date,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE,
      'ORDER_SALE',
      sale.id
    ) IS TRUE
    AND lower(COALESCE(sale.sale_origin, '')) = 'order';

  v_order_total := round((v_order_cash + v_order_card + v_order_transfer)::NUMERIC, 2);
  v_known := round(((v_base->>'known_available_mxn')::NUMERIC + v_order_total)::NUMERIC, 2);

  -- order_sales deja de ocultar todo cobro confirmado. Sólo conserva los
  -- cobros cuyo método no puede traducirse todavía a efectivo disponible.
  v_limitations := COALESCE(v_base->'limitations', '{}'::JSONB)
    || jsonb_build_object(
      'order_sales', jsonb_build_object(
        'count', v_unreconciled_count,
        'amount_mxn', round(v_unreconciled_amount, 2)
      )
    );

  v_exact :=
    COALESCE((v_limitations->'ambiguous_cutoff_movements'->>'count')::INTEGER, 0) = 0
    AND COALESCE((v_limitations->'pending_expenses'->>'count')::INTEGER, 0) = 0
    AND COALESCE((v_limitations->'refunded_pos_sales'->>'count')::INTEGER, 0) = 0
    AND COALESCE((v_limitations->'order_sales'->>'count')::INTEGER, 0) = 0
    AND COALESCE((v_limitations->'delivery_sales'->>'count')::INTEGER, 0) = 0
    AND COALESCE((v_limitations->'unsupported_pos_payments'->>'count')::INTEGER, 0) = 0;

  v_result := jsonb_set(
    v_base,
    '{inflows}',
    COALESCE(v_base->'inflows', '{}'::JSONB) || jsonb_build_object(
      'order_collections_mxn', v_order_total,
      'order_collections_by_method', jsonb_build_object(
        'count', v_order_count,
        'cash_mxn', round(v_order_cash, 2),
        'card_mxn', round(v_order_card, 2),
        'transfer_mxn', round(v_order_transfer, 2)
      )
    ),
    true
  );
  v_result := jsonb_set(v_result, '{limitations}', v_limitations, true);
  v_result := jsonb_set(v_result, '{known_available_mxn}', to_jsonb(v_known), true);
  v_result := jsonb_set(
    v_result,
    '{available_mxn}',
    CASE WHEN v_exact THEN to_jsonb(v_known) ELSE 'null'::JSONB END,
    true
  );
  v_result := jsonb_set(v_result, '{is_exact}', to_jsonb(v_exact), true);
  v_result := jsonb_set(
    v_result,
    '{status}',
    to_jsonb((CASE WHEN v_exact THEN 'EXACT' ELSE 'INCOMPLETE' END)::TEXT),
    true
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_month_available_funds_v2(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_available_funds_v2(DATE) TO authenticated;

COMMENT ON FUNCTION public.finance_month_available_funds_v2(DATE) IS
  'Stage-1 liquidity plus paid order collections by checkout date and payment method; pending/prepared/cancelled orders and delivery settlements remain excluded.';

COMMIT;
