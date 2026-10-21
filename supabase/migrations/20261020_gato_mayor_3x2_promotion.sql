-- CAT CORN: prospective 3 x 2 Gato Mayor POS promotion.
-- IMPORTANT: do not apply until the read-only recalculate_sale_total preflight
-- shipped with this change has been reviewed. No historical rows are changed.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_rules') IS NULL
     OR to_regclass('public.commission_program_eligibility_snapshots') IS NULL
     OR to_regprocedure('public.recalculate_sale_total(uuid)') IS NULL
     OR to_regprocedure('public.user_has_branch_access(uuid)') IS NULL
     OR to_regprocedure('public.get_commission_rule_id(text,text,date)') IS NULL
     OR to_regprocedure('public.get_commission_rule_amount(text,text,date)') IS NULL THEN
    RAISE EXCEPTION 'Required deployed POS objects are missing';
  END IF;
  IF to_regprocedure('public.create_gato_mayor_3x2_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '3x2 checkout RPC already exists; stop and compare definitions';
  END IF;
END;
$$;

CREATE TABLE public.pos_promotion_checkouts (
  checkout_token UUID PRIMARY KEY,
  sale_id UUID NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE RESTRICT,
  cashier_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  request_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pos_promotion_groups (
  id UUID PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  group_number INTEGER NOT NULL CHECK (group_number > 0),
  promotion_code TEXT NOT NULL CHECK (promotion_code = 'GATO_MAYOR_3X2'),
  free_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  discount_amount NUMERIC(12,2) NOT NULL CHECK (discount_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, group_number)
);

ALTER TABLE public.sale_items
  ADD COLUMN promotion_group_id UUID
  REFERENCES public.pos_promotion_groups(id) ON DELETE RESTRICT;

CREATE INDEX idx_sale_items_promotion_group
  ON public.sale_items(promotion_group_id)
  WHERE promotion_group_id IS NOT NULL;
CREATE INDEX idx_pos_promotion_groups_sale
  ON public.pos_promotion_groups(sale_id);

COMMENT ON TABLE public.pos_promotion_groups IS
  'One immutable 3-unit group per application of a POS promotion.';
COMMENT ON COLUMN public.sale_items.promotion_group_id IS
  'Stable promotion group. A sale item can belong to at most one group.';

ALTER TABLE public.pos_promotion_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_promotion_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_promotion_groups_branch_read
ON public.pos_promotion_groups FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sales AS sale
    WHERE sale.id = pos_promotion_groups.sale_id
      AND public.user_has_branch_access(sale.branch_id)
  )
);

REVOKE ALL ON public.pos_promotion_checkouts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pos_promotion_groups FROM PUBLIC, anon;
GRANT SELECT ON public.pos_promotion_groups TO authenticated;

INSERT INTO public.commission_rules (
  scheme, product_key, product_name, commission_type, commission_amount,
  currency, valid_from, active, notes
)
VALUES
  ('vendedora_pos', 'gato_mayor_3x2', 'Promoción 3 x 2 Gato Mayor', 'fixed_bonus', 5.00, 'MXN', DATE '2026-10-20', TRUE,
   'Una comisión fija por grupo promocional; no por bolsa.'),
  ('venta_pieza', 'gato_mayor_3x2', 'Promoción 3 x 2 Gato Mayor', 'fixed_bonus', 5.00, 'MXN', DATE '2026-10-20', TRUE,
   'Una comisión fija por grupo promocional; no por bolsa.')
ON CONFLICT (scheme, product_key, valid_from) DO UPDATE
SET product_name = EXCLUDED.product_name,
    commission_type = EXCLUDED.commission_type,
    commission_amount = EXCLUDED.commission_amount,
    currency = EXCLUDED.currency,
    active = EXCLUDED.active,
    notes = EXCLUDED.notes,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.create_gato_mayor_3x2_pos_sale(
  p_branch_id UUID,
  p_cash_session_id UUID,
  p_checkout_token UUID,
  p_attribution_mode TEXT,
  p_commission_recipient_id UUID,
  p_total NUMERIC,
  p_payment_method TEXT,
  p_cash_amount NUMERIC,
  p_card_amount NUMERIC,
  p_transfer_amount NUMERIC,
  p_customer_id UUID,
  p_items JSONB,
  p_groups JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale_id UUID;
  v_sale_created_at TIMESTAMPTZ;
  v_existing public.pos_promotion_checkouts%ROWTYPE;
  v_payload JSONB;
  v_item RECORD;
  v_group RECORD;
  v_selection RECORD;
  v_product public.products%ROWTYPE;
  v_free_product_id UUID;
  v_free_price NUMERIC;
  v_free_used BOOLEAN;
  v_base_total NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_expected_total NUMERIC;
  v_actual_total NUMERIC;
  v_grouped_quantity INTEGER;
  v_recipient_id UUID;
  v_profile public.user_profiles%ROWTYPE;
  v_scheme TEXT;
  v_rule_id UUID;
  v_event_id UUID;
  v_business_date DATE;
  v_expected_commissions INTEGER := 0;
  v_actual_commissions INTEGER := 0;
  v_actual_commission_amount NUMERIC := 0;
  v_method TEXT := upper(btrim(COALESCE(p_payment_method, '')));
  v_cash NUMERIC := COALESCE(p_cash_amount, 0);
  v_card NUMERIC := COALESCE(p_card_amount, 0);
  v_transfer NUMERIC := COALESCE(p_transfer_amount, 0);
  v_aurrera CONSTANT UUID := 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active authenticated branch access is required';
  END IF;
  IF p_checkout_token IS NULL THEN RAISE EXCEPTION 'A checkout token is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
     OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'Items and complete promotion groups are required';
  END IF;
  IF v_method NOT IN ('CASH', 'CARD', 'MIXED', 'TRANSFER') OR COALESCE(p_total, 0) <= 0
     OR v_cash < 0 OR v_card < 0 OR v_transfer < 0 THEN
    RAISE EXCEPTION 'Invalid direct POS payment';
  END IF;
  IF (v_method = 'CASH' AND (v_cash + 0.009 < p_total OR v_card <> 0 OR v_transfer <> 0))
     OR (v_method = 'CARD' AND (v_card + 0.009 < p_total OR v_cash <> 0 OR v_transfer <> 0))
     OR (v_method = 'MIXED' AND (v_cash <= 0 OR v_card <= 0 OR v_transfer <> 0 OR v_cash + v_card + 0.009 < p_total))
     OR (v_method = 'TRANSFER' AND (abs(v_transfer - p_total) > 0.009 OR v_cash <> 0 OR v_card <> 0)) THEN
    RAISE EXCEPTION 'Payment amounts do not match the selected method';
  END IF;

  IF p_branch_id = v_aurrera THEN
    IF p_attribution_mode NOT IN ('employee', 'administrator') THEN
      RAISE EXCEPTION 'Aurrera requires cashier attribution';
    END IF;
  ELSIF p_attribution_mode IS NOT NULL OR p_commission_recipient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Delegated attribution is exclusive to Aurrera';
  END IF;

  v_payload := jsonb_build_object(
    'branch_id', p_branch_id, 'cash_session_id', p_cash_session_id,
    'attribution_mode', p_attribution_mode, 'commission_recipient_id', p_commission_recipient_id,
    'total', p_total, 'payment_method', v_method, 'cash_amount', v_cash,
    'card_amount', v_card, 'transfer_amount', v_transfer, 'customer_id', p_customer_id,
    'items', p_items, 'groups', p_groups
  );
  PERFORM pg_advisory_xact_lock(hashtext(p_checkout_token::TEXT));
  SELECT checkout.* INTO v_existing
  FROM public.pos_promotion_checkouts AS checkout
  WHERE checkout.checkout_token = p_checkout_token;
  IF v_existing.checkout_token IS NOT NULL THEN
    IF v_existing.cashier_id IS DISTINCT FROM auth.uid()
       OR v_existing.request_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'The checkout token was already used with different sale data';
    END IF;
    RETURN v_existing.sale_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID, product_name TEXT, is_generic BOOLEAN, quantity INTEGER,
      client_unit_price NUMERIC, selected_beverage_product_id UUID
    )
    WHERE COALESCE(item.quantity, 0) <= 0
       OR (COALESCE(item.is_generic, FALSE) AND (item.product_id IS NOT NULL OR NULLIF(btrim(COALESCE(item.product_name, '')), '') IS NULL OR item.client_unit_price < 0))
       OR (NOT COALESCE(item.is_generic, FALSE) AND item.product_id IS NULL)
  ) OR EXISTS (
    SELECT item.product_id FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID, product_name TEXT, is_generic BOOLEAN, quantity INTEGER,
      client_unit_price NUMERIC, selected_beverage_product_id UUID
    )
    JOIN public.products AS product ON product.id = item.product_id
    WHERE upper(product.sku_code) IN ('SLGM180', 'SBGM180', 'CAGM180')
    GROUP BY item.product_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid or duplicate sale item payload';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID, product_name TEXT, is_generic BOOLEAN, quantity INTEGER,
      client_unit_price NUMERIC, selected_beverage_product_id UUID
    )
  LOOP
    IF COALESCE(v_item.is_generic, FALSE) THEN
      v_base_total := v_base_total + v_item.client_unit_price * v_item.quantity;
    ELSE
      SELECT product.* INTO v_product FROM public.products AS product WHERE product.id = v_item.product_id;
      IF v_product.id IS NULL OR NOT COALESCE(v_product.active, FALSE) THEN
        RAISE EXCEPTION 'Inactive or missing product %', v_item.product_id;
      END IF;
      v_base_total := v_base_total + v_product.price * v_item.quantity;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT group_id FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
    CROSS JOIN LATERAL (SELECT promo_group.id AS group_id) AS ids
    GROUP BY group_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT group_number FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
    GROUP BY group_number HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate promotion group identity'; END IF;

  FOR v_group IN
    SELECT * FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
    ORDER BY group_number
  LOOP
    IF v_group.id IS NULL OR v_group.group_number <= 0 OR jsonb_typeof(v_group.items) IS DISTINCT FROM 'array'
       OR (SELECT COALESCE(sum(quantity), 0) FROM jsonb_to_recordset(v_group.items) AS x(product_id UUID, quantity INTEGER)) <> 3
       OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_group.items) AS x(product_id UUID, quantity INTEGER) WHERE product_id IS NULL OR quantity <= 0)
       OR EXISTS (SELECT product_id FROM jsonb_to_recordset(v_group.items) AS x(product_id UUID, quantity INTEGER) GROUP BY product_id HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Each promotion group must contain exactly three valid units';
    END IF;

    SELECT product.id, product.price INTO v_free_product_id, v_free_price
    FROM jsonb_to_recordset(v_group.items) AS selection(product_id UUID, quantity INTEGER)
    JOIN public.products AS product ON product.id = selection.product_id
    WHERE upper(product.sku_code) IN ('SLGM180', 'SBGM180', 'CAGM180')
      AND COALESCE(product.active, FALSE)
    ORDER BY product.price, product.sku_code, product.id
    LIMIT 1;
    IF v_free_product_id IS NULL
       OR (SELECT count(*) FROM jsonb_to_recordset(v_group.items) AS selection(product_id UUID, quantity INTEGER)
           JOIN public.products AS product ON product.id = selection.product_id
           WHERE upper(product.sku_code) IN ('SLGM180', 'SBGM180', 'CAGM180') AND COALESCE(product.active, FALSE))
          <> jsonb_array_length(v_group.items) THEN
      RAISE EXCEPTION 'Promotion groups accept only the three configured Gato Mayor SKUs';
    END IF;
    v_discount_total := v_discount_total + v_free_price;
  END LOOP;

  IF EXISTS (
    SELECT grouped.product_id
    FROM (
      SELECT selection.product_id, sum(selection.quantity)::INTEGER AS quantity
      FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
      CROSS JOIN LATERAL jsonb_to_recordset(promo_group.items) AS selection(product_id UUID, quantity INTEGER)
      GROUP BY selection.product_id
    ) AS grouped
    LEFT JOIN (
      SELECT item.product_id, sum(item.quantity)::INTEGER AS quantity
      FROM jsonb_to_recordset(p_items) AS item(
        product_id UUID, product_name TEXT, is_generic BOOLEAN, quantity INTEGER,
        client_unit_price NUMERIC, selected_beverage_product_id UUID
      )
      WHERE NOT COALESCE(item.is_generic, FALSE)
      GROUP BY item.product_id
    ) AS cart_item ON cart_item.product_id = grouped.product_id
    WHERE cart_item.product_id IS NULL OR grouped.quantity > cart_item.quantity
  ) THEN RAISE EXCEPTION 'A promotion unit is missing from the cart or belongs to more than one group'; END IF;

  v_expected_total := round(v_base_total - v_discount_total, 2);
  IF abs(v_expected_total - p_total) > 0.009 THEN
    RAISE EXCEPTION 'Catalog total mismatch: expected %, received %', v_expected_total, p_total;
  END IF;

  INSERT INTO public.sales (
    total, payment_method, cash_amount, card_amount, transfer_amount,
    sale_origin, delivery_platform, platform_amount, cashier_id, customer_id,
    loyalty_reward_applied, loyalty_discount_amount, promotion_code,
    branch_id, cash_session_id, pos_commission_attribution,
    pos_commission_recipient_id, checkout_token
  ) VALUES (
    p_total, v_method, v_cash, v_card, v_transfer,
    'pos', NULL, 0, auth.uid(), p_customer_id,
    FALSE, v_discount_total, 'GATO_MAYOR_3X2',
    p_branch_id, p_cash_session_id,
    CASE WHEN p_branch_id = v_aurrera THEN p_attribution_mode ELSE NULL END,
    CASE WHEN p_branch_id = v_aurrera THEN p_commission_recipient_id ELSE NULL END,
    CASE WHEN p_branch_id = v_aurrera THEN p_checkout_token ELSE NULL END
  ) RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  FOR v_group IN
    SELECT * FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
    ORDER BY group_number
  LOOP
    SELECT product.id, product.price INTO v_free_product_id, v_free_price
    FROM jsonb_to_recordset(v_group.items) AS selection(product_id UUID, quantity INTEGER)
    JOIN public.products AS product ON product.id = selection.product_id
    ORDER BY product.price, product.sku_code, product.id LIMIT 1;

    INSERT INTO public.pos_promotion_groups(id, sale_id, group_number, promotion_code, free_product_id, discount_amount)
    VALUES (v_group.id, v_sale_id, v_group.group_number, 'GATO_MAYOR_3X2', v_free_product_id, v_free_price);

    v_free_used := FALSE;
    FOR v_selection IN
      SELECT selection.*, product.price, COALESCE(NULLIF(btrim(product.product_name), ''), product.name) AS product_name
      FROM jsonb_to_recordset(v_group.items) AS selection(product_id UUID, quantity INTEGER)
      JOIN public.products AS product ON product.id = selection.product_id
      ORDER BY product.price, product.sku_code, product.id
    LOOP
      FOR v_grouped_quantity IN 1..v_selection.quantity LOOP
        INSERT INTO public.sale_items(
          sale_id, product_id, product_name, is_generic, quantity, price,
          discount_amount, discount_reason, selected_beverage_product_id, promotion_group_id
        ) VALUES (
          v_sale_id, v_selection.product_id, v_selection.product_name, FALSE, 1,
          CASE WHEN NOT v_free_used AND v_selection.product_id = v_free_product_id THEN 0 ELSE v_selection.price END,
          CASE WHEN NOT v_free_used AND v_selection.product_id = v_free_product_id THEN v_selection.price ELSE 0 END,
          'PROMO_GATO_MAYOR_3X2', NULL, v_group.id
        );
        IF NOT v_free_used AND v_selection.product_id = v_free_product_id THEN v_free_used := TRUE; END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID, product_name TEXT, is_generic BOOLEAN, quantity INTEGER,
      client_unit_price NUMERIC, selected_beverage_product_id UUID
    )
  LOOP
    SELECT COALESCE(sum(selection.quantity), 0)::INTEGER INTO v_grouped_quantity
    FROM jsonb_to_recordset(p_groups) AS promo_group(id UUID, group_number INTEGER, items JSONB)
    CROSS JOIN LATERAL jsonb_to_recordset(promo_group.items) AS selection(product_id UUID, quantity INTEGER)
    WHERE selection.product_id = v_item.product_id;
    IF v_item.quantity > v_grouped_quantity THEN
      IF COALESCE(v_item.is_generic, FALSE) THEN
        INSERT INTO public.sale_items(sale_id, product_id, product_name, is_generic, quantity, price, discount_amount)
        VALUES (v_sale_id, NULL, v_item.product_name, TRUE, v_item.quantity, v_item.client_unit_price, 0);
      ELSE
        SELECT product.* INTO v_product FROM public.products AS product WHERE product.id = v_item.product_id;
        INSERT INTO public.sale_items(
          sale_id, product_id, product_name, is_generic, quantity, price,
          discount_amount, selected_beverage_product_id
        ) VALUES (
          v_sale_id, v_item.product_id, COALESCE(NULLIF(btrim(v_product.product_name), ''), v_product.name), FALSE,
          v_item.quantity - v_grouped_quantity, v_product.price, 0, v_item.selected_beverage_product_id
        );
      END IF;
    END IF;
  END LOOP;

  -- Replace the per-bag events emitted by the legacy trigger inside this same
  -- transaction. Nothing historical is deleted and normal cart lines remain.
  DELETE FROM public.commission_events AS event
  USING public.sale_items AS item
  WHERE item.sale_id = v_sale_id AND item.promotion_group_id IS NOT NULL
    AND event.source_type = 'pos_sale' AND event.source_item_id = item.id;
  DELETE FROM public.commission_program_eligibility_snapshots AS snapshot
  USING public.sale_items AS item
  WHERE item.sale_id = v_sale_id AND item.promotion_group_id IS NOT NULL
    AND snapshot.program = 'vendedora_pos' AND snapshot.commercial_scheme = 'pos'
    AND snapshot.source_item_id = item.id;

  IF p_branch_id = v_aurrera THEN
    v_recipient_id := CASE WHEN p_attribution_mode = 'employee' THEN p_commission_recipient_id ELSE NULL END;
  ELSE
    v_recipient_id := auth.uid();
  END IF;
  SELECT profile.* INTO v_profile FROM public.user_profiles AS profile WHERE profile.id = v_recipient_id;
  IF v_recipient_id IS NOT NULL AND v_profile.is_active
     AND v_profile.id IN ('b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID, '682568c5-4339-4af5-85ef-71c8b2febd59'::UUID) THEN
    v_scheme := CASE WHEN v_profile.role::TEXT = 'socios_comerciales' THEN 'venta_pieza' ELSE 'vendedora_pos' END;
    v_business_date := (v_sale_created_at AT TIME ZONE 'America/Mexico_City')::DATE;
    v_rule_id := public.get_commission_rule_id(v_scheme, 'gato_mayor_3x2', v_business_date);
    IF v_rule_id IS NULL OR public.get_commission_rule_amount(v_scheme, 'gato_mayor_3x2', v_business_date) <> 5 THEN
      RAISE EXCEPTION 'The required 3x2 commission rule is not effective';
    END IF;
    FOR v_group IN SELECT * FROM public.pos_promotion_groups WHERE sale_id = v_sale_id LOOP
      INSERT INTO public.commission_events(
        seller_id, partner_id, source_type, source_id, source_item_id, rule_id,
        product_key, product_name, product_variant, product_size, quantity,
        unit_commission, commission_amount, release_condition, status, earned_at,
        available_at, metadata
      ) VALUES (
        v_recipient_id, NULL, 'pos_sale', v_sale_id, v_group.id, v_rule_id,
        'gato_mayor_3x2', 'Promoción 3 x 2 Gato Mayor', NULL, '3 bolsas', 1,
        5, 5, 'full_payment', 'available', v_sale_created_at, v_sale_created_at,
        jsonb_build_object('channel', 'pos', 'promotion_code', 'GATO_MAYOR_3X2',
          'promotion_group_id', v_group.id, 'sale_id', v_sale_id,
          'authenticated_cashier_id', auth.uid(), 'commission_recipient_id', v_recipient_id,
          'commission_scheme', v_scheme, 'business_date', v_business_date)
      ) RETURNING id INTO v_event_id;
      IF v_event_id IS NULL THEN RAISE EXCEPTION 'Promotional commission was not created'; END IF;
      v_expected_commissions := v_expected_commissions + 1;
    END LOOP;
  END IF;

  SELECT count(*), COALESCE(sum(event.commission_amount), 0)
  INTO v_actual_commissions, v_actual_commission_amount
  FROM public.commission_events AS event
  JOIN public.pos_promotion_groups AS promo_group ON promo_group.id = event.source_item_id
  WHERE promo_group.sale_id = v_sale_id AND event.source_type = 'pos_sale';
  IF v_actual_commissions <> v_expected_commissions
     OR v_actual_commission_amount <> v_expected_commissions * 5 THEN
    RAISE EXCEPTION 'Promotional commission invariant failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_events AS event
    JOIN public.sale_items AS item ON item.id = event.source_item_id
    WHERE item.sale_id = v_sale_id AND item.promotion_group_id IS NOT NULL AND event.source_type = 'pos_sale'
  ) THEN RAISE EXCEPTION 'Duplicate per-bag promotional commission detected'; END IF;

  SELECT sale.total INTO v_actual_total FROM public.sales AS sale WHERE sale.id = v_sale_id;
  IF abs(v_actual_total - v_expected_total) > 0.009 THEN
    RAISE EXCEPTION 'Persisted total differs from the independently verified catalog total';
  END IF;

  INSERT INTO public.pos_promotion_checkouts(checkout_token, sale_id, cashier_id, branch_id, request_payload)
  VALUES (p_checkout_token, v_sale_id, auth.uid(), p_branch_id, v_payload);
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_gato_mayor_3x2_pos_sale(
  UUID, UUID, UUID, TEXT, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, JSONB, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_gato_mayor_3x2_pos_sale(
  UUID, UUID, UUID, TEXT, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, JSONB, JSONB
) TO authenticated;

COMMIT;
