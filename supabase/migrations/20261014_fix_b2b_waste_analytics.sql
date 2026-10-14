BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.normalize_b2b_product_identity_text(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite public.normalize_b2b_product_identity_text(text)';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.v_b2b_waste_events_normalized
WITH (security_invoker = true)
AS
WITH movement_item_counts AS (
  SELECT
    item.movement_id,
    COUNT(*) FILTER (WHERE COALESCE(item.quantity_spoiled, 0) > 0) AS spoilage_item_count,
    COUNT(*) FILTER (WHERE COALESCE(item.quantity_withdrawn, 0) > 0) AS withdrawal_item_count,
    (ARRAY_AGG(item.id ORDER BY item.id) FILTER (WHERE COALESCE(item.quantity_spoiled, 0) > 0))[1] AS spoilage_item_id,
    (ARRAY_AGG(item.id ORDER BY item.id) FILTER (WHERE COALESCE(item.quantity_withdrawn, 0) > 0))[1] AS withdrawal_item_id
  FROM public.commercial_partner_movement_items AS item
  GROUP BY item.movement_id
),
linked_unit_counts AS (
  SELECT
    movement.id AS movement_id,
    COUNT(unit.id) FILTER (
      WHERE unit.spoilage_movement_id = movement.id
        AND unit.status = 'spoiled'
        AND unit.spoiled_at IS NOT NULL
    ) AS spoiled_units,
    COUNT(unit.id) FILTER (
      WHERE unit.return_movement_id = movement.id
        AND unit.status = 'returned_good'
        AND unit.returned_good_at IS NOT NULL
    ) AS withdrawn_units
  FROM public.commercial_partner_movements AS movement
  LEFT JOIN public.commercial_delivery_units AS unit
    ON unit.spoilage_movement_id = movement.id
    OR unit.return_movement_id = movement.id
  GROUP BY movement.id
),
tagged_spoilage AS (
  SELECT
    'tagged_spoilage:unit:' || unit.id::TEXT AS event_identity,
    unit.partner_id,
    COALESCE(NULLIF(BTRIM(partner.business_name), ''), NULLIF(BTRIM(partner.responsible_name), ''), unit.partner_id::TEXT) AS partner_name,
    movement.movement_date::DATE AS event_date,
    unit.product_id,
    unit.product_name,
    unit.product_variant,
    unit.product_size,
    1::NUMERIC AS quantity,
    'tagged_spoilage'::TEXT AS waste_source,
    unit.spoilage_movement_id AS movement_id,
    CASE WHEN counts.spoilage_item_count = 1 THEN counts.spoilage_item_id END AS movement_item_id,
    unit.id AS delivery_unit_id,
    event_item.spoilage_absorbed_by::TEXT AS cost_responsibility,
    NULLIF(source_item.suggested_retail_price, 0)::NUMERIC AS historical_public_price,
    CASE
      WHEN COALESCE(counts.spoilage_item_count, 0) <> 1
        THEN 'ambiguous: tagged spoilage movement does not have exactly one spoilage item'
      WHEN COALESCE(linked.spoiled_units, 0) > COALESCE(event_item.quantity_spoiled, 0)
        THEN 'ambiguous: tagged spoilage units exceed movement item quantity_spoiled'
      WHEN unit.partner_id IS DISTINCT FROM event_item.partner_id
        OR unit.product_id IS DISTINCT FROM event_item.product_id
        OR public.normalize_b2b_product_identity_text(unit.product_name)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_name)
        OR public.normalize_b2b_product_identity_text(unit.product_variant)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_variant)
        OR public.normalize_b2b_product_identity_text(unit.product_size)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_size)
        THEN 'ambiguous: tagged spoilage unit identity does not match movement item product, variant, and size'
      ELSE 'delivery_unit.spoilage_movement_id + unique matching spoilage item'
    END AS deduplication_evidence
  FROM public.commercial_delivery_units AS unit
  JOIN public.commercial_partner_movements AS movement
    ON movement.id = unit.spoilage_movement_id
   AND movement.status = 'completed'
  JOIN public.commercial_partners AS partner ON partner.id = unit.partner_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = unit.spoilage_movement_id
  LEFT JOIN linked_unit_counts AS linked ON linked.movement_id = unit.spoilage_movement_id
  LEFT JOIN public.commercial_partner_movement_items AS event_item ON event_item.id = counts.spoilage_item_id
  LEFT JOIN public.commercial_partner_movement_items AS source_item ON source_item.id = unit.source_item_id
  WHERE unit.status = 'spoiled'
    AND unit.spoilage_movement_id IS NOT NULL
    AND unit.spoiled_at IS NOT NULL
),
tagged_withdrawal AS (
  SELECT
    'withdrawal:unit:' || unit.id::TEXT AS event_identity,
    unit.partner_id,
    COALESCE(NULLIF(BTRIM(partner.business_name), ''), NULLIF(BTRIM(partner.responsible_name), ''), unit.partner_id::TEXT) AS partner_name,
    movement.movement_date::DATE AS event_date,
    unit.product_id,
    unit.product_name,
    unit.product_variant,
    unit.product_size,
    1::NUMERIC AS quantity,
    'withdrawal'::TEXT AS waste_source,
    unit.return_movement_id AS movement_id,
    CASE WHEN counts.withdrawal_item_count = 1 THEN counts.withdrawal_item_id END AS movement_item_id,
    unit.id AS delivery_unit_id,
    NULL::TEXT AS cost_responsibility,
    NULLIF(source_item.suggested_retail_price, 0)::NUMERIC AS historical_public_price,
    CASE
      WHEN COALESCE(counts.withdrawal_item_count, 0) <> 1
        THEN 'ambiguous: tagged withdrawal movement does not have exactly one withdrawal item'
      WHEN COALESCE(linked.withdrawn_units, 0) > COALESCE(event_item.quantity_withdrawn, 0)
        THEN 'ambiguous: tagged withdrawal units exceed movement item quantity_withdrawn'
      WHEN unit.partner_id IS DISTINCT FROM event_item.partner_id
        OR unit.product_id IS DISTINCT FROM event_item.product_id
        OR public.normalize_b2b_product_identity_text(unit.product_name)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_name)
        OR public.normalize_b2b_product_identity_text(unit.product_variant)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_variant)
        OR public.normalize_b2b_product_identity_text(unit.product_size)
          IS DISTINCT FROM public.normalize_b2b_product_identity_text(event_item.product_size)
        THEN 'ambiguous: tagged withdrawal unit identity does not match movement item product, variant, and size'
      ELSE 'delivery_unit.return_movement_id + unique matching withdrawal item'
    END AS deduplication_evidence
  FROM public.commercial_delivery_units AS unit
  JOIN public.commercial_partner_movements AS movement
    ON movement.id = unit.return_movement_id
   AND movement.status = 'completed'
  JOIN public.commercial_partners AS partner ON partner.id = unit.partner_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = unit.return_movement_id
  LEFT JOIN linked_unit_counts AS linked ON linked.movement_id = unit.return_movement_id
  LEFT JOIN public.commercial_partner_movement_items AS event_item ON event_item.id = counts.withdrawal_item_id
  LEFT JOIN public.commercial_partner_movement_items AS source_item ON source_item.id = unit.source_item_id
  WHERE unit.status = 'returned_good'
    AND unit.return_movement_id IS NOT NULL
    AND unit.returned_good_at IS NOT NULL
),
legacy_spoilage AS (
  SELECT
    'legacy_spoilage:item:' || item.id::TEXT AS event_identity,
    movement.partner_id,
    COALESCE(NULLIF(BTRIM(partner.business_name), ''), NULLIF(BTRIM(partner.responsible_name), ''), movement.partner_id::TEXT) AS partner_name,
    movement.movement_date::DATE AS event_date,
    item.product_id,
    item.product_name,
    item.product_variant,
    item.product_size,
    (
      COALESCE(item.quantity_spoiled, 0)
      - CASE WHEN counts.spoilage_item_count = 1 THEN COALESCE(linked.spoiled_units, 0) ELSE 0 END
    )::NUMERIC AS quantity,
    'legacy_spoilage'::TEXT AS waste_source,
    movement.id AS movement_id,
    item.id AS movement_item_id,
    NULL::UUID AS delivery_unit_id,
    item.spoilage_absorbed_by::TEXT AS cost_responsibility,
    NULLIF(item.suggested_retail_price, 0)::NUMERIC AS historical_public_price,
    CASE
      WHEN COALESCE(linked.spoiled_units, 0) = 0 THEN 'movement item has no tagged delivery units'
      WHEN counts.spoilage_item_count = 1 THEN 'movement quantity minus linked tagged delivery units'
      ELSE 'ambiguous: tagged spoilage movement has multiple spoilage items'
    END AS deduplication_evidence
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = movement.id
  LEFT JOIN linked_unit_counts AS linked ON linked.movement_id = movement.id
  WHERE movement.status = 'completed'
    AND COALESCE(item.quantity_spoiled, 0) > 0
    AND (
      COALESCE(item.quantity_spoiled, 0)
      - CASE WHEN counts.spoilage_item_count = 1 THEN COALESCE(linked.spoiled_units, 0) ELSE 0 END
    ) > 0
),
historical_withdrawal AS (
  SELECT
    'withdrawal:item:' || item.id::TEXT AS event_identity,
    movement.partner_id,
    COALESCE(NULLIF(BTRIM(partner.business_name), ''), NULLIF(BTRIM(partner.responsible_name), ''), movement.partner_id::TEXT) AS partner_name,
    movement.movement_date::DATE AS event_date,
    item.product_id,
    item.product_name,
    item.product_variant,
    item.product_size,
    (
      COALESCE(item.quantity_withdrawn, 0)
      - CASE WHEN counts.withdrawal_item_count = 1 THEN COALESCE(linked.withdrawn_units, 0) ELSE 0 END
    )::NUMERIC AS quantity,
    'withdrawal'::TEXT AS waste_source,
    movement.id AS movement_id,
    item.id AS movement_item_id,
    NULL::UUID AS delivery_unit_id,
    NULL::TEXT AS cost_responsibility,
    NULLIF(item.suggested_retail_price, 0)::NUMERIC AS historical_public_price,
    CASE
      WHEN COALESCE(linked.withdrawn_units, 0) = 0 THEN 'movement item has no tagged delivery units'
      WHEN counts.withdrawal_item_count = 1 THEN 'movement quantity minus linked tagged delivery units'
      ELSE 'ambiguous: tagged withdrawal movement has multiple withdrawal items'
    END AS deduplication_evidence
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = movement.id
  LEFT JOIN linked_unit_counts AS linked ON linked.movement_id = movement.id
  WHERE movement.status = 'completed'
    AND COALESCE(item.quantity_withdrawn, 0) > 0
    AND (
      COALESCE(item.quantity_withdrawn, 0)
      - CASE WHEN counts.withdrawal_item_count = 1 THEN COALESCE(linked.withdrawn_units, 0) ELSE 0 END
    ) > 0
),
base_events AS (
  SELECT * FROM tagged_spoilage
  UNION ALL SELECT * FROM legacy_spoilage
  UNION ALL SELECT * FROM tagged_withdrawal
  UNION ALL SELECT * FROM historical_withdrawal
),
resolved_events AS (
  SELECT
    event.*,
    COALESCE(event.product_id, CASE WHEN mapping.candidate_count = 1 THEN mapping.product_id END) AS resolved_product_id,
    mapping.candidate_count
  FROM base_events AS event
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT candidate.product_id)::INTEGER AS candidate_count,
      MIN(candidate.product_id::TEXT)::UUID AS product_id
    FROM public.b2b_product_mappings AS candidate
    WHERE candidate.source_catalog = 'comodato'
      AND candidate.active
      AND event.event_date >= candidate.valid_from
      AND (candidate.valid_to IS NULL OR event.event_date < candidate.valid_to)
      AND public.normalize_b2b_product_identity_text(candidate.source_product_name)
            = public.normalize_b2b_product_identity_text(event.product_name)
      AND public.normalize_b2b_product_identity_text(candidate.source_variant)
            = public.normalize_b2b_product_identity_text(event.product_variant)
      AND public.normalize_b2b_product_identity_text(candidate.source_size)
            = public.normalize_b2b_product_identity_text(event.product_size)
  ) AS mapping ON event.product_id IS NULL
)
SELECT
  event.event_identity,
  event.partner_id,
  event.partner_name,
  event.event_date,
  DATE_TRUNC('month', event.event_date)::DATE AS reporting_month,
  event.resolved_product_id AS product_id,
  event.product_name,
  event.product_variant,
  event.product_size,
  event.quantity,
  event.waste_source,
  event.movement_id,
  event.movement_item_id,
  event.delivery_unit_id,
  event.cost_responsibility,
  product.unit_cost::NUMERIC AS production_unit_cost,
  CASE WHEN product.unit_cost IS NOT NULL THEN event.quantity * product.unit_cost END AS production_cost_total,
  COALESCE(event.historical_public_price, NULLIF(product.price, 0))::NUMERIC AS public_unit_price,
  CASE
    WHEN COALESCE(event.historical_public_price, NULLIF(product.price, 0)) IS NOT NULL
      THEN event.quantity * COALESCE(event.historical_public_price, NULLIF(product.price, 0))
  END AS public_value_total,
  product.unit_cost IS NOT NULL AS production_cost_complete,
  COALESCE(event.historical_public_price, NULLIF(product.price, 0)) IS NOT NULL AS public_value_complete,
  CASE
    WHEN event.historical_public_price IS NOT NULL THEN 'historical_suggested_retail_price_snapshot'
    WHEN NULLIF(product.price, 0) IS NOT NULL THEN 'current_public_product_price'
    ELSE 'public_price_unavailable'
  END AS pricing_source,
  CASE
    WHEN event.product_id IS NULL AND COALESCE(event.candidate_count, 0) > 1
      THEN 'ambiguous: product mapping has multiple active candidates; ' || event.deduplication_evidence
    ELSE event.deduplication_evidence
  END AS deduplication_evidence,
  CASE
    WHEN event.resolved_product_id IS NOT NULL THEN 'product:' || event.resolved_product_id::TEXT
    ELSE 'snapshot:'
      || public.normalize_b2b_product_identity_text(event.product_name) || '|'
      || public.normalize_b2b_product_identity_text(event.product_variant) || '|'
      || public.normalize_b2b_product_identity_text(event.product_size)
  END AS product_key
FROM resolved_events AS event
LEFT JOIN public.products AS product ON product.id = event.resolved_product_id;

REVOKE ALL ON public.v_b2b_waste_events_normalized FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.v_b2b_delivery_product_keys_normalized
WITH (security_invoker = true)
AS
WITH resolved_deliveries AS (
  SELECT
    movement.id AS movement_id,
    item.id AS movement_item_id,
    movement.movement_date::DATE AS event_date,
    item.product_id,
    item.product_name,
    item.product_variant,
    item.product_size,
    item.quantity_delivered::NUMERIC AS quantity_delivered,
    COALESCE(item.product_id, CASE WHEN mapping.candidate_count = 1 THEN mapping.product_id END) AS resolved_product_id,
    COALESCE(mapping.candidate_count, 0) AS mapping_candidate_count
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT candidate.product_id)::INTEGER AS candidate_count,
      MIN(candidate.product_id::TEXT)::UUID AS product_id
    FROM public.b2b_product_mappings AS candidate
    WHERE candidate.source_catalog = 'comodato'
      AND candidate.active
      AND movement.movement_date::DATE >= candidate.valid_from
      AND (candidate.valid_to IS NULL OR movement.movement_date::DATE < candidate.valid_to)
      AND public.normalize_b2b_product_identity_text(candidate.source_product_name)
            = public.normalize_b2b_product_identity_text(item.product_name)
      AND public.normalize_b2b_product_identity_text(candidate.source_variant)
            = public.normalize_b2b_product_identity_text(item.product_variant)
      AND public.normalize_b2b_product_identity_text(candidate.source_size)
            = public.normalize_b2b_product_identity_text(item.product_size)
  ) AS mapping ON item.product_id IS NULL
  WHERE movement.status = 'completed'
    AND movement.movement_type = 'delivery'
    AND COALESCE(item.quantity_delivered, 0) > 0
)
SELECT
  movement_id,
  movement_item_id,
  event_date,
  resolved_product_id AS product_id,
  product_name,
  product_variant,
  product_size,
  quantity_delivered,
  CASE
    WHEN product_id IS NOT NULL THEN 'direct_product_id'
    WHEN mapping_candidate_count = 1 THEN 'unique_mapping'
    WHEN mapping_candidate_count > 1 THEN 'ambiguous'
    ELSE 'unmapped_snapshot'
  END AS mapping_status,
  CASE
    WHEN resolved_product_id IS NOT NULL THEN 'product:' || resolved_product_id::TEXT
    ELSE 'snapshot:'
      || public.normalize_b2b_product_identity_text(product_name) || '|'
      || public.normalize_b2b_product_identity_text(product_variant) || '|'
      || public.normalize_b2b_product_identity_text(product_size)
  END AS product_key
FROM resolved_deliveries;

REVOKE ALL ON public.v_b2b_delivery_product_keys_normalized FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_b2b_waste_analytics_admin(
  p_period_start DATE,
  p_period_end_exclusive DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_result JSONB;
  v_ambiguity_identity TEXT;
  v_ambiguity_reason TEXT;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = v_actor
      AND profile.role = 'admin'
      AND COALESCE(profile.is_active, FALSE)
  ) THEN
    RAISE EXCEPTION 'Active administrator access is required';
  END IF;

  IF p_period_start IS NULL OR p_period_end_exclusive IS NULL
     OR p_period_end_exclusive <= p_period_start THEN
    RAISE EXCEPTION 'A valid inclusive-start, exclusive-end period is required';
  END IF;

  SELECT event.event_identity, event.deduplication_evidence
  INTO v_ambiguity_identity, v_ambiguity_reason
  FROM public.v_b2b_waste_events_normalized AS event
  WHERE event.event_date >= p_period_start
    AND event.event_date < p_period_end_exclusive
    AND event.deduplication_evidence LIKE 'ambiguous:%'
  ORDER BY event.event_date, event.event_identity
  LIMIT 1;

  IF v_ambiguity_identity IS NOT NULL THEN
    RAISE EXCEPTION 'B2B waste reconciliation failed for %: %', v_ambiguity_identity, v_ambiguity_reason;
  END IF;

  SELECT delivery.movement_item_id::TEXT,
         'ambiguous: delivery product mapping has multiple active candidates'
  INTO v_ambiguity_identity, v_ambiguity_reason
  FROM public.v_b2b_delivery_product_keys_normalized AS delivery
  WHERE delivery.event_date >= p_period_start
    AND delivery.event_date < p_period_end_exclusive
    AND delivery.mapping_status = 'ambiguous'
  ORDER BY delivery.event_date, delivery.movement_item_id
  LIMIT 1;

  IF v_ambiguity_identity IS NOT NULL THEN
    RAISE EXCEPTION 'B2B delivery reconciliation failed for movement item %: %', v_ambiguity_identity, v_ambiguity_reason;
  END IF;

  WITH period_events AS (
    SELECT *
    FROM public.v_b2b_waste_events_normalized AS event
    WHERE event.event_date >= p_period_start
      AND event.event_date < p_period_end_exclusive
  ),
  delivered_by_product AS (
    SELECT
      delivery.product_key,
      SUM(delivery.quantity_delivered)::NUMERIC AS delivered_units
    FROM public.v_b2b_delivery_product_keys_normalized AS delivery
    WHERE delivery.event_date >= p_period_start
      AND delivery.event_date < p_period_end_exclusive
    GROUP BY delivery.product_key
  ),
  partner_rows AS (
    SELECT
      event.partner_id,
      MAX(event.partner_name) AS partner_name,
      SUM(event.quantity) AS total_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'tagged_spoilage'), 0) AS tagged_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'legacy_spoilage'), 0) AS legacy_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'withdrawal'), 0) AS withdrawal_units,
      SUM(event.production_cost_total) AS production_cost_total,
      SUM(event.public_value_total) AS public_value_total,
      BOOL_AND(event.production_cost_complete) AS production_cost_complete,
      BOOL_AND(event.public_value_complete) AS public_value_complete,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.production_cost_complete), 0) AS missing_cost_quantity,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.public_value_complete), 0) AS missing_public_price_quantity,
      CASE
        WHEN COUNT(DISTINCT event.cost_responsibility) FILTER (
          WHERE event.waste_source <> 'withdrawal' AND event.cost_responsibility IS NOT NULL
        ) = 1 THEN MAX(event.cost_responsibility) FILTER (
          WHERE event.waste_source <> 'withdrawal' AND event.cost_responsibility IS NOT NULL
        )
        WHEN COUNT(DISTINCT event.cost_responsibility) FILTER (
          WHERE event.waste_source <> 'withdrawal' AND event.cost_responsibility IS NOT NULL
        ) > 1 THEN 'mixed'
        ELSE 'not_recorded'
      END AS cost_responsibility
    FROM period_events AS event
    GROUP BY event.partner_id
  ),
  product_rows AS (
    SELECT
      event.product_key,
      (ARRAY_AGG(event.product_id ORDER BY event.product_id) FILTER (WHERE event.product_id IS NOT NULL))[1] AS product_id,
      MAX(event.product_name) AS product_name,
      MAX(event.product_variant) AS product_variant,
      MAX(event.product_size) AS product_size,
      SUM(event.quantity) AS waste_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'tagged_spoilage'), 0) AS tagged_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'legacy_spoilage'), 0) AS legacy_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'withdrawal'), 0) AS withdrawal_units,
      SUM(event.production_cost_total) AS production_cost_total,
      SUM(event.public_value_total) AS public_value_total,
      BOOL_AND(event.production_cost_complete) AS production_cost_complete,
      BOOL_AND(event.public_value_complete) AS public_value_complete,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.production_cost_complete), 0) AS missing_cost_quantity,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.public_value_complete), 0) AS missing_public_price_quantity
    FROM period_events AS event
    GROUP BY event.product_key
  ),
  totals AS (
    SELECT
      COALESCE(SUM(event.quantity), 0) AS total_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'tagged_spoilage'), 0) AS tagged_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'legacy_spoilage'), 0) AS legacy_spoilage_units,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.waste_source = 'withdrawal'), 0) AS withdrawal_units,
      CASE WHEN COUNT(*) = 0 THEN 0::NUMERIC ELSE SUM(event.production_cost_total) END AS production_cost_total,
      CASE WHEN COUNT(*) = 0 THEN 0::NUMERIC ELSE SUM(event.public_value_total) END AS public_value_total,
      COALESCE(BOOL_AND(event.production_cost_complete), TRUE) AS production_cost_complete,
      COALESCE(BOOL_AND(event.public_value_complete), TRUE) AS public_value_complete,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.production_cost_complete), 0) AS missing_cost_quantity,
      COALESCE(SUM(event.quantity) FILTER (WHERE NOT event.public_value_complete), 0) AS missing_public_price_quantity,
      COALESCE(SUM(event.quantity) FILTER (WHERE event.pricing_source = 'current_public_product_price'), 0) AS current_public_price_quantity
    FROM period_events AS event
  )
  SELECT JSONB_BUILD_OBJECT(
    'period', JSONB_BUILD_OBJECT(
      'start_date', p_period_start,
      'end_date_exclusive', p_period_end_exclusive,
      'timezone', 'America/Mexico_City'
    ),
    'summary', TO_JSONB(totals),
    'partners', COALESCE((
      SELECT JSONB_AGG(
        TO_JSONB(partner_row) || JSONB_BUILD_OBJECT(
          'monthly_waste_percentage', ROUND(partner_row.total_units / NULLIF(totals.total_units, 0), 6)
        )
        ORDER BY partner_row.total_units DESC, partner_row.partner_name
      )
      FROM partner_rows AS partner_row
    ), '[]'::JSONB),
    'products', COALESCE((
      SELECT JSONB_AGG(
        TO_JSONB(product_row) || JSONB_BUILD_OBJECT(
          'delivered_units', delivery.delivered_units,
          'waste_rate', CASE
            WHEN delivery.delivered_units > 0
              THEN ROUND(product_row.waste_units / delivery.delivered_units, 6)
          END
        )
        ORDER BY product_row.waste_units DESC, product_row.product_name
      )
      FROM product_rows AS product_row
      LEFT JOIN delivered_by_product AS delivery USING (product_key)
    ), '[]'::JSONB),
    'details', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(event) ORDER BY event.event_date, event.event_identity)
      FROM period_events AS event
    ), '[]'::JSONB),
    'ambiguities', '[]'::JSONB
  )
  INTO v_result
  FROM totals;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_b2b_waste_analytics_admin(DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_b2b_waste_analytics_admin(DATE, DATE)
  TO authenticated;

COMMENT ON VIEW public.v_b2b_waste_events_normalized IS
  'Read-only normalized B2B spoilage and withdrawal events. Completed movement dates are canonical and tagged identities and quantities must reconcile to their movement item.';
COMMENT ON VIEW public.v_b2b_delivery_product_keys_normalized IS
  'Read-only completed B2B deliveries resolved with the same product identity keys and mapping validity rules used by waste analytics.';
COMMENT ON FUNCTION public.get_b2b_waste_analytics_admin(DATE, DATE) IS
  'Admin-only monthly B2B waste analytics using local Mexico City dates and an exclusive end date.';

COMMIT;
