BEGIN;

DO $$
BEGIN
  IF to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_settlements') IS NULL
     OR to_regclass('public.commission_settlement_items') IS NULL
     OR to_regclass('public.v_commission_events_effective') IS NULL
     OR to_regclass('public.v_commission_event_payment_balances') IS NULL THEN
    RAISE EXCEPTION 'The deployed commission schema is incomplete';
  END IF;

  IF to_regprocedure('public.is_commission_admin()') IS NULL
     OR to_regprocedure('public.create_commission_settlement(uuid,date,date,numeric)') IS NULL
     OR to_regprocedure('public.cancel_commission_settlement_draft(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Required commission administration functions are missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commission_settlement_candidate_events(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS TABLE(
  event_id UUID,
  earned_at TIMESTAMPTZ,
  earned_local_date DATE,
  allocatable_amount NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    event.id AS event_id,
    event.earned_at,
    (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE AS earned_local_date,
    balance.allocatable_amount
  FROM public.v_commission_events_effective AS event
  JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  JOIN public.user_profiles AS seller
    ON seller.id = event.seller_id
  WHERE event.seller_id = p_seller_id
    AND seller.is_active
    AND seller.role IN ('socios_comerciales', 'vendedora')
    AND event.status = 'available'
    AND abs(balance.allocatable_amount) > 0.005
    AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE
      BETWEEN p_period_start AND p_period_end
    AND (
      seller.role = 'socios_comerciales'
      OR (
        seller.role = 'vendedora'
        AND event.source_type = 'prospect_conversion_bonus'
      )
    )
  ORDER BY event.earned_at, event.id;
$$;

REVOKE ALL ON FUNCTION public.commission_settlement_candidate_events(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_commission_settlement_preview(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS TABLE(
  available_total NUMERIC,
  event_count INTEGER,
  first_available_date DATE,
  last_available_date DATE,
  existing_draft_id UUID,
  existing_draft_folio TEXT,
  existing_draft_total NUMERIC,
  existing_draft_created_at TIMESTAMPTZ,
  existing_draft_period_start DATE,
  existing_draft_period_end DATE,
  existing_draft_event_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_commission_admin() = FALSE THEN
    RAISE EXCEPTION 'Solo un administrador puede consultar la vista previa de liquidaciones.';
  END IF;

  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor es obligatorio.';
  END IF;

  IF p_period_start IS NULL
     OR p_period_end IS NULL
     OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'El periodo indicado no es válido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS seller
    WHERE seller.id = p_seller_id
      AND seller.is_active
      AND seller.role IN ('socios_comerciales', 'vendedora')
  ) THEN
    RAISE EXCEPTION 'El usuario seleccionado no puede recibir una liquidación de comisiones.';
  END IF;

  RETURN QUERY
  WITH candidate_totals AS (
    SELECT
      COALESCE(sum(candidate.allocatable_amount), 0)::NUMERIC AS available_total,
      count(*)::INTEGER AS event_count,
      min(candidate.earned_local_date) AS first_available_date,
      max(candidate.earned_local_date) AS last_available_date
    FROM public.commission_settlement_candidate_events(
      p_seller_id,
      p_period_start,
      p_period_end
    ) AS candidate
  ), existing_draft AS (
    SELECT
      settlement.id,
      settlement.folio,
      settlement.total_amount,
      settlement.created_at,
      settlement.period_start,
      settlement.period_end,
      count(item.id)::INTEGER AS event_count
    FROM public.commission_settlements AS settlement
    LEFT JOIN public.commission_settlement_items AS item
      ON item.settlement_id = settlement.id
    WHERE settlement.seller_id = p_seller_id
      AND settlement.status = 'draft'
    GROUP BY settlement.id
    ORDER BY settlement.created_at, settlement.id
    LIMIT 1
  )
  SELECT
    totals.available_total,
    totals.event_count,
    totals.first_available_date,
    totals.last_available_date,
    draft.id,
    draft.folio,
    draft.total_amount,
    draft.created_at,
    draft.period_start,
    draft.period_end,
    draft.event_count
  FROM candidate_totals AS totals
  LEFT JOIN existing_draft AS draft ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_commission_settlement_preview(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_settlement_preview(UUID, DATE, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_amount NUMERIC DEFAULT NULL
)
RETURNS TABLE(
  settlement_id UUID,
  folio TEXT,
  total_amount NUMERIC,
  event_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settlement_id UUID;
  v_folio TEXT;
  v_available_total NUMERIC := 0;
  v_target_amount NUMERIC := 0;
  v_amount_left NUMERIC := 0;
  v_item_amount NUMERIC := 0;
  v_total NUMERIC := 0;
  v_count INTEGER := 0;
  v_pay_all BOOLEAN := FALSE;
  r_event RECORD;
BEGIN
  IF public.is_commission_admin() = FALSE THEN
    RAISE EXCEPTION 'Solo un administrador puede preparar pagos de comisiones.';
  END IF;

  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor es obligatorio.';
  END IF;

  IF p_period_start IS NULL
     OR p_period_end IS NULL
     OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'El periodo indicado no es válido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS seller
    WHERE seller.id = p_seller_id
      AND seller.is_active
      AND seller.role IN ('socios_comerciales', 'vendedora')
  ) THEN
    RAISE EXCEPTION 'El usuario seleccionado no puede recibir una liquidación de comisiones.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.commission_settlements AS settlement
    WHERE settlement.seller_id = p_seller_id
      AND settlement.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'El vendedor ya tiene una liquidación en preparación.';
  END IF;

  IF p_amount IS NOT NULL THEN
    IF p_amount <= 0 THEN
      RAISE EXCEPTION 'El monto a pagar debe ser mayor que cero.';
    END IF;
    IF p_amount <> round(p_amount, 2) THEN
      RAISE EXCEPTION 'El monto a pagar solo puede tener hasta dos decimales.';
    END IF;
  END IF;

  PERFORM event.id
  FROM public.commission_events AS event
  JOIN public.commission_settlement_candidate_events(
    p_seller_id,
    p_period_start,
    p_period_end
  ) AS candidate ON candidate.event_id = event.id
  ORDER BY candidate.earned_at, candidate.event_id
  FOR UPDATE OF event;

  SELECT COALESCE(sum(candidate.allocatable_amount), 0)
  INTO v_available_total
  FROM public.commission_settlement_candidate_events(
    p_seller_id,
    p_period_start,
    p_period_end
  ) AS candidate;

  IF v_available_total <= 0.005 THEN
    RAISE EXCEPTION 'No existen comisiones disponibles para pagar en este periodo.';
  END IF;

  v_target_amount := round(COALESCE(p_amount, v_available_total), 2);

  IF v_target_amount > v_available_total + 0.005 THEN
    RAISE EXCEPTION
      'El monto solicitado (%) supera el saldo disponible del periodo (%).',
      v_target_amount,
      v_available_total;
  END IF;

  v_pay_all := abs(v_target_amount - v_available_total) <= 0.005;
  v_amount_left := v_target_amount;

  INSERT INTO public.commission_settlements (
    seller_id,
    period_start,
    period_end,
    status,
    created_by
  )
  VALUES (
    p_seller_id,
    p_period_start,
    p_period_end,
    'draft',
    auth.uid()
  )
  RETURNING id, commission_settlements.folio
  INTO v_settlement_id, v_folio;

  FOR r_event IN
    SELECT
      candidate.event_id,
      candidate.earned_at,
      candidate.allocatable_amount
    FROM public.commission_settlement_candidate_events(
      p_seller_id,
      p_period_start,
      p_period_end
    ) AS candidate
    ORDER BY candidate.earned_at, candidate.event_id
  LOOP
    EXIT WHEN NOT v_pay_all AND v_amount_left <= 0.005;

    IF v_pay_all THEN
      v_item_amount := r_event.allocatable_amount;
    ELSIF r_event.allocatable_amount < 0 THEN
      v_item_amount := r_event.allocatable_amount;
    ELSE
      v_item_amount := least(r_event.allocatable_amount, v_amount_left);
    END IF;

    IF abs(v_item_amount) > 0.005 THEN
      INSERT INTO public.commission_settlement_items (
        settlement_id,
        commission_event_id,
        amount
      )
      VALUES (
        v_settlement_id,
        r_event.event_id,
        v_item_amount
      );

      v_count := v_count + 1;
      v_amount_left := v_amount_left - v_item_amount;
    END IF;
  END LOOP;

  IF v_count = 0 OR abs(v_amount_left) > 0.005 THEN
    RAISE EXCEPTION
      'No fue posible distribuir exactamente el monto solicitado. Diferencia: %.',
      v_amount_left;
  END IF;

  SELECT settlement.total_amount
  INTO v_total
  FROM public.commission_settlements AS settlement
  WHERE settlement.id = v_settlement_id;

  IF abs(v_total - v_target_amount) > 0.005 THEN
    RAISE EXCEPTION
      'El total de la liquidación (%) no coincide con el monto solicitado (%).',
      v_total,
      v_target_amount;
  END IF;

  RETURN QUERY
  SELECT v_settlement_id, v_folio, v_total, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_commission_settlement(UUID, DATE, DATE, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commission_settlement(UUID, DATE, DATE, NUMERIC)
  TO authenticated;

COMMIT;
