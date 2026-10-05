BEGIN;

-- This phase cannot safely infer an opening count for a session that is
-- already open. Stop before any DDL or data change.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cash_register_sessions AS session
    WHERE session.branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND session.status = 'open'
      AND session.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Chipitlán tiene una caja abierta. Primero cierre la caja actual antes de instalar el control de conteos.';
  END IF;
END;
$$;

-- Fail before replacing any deployed cash contract that differs from the
-- branch-aware functions versioned by Phase 1B.
DO $$
DECLARE
  v_open_definition TEXT;
  v_close_definition TEXT;
  v_sale_guard_definition TEXT;
BEGIN
  IF to_regprocedure(
    'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'
  ) IS NULL OR (
    SELECT COUNT(*)
    FROM pg_proc AS function_row
    WHERE function_row.pronamespace = 'public'::REGNAMESPACE
      AND function_row.proname = 'open_cash_register_session_for_branch'
  ) <> 1 THEN
    RAISE EXCEPTION 'Unexpected open_cash_register_session_for_branch contract';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc AS function_row
       WHERE function_row.oid =
         'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
         AND function_row.prorettype = 'public.cash_register_sessions'::REGTYPE
     ) OR lower(pg_get_function_arguments(
       'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
     )) NOT LIKE '%p_opening_cash numeric default 0%'
     OR lower(pg_get_function_arguments(
       'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
     )) NOT LIKE '%p_opened_by uuid default null%'
     OR lower(pg_get_function_arguments(
       'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
     )) NOT LIKE '%p_notes text default null%' THEN
    RAISE EXCEPTION 'Unexpected open_cash_register_session_for_branch result or defaults';
  END IF;

  IF to_regprocedure(
    'public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)'
  ) IS NULL OR (
    SELECT COUNT(*)
    FROM pg_proc AS function_row
    WHERE function_row.pronamespace = 'public'::REGNAMESPACE
      AND function_row.proname = 'close_cash_register_session_for_branch'
  ) <> 1 THEN
    RAISE EXCEPTION 'Unexpected close_cash_register_session_for_branch contract';
  END IF;

  SELECT lower(pg_get_functiondef(
    'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
  )) INTO v_open_definition;
  SELECT lower(pg_get_functiondef(
    'public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)'::REGPROCEDURE
  )) INTO v_close_definition;

  IF v_open_definition NOT LIKE '%auth.uid()%'
     OR v_open_definition NOT LIKE '%user_has_branch_access%'
     OR v_open_definition NOT LIKE '%insert into public.cash_register_sessions%' THEN
    RAISE EXCEPTION 'Deployed opening RPC definition is not the expected branch-aware implementation';
  END IF;

  IF v_close_definition NOT LIKE '%auth.uid()%'
     OR v_close_definition NOT LIKE '%user_has_branch_access%'
     OR v_close_definition NOT LIKE '%update public.cash_register_sessions%'
     OR v_close_definition NOT LIKE '%for update%' THEN
    RAISE EXCEPTION 'Deployed closing RPC definition is not the expected branch-aware implementation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.sales'::REGCLASS
      AND trigger_row.tgname = 'trg_assign_open_cash_session_to_sale'
      AND trigger_row.tgfoid = 'public.assign_open_cash_session_to_sale()'::REGPROCEDURE
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Expected sales cash-session guard trigger was not found';
  END IF;

  SELECT lower(pg_get_functiondef(trigger_row.tgfoid))
    INTO v_sale_guard_definition
  FROM pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.sales'::REGCLASS
    AND trigger_row.tgname = 'trg_assign_open_cash_session_to_sale'
    AND trigger_row.tgfoid = 'public.assign_open_cash_session_to_sale()'::REGPROCEDURE
    AND NOT trigger_row.tgisinternal;

  IF v_sale_guard_definition NOT LIKE '%user_has_branch_access%'
     OR v_sale_guard_definition NOT LIKE '%cash_session_id%'
     OR v_sale_guard_definition NOT LIKE '%cash_register_sessions%'
     OR v_sale_guard_definition NOT LIKE '%sale_origin%' THEN
    RAISE EXCEPTION 'Deployed sales cash-session guard is not the expected branch-aware implementation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND code = 'chipitlan_01'
      AND active
  ) OR NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND code = 'aurrera_la_luna_02'
      AND active
  ) THEN
    RAISE EXCEPTION 'The confirmed Chipitlán and Aurrera branch identities are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'c0f9cc2d-1057-40c1-94b0-615471b118d6'::UUID
      AND lower(btrim(unit)) = 'g'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = '35c434ec-8876-4757-bb91-b241e8002878'::UUID
      AND lower(btrim(unit)) = 'ml'
  ) THEN
    RAISE EXCEPTION 'The confirmed corn (g) and oil (ml) raw-material identities are required';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.branch_cash_control_settings (
  branch_id UUID PRIMARY KEY REFERENCES public.branches(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  require_opening_inventory_count BOOLEAN NOT NULL DEFAULT TRUE,
  require_closing_inventory_count BOOLEAN NOT NULL DEFAULT TRUE,
  corn_raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  oil_raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (corn_raw_material_id <> oil_raw_material_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_register_sessions_id_branch_unique_idx
  ON public.cash_register_sessions (id, branch_id);

CREATE TABLE IF NOT EXISTS public.cash_inventory_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_session_id UUID NOT NULL,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (phase IN ('opening', 'closing')),
  captured_value NUMERIC NOT NULL CHECK (
    captured_value >= 0
    AND captured_value = round(captured_value, 3)
    AND captured_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  captured_unit TEXT NOT NULL CHECK (captured_unit IN ('kg', 'L')),
  normalized_value NUMERIC NOT NULL CHECK (
    normalized_value >= 0
    AND normalized_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  normalized_unit TEXT NOT NULL CHECK (normalized_unit IN ('g', 'ml')),
  counted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_inventory_counts_session_branch_fkey
    FOREIGN KEY (cash_session_id, branch_id)
    REFERENCES public.cash_register_sessions(id, branch_id)
    ON DELETE RESTRICT,
  CONSTRAINT cash_inventory_counts_session_phase_material_key
    UNIQUE (cash_session_id, phase, raw_material_id),
  CHECK (
    (captured_unit = 'kg' AND normalized_unit = 'g'
      AND normalized_value = captured_value * 1000)
    OR
    (captured_unit = 'L' AND normalized_unit = 'ml'
      AND normalized_value = captured_value * 1000)
  )
);

CREATE INDEX IF NOT EXISTS cash_inventory_counts_branch_counted_at_idx
  ON public.cash_inventory_counts (branch_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS cash_inventory_counts_counted_by_idx
  ON public.cash_inventory_counts (counted_by, counted_at DESC);

CREATE TABLE IF NOT EXISTS public.cash_session_close_summaries (
  cash_session_id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  closed_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ NOT NULL,
  sale_count INTEGER NOT NULL CHECK (sale_count >= 0),
  refunded_sale_count INTEGER NOT NULL CHECK (refunded_sale_count >= 0),
  refunded_sales_amount NUMERIC NOT NULL CHECK (refunded_sales_amount >= 0),
  gross_sales NUMERIC NOT NULL CHECK (gross_sales >= 0),
  net_sales NUMERIC NOT NULL CHECK (net_sales >= 0),
  discount_total NUMERIC NOT NULL CHECK (discount_total >= 0),
  cash_total NUMERIC NOT NULL CHECK (cash_total >= 0),
  card_total NUMERIC NOT NULL CHECK (card_total >= 0),
  transfer_total NUMERIC NOT NULL CHECK (transfer_total >= 0),
  delivery_total NUMERIC NOT NULL CHECK (delivery_total >= 0),
  generic_sales_total NUMERIC NOT NULL CHECK (generic_sales_total >= 0),
  generic_line_count INTEGER NOT NULL CHECK (generic_line_count >= 0),
  promotion_sale_count INTEGER NOT NULL CHECK (promotion_sale_count >= 0),
  known_cost_total NUMERIC NOT NULL CHECK (known_cost_total >= 0),
  amount_without_known_cost NUMERIC NOT NULL CHECK (amount_without_known_cost >= 0),
  lines_without_known_cost INTEGER NOT NULL CHECK (lines_without_known_cost >= 0),
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_session_close_summaries_session_branch_fkey
    FOREIGN KEY (cash_session_id, branch_id)
    REFERENCES public.cash_register_sessions(id, branch_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS cash_session_close_summaries_branch_closed_at_idx
  ON public.cash_session_close_summaries (branch_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_operational_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_session_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('cash_inventory_opening', 'cash_inventory_closing')),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  message TEXT NOT NULL CHECK (btrim(message) <> ''),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_operational_alerts_session_branch_fkey
    FOREIGN KEY (cash_session_id, branch_id)
    REFERENCES public.cash_register_sessions(id, branch_id)
    ON DELETE RESTRICT,
  CONSTRAINT admin_operational_alerts_session_type_key
    UNIQUE (cash_session_id, alert_type)
);

CREATE INDEX IF NOT EXISTS admin_operational_alerts_created_at_idx
  ON public.admin_operational_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_operational_alerts_branch_created_at_idx
  ON public.admin_operational_alerts (branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_operational_alert_reads (
  alert_id UUID NOT NULL REFERENCES public.admin_operational_alerts(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, admin_user_id)
);

CREATE INDEX IF NOT EXISTS admin_operational_alert_reads_admin_idx
  ON public.admin_operational_alert_reads (admin_user_id, read_at DESC);

-- Existing objects with these names must match the intended columns. This
-- prevents IF NOT EXISTS from silently accepting an incompatible deployment.
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_agg(expected.column_name ORDER BY expected.column_name)
    INTO v_missing
  FROM (VALUES
    ('branch_cash_control_settings', 'branch_id', 'uuid'),
    ('branch_cash_control_settings', 'corn_raw_material_id', 'uuid'),
    ('branch_cash_control_settings', 'oil_raw_material_id', 'uuid'),
    ('cash_inventory_counts', 'cash_session_id', 'uuid'),
    ('cash_inventory_counts', 'captured_value', 'numeric'),
    ('cash_inventory_counts', 'normalized_value', 'numeric'),
    ('cash_session_close_summaries', 'detail', 'jsonb'),
    ('admin_operational_alerts', 'payload', 'jsonb'),
    ('admin_operational_alert_reads', 'admin_user_id', 'uuid')
  ) AS expected(table_name, column_name, data_type)
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
   AND actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
   AND actual.data_type = expected.data_type
  WHERE actual.column_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected cash inventory control table contract; missing/incompatible columns: %', v_missing;
  END IF;
END;
$$;

INSERT INTO public.branch_cash_control_settings (
  branch_id,
  active,
  require_opening_inventory_count,
  require_closing_inventory_count,
  corn_raw_material_id,
  oil_raw_material_id
)
VALUES (
  'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID,
  TRUE,
  TRUE,
  TRUE,
  'c0f9cc2d-1057-40c1-94b0-615471b118d6'::UUID,
  '35c434ec-8876-4757-bb91-b241e8002878'::UUID
)
ON CONFLICT (branch_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.branch_cash_control_settings AS setting
    WHERE setting.branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND setting.active
      AND setting.require_opening_inventory_count
      AND setting.require_closing_inventory_count
      AND setting.corn_raw_material_id = 'c0f9cc2d-1057-40c1-94b0-615471b118d6'::UUID
      AND setting.oil_raw_material_id = '35c434ec-8876-4757-bb91-b241e8002878'::UUID
  ) THEN
    RAISE EXCEPTION 'Existing Chipitlán cash-control configuration is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.branch_cash_control_settings
    WHERE branch_id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND active
  ) THEN
    RAISE EXCEPTION 'Aurrera must not be enabled for cash inventory controls in this phase';
  END IF;
END;
$$;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS observed_unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS observed_total_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_source TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_items'
      AND column_name IN ('observed_unit_cost', 'observed_total_cost')
      AND data_type <> 'numeric'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_items'
      AND column_name = 'cost_source'
      AND data_type <> 'text'
  ) THEN
    RAISE EXCEPTION 'Existing sale_items cost snapshot columns have incompatible types';
  END IF;
END;
$$;

ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_observed_unit_cost_nonnegative,
  DROP CONSTRAINT IF EXISTS sale_items_observed_total_cost_nonnegative,
  DROP CONSTRAINT IF EXISTS sale_items_cost_snapshot_consistent;

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_observed_unit_cost_nonnegative
    CHECK (observed_unit_cost IS NULL OR observed_unit_cost >= 0),
  ADD CONSTRAINT sale_items_observed_total_cost_nonnegative
    CHECK (observed_total_cost IS NULL OR observed_total_cost >= 0),
  ADD CONSTRAINT sale_items_cost_snapshot_consistent CHECK (
    (observed_unit_cost IS NULL AND observed_total_cost IS NULL
      AND (cost_source IS NULL OR cost_source IN ('generic', 'missing', 'combo_missing')))
    OR
    (observed_unit_cost IS NOT NULL AND observed_total_cost IS NOT NULL
      AND cost_source IN ('product_unit_cost', 'combo_components'))
  );

CREATE OR REPLACE FUNCTION public._validate_cash_inventory_count_value(
  p_value NUMERIC,
  p_label TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION '% is required', p_label;
  END IF;
  IF p_value::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_value < 0
     OR p_value <> round(p_value, 3) THEN
    RAISE EXCEPTION '% must be a finite non-negative number with at most three decimals', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._protect_cash_inventory_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Cash inventory counts are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public._protect_cash_close_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Cash-session close summaries are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public._protect_admin_operational_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Administrative operational alerts are immutable';
END;
$$;

DROP TRIGGER IF EXISTS protect_cash_inventory_counts
  ON public.cash_inventory_counts;
CREATE TRIGGER protect_cash_inventory_counts
  BEFORE UPDATE OR DELETE ON public.cash_inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public._protect_cash_inventory_counts();

DROP TRIGGER IF EXISTS protect_cash_close_summaries
  ON public.cash_session_close_summaries;
CREATE TRIGGER protect_cash_close_summaries
  BEFORE UPDATE OR DELETE ON public.cash_session_close_summaries
  FOR EACH ROW EXECUTE FUNCTION public._protect_cash_close_summaries();

DROP TRIGGER IF EXISTS protect_admin_operational_alerts
  ON public.admin_operational_alerts;
CREATE TRIGGER protect_admin_operational_alerts
  BEFORE UPDATE OR DELETE ON public.admin_operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public._protect_admin_operational_alerts();

CREATE OR REPLACE FUNCTION public.snapshot_sale_item_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_combo BOOLEAN;
  v_unit_cost NUMERIC;
  v_component_count INTEGER;
  v_missing_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.observed_unit_cost IS DISTINCT FROM OLD.observed_unit_cost
       OR NEW.observed_total_cost IS DISTINCT FROM OLD.observed_total_cost
       OR NEW.cost_source IS DISTINCT FROM OLD.cost_source THEN
      RAISE EXCEPTION 'Sale-item cost snapshots are immutable';
    END IF;
    RETURN NEW;
  END IF;

  NEW.observed_unit_cost := NULL;
  NEW.observed_total_cost := NULL;

  IF NEW.product_id IS NULL OR COALESCE(NEW.is_generic, FALSE) THEN
    NEW.cost_source := 'generic';
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.product_combos AS combo
    WHERE combo.product_id = NEW.product_id
      AND combo.active
  ) INTO v_is_combo;

  IF v_is_combo THEN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE component.unit_cost IS NULL),
      SUM(component.unit_cost * component.quantity_per_combo)
    INTO v_component_count, v_missing_count, v_unit_cost
    FROM (
      SELECT
        product.unit_cost,
        definition.quantity_per_combo::NUMERIC AS quantity_per_combo
      FROM public.product_combo_components AS definition
      JOIN public.products AS product
        ON product.id = definition.component_product_id
      WHERE definition.combo_product_id = NEW.product_id
        AND definition.component_type = 'fixed'

      UNION ALL

      SELECT
        product.unit_cost,
        definition.quantity_per_combo::NUMERIC
      FROM public.product_combo_components AS definition
      JOIN public.products AS product
        ON product.id = NEW.selected_beverage_product_id
      WHERE definition.combo_product_id = NEW.product_id
        AND definition.component_type = 'choice'
        AND definition.option_group = 'beverage'
        AND NEW.selected_beverage_product_id IS NOT NULL
    ) AS component;

    IF v_component_count = 0 OR v_missing_count > 0 OR v_unit_cost IS NULL THEN
      NEW.cost_source := 'combo_missing';
      RETURN NEW;
    END IF;

    NEW.observed_unit_cost := round(v_unit_cost, 4);
    NEW.observed_total_cost := round(v_unit_cost * NEW.quantity, 4);
    NEW.cost_source := 'combo_components';
    RETURN NEW;
  END IF;

  SELECT product.unit_cost
    INTO v_unit_cost
  FROM public.products AS product
  WHERE product.id = NEW.product_id;

  IF v_unit_cost IS NULL THEN
    NEW.cost_source := 'missing';
    RETURN NEW;
  END IF;

  NEW.observed_unit_cost := round(v_unit_cost, 4);
  NEW.observed_total_cost := round(v_unit_cost * NEW.quantity, 4);
  NEW.cost_source := 'product_unit_cost';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_snapshot_sale_item_cost ON public.sale_items;
CREATE TRIGGER aa_snapshot_sale_item_cost
  BEFORE INSERT OR UPDATE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_sale_item_cost();

CREATE OR REPLACE FUNCTION public.open_cash_register_with_inventory_for_branch(
  p_branch_id UUID,
  p_opening_cash NUMERIC,
  p_corn_kg NUMERIC,
  p_oil_liters NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_setting public.branch_cash_control_settings%ROWTYPE;
  v_session_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'An active authenticated profile is required';
  END IF;
  IF NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  SELECT setting.* INTO v_setting
  FROM public.branch_cash_control_settings AS setting
  WHERE setting.branch_id = p_branch_id
    AND setting.active
    AND setting.require_opening_inventory_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected branch is not configured for controlled inventory opening';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0
     OR p_opening_cash::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Opening cash must be a finite non-negative number';
  END IF;
  PERFORM public._validate_cash_inventory_count_value(p_corn_kg, 'Corn kilograms');
  PERFORM public._validate_cash_inventory_count_value(p_oil_liters, 'Oil liters');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_branch_id::TEXT, 0));

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_sessions AS session
    WHERE session.branch_id = p_branch_id
      AND session.status = 'open'
      AND session.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An open cash-register session already exists for the selected branch';
  END IF;

  INSERT INTO public.cash_register_sessions (
    branch_id, opening_cash, opened_by, opened_at, notes
  ) VALUES (
    p_branch_id, p_opening_cash, v_actor, v_now, p_notes
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.cash_inventory_counts (
    cash_session_id, branch_id, raw_material_id, phase,
    captured_value, captured_unit, normalized_value, normalized_unit,
    counted_by, counted_at
  ) VALUES
    (
      v_session_id, p_branch_id, v_setting.corn_raw_material_id, 'opening',
      p_corn_kg, 'kg', p_corn_kg * 1000, 'g', v_actor, v_now
    ),
    (
      v_session_id, p_branch_id, v_setting.oil_raw_material_id, 'opening',
      p_oil_liters, 'L', p_oil_liters * 1000, 'ml', v_actor, v_now
    );

  INSERT INTO public.admin_operational_alerts (
    branch_id, cash_session_id, actor_id, alert_type, title, message,
    payload, created_at
  ) VALUES (
    p_branch_id,
    v_session_id,
    v_actor,
    'cash_inventory_opening',
    'Caja abierta con conteo de insumos',
    'Se abrió la caja de Chipitlán y se registró el conteo inicial de maíz y aceite.',
    JSONB_BUILD_OBJECT(
      'corn', JSONB_BUILD_OBJECT(
        'raw_material_id', v_setting.corn_raw_material_id,
        'captured_value', p_corn_kg,
        'captured_unit', 'kg',
        'normalized_value', p_corn_kg * 1000,
        'normalized_unit', 'g'
      ),
      'oil', JSONB_BUILD_OBJECT(
        'raw_material_id', v_setting.oil_raw_material_id,
        'captured_value', p_oil_liters,
        'captured_unit', 'L',
        'normalized_value', p_oil_liters * 1000,
        'normalized_unit', 'ml'
      ),
      'opening_cash', p_opening_cash
    ),
    v_now
  );

  RETURN JSONB_BUILD_OBJECT(
    'session_id', v_session_id,
    'branch_id', p_branch_id,
    'opened_at', v_now,
    'corn_kg', p_corn_kg,
    'oil_liters', p_oil_liters
  );
END;
$$;

-- Preserve the existing public signature for uncontrolled branches, while
-- making it an explicit non-bypassable rejection for configured branches.
CREATE OR REPLACE FUNCTION public.open_cash_register_session_for_branch(
  p_branch_id UUID,
  p_opening_cash NUMERIC DEFAULT 0,
  p_opened_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.cash_register_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to open a cash-register session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'An active profile is required to open a cash-register session';
  END IF;
  IF NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.branch_cash_control_settings AS setting
    WHERE setting.branch_id = p_branch_id
      AND setting.active
      AND setting.require_opening_inventory_count
  ) THEN
    RAISE EXCEPTION 'This branch requires inventory counts; use open_cash_register_with_inventory_for_branch';
  END IF;
  IF p_opened_by IS NOT NULL AND p_opened_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The session opener must be the authenticated user';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_branch_id::TEXT, 0));

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_sessions AS session
    WHERE session.branch_id = p_branch_id
      AND session.status = 'open'
      AND session.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An open cash-register session already exists for the selected branch';
  END IF;

  INSERT INTO public.cash_register_sessions (branch_id, opening_cash, opened_by, notes)
  VALUES (p_branch_id, p_opening_cash, v_actor, p_notes)
  RETURNING * INTO v_session;
  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register_with_inventory_for_branch(
  p_branch_id UUID,
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_corn_kg NUMERIC,
  p_oil_liters NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_setting public.branch_cash_control_settings%ROWTYPE;
  v_opening_cash NUMERIC;
  v_cash_sales NUMERIC;
  v_withdrawals NUMERIC;
  v_expected NUMERIC;
  v_difference NUMERIC;
  v_now TIMESTAMPTZ := now();
  v_opening_corn_kg NUMERIC;
  v_opening_oil_liters NUMERIC;
  v_sale_count INTEGER;
  v_refunded_sale_count INTEGER;
  v_refunded_sales_amount NUMERIC;
  v_net_sales NUMERIC;
  v_discount_total NUMERIC;
  v_gross_sales NUMERIC;
  v_cash_total NUMERIC;
  v_card_total NUMERIC;
  v_transfer_total NUMERIC;
  v_delivery_total NUMERIC;
  v_generic_sales_total NUMERIC;
  v_generic_line_count INTEGER;
  v_promotion_sale_count INTEGER;
  v_known_cost_total NUMERIC;
  v_amount_without_known_cost NUMERIC;
  v_lines_without_known_cost INTEGER;
  v_detail JSONB;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'An active authenticated profile is required';
  END IF;
  IF NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  SELECT setting.* INTO v_setting
  FROM public.branch_cash_control_settings AS setting
  WHERE setting.branch_id = p_branch_id
    AND setting.active
    AND setting.require_closing_inventory_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected branch is not configured for controlled inventory closing';
  END IF;

  IF p_counted_cash IS NULL OR p_counted_cash < 0
     OR p_counted_cash::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Counted cash must be a finite non-negative number';
  END IF;
  PERFORM public._validate_cash_inventory_count_value(p_corn_kg, 'Corn kilograms');
  PERFORM public._validate_cash_inventory_count_value(p_oil_liters, 'Oil liters');

  SELECT session.opening_cash
    INTO v_opening_cash
  FROM public.cash_register_sessions AS session
  WHERE session.id = p_session_id
    AND session.branch_id = p_branch_id
    AND session.status = 'open'
    AND session.closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open cash-register session % was not found for the selected branch', p_session_id;
  END IF;

  SELECT
    MAX(count_row.captured_value) FILTER (
      WHERE count_row.raw_material_id = v_setting.corn_raw_material_id
    ),
    MAX(count_row.captured_value) FILTER (
      WHERE count_row.raw_material_id = v_setting.oil_raw_material_id
    )
  INTO v_opening_corn_kg, v_opening_oil_liters
  FROM public.cash_inventory_counts AS count_row
  WHERE count_row.cash_session_id = p_session_id
    AND count_row.branch_id = p_branch_id
    AND count_row.phase = 'opening';
  IF v_opening_corn_kg IS NULL OR v_opening_oil_liters IS NULL THEN
    RAISE EXCEPTION 'The cash session does not have the required opening inventory counts';
  END IF;

  SELECT COALESCE(SUM(CASE
    WHEN UPPER(sale.payment_method::TEXT) = 'CASH' THEN sale.total
    WHEN UPPER(sale.payment_method::TEXT) = 'MIXED' THEN COALESCE(sale.cash_amount, 0)
    ELSE 0
  END), 0)
  INTO v_cash_sales
  FROM public.sales AS sale
  WHERE sale.cash_session_id = p_session_id
    AND sale.branch_id = p_branch_id
    AND COALESCE(sale.is_refunded, FALSE) = FALSE
    AND COALESCE(sale.sale_origin, 'pos') = 'pos';

  SELECT COALESCE(SUM(withdrawal.amount), 0)
    INTO v_withdrawals
  FROM public.cash_withdrawals AS withdrawal
  WHERE withdrawal.session_id = p_session_id;

  v_expected := v_opening_cash + v_cash_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  INSERT INTO public.cash_inventory_counts (
    cash_session_id, branch_id, raw_material_id, phase,
    captured_value, captured_unit, normalized_value, normalized_unit,
    counted_by, counted_at
  ) VALUES
    (
      p_session_id, p_branch_id, v_setting.corn_raw_material_id, 'closing',
      p_corn_kg, 'kg', p_corn_kg * 1000, 'g', v_actor, v_now
    ),
    (
      p_session_id, p_branch_id, v_setting.oil_raw_material_id, 'closing',
      p_oil_liters, 'L', p_oil_liters * 1000, 'ml', v_actor, v_now
    );

  SELECT
    COUNT(*) FILTER (WHERE NOT COALESCE(sale.is_refunded, FALSE))::INTEGER,
    COUNT(*) FILTER (WHERE COALESCE(sale.is_refunded, FALSE))::INTEGER,
    COALESCE(SUM(sale.total) FILTER (WHERE COALESCE(sale.is_refunded, FALSE)), 0),
    COALESCE(SUM(sale.total) FILTER (WHERE NOT COALESCE(sale.is_refunded, FALSE)), 0),
    COALESCE(SUM(CASE
      WHEN NOT COALESCE(sale.is_refunded, FALSE)
        AND UPPER(sale.payment_method::TEXT) = 'CASH' THEN sale.total
      WHEN NOT COALESCE(sale.is_refunded, FALSE)
        AND UPPER(sale.payment_method::TEXT) = 'MIXED' THEN COALESCE(sale.cash_amount, 0)
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN NOT COALESCE(sale.is_refunded, FALSE)
        AND UPPER(sale.payment_method::TEXT) = 'CARD' THEN sale.total
      WHEN NOT COALESCE(sale.is_refunded, FALSE)
        AND UPPER(sale.payment_method::TEXT) = 'MIXED' THEN COALESCE(sale.card_amount, 0)
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN NOT COALESCE(sale.is_refunded, FALSE)
        AND UPPER(sale.payment_method::TEXT) = 'TRANSFER' THEN sale.total
      ELSE 0 END), 0),
    COALESCE(SUM(sale.total) FILTER (
      WHERE NOT COALESCE(sale.is_refunded, FALSE)
        AND sale.sale_origin = 'delivery'
    ), 0),
    COUNT(*) FILTER (
      WHERE NOT COALESCE(sale.is_refunded, FALSE)
        AND NULLIF(BTRIM(sale.promotion_code), '') IS NOT NULL
    )::INTEGER
  INTO
    v_sale_count,
    v_refunded_sale_count,
    v_refunded_sales_amount,
    v_net_sales,
    v_cash_total,
    v_card_total,
    v_transfer_total,
    v_delivery_total,
    v_promotion_sale_count
  FROM public.sales AS sale
  WHERE sale.cash_session_id = p_session_id
    AND sale.branch_id = p_branch_id;

  SELECT
    COALESCE(SUM(COALESCE(item.discount_amount, 0)), 0),
    COALESCE(SUM(item.price * item.quantity) FILTER (
      WHERE item.product_id IS NULL OR COALESCE(item.is_generic, FALSE)
    ), 0),
    COUNT(*) FILTER (
      WHERE item.product_id IS NULL OR COALESCE(item.is_generic, FALSE)
    )::INTEGER,
    COALESCE(SUM(item.observed_total_cost) FILTER (
      WHERE item.observed_total_cost IS NOT NULL
    ), 0),
    COALESCE(SUM(item.price * item.quantity) FILTER (
      WHERE item.observed_total_cost IS NULL
    ), 0),
    COUNT(*) FILTER (WHERE item.observed_total_cost IS NULL)::INTEGER
  INTO
    v_discount_total,
    v_generic_sales_total,
    v_generic_line_count,
    v_known_cost_total,
    v_amount_without_known_cost,
    v_lines_without_known_cost
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  WHERE sale.cash_session_id = p_session_id
    AND sale.branch_id = p_branch_id
    AND NOT COALESCE(sale.is_refunded, FALSE);

  v_gross_sales := v_net_sales + v_discount_total;

  SELECT JSONB_BUILD_OBJECT(
    'sales', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'sale_id', sale.id,
        'created_at', sale.created_at,
        'payment_method', sale.payment_method,
        'total', sale.total,
        'cash_amount', sale.cash_amount,
        'card_amount', sale.card_amount,
        'transfer_amount', sale.transfer_amount,
        'sale_origin', sale.sale_origin,
        'delivery_platform', sale.delivery_platform,
        'promotion_code', sale.promotion_code,
        'is_refunded', COALESCE(sale.is_refunded, FALSE),
        'items', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'sale_item_id', item.id,
            'product_id', item.product_id,
            'product_name', COALESCE(item.product_name, product.product_name, product.name),
            'quantity', item.quantity,
            'effective_unit_price', item.price,
            'discount_amount', COALESCE(item.discount_amount, 0),
            'discount_reason', item.discount_reason,
            'is_generic', item.product_id IS NULL OR COALESCE(item.is_generic, FALSE),
            'observed_unit_cost', item.observed_unit_cost,
            'observed_total_cost', item.observed_total_cost,
            'cost_source', item.cost_source,
            'missing_cost', item.observed_total_cost IS NULL,
            'combo_components', COALESCE((
              SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                'component_product_id', component.component_product_id,
                'component_name', component.component_name,
                'component_sku', component.component_sku,
                'component_type', component.component_type,
                'quantity_total', component.quantity_total,
                'observed_unit_price', component.observed_unit_price,
                'selected_option_group', component.selected_option_group
              ) ORDER BY component.component_type, component.component_sku)
              FROM public.sale_item_combo_components AS component
              WHERE component.sale_item_id = item.id
            ), '[]'::JSONB)
          ) ORDER BY item.id)
          FROM public.sale_items AS item
          LEFT JOIN public.products AS product ON product.id = item.product_id
          WHERE item.sale_id = sale.id
        ), '[]'::JSONB)
      ) ORDER BY sale.created_at, sale.id)
      FROM public.sales AS sale
      WHERE sale.cash_session_id = p_session_id
        AND sale.branch_id = p_branch_id
        AND NOT COALESCE(sale.is_refunded, FALSE)
    ), '[]'::JSONB),
    'refunded_sales', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'sale_id', sale.id,
        'created_at', sale.created_at,
        'total', sale.total,
        'refunded_at', sale.refunded_at,
        'refund_reason', sale.refund_reason
      ) ORDER BY sale.created_at, sale.id)
      FROM public.sales AS sale
      WHERE sale.cash_session_id = p_session_id
        AND sale.branch_id = p_branch_id
        AND COALESCE(sale.is_refunded, FALSE)
    ), '[]'::JSONB),
    'product_totals', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(product_total)
        ORDER BY product_total.product_name, product_total.product_id)
      FROM (
        SELECT
          item.product_id,
          COALESCE(item.product_name, product.product_name, product.name, 'Producto genérico')
            AS product_name,
          item.product_id IS NULL OR COALESCE(item.is_generic, FALSE) AS is_generic,
          SUM(item.quantity) AS quantity,
          SUM(item.price * item.quantity) AS net_amount,
          SUM(COALESCE(item.discount_amount, 0)) AS discount_amount,
          SUM(item.observed_total_cost) FILTER (
            WHERE item.observed_total_cost IS NOT NULL
          ) AS known_cost,
          COUNT(*) FILTER (WHERE item.observed_total_cost IS NULL)::INTEGER
            AS missing_cost_lines
        FROM public.sale_items AS item
        JOIN public.sales AS sale ON sale.id = item.sale_id
        LEFT JOIN public.products AS product ON product.id = item.product_id
        WHERE sale.cash_session_id = p_session_id
          AND sale.branch_id = p_branch_id
          AND NOT COALESCE(sale.is_refunded, FALSE)
        GROUP BY
          item.product_id,
          COALESCE(item.product_name, product.product_name, product.name, 'Producto genérico'),
          (item.product_id IS NULL OR COALESCE(item.is_generic, FALSE))
      ) AS product_total
    ), '[]'::JSONB)
  ) INTO v_detail;

  INSERT INTO public.cash_session_close_summaries (
    cash_session_id, branch_id, closed_by, closed_at,
    sale_count, refunded_sale_count, refunded_sales_amount,
    gross_sales, net_sales, discount_total,
    cash_total, card_total, transfer_total, delivery_total,
    generic_sales_total, generic_line_count, promotion_sale_count,
    known_cost_total, amount_without_known_cost, lines_without_known_cost,
    detail
  ) VALUES (
    p_session_id, p_branch_id, v_actor, v_now,
    v_sale_count, v_refunded_sale_count, v_refunded_sales_amount,
    v_gross_sales, v_net_sales, v_discount_total,
    v_cash_total, v_card_total, v_transfer_total, v_delivery_total,
    v_generic_sales_total, v_generic_line_count, v_promotion_sale_count,
    v_known_cost_total, v_amount_without_known_cost, v_lines_without_known_cost,
    v_detail
  );

  UPDATE public.cash_register_sessions
  SET status = 'closed',
      closed_at = v_now,
      closed_by = v_actor,
      counted_cash = p_counted_cash,
      expected_cash = v_expected,
      difference = v_difference,
      close_notes = p_notes
  WHERE id = p_session_id
    AND branch_id = p_branch_id
    AND status = 'open'
    AND closed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The cash session changed while it was being closed';
  END IF;

  INSERT INTO public.admin_operational_alerts (
    branch_id, cash_session_id, actor_id, alert_type, title, message,
    payload, created_at
  ) VALUES (
    p_branch_id,
    p_session_id,
    v_actor,
    'cash_inventory_closing',
    'Caja cerrada con conteo de insumos',
    'Se cerró la caja de Chipitlán y se registró el conteo final de maíz y aceite.',
    JSONB_BUILD_OBJECT(
      'opening_counts', JSONB_BUILD_OBJECT(
        'corn_kg', v_opening_corn_kg,
        'oil_liters', v_opening_oil_liters
      ),
      'closing_counts', JSONB_BUILD_OBJECT(
        'corn_kg', p_corn_kg,
        'oil_liters', p_oil_liters
      ),
      'differences', JSONB_BUILD_OBJECT(
        'corn_kg', p_corn_kg - v_opening_corn_kg,
        'oil_liters', p_oil_liters - v_opening_oil_liters
      ),
      'apparent_consumption', JSONB_BUILD_OBJECT(
        'corn_kg', v_opening_corn_kg - p_corn_kg,
        'oil_liters', v_opening_oil_liters - p_oil_liters,
        'authoritative', FALSE
      ),
      'cash', JSONB_BUILD_OBJECT(
        'expected_cash', v_expected,
        'counted_cash', p_counted_cash,
        'difference', v_difference
      ),
      'sales_summary', JSONB_BUILD_OBJECT(
        'sale_count', v_sale_count,
        'refunded_sale_count', v_refunded_sale_count,
        'gross_sales', v_gross_sales,
        'net_sales', v_net_sales,
        'discount_total', v_discount_total,
        'cash_total', v_cash_total,
        'card_total', v_card_total,
        'transfer_total', v_transfer_total,
        'delivery_total', v_delivery_total,
        'generic_sales_total', v_generic_sales_total,
        'known_cost_total', v_known_cost_total,
        'amount_without_known_cost', v_amount_without_known_cost,
        'lines_without_known_cost', v_lines_without_known_cost
      )
    ),
    v_now
  );

  RETURN JSONB_BUILD_OBJECT(
    'session_id', p_session_id,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_difference,
    'closed_at', v_now,
    'opening_corn_kg', v_opening_corn_kg,
    'closing_corn_kg', p_corn_kg,
    'opening_oil_liters', v_opening_oil_liters,
    'closing_oil_liters', p_oil_liters
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register_session_for_branch(
  p_branch_id UUID,
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_closed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_opening_cash NUMERIC;
  v_cash_sales NUMERIC;
  v_withdrawals NUMERIC;
  v_expected NUMERIC;
  v_difference NUMERIC;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to close a cash-register session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'An active profile is required to close a cash-register session';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.branch_cash_control_settings AS setting
    WHERE setting.branch_id = p_branch_id
      AND setting.active
      AND setting.require_closing_inventory_count
  ) THEN
    RAISE EXCEPTION 'This branch requires inventory counts; use close_cash_register_with_inventory_for_branch';
  END IF;
  IF p_closed_by IS NOT NULL AND p_closed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The session closer must be the authenticated user';
  END IF;

  SELECT session.opening_cash
    INTO v_opening_cash
  FROM public.cash_register_sessions AS session
  WHERE session.id = p_session_id
    AND session.branch_id = p_branch_id
    AND session.status = 'open'
    AND session.closed_at IS NULL
    AND public.user_has_branch_access(session.branch_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open cash-register session % was not found for the selected branch', p_session_id;
  END IF;

  SELECT COALESCE(SUM(CASE
    WHEN UPPER(payment_method::TEXT) = 'CASH' THEN total
    WHEN UPPER(payment_method::TEXT) = 'MIXED' THEN COALESCE(cash_amount, 0)
    ELSE 0 END), 0)
  INTO v_cash_sales
  FROM public.sales
  WHERE cash_session_id = p_session_id
    AND branch_id = p_branch_id
    AND COALESCE(is_refunded, FALSE) = FALSE
    AND COALESCE(sale_origin, 'pos') = 'pos';

  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawals
  FROM public.cash_withdrawals
  WHERE session_id = p_session_id;

  v_expected := v_opening_cash + v_cash_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  UPDATE public.cash_register_sessions
  SET status = 'closed', closed_at = now(), closed_by = v_actor,
      counted_cash = p_counted_cash, expected_cash = v_expected,
      difference = v_difference, close_notes = p_notes
  WHERE id = p_session_id
    AND branch_id = p_branch_id
    AND status = 'open'
    AND closed_at IS NULL;

  RETURN json_build_object(
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_difference
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_open_cash_session_to_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_branch UUID;
  v_session_closed_at TIMESTAMPTZ;
  v_session_id UUID;
  v_origin TEXT := COALESCE(NEW.sale_origin, 'pos');
  v_controlled BOOLEAN;
  v_corn_material_id UUID;
  v_oil_material_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'The branch of a sale cannot be changed';
    END IF;
    IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id THEN
      RAISE EXCEPTION 'The cash-register session of a sale cannot be changed';
    END IF;
    IF NOT public.user_has_branch_access(NEW.branch_id) THEN
      RAISE EXCEPTION 'Active access to the selected branch is required';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.user_has_branch_access(NEW.branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  SELECT TRUE, setting.corn_raw_material_id, setting.oil_raw_material_id
    INTO v_controlled, v_corn_material_id, v_oil_material_id
  FROM public.branch_cash_control_settings AS setting
  WHERE setting.branch_id = NEW.branch_id
    AND setting.active
    AND setting.require_opening_inventory_count;
  v_controlled := COALESCE(v_controlled, FALSE);

  -- Orders remain deliberately outside physical cash control. Delivery keeps
  -- its legacy behavior in uncontrolled branches, including Aurrera.
  IF v_origin = 'order'
     OR (v_origin <> 'pos' AND NOT (v_origin = 'delivery' AND v_controlled)) THEN
    RETURN NEW;
  END IF;

  IF NEW.cashier_id IS NOT NULL AND NEW.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'The POS cashier must be the authenticated user';
  END IF;
  NEW.cashier_id := auth.uid();

  IF NEW.cash_session_id IS NULL THEN
    SELECT session.id, session.branch_id, session.closed_at
      INTO v_session_id, v_session_branch, v_session_closed_at
    FROM public.cash_register_sessions AS session
    WHERE session.branch_id = NEW.branch_id
      AND session.status = 'open'
      AND session.closed_at IS NULL
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An open cash-register session is required for the sale branch';
    END IF;
    NEW.cash_session_id := v_session_id;
  ELSE
    SELECT session.branch_id, session.closed_at
      INTO v_session_branch, v_session_closed_at
    FROM public.cash_register_sessions AS session
    WHERE session.id = NEW.cash_session_id
      AND session.status = 'open'
      AND session.closed_at IS NULL;
    IF v_session_branch IS NULL THEN
      RAISE EXCEPTION 'Cash-register session % does not exist', NEW.cash_session_id;
    END IF;
    IF v_session_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cash-register session % is closed', NEW.cash_session_id;
    END IF;
    IF NEW.branch_id IS DISTINCT FROM v_session_branch THEN
      RAISE EXCEPTION 'A sale and its cash-register session must belong to the same branch';
    END IF;
  END IF;

  IF v_controlled AND NOT (
    EXISTS (
      SELECT 1 FROM public.cash_inventory_counts AS count_row
      WHERE count_row.cash_session_id = NEW.cash_session_id
        AND count_row.branch_id = NEW.branch_id
        AND count_row.phase = 'opening'
        AND count_row.raw_material_id = v_corn_material_id
        AND count_row.captured_unit = 'kg'
        AND count_row.normalized_unit = 'g'
    )
    AND EXISTS (
      SELECT 1 FROM public.cash_inventory_counts AS count_row
      WHERE count_row.cash_session_id = NEW.cash_session_id
        AND count_row.branch_id = NEW.branch_id
        AND count_row.phase = 'opening'
        AND count_row.raw_material_id = v_oil_material_id
        AND count_row.captured_unit = 'L'
        AND count_row.normalized_unit = 'ml'
    )
  ) THEN
    RAISE EXCEPTION 'A valid opening corn and oil count is required for Chipitlán sales';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_inventory_session_state(
  p_branch_id UUID,
  p_session_id UUID
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
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = v_actor AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'An active authenticated profile is required';
  END IF;
  IF NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_register_sessions AS session
    WHERE session.id = p_session_id AND session.branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Cash session was not found for the selected branch';
  END IF;

  SELECT JSONB_BUILD_OBJECT(
    'controlled', setting.branch_id IS NOT NULL,
    'opening', JSONB_BUILD_OBJECT(
      'corn_kg', MAX(count_row.captured_value) FILTER (
        WHERE count_row.phase = 'opening'
          AND count_row.raw_material_id = setting.corn_raw_material_id
      ),
      'oil_liters', MAX(count_row.captured_value) FILTER (
        WHERE count_row.phase = 'opening'
          AND count_row.raw_material_id = setting.oil_raw_material_id
      ),
      'counted_at', MAX(count_row.counted_at) FILTER (WHERE count_row.phase = 'opening')
    ),
    'closing', JSONB_BUILD_OBJECT(
      'corn_kg', MAX(count_row.captured_value) FILTER (
        WHERE count_row.phase = 'closing'
          AND count_row.raw_material_id = setting.corn_raw_material_id
      ),
      'oil_liters', MAX(count_row.captured_value) FILTER (
        WHERE count_row.phase = 'closing'
          AND count_row.raw_material_id = setting.oil_raw_material_id
      ),
      'counted_at', MAX(count_row.counted_at) FILTER (WHERE count_row.phase = 'closing')
    ),
    'close_summary', (SELECT TO_JSONB(summary_row)
      FROM public.cash_session_close_summaries AS summary_row
      WHERE summary_row.cash_session_id = p_session_id)
  ) INTO v_result
  FROM public.cash_register_sessions AS session
  LEFT JOIN public.branch_cash_control_settings AS setting
    ON setting.branch_id = session.branch_id AND setting.active
  LEFT JOIN public.cash_inventory_counts AS count_row
    ON count_row.cash_session_id = session.id
  WHERE session.id = p_session_id
    AND session.branch_id = p_branch_id
  GROUP BY setting.branch_id, setting.corn_raw_material_id, setting.oil_raw_material_id;

  RETURN COALESCE(v_result, JSONB_BUILD_OBJECT('controlled', FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_inventory_history_admin()
RETURNS TABLE (
  cash_session_id UUID,
  branch_id UUID,
  branch_code TEXT,
  branch_name TEXT,
  session_status TEXT,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  phase TEXT,
  counted_at TIMESTAMPTZ,
  counted_by UUID,
  counted_by_name TEXT,
  corn_kg NUMERIC,
  oil_liters NUMERIC,
  corn_g NUMERIC,
  oil_ml NUMERIC,
  opening_cash NUMERIC,
  counted_cash NUMERIC,
  expected_cash NUMERIC,
  cash_difference NUMERIC,
  close_summary JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can view cash inventory history';
  END IF;

  RETURN QUERY
  SELECT
    session.id,
    session.branch_id,
    branch.code::TEXT,
    branch.name::TEXT,
    session.status::TEXT,
    session.opened_at,
    session.closed_at,
    phase_row.phase,
    GREATEST(corn.counted_at, oil.counted_at),
    COALESCE(corn.counted_by, oil.counted_by),
    profile.full_name::TEXT,
    corn.captured_value,
    oil.captured_value,
    corn.normalized_value,
    oil.normalized_value,
    session.opening_cash,
    session.counted_cash,
    session.expected_cash,
    session.difference,
    CASE WHEN summary.cash_session_id IS NULL THEN NULL ELSE TO_JSONB(summary) END
  FROM public.cash_register_sessions AS session
  JOIN public.branches AS branch ON branch.id = session.branch_id
  JOIN public.branch_cash_control_settings AS setting
    ON setting.branch_id = session.branch_id
  CROSS JOIN (VALUES ('opening'::TEXT), ('closing'::TEXT)) AS phase_row(phase)
  LEFT JOIN public.cash_inventory_counts AS corn
    ON corn.cash_session_id = session.id
   AND corn.phase = phase_row.phase
   AND corn.raw_material_id = setting.corn_raw_material_id
  LEFT JOIN public.cash_inventory_counts AS oil
    ON oil.cash_session_id = session.id
   AND oil.phase = phase_row.phase
   AND oil.raw_material_id = setting.oil_raw_material_id
  LEFT JOIN public.user_profiles AS profile
    ON profile.id = COALESCE(corn.counted_by, oil.counted_by)
  LEFT JOIN public.cash_session_close_summaries AS summary
    ON summary.cash_session_id = session.id
  WHERE corn.id IS NOT NULL OR oil.id IS NOT NULL
  ORDER BY GREATEST(corn.counted_at, oil.counted_at) DESC, session.id, phase_row.phase;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_operational_alerts(
  p_include_read BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  alert_id UUID,
  branch_id UUID,
  branch_code TEXT,
  branch_name TEXT,
  cash_session_id UUID,
  actor_id UUID,
  actor_name TEXT,
  alert_type TEXT,
  title TEXT,
  message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ,
  is_read BOOLEAN,
  read_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can view operational alerts';
  END IF;

  RETURN QUERY
  SELECT
    alert.id,
    alert.branch_id,
    branch.code::TEXT,
    branch.name::TEXT,
    alert.cash_session_id,
    alert.actor_id,
    profile.full_name::TEXT,
    alert.alert_type::TEXT,
    alert.title::TEXT,
    alert.message::TEXT,
    alert.payload,
    alert.created_at,
    read_row.alert_id IS NOT NULL,
    read_row.read_at
  FROM public.admin_operational_alerts AS alert
  JOIN public.branches AS branch ON branch.id = alert.branch_id
  JOIN public.user_profiles AS profile ON profile.id = alert.actor_id
  LEFT JOIN public.admin_operational_alert_reads AS read_row
    ON read_row.alert_id = alert.id
   AND read_row.admin_user_id = v_actor
  WHERE p_include_read OR read_row.alert_id IS NULL
  ORDER BY alert.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_admin_operational_alert(
  p_alert_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_read_at TIMESTAMPTZ := now();
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can acknowledge operational alerts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_operational_alerts WHERE id = p_alert_id
  ) THEN
    RAISE EXCEPTION 'Operational alert was not found';
  END IF;

  INSERT INTO public.admin_operational_alert_reads (
    alert_id, admin_user_id, read_at
  ) VALUES (
    p_alert_id, v_actor, v_read_at
  )
  ON CONFLICT (alert_id, admin_user_id) DO NOTHING;

  SELECT read_at INTO v_read_at
  FROM public.admin_operational_alert_reads
  WHERE alert_id = p_alert_id AND admin_user_id = v_actor;

  RETURN JSONB_BUILD_OBJECT(
    'alert_id', p_alert_id,
    'admin_user_id', v_actor,
    'read_at', v_read_at
  );
END;
$$;

ALTER TABLE public.branch_cash_control_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_session_close_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_operational_alert_reads ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'branch_cash_control_settings',
        'cash_inventory_counts',
        'cash_session_close_summaries',
        'admin_operational_alerts',
        'admin_operational_alert_reads'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;

CREATE POLICY branch_cash_control_settings_admin_select
  ON public.branch_cash_control_settings
  FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());
CREATE POLICY cash_inventory_counts_admin_select
  ON public.cash_inventory_counts
  FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());
CREATE POLICY cash_session_close_summaries_admin_select
  ON public.cash_session_close_summaries
  FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());
CREATE POLICY admin_operational_alerts_admin_select
  ON public.admin_operational_alerts
  FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());
CREATE POLICY admin_operational_alert_reads_own_select
  ON public.admin_operational_alert_reads
  FOR SELECT TO authenticated
  USING (
    admin_user_id = auth.uid()
    AND public.current_user_is_active_admin()
  );

REVOKE ALL ON TABLE public.branch_cash_control_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cash_inventory_counts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cash_session_close_summaries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_operational_alerts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_operational_alert_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.branch_cash_control_settings TO authenticated;
GRANT SELECT ON TABLE public.cash_inventory_counts TO authenticated;
GRANT SELECT ON TABLE public.cash_session_close_summaries TO authenticated;
GRANT SELECT ON TABLE public.admin_operational_alerts TO authenticated;
GRANT SELECT ON TABLE public.admin_operational_alert_reads TO authenticated;

REVOKE ALL ON FUNCTION public._validate_cash_inventory_count_value(NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._protect_cash_inventory_counts()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._protect_cash_close_summaries()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._protect_admin_operational_alerts()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_sale_item_cost()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_open_cash_session_to_sale()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.open_cash_register_with_inventory_for_branch(
  UUID, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_register_with_inventory_for_branch(
  UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cash_inventory_session_state(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cash_inventory_history_admin()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_operational_alerts(BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acknowledge_admin_operational_alert(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_cash_register_session_for_branch(
  UUID, NUMERIC, UUID, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_register_session_for_branch(
  UUID, UUID, NUMERIC, UUID, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.open_cash_register_with_inventory_for_branch(
  UUID, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register_with_inventory_for_branch(
  UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_inventory_session_state(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_inventory_history_admin()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_operational_alerts(BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_admin_operational_alert(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_register_session_for_branch(
  UUID, NUMERIC, UUID, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register_session_for_branch(
  UUID, UUID, NUMERIC, UUID, TEXT
) TO authenticated;

-- Add persistent alerts to Realtime only when the standard publication exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'admin_operational_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.admin_operational_alerts;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
