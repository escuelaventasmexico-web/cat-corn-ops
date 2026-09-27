BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_comodato_adjustment_preview(
  p_partner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_partner_model TEXT;
  v_pending_balance NUMERIC;
  v_settlements JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated administrator is required';
  END IF;

  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = v_actor
      AND profile.role = 'admin'
      AND COALESCE(profile.is_active, FALSE)
  ) THEN
    RAISE EXCEPTION 'Only an active administrator can preview a Comodato adjustment';
  END IF;

  SELECT LOWER(BTRIM(partner.partner_model::TEXT))
    INTO v_partner_model
  FROM public.commercial_partners AS partner
  WHERE partner.id = p_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commercial partner not found';
  END IF;

  IF v_partner_model IS DISTINCT FROM 'comodato' THEN
    RAISE EXCEPTION 'Commercial partner is not a Comodato partner';
  END IF;

  SELECT public.get_partner_comodato_pending_balance(p_partner_id)
    INTO v_pending_balance;

  WITH settlement_items AS (
    SELECT
      movement.id AS settlement_id,
      movement.movement_date,
      item.id AS movement_item_id,
      item.product_id,
      item.product_name,
      item.product_variant,
      item.product_size,
      COALESCE(item.quantity_sold, 0)::NUMERIC AS quantity_sold,
      COALESCE(item.amount_due, 0)::NUMERIC AS amount_due
    FROM public.commercial_partner_movements AS movement
    JOIN public.commercial_partner_movement_items AS item
      ON item.movement_id = movement.id
    WHERE movement.partner_id = p_partner_id
      AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
      AND LOWER(BTRIM(movement.status)) = 'completed'
      AND COALESCE(item.quantity_sold, 0) > 0
  ), prior_adjustments AS (
    SELECT
      adjustment.adjusts_movement_item_id AS movement_item_id,
      COALESCE(SUM(adjustment.quantity_adjusted), 0)::NUMERIC
        AS quantity_already_adjusted,
      COALESCE(SUM(adjustment.amount_adjusted), 0)::NUMERIC
        AS amount_already_adjusted
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment_movement.partner_id = p_partner_id
      AND LOWER(BTRIM(adjustment_movement.movement_type)) = 'adjustment'
      AND LOWER(BTRIM(adjustment_movement.status)) = 'completed'
      AND adjustment.adjusts_movement_item_id IS NOT NULL
    GROUP BY adjustment.adjusts_movement_item_id
  ), approved_payments AS (
    SELECT
      payment.movement_id AS settlement_id,
      COALESCE(SUM(payment.amount), 0)::NUMERIC AS approved_payment_amount
    FROM public.commercial_partner_payments AS payment
    WHERE payment.partner_id = p_partner_id
      AND LOWER(BTRIM(payment.status)) IN ('completed', 'paid')
      AND payment.movement_id IS NOT NULL
    GROUP BY payment.movement_id
  ), active_payment_requests AS (
    SELECT DISTINCT request.movement_id AS settlement_id
    FROM public.partner_payment_verification_requests AS request
    WHERE request.partner_id = p_partner_id
      AND request.scheme = 'comodato'
      AND LOWER(BTRIM(COALESCE(request.status, ''))) IN ('draft', 'pending_review')
      AND request.movement_id IS NOT NULL
  ), commission_state AS (
    SELECT
      event.id AS commission_event_id,
      event.source_id AS settlement_id,
      event.source_item_id AS movement_item_id,
      COALESCE(event.commission_amount, 0)::NUMERIC AS commission_amount,
      COALESCE(event.unit_commission, 0)::NUMERIC AS unit_commission,
      event.status AS commission_status,
      COALESCE(balance.paid_amount, 0)::NUMERIC AS paid_amount,
      COALESCE(balance.reserved_amount, 0)::NUMERIC AS reserved_amount,
      balance.payment_status,
      EXISTS (
        SELECT 1
        FROM public.commission_settlement_items AS settlement_item
        JOIN public.commission_settlements AS settlement
          ON settlement.id = settlement_item.settlement_id
        WHERE settlement_item.commission_event_id = event.id
          AND settlement.status IS DISTINCT FROM 'cancelled'
      ) AS in_non_cancelled_commission_settlement
    FROM public.commission_events AS event
    LEFT JOIN public.v_commission_event_payment_balances AS balance
      ON balance.commission_event_id = event.id
    WHERE event.source_type = 'comodato_sale'
      AND event.partner_id = p_partner_id
  ), item_base AS (
    SELECT
      settlement_item.*,
      COALESCE(adjustment.quantity_already_adjusted, 0)::NUMERIC
        AS quantity_already_adjusted,
      COALESCE(adjustment.amount_already_adjusted, 0)::NUMERIC
        AS amount_already_adjusted,
      COALESCE(payment.approved_payment_amount, 0)::NUMERIC
        AS approved_payment_amount,
      commission.commission_event_id,
      commission.commission_amount,
      commission.unit_commission,
      commission.commission_status,
      commission.paid_amount,
      commission.reserved_amount,
      commission.payment_status,
      COALESCE(commission.in_non_cancelled_commission_settlement, FALSE)
        AS in_non_cancelled_commission_settlement,
      request.settlement_id IS NOT NULL AS has_active_payment_request
    FROM settlement_items AS settlement_item
    LEFT JOIN prior_adjustments AS adjustment
      ON adjustment.movement_item_id = settlement_item.movement_item_id
    LEFT JOIN approved_payments AS payment
      ON payment.settlement_id = settlement_item.settlement_id
    LEFT JOIN active_payment_requests AS request
      ON request.settlement_id = settlement_item.settlement_id
    LEFT JOIN commission_state AS commission
      ON commission.settlement_id = settlement_item.settlement_id
     AND commission.movement_item_id = settlement_item.movement_item_id
  ), movement_totals AS (
    SELECT
      base.settlement_id,
      COALESCE(SUM(base.amount_due - base.amount_already_adjusted), 0)::NUMERIC
        AS effective_amount,
      MAX(base.approved_payment_amount)::NUMERIC AS approved_payment_amount
    FROM item_base AS base
    GROUP BY base.settlement_id
  ), eligibility AS (
    SELECT
      base.*,
      GREATEST(base.quantity_sold - base.quantity_already_adjusted, 0)::NUMERIC
        AS remaining_quantity,
      GREATEST(base.amount_due - base.amount_already_adjusted, 0)::NUMERIC
        AS remaining_amount,
      GREATEST(total.effective_amount - total.approved_payment_amount, 0)::NUMERIC
        AS movement_adjustable_amount,
      (
        ABS(COALESCE(base.paid_amount, 0)) > 0.005
        OR ABS(COALESCE(base.reserved_amount, 0)) > 0.005
        OR LOWER(COALESCE(base.payment_status, '')) IN ('paid', 'partially_paid')
        OR base.in_non_cancelled_commission_settlement
      ) AS has_protected_commission
    FROM item_base AS base
    JOIN movement_totals AS total
      ON total.settlement_id = base.settlement_id
  ), capped AS (
    SELECT
      eligibility.*,
      CASE
        WHEN eligibility.has_protected_commission
          OR eligibility.has_active_payment_request
          OR eligibility.remaining_quantity <= 0
          OR eligibility.movement_adjustable_amount <= 0.005
        THEN 0
        ELSE cap.max_quantity
      END::INTEGER AS max_adjustable_quantity
    FROM eligibility
    CROSS JOIN LATERAL (
      SELECT COALESCE(MAX(candidate.quantity), 0)::INTEGER AS max_quantity
      FROM generate_series(
        0,
        GREATEST(FLOOR(eligibility.remaining_quantity), 0)::INTEGER
      ) AS candidate(quantity)
      WHERE CASE
        WHEN candidate.quantity = eligibility.remaining_quantity
          THEN eligibility.remaining_amount
        ELSE ROUND(
          eligibility.amount_due * candidate.quantity / eligibility.quantity_sold,
          2
        )
      END <= eligibility.movement_adjustable_amount + 0.005
    ) AS cap
  ), calculated AS (
    SELECT
      capped.*,
      CASE
        WHEN capped.max_adjustable_quantity <= 0 THEN 0::NUMERIC
        WHEN capped.max_adjustable_quantity = capped.remaining_quantity
          THEN capped.remaining_amount
        ELSE ROUND(
          capped.amount_due * capped.max_adjustable_quantity / capped.quantity_sold,
          2
        )
      END::NUMERIC AS max_adjustable_amount,
      (
        capped.max_adjustable_quantity * COALESCE(capped.unit_commission, 0)
      )::NUMERIC AS estimated_commission_reduction,
      CASE
        WHEN capped.has_protected_commission
          THEN 'Esta comisión ya fue pagada, reservada o incluida en una liquidación de comisiones.'
        WHEN capped.has_active_payment_request
          THEN 'Hay una solicitud de pago activa para esta liquidación.'
        WHEN capped.remaining_quantity <= 0
          THEN 'No quedan piezas por corregir en este renglón.'
        WHEN capped.movement_adjustable_amount <= 0.005
          THEN 'La liquidación ya está cubierta por pagos aprobados.'
        WHEN capped.max_adjustable_quantity <= 0
          THEN 'No hay una cantidad entera que pueda ajustarse sin afectar pagos aprobados.'
        ELSE NULL
      END AS blocked_reason
    FROM capped
  ), settlement_json AS (
    SELECT
      calculated.settlement_id,
      MAX(calculated.movement_date) AS movement_date,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'movement_item_id', calculated.movement_item_id,
          'product_id', calculated.product_id,
          'product_name', calculated.product_name,
          'product_variant', calculated.product_variant,
          'product_size', calculated.product_size,
          'quantity_sold', calculated.quantity_sold,
          'amount_due', calculated.amount_due,
          'quantity_already_adjusted', calculated.quantity_already_adjusted,
          'amount_already_adjusted', calculated.amount_already_adjusted,
          'approved_payment_amount', calculated.approved_payment_amount,
          'commission_event_id', calculated.commission_event_id,
          'commission_amount', calculated.commission_amount,
          'unit_commission', calculated.unit_commission,
          'commission_status', calculated.commission_status,
          'commission_payment_status', calculated.payment_status,
          'commission_paid_amount', calculated.paid_amount,
          'commission_reserved_amount', calculated.reserved_amount,
          'in_non_cancelled_commission_settlement',
            calculated.in_non_cancelled_commission_settlement,
          'has_active_payment_request', calculated.has_active_payment_request,
          'max_adjustable_quantity', calculated.max_adjustable_quantity,
          'max_adjustable_amount', calculated.max_adjustable_amount,
          'estimated_commission_reduction',
            calculated.estimated_commission_reduction,
          'blocked', calculated.blocked_reason IS NOT NULL,
          'blocked_reason', calculated.blocked_reason
        )
        ORDER BY calculated.movement_item_id
      ) AS items
    FROM calculated
    GROUP BY calculated.settlement_id
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'settlement_id', settlement_json.settlement_id,
        'settlement_reference', LEFT(settlement_json.settlement_id::TEXT, 8),
        'movement_date', settlement_json.movement_date,
        'items', settlement_json.items
      )
      ORDER BY settlement_json.movement_date DESC, settlement_json.settlement_id
    ),
    '[]'::JSONB
  )
  INTO v_settlements
  FROM settlement_json;

  RETURN JSONB_BUILD_OBJECT(
    'partner_id', p_partner_id,
    'pending_balance', COALESCE(v_pending_balance, 0),
    'settlements', COALESCE(v_settlements, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_comodato_adjustment_preview(UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_comodato_adjustment_preview(UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_comodato_adjustment_preview(UUID)
  TO authenticated;

REVOKE SELECT ON TABLE public.v_commission_event_payment_balances
  FROM PUBLIC, anon, authenticated;

COMMIT;
