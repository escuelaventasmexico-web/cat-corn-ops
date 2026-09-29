BEGIN;

DO $$
DECLARE
  v_role_constraint TEXT;
  v_cash_function_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND lower(auth_user.email) = 'biancapan@catcorn.com.mx'
  ) THEN
    RAISE EXCEPTION
      'Auth identity mismatch for b5fe98b7-d5ff-457e-8176-ed66a13af84b; expected biancapan@catcorn.com.mx';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE lower(auth_user.email) = 'biancapan@catcorn.com.mx'
      AND auth_user.id <> 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
  ) THEN
    RAISE EXCEPTION 'The expected email is associated with another Auth UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND branch.code = 'chipitlan_01'
      AND branch.active
  ) THEN
    RAISE EXCEPTION 'Active branch chipitlan_01 does not match its expected UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND branch.code = 'aurrera_la_luna_02'
      AND branch.active
  ) THEN
    RAISE EXCEPTION 'Active branch aurrera_la_luna_02 does not match its expected UUID';
  END IF;

  IF to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.user_branch_access') IS NULL
     OR to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.raw_materials') IS NULL
     OR to_regclass('public.sku_print_events') IS NULL
     OR to_regclass('public.sku_print_event_items') IS NULL THEN
    RAISE EXCEPTION 'A required access-control or POS table is missing';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid, true)
    INTO v_role_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.user_profiles'::REGCLASS
    AND constraint_row.conname = 'user_profiles_role_check'
    AND constraint_row.contype = 'c';

  IF v_role_constraint IS NULL OR regexp_replace(v_role_constraint, '\s+', '', 'g') NOT IN (
    'CHECK(role=ANY(ARRAY[''admin''::text,''socios_comerciales''::text]))',
    'CHECK(role=ANY(ARRAY[''admin''::text,''socios_comerciales''::text,''vendedora''::text]))'
  ) THEN
    RAISE EXCEPTION
      'user_profiles_role_check has an unexpected definition: %',
      COALESCE(v_role_constraint, '<missing>');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.user_profiles'::REGCLASS
      AND constraint_row.contype = 'c'
      AND constraint_row.conname <> 'user_profiles_role_check'
      AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%role%'
  ) THEN
    RAISE EXCEPTION 'An additional user_profiles role constraint requires manual review';
  END IF;

  IF to_regprocedure('public.user_has_branch_access(uuid)') IS NULL
     OR to_regprocedure('public.print_sku_labels(uuid,integer)') IS NULL
     OR to_regprocedure('public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.get_open_cash_register_session_for_branch(uuid)') IS NULL
     OR to_regprocedure('public.register_cash_withdrawal_for_branch(uuid,uuid,numeric,text,text,uuid,text)') IS NULL
     OR to_regprocedure('public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'A required branch, print, or cash-register function is missing';
  END IF;

  SELECT count(*)
    INTO v_cash_function_count
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'open_cash_register_session_for_branch',
      'get_open_cash_register_session_for_branch',
      'register_cash_withdrawal_for_branch',
      'close_cash_register_session_for_branch'
    )
    AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%user_has_branch_access%';

  IF v_cash_function_count <> 4 THEN
    RAISE EXCEPTION 'Every deployed branch cash RPC must validate user_has_branch_access';
  END IF;

  IF to_regclass('public.v_cash_register_sessions_summary') IS NULL
     OR to_regclass('public.v_open_cash_register_status') IS NULL
     OR to_regclass('public.v_cash_register_session_sales') IS NULL THEN
    RAISE EXCEPTION 'The three deployed cash-register views are required';
  END IF;
END;
$$;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::TEXT, 'socios_comerciales'::TEXT, 'vendedora'::TEXT]));

INSERT INTO public.user_profiles (id, full_name, role, is_active)
VALUES (
  'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID,
  'Blanca Paniagua',
  'vendedora',
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    updated_at = now();

INSERT INTO public.user_branch_access (user_id, branch_id, active, created_by)
VALUES (
  'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID,
  'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID,
  TRUE,
  NULL
)
ON CONFLICT (user_id, branch_id) DO UPDATE
SET active = TRUE;

UPDATE public.user_branch_access
SET active = FALSE
WHERE user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
  AND branch_id <> 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
  AND active;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_print_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_print_event_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'sales',
        'sale_items',
        'products',
        'raw_materials',
        'sku_print_events',
        'sku_print_event_items'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;

CREATE POLICY sales_branch_select
  ON public.sales
  FOR SELECT TO authenticated
  USING (public.user_has_branch_access(branch_id));

CREATE POLICY sales_branch_insert
  ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_branch_access(branch_id));

CREATE POLICY sales_branch_update
  ON public.sales
  FOR UPDATE TO authenticated
  USING (public.user_has_branch_access(branch_id))
  WITH CHECK (public.user_has_branch_access(branch_id));

CREATE POLICY sale_items_branch_select
  ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND public.user_has_branch_access(parent_sale.branch_id)
    )
  );

CREATE POLICY sale_items_branch_insert
  ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND public.user_has_branch_access(parent_sale.branch_id)
    )
  );

CREATE POLICY sale_items_admin_update
  ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND public.user_has_branch_access(parent_sale.branch_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND public.user_has_branch_access(parent_sale.branch_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

CREATE POLICY sale_items_admin_delete
  ON public.sale_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND public.user_has_branch_access(parent_sale.branch_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

CREATE POLICY products_active_profiles_select
  ON public.products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.is_active
        AND profile.role IN ('admin', 'socios_comerciales', 'vendedora')
    )
  );

CREATE POLICY products_admin_write
  ON public.products
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

CREATE POLICY raw_materials_active_profiles_select
  ON public.raw_materials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.is_active
        AND profile.role IN ('admin', 'socios_comerciales', 'vendedora')
    )
  );

CREATE POLICY raw_materials_admin_write
  ON public.raw_materials
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

CREATE POLICY sku_print_events_admin_select
  ON public.sku_print_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

CREATE POLICY sku_print_event_items_admin_select
  ON public.sku_print_event_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND profile.is_active
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.sale_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sale_items TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.products FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.raw_materials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.raw_materials TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.sku_print_events FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.sku_print_event_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sku_print_events TO authenticated;
GRANT SELECT ON TABLE public.sku_print_event_items TO authenticated;

CREATE OR REPLACE VIEW public.v_cash_register_session_sales
WITH (security_invoker = true)
AS
SELECT
  sale.cash_session_id AS session_id,
  sale.id AS sale_id,
  sale.created_at,
  sale.payment_method,
  sale.total,
  sale.customer_id,
  sale.promotion_code,
  COALESCE(sale.loyalty_reward_applied, FALSE) AS loyalty_reward_applied,
  COALESCE(sale.loyalty_discount_amount, 0::NUMERIC) AS loyalty_discount_amount,
  sale.branch_id
FROM public.sales AS sale
WHERE sale.cash_session_id IS NOT NULL
  AND COALESCE(sale.is_refunded, FALSE) = FALSE
  AND COALESCE(sale.sale_origin, 'pos') = 'pos';

CREATE OR REPLACE VIEW public.v_cash_register_sessions_summary
WITH (security_invoker = true)
AS
SELECT
  session.id AS session_id,
  session.status,
  session.opened_at,
  session.closed_at,
  session.opening_cash,
  session.opened_by,
  session.closed_by,
  session.notes,
  session.close_notes,
  COALESCE(sale_totals.cash_total, 0::NUMERIC) AS calculated_cash_sales,
  COALESCE(sale_totals.card_total, 0::NUMERIC) AS calculated_card_sales,
  COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC) AS calculated_withdrawals_total,
  session.opening_cash
    + COALESCE(sale_totals.cash_total, 0::NUMERIC)
    - COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC)
      AS calculated_expected_cash_on_hand,
  session.counted_cash,
  CASE
    WHEN session.counted_cash IS NOT NULL THEN
      session.counted_cash
      - (
        session.opening_cash
        + COALESCE(sale_totals.cash_total, 0::NUMERIC)
        - COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC)
      )
    ELSE NULL::NUMERIC
  END AS calculated_cash_difference,
  COALESCE(sale_totals.sales_count, 0) AS sales_count,
  COALESCE(withdrawal_totals.withdrawal_count, 0) AS withdrawals_count,
  COALESCE(sale_totals.cash_total, 0::NUMERIC) AS cash_sales_total,
  COALESCE(sale_totals.card_total, 0::NUMERIC) AS card_sales_total,
  COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC) AS withdrawals_total,
  session.opening_cash
    + COALESCE(sale_totals.cash_total, 0::NUMERIC)
    - COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC)
      AS expected_cash,
  session.difference,
  session.branch_id
FROM public.cash_register_sessions AS session
LEFT JOIN LATERAL (
  SELECT
    sum(
      CASE
        WHEN upper(sale.payment_method) = 'CASH' THEN sale.total
        WHEN upper(sale.payment_method) = 'MIXED' THEN COALESCE(sale.cash_amount, 0::NUMERIC)
        ELSE 0::NUMERIC
      END
    ) AS cash_total,
    sum(
      CASE
        WHEN upper(sale.payment_method) = 'CARD' THEN sale.total
        WHEN upper(sale.payment_method) = 'MIXED' THEN COALESCE(sale.card_amount, 0::NUMERIC)
        ELSE 0::NUMERIC
      END
    ) AS card_total,
    count(*)::INTEGER AS sales_count
  FROM public.sales AS sale
  WHERE sale.cash_session_id = session.id
    AND COALESCE(sale.is_refunded, FALSE) = FALSE
    AND COALESCE(sale.sale_origin, 'pos') = 'pos'
) AS sale_totals ON TRUE
LEFT JOIN LATERAL (
  SELECT
    sum(withdrawal.amount) AS withdrawal_total,
    count(*)::INTEGER AS withdrawal_count
  FROM public.cash_withdrawals AS withdrawal
  WHERE withdrawal.session_id = session.id
) AS withdrawal_totals ON TRUE
ORDER BY session.opened_at DESC;

CREATE OR REPLACE VIEW public.v_open_cash_register_status
WITH (security_invoker = true)
AS
SELECT
  session.id AS session_id,
  session.opening_cash,
  COALESCE(sale_totals.cash_total, 0::NUMERIC) AS cash_sales_total,
  COALESCE(sale_totals.card_total, 0::NUMERIC) AS card_sales_total,
  COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC) AS withdrawals_total,
  session.opening_cash
    + COALESCE(sale_totals.cash_total, 0::NUMERIC)
    - COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC) AS current_cash,
  session.opening_cash
    + COALESCE(sale_totals.cash_total, 0::NUMERIC)
    - COALESCE(withdrawal_totals.withdrawal_total, 0::NUMERIC) > 5000::NUMERIC
      AS needs_withdrawal,
  session.opened_at,
  session.opened_by,
  session.notes,
  session.branch_id
FROM public.cash_register_sessions AS session
LEFT JOIN LATERAL (
  SELECT
    sum(
      CASE
        WHEN upper(sale.payment_method) = 'CASH' THEN sale.total
        WHEN upper(sale.payment_method) = 'MIXED' THEN COALESCE(sale.cash_amount, 0::NUMERIC)
        ELSE 0::NUMERIC
      END
    ) AS cash_total,
    sum(
      CASE
        WHEN upper(sale.payment_method) = 'CARD' THEN sale.total
        WHEN upper(sale.payment_method) = 'MIXED' THEN COALESCE(sale.card_amount, 0::NUMERIC)
        ELSE 0::NUMERIC
      END
    ) AS card_total
  FROM public.sales AS sale
  WHERE sale.cash_session_id = session.id
    AND COALESCE(sale.is_refunded, FALSE) = FALSE
    AND COALESCE(sale.sale_origin, 'pos') = 'pos'
) AS sale_totals ON TRUE
LEFT JOIN LATERAL (
  SELECT sum(withdrawal.amount) AS withdrawal_total
  FROM public.cash_withdrawals AS withdrawal
  WHERE withdrawal.session_id = session.id
) AS withdrawal_totals ON TRUE
WHERE session.closed_at IS NULL
ORDER BY session.opened_at DESC;

REVOKE ALL PRIVILEGES ON TABLE public.v_cash_register_session_sales FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.v_cash_register_sessions_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.v_open_cash_register_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_cash_register_session_sales TO authenticated;
GRANT SELECT ON TABLE public.v_cash_register_sessions_summary TO authenticated;
GRANT SELECT ON TABLE public.v_open_cash_register_status TO authenticated;

CREATE OR REPLACE FUNCTION public.print_sku_labels(
  p_product_id UUID,
  p_units INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role TEXT;
  v_actor_active BOOLEAN;
  v_product RECORD;
  v_event_id UUID;
  v_shortages JSONB;
  v_has_recipe BOOLEAN;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_gummy_units_produced BIGINT;
  v_gummy_units_already_printed BIGINT;
  v_available_to_print BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to print labels';
  END IF;

  SELECT profile.role, profile.is_active
    INTO v_actor_role, v_actor_active
  FROM public.user_profiles AS profile
  WHERE profile.id = v_actor;

  IF NOT FOUND OR NOT COALESCE(v_actor_active, FALSE) THEN
    RAISE EXCEPTION 'An active user profile is required to print labels';
  END IF;

  IF v_actor_role NOT IN ('admin', 'socios_comerciales', 'vendedora') THEN
    RAISE EXCEPTION 'The authenticated role is not authorized to print labels';
  END IF;

  IF p_units IS NULL OR p_units <= 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'La cantidad a imprimir debe ser mayor a 0.'
    );
  END IF;

  SELECT
    product.id,
    product.name,
    product.sku_code,
    product.barcode_value,
    product.unit_cost,
    product.active
  INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'Producto no encontrado.');
  END IF;

  IF COALESCE(v_product.active, FALSE) = FALSE THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'El producto está inactivo.');
  END IF;

  IF v_product.sku_code IS NULL OR v_product.barcode_value IS NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'El producto no tiene SKU o barcode configurado.'
    );
  END IF;

  IF v_product.sku_code = 'GOMIX90' THEN
    PERFORM 1
    FROM public.products AS product
    WHERE product.id = p_product_id
    FOR UPDATE;

    SELECT COALESCE(sum(run.units_produced), 0)
      INTO v_gummy_units_produced
    FROM public.gummy_production_runs AS run
    WHERE run.product_id = p_product_id;

    SELECT COALESCE(sum(print_event.units_printed), 0)
      INTO v_gummy_units_already_printed
    FROM public.sku_print_events AS print_event
    WHERE print_event.product_id = p_product_id;

    v_available_to_print := greatest(
      v_gummy_units_produced - v_gummy_units_already_printed,
      0
    );

    IF p_units > v_available_to_print THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'message', format(
          'Sólo hay %s bolsa(s) de gomitas producida(s) pendiente(s) de etiquetar.',
          v_available_to_print
        ),
        'units_available_to_print', v_available_to_print,
        'units_requested', p_units
      );
    END IF;

    v_unit_cost := v_product.unit_cost;
    v_total_cost := CASE
      WHEN v_unit_cost IS NULL THEN NULL
      ELSE round((v_unit_cost * p_units)::NUMERIC, 2)
    END;

    INSERT INTO public.sku_print_events (
      product_id,
      units_printed,
      sku_code,
      barcode_value,
      unit_cost_snapshot,
      total_cost_snapshot
    )
    VALUES (
      v_product.id,
      p_units,
      v_product.sku_code,
      v_product.barcode_value,
      v_unit_cost,
      v_total_cost
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'message', 'Impresión de gomitas registrada sin descontar materia prima nuevamente.',
      'print_event_id', v_event_id,
      'product_id', v_product.id,
      'product_name', v_product.name,
      'sku_code', v_product.sku_code,
      'barcode_value', v_product.barcode_value,
      'units_printed', p_units,
      'units_available_to_print', v_available_to_print - p_units,
      'unit_cost_snapshot', v_unit_cost,
      'total_cost_snapshot', v_total_cost
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.product_recipe_items AS recipe_item
    WHERE recipe_item.product_id = p_product_id
  ) INTO v_has_recipe;

  IF NOT v_has_recipe THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'El producto no tiene receta configurada.'
    );
  END IF;

  PERFORM 1
  FROM public.raw_materials AS material
  JOIN public.product_recipe_items AS recipe_item
    ON recipe_item.raw_material_id = material.id
  WHERE recipe_item.product_id = p_product_id
  ORDER BY material.id
  FOR UPDATE OF material;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'raw_material_id', shortage.raw_material_id,
        'material_name', shortage.material_name,
        'unit', shortage.unit,
        'required_qty', shortage.required_qty,
        'available_qty', shortage.available_qty,
        'missing_qty', shortage.missing_qty
      )
      ORDER BY shortage.material_name
    ),
    '[]'::JSONB
  ) INTO v_shortages
  FROM (
    SELECT
      material.id AS raw_material_id,
      material.name AS material_name,
      material.unit,
      round((recipe_item.qty_per_unit * p_units)::NUMERIC, 4) AS required_qty,
      round(material.current_stock::NUMERIC, 4) AS available_qty,
      round(
        ((recipe_item.qty_per_unit * p_units) - material.current_stock)::NUMERIC,
        4
      ) AS missing_qty
    FROM public.product_recipe_items AS recipe_item
    JOIN public.raw_materials AS material
      ON material.id = recipe_item.raw_material_id
    WHERE recipe_item.product_id = p_product_id
      AND material.current_stock < (recipe_item.qty_per_unit * p_units)
  ) AS shortage;

  IF jsonb_array_length(v_shortages) > 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'Inventario insuficiente para imprimir.',
      'shortages', v_shortages
    );
  END IF;

  v_unit_cost := v_product.unit_cost;
  v_total_cost := CASE
    WHEN v_unit_cost IS NULL THEN NULL
    ELSE round((v_unit_cost * p_units)::NUMERIC, 2)
  END;

  INSERT INTO public.sku_print_events (
    product_id,
    units_printed,
    sku_code,
    barcode_value,
    unit_cost_snapshot,
    total_cost_snapshot
  )
  VALUES (
    v_product.id,
    p_units,
    v_product.sku_code,
    v_product.barcode_value,
    v_unit_cost,
    v_total_cost
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.sku_print_event_items (
    print_event_id,
    raw_material_id,
    qty_consumed,
    unit_snapshot,
    material_name_snapshot
  )
  SELECT
    v_event_id,
    material.id,
    round((recipe_item.qty_per_unit * p_units)::NUMERIC, 4),
    material.unit,
    material.name
  FROM public.product_recipe_items AS recipe_item
  JOIN public.raw_materials AS material
    ON material.id = recipe_item.raw_material_id
  WHERE recipe_item.product_id = p_product_id;

  UPDATE public.raw_materials AS material
  SET current_stock = material.current_stock - consumption.qty_to_discount,
      updated_at = now()
  FROM (
    SELECT
      recipe_item.raw_material_id,
      round(sum(recipe_item.qty_per_unit * p_units)::NUMERIC, 4) AS qty_to_discount
    FROM public.product_recipe_items AS recipe_item
    WHERE recipe_item.product_id = p_product_id
    GROUP BY recipe_item.raw_material_id
  ) AS consumption
  WHERE material.id = consumption.raw_material_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'message', 'Impresión registrada y stock descontado correctamente.',
    'print_event_id', v_event_id,
    'product_id', v_product.id,
    'product_name', v_product.name,
    'sku_code', v_product.sku_code,
    'barcode_value', v_product.barcode_value,
    'units_printed', p_units,
    'unit_cost_snapshot', v_unit_cost,
    'total_cost_snapshot', v_total_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.user_has_branch_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_branch_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.print_sku_labels(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.print_sku_labels(UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.open_cash_register_session_for_branch(UUID, NUMERIC, UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_register_session_for_branch(UUID, NUMERIC, UUID, TEXT)
TO authenticated;

REVOKE ALL ON FUNCTION public.get_open_cash_register_session_for_branch(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_cash_register_session_for_branch(UUID)
TO authenticated;

REVOKE ALL ON FUNCTION public.register_cash_withdrawal_for_branch(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_cash_withdrawal_for_branch(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT)
TO authenticated;

REVOKE ALL ON FUNCTION public.close_cash_register_session_for_branch(UUID, UUID, NUMERIC, UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_register_session_for_branch(UUID, UUID, NUMERIC, UUID, TEXT)
TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
