-- CAT CORN: attributed POS sales for Aurrera La Luna 02.
-- REVIEWED v3, reconciled with the read-only preflight output from Supabase.
-- Guard: abort if the existing POS commission engine changed since preflight.
-- Administrator choice requires an authenticated active admin account.
--
-- This migration does not backfill or rewrite historical sales or commissions.
-- cashier_id remains the authenticated operator. The new nullable attribution
-- columns identify the effective seller only for new direct POS sales in
-- Aurrera. Existing Chipitlan and delivery flows retain their current behavior.
-- Rollout compatible: previous Aurrera frontend may continue to send legacy
-- sales without attribution until the new frontend is deployed and verified.
-- No historical sale or commission rows are updated.
-- Read-only PRE-FLIGHT: all identities and 16 current commission rates matched.
-- Limitation: checkout prices are supplied by the POS client, as in the existing
-- flow; test a controlled authenticated transaction before broad rollout.
-- The administrator path intentionally rejects non-admin authenticated users.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_rules') IS NULL
     OR to_regprocedure('public.sync_pos_commission_for_sale_item(uuid)') IS NULL
     OR to_regprocedure('public.user_has_branch_access(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required deployed POS and commission objects are missing';
  END IF;

  -- The baseline hash comes from the exact pg_get_functiondef exported by
  -- the production preflight. Abort rather than overwrite a changed engine.
  IF md5(pg_get_functiondef('public.sync_pos_commission_for_sale_item(uuid)'::regprocedure))
      IS DISTINCT FROM '16e8a0a2171410877c5ed096c2324942' THEN
    RAISE EXCEPTION 'POS commission engine differs from the audited baseline. Stop; re-export before replacing.';
  END IF;

  -- Do not silently replace an independently deployed checkout function.
  IF to_regprocedure(
      'public.create_aurrera_attributed_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,boolean,numeric,text,jsonb)'
    ) IS NOT NULL THEN
    RAISE EXCEPTION 'Aurrera checkout RPC already exists. Stop and compare versions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND code = 'aurrera_la_luna_02' AND active
  ) THEN
    RAISE EXCEPTION 'The exact active Aurrera La Luna 02 branch is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND role::TEXT = 'vendedora' AND is_active
  ) THEN
    RAISE EXCEPTION 'The exact active Angelica commission profile is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = '682568c5-4339-4af5-85ef-71c8b2febd59'::UUID
      AND role::TEXT = 'socios_comerciales' AND is_active
  ) THEN
    RAISE EXCEPTION 'The exact active Gerardo commission profile is missing';
  END IF;
END;
$$;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pos_commission_attribution TEXT,
  ADD COLUMN IF NOT EXISTS pos_commission_recipient_id UUID
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS checkout_token UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::REGCLASS
      AND conname = 'sales_pos_commission_attribution_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_pos_commission_attribution_check CHECK (
        (pos_commission_attribution IS NULL
          AND pos_commission_recipient_id IS NULL
          AND checkout_token IS NULL)
        OR
        (pos_commission_attribution = 'employee'
          AND pos_commission_recipient_id IS NOT NULL
          AND checkout_token IS NOT NULL)
        OR
        (pos_commission_attribution = 'administrator'
          AND pos_commission_recipient_id IS NULL
          AND checkout_token IS NOT NULL)
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_checkout_token
  ON public.sales (checkout_token);

COMMENT ON COLUMN public.sales.cashier_id IS
  'Authenticated operator recorded by the cash-session trigger; never the delegated POS commission recipient.';
COMMENT ON COLUMN public.sales.pos_commission_attribution IS
  'Explicit Aurrera selection: employee or administrator. NULL preserves legacy and non-Aurrera behavior.';
COMMENT ON COLUMN public.sales.pos_commission_recipient_id IS
  'Effective POS commission recipient selected for a new Aurrera sale; NULL for an explicit administrator sale.';
COMMENT ON COLUMN public.sales.checkout_token IS
  'Client-generated idempotency token for an atomic Aurrera checkout.';

CREATE OR REPLACE FUNCTION public.validate_aurrera_pos_commission_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_aurrera CONSTANT UUID := 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID;
  v_angelica CONSTANT UUID := 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID;
  v_gerardo CONSTANT UUID := '682568c5-4339-4af5-85ef-71c8b2febd59'::UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pos_commission_attribution IS DISTINCT FROM OLD.pos_commission_attribution
       OR NEW.pos_commission_recipient_id IS DISTINCT FROM OLD.pos_commission_recipient_id
       OR NEW.checkout_token IS DISTINCT FROM OLD.checkout_token THEN
      RAISE EXCEPTION 'POS commission attribution and checkout token are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF lower(btrim(COALESCE(NEW.sale_origin, ''))) <> 'pos'
     OR NEW.branch_id IS DISTINCT FROM v_aurrera THEN
    IF NEW.pos_commission_attribution IS NOT NULL
       OR NEW.pos_commission_recipient_id IS NOT NULL
       OR NEW.checkout_token IS NOT NULL THEN
      RAISE EXCEPTION 'Delegated POS commission attribution is exclusive to direct Aurrera sales';
    END IF;
    RETURN NEW;
  END IF;

  -- Deployment bridge: the previous frontend has no attribution fields.
  -- Existing POS sales must continue during the coordinated rollout.
  IF NEW.checkout_token IS NULL
     AND NEW.pos_commission_attribution IS NULL
     AND NEW.pos_commission_recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.checkout_token IS NULL OR NEW.pos_commission_attribution IS NULL THEN
    RAISE EXCEPTION 'Attributed Aurrera POS sales require a selection and token';
  END IF;

  IF NEW.pos_commission_attribution = 'administrator' THEN
    IF NEW.pos_commission_recipient_id IS NOT NULL THEN
      RAISE EXCEPTION 'Administrator sales cannot have a commission recipient';
    END IF;
    SELECT profile.* INTO v_profile
    FROM public.user_profiles AS profile
    WHERE profile.id = auth.uid();
    IF v_profile.id IS NULL OR v_profile.role::TEXT <> 'admin' OR NOT v_profile.is_active THEN
      RAISE EXCEPTION 'Administrator attribution requires an active authenticated administrator';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pos_commission_attribution <> 'employee'
     OR NEW.pos_commission_recipient_id NOT IN (v_angelica, v_gerardo) THEN
    RAISE EXCEPTION 'Invalid Aurrera POS commission recipient';
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.user_profiles AS profile
  WHERE profile.id = NEW.pos_commission_recipient_id;

  IF v_profile.id IS NULL OR NOT v_profile.is_active
     OR (v_profile.id = v_angelica AND v_profile.role::TEXT <> 'vendedora')
     OR (v_profile.id = v_gerardo AND v_profile.role::TEXT <> 'socios_comerciales') THEN
    RAISE EXCEPTION 'The selected Aurrera employee is not eligible for POS attribution';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_aurrera_pos_commission_attribution
  ON public.sales;
CREATE TRIGGER trg_validate_aurrera_pos_commission_attribution
BEFORE INSERT OR UPDATE
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.validate_aurrera_pos_commission_attribution();

-- This is the deployed 2026-10-01 combo-aware function, changed only to
-- resolve the effective recipient separately from the authenticated cashier.
CREATE OR REPLACE FUNCTION public.sync_pos_commission_for_sale_item(p_sale_item_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_sold_product public.products%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_snapshot public.commission_program_eligibility_snapshots%ROWTYPE;
  v_product_name TEXT;
  v_product_key TEXT;
  v_rule_id UUID;
  v_unit_commission NUMERIC := 0;
  v_commission_amount NUMERIC := 0;
  v_business_date DATE;
  v_event_id UUID;
  v_scheme TEXT;
  v_recipient_id UUID;
  v_is_official_combo BOOLEAN := FALSE;
  v_snapshot_metadata JSONB;
  v_event_metadata JSONB;
BEGIN
  SELECT item.* INTO v_item
  FROM public.sale_items AS item
  WHERE item.id = p_sale_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_item.sale_id;
  IF NOT FOUND
     OR lower(trim(COALESCE(v_sale.sale_origin, ''))) <> 'pos'
     OR COALESCE(v_sale.is_refunded, FALSE)
     OR v_item.product_id IS NULL
     OR COALESCE(v_item.is_generic, FALSE) THEN
    RETURN NULL;
  END IF;

  SELECT event.id INTO v_event_id
  FROM public.commission_events AS event
  WHERE event.source_type = 'pos_sale'
    AND event.source_item_id = v_item.id
  LIMIT 1;
  IF v_event_id IS NOT NULL THEN RETURN v_event_id; END IF;

  IF v_sale.pos_commission_attribution = 'administrator' THEN
    RETURN NULL;
  ELSIF v_sale.pos_commission_attribution = 'employee' THEN
    v_recipient_id := v_sale.pos_commission_recipient_id;
  ELSE
    -- Exact legacy behavior for Chipitlan and pre-migration rows.
    v_recipient_id := v_sale.cashier_id;
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.user_profiles AS profile
  WHERE profile.id = v_recipient_id;
  IF v_profile.id IS NULL THEN RETURN NULL; END IF;

  SELECT product.* INTO v_sold_product
  FROM public.products AS product
  WHERE product.id = v_item.product_id;
  IF v_sold_product.id IS NULL THEN
    RAISE WARNING 'POS commission: product_id % no encontrado para sale_item %',
      v_item.product_id, p_sale_item_id;
    RETURN NULL;
  END IF;

  SELECT commission_product.* INTO v_product
  FROM public.product_combos AS combo
  JOIN public.products AS commission_product
    ON commission_product.id = combo.commission_product_id
  WHERE combo.product_id = v_item.product_id
    AND combo.active;

  IF v_product.id IS NULL THEN
    v_product := v_sold_product;
  ELSE
    v_is_official_combo := TRUE;
  END IF;

  v_product_name := COALESCE(
    NULLIF(trim(COALESCE(v_product.product_name, '')), ''),
    v_product.name
  );
  v_product_key := public.commission_product_key(v_product_name, v_product.flavor);
  v_business_date := (v_sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE;

  IF v_profile.role::TEXT = 'socios_comerciales' THEN
    v_scheme := 'venta_pieza';
    v_rule_id := public.get_commission_rule_id(v_scheme, v_product_key, v_business_date);
    v_unit_commission := public.get_commission_rule_amount(v_scheme, v_product_key, v_business_date);
  ELSE
    SELECT snapshot.* INTO v_snapshot
    FROM public.commission_program_eligibility_snapshots AS snapshot
    WHERE snapshot.program = 'vendedora_pos'
      AND snapshot.commercial_scheme = 'pos'
      AND snapshot.source_item_id = v_item.id
    FOR UPDATE;

    IF v_snapshot.source_item_id IS NULL THEN
      v_rule_id := public.get_commission_rule_id('vendedora_pos', v_product_key, v_business_date);
      v_unit_commission := public.get_commission_rule_amount('vendedora_pos', v_product_key, v_business_date);
      v_snapshot_metadata := jsonb_build_object(
        'product_key', v_product_key,
        'business_date', v_business_date,
        'authenticated_cashier_id', v_sale.cashier_id,
        'commission_recipient_id', v_recipient_id,
        'attribution_mode', COALESCE(v_sale.pos_commission_attribution, 'legacy_cashier')
      );
      IF v_is_official_combo THEN
        v_snapshot_metadata := v_snapshot_metadata || jsonb_build_object(
          'official_combo', TRUE,
          'combo_product_id', v_sold_product.id,
          'commission_product_id', v_product.id
        );
      END IF;

      INSERT INTO public.commission_program_eligibility_snapshots (
        program, commercial_scheme, source_item_id, source_id, seller_id, eligible,
        rule_id, unit_commission, operation_at, reason, metadata
      ) VALUES (
        'vendedora_pos', 'pos', v_item.id, v_sale.id, v_recipient_id,
        v_profile.role::TEXT = 'vendedora' AND v_profile.is_active
          AND v_rule_id IS NOT NULL AND COALESCE(v_unit_commission, 0) > 0,
        v_rule_id, v_unit_commission, v_sale.created_at,
        CASE
          WHEN v_profile.role::TEXT <> 'vendedora' OR NOT v_profile.is_active
            THEN 'recipient_not_active_vendedora'
          WHEN v_rule_id IS NULL THEN 'no_effective_rule'
          ELSE 'eligible'
        END,
        v_snapshot_metadata
      )
      ON CONFLICT (program, commercial_scheme, source_item_id) DO NOTHING;

      SELECT snapshot.* INTO v_snapshot
      FROM public.commission_program_eligibility_snapshots AS snapshot
      WHERE snapshot.program = 'vendedora_pos'
        AND snapshot.commercial_scheme = 'pos'
        AND snapshot.source_item_id = v_item.id;
    END IF;

    IF NOT COALESCE(v_snapshot.eligible, FALSE) THEN RETURN NULL; END IF;
    v_scheme := 'vendedora_pos';
    v_rule_id := v_snapshot.rule_id;
    v_unit_commission := v_snapshot.unit_commission;
  END IF;

  IF v_rule_id IS NULL OR COALESCE(v_unit_commission, 0) <= 0 THEN
    RAISE WARNING 'POS commission: sin regla vigente para product_key %, fecha %, sale_item %',
      v_product_key, v_business_date, p_sale_item_id;
    RETURN NULL;
  END IF;

  v_commission_amount := COALESCE(v_item.quantity, 0)::NUMERIC * v_unit_commission;
  IF v_commission_amount <= 0 THEN RETURN NULL; END IF;

  v_event_metadata := jsonb_build_object(
    'channel', 'pos',
    'cashier_id', v_sale.cashier_id,
    'authenticated_cashier_id', v_sale.cashier_id,
    'commission_recipient_id', v_recipient_id,
    'attribution_mode', COALESCE(v_sale.pos_commission_attribution, 'legacy_cashier'),
    'sale_id', v_sale.id,
    'sale_item_id', v_item.id,
    'product_id', v_item.product_id,
    'commission_scheme', v_scheme,
    'business_date', v_business_date
  );
  IF v_is_official_combo THEN
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'official_combo', TRUE,
      'combo_product_id', v_sold_product.id,
      'combo_product_sku', v_sold_product.sku_code,
      'commission_product_id', v_product.id,
      'commission_product_sku', v_product.sku_code
    );
  END IF;

  INSERT INTO public.commission_events (
    seller_id, partner_id, source_type, source_id, source_item_id, rule_id,
    product_key, product_name, product_variant, product_size, quantity,
    unit_commission, commission_amount, release_condition, status, earned_at,
    available_at, metadata
  ) VALUES (
    v_recipient_id, NULL, 'pos_sale', v_sale.id, v_item.id, v_rule_id,
    v_product_key, v_product_name, v_product.flavor, v_product.size, v_item.quantity,
    v_unit_commission, v_commission_amount, 'full_payment', 'available',
    v_sale.created_at, v_sale.created_at, v_event_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id INTO v_event_id
    FROM public.commission_events AS event
    WHERE event.source_type = 'pos_sale'
      AND event.source_item_id = v_item.id
    LIMIT 1;
  END IF;
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_aurrera_attributed_pos_sale(
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
  p_loyalty_reward_applied BOOLEAN,
  p_loyalty_discount_amount NUMERIC,
  p_promotion_code TEXT,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_sale_id UUID;
  v_created BOOLEAN := FALSE;
  v_actual_total NUMERIC;
  v_item RECORD;
  v_method TEXT := upper(btrim(COALESCE(p_payment_method, '')));
  v_cash NUMERIC := COALESCE(p_cash_amount, 0);
  v_card NUMERIC := COALESCE(p_card_amount, 0);
  v_transfer NUMERIC := COALESCE(p_transfer_amount, 0);
  v_aurrera CONSTANT UUID := 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required';
  END IF;
  IF p_branch_id IS DISTINCT FROM v_aurrera
     OR NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to Aurrera La Luna 02 is required';
  END IF;
  IF p_checkout_token IS NULL THEN
    RAISE EXCEPTION 'A checkout token is required';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one sale item is required';
  END IF;
  IF COALESCE(p_total, 0) <= 0 OR v_cash < 0 OR v_card < 0 OR v_transfer < 0 THEN
    RAISE EXCEPTION 'Invalid POS totals';
  END IF;
  IF v_method NOT IN ('CASH', 'CARD', 'MIXED', 'TRANSFER') THEN
    RAISE EXCEPTION 'Invalid direct POS payment method';
  END IF;
  IF (v_method = 'CASH' AND (v_cash + 0.009 < p_total OR v_card <> 0 OR v_transfer <> 0))
     OR (v_method = 'CARD' AND (v_card + 0.009 < p_total OR v_cash <> 0 OR v_transfer <> 0))
     OR (v_method = 'MIXED' AND ((CASE WHEN v_cash > 0 THEN 1 ELSE 0 END
                                       + CASE WHEN v_card > 0 THEN 1 ELSE 0 END
                                       + CASE WHEN v_transfer > 0 THEN 1 ELSE 0 END) < 2
                                    OR v_cash + v_card + v_transfer + 0.009 < p_total))
     OR (v_method = 'TRANSFER' AND (abs(v_transfer - p_total) > 0.009 OR v_cash <> 0 OR v_card <> 0)) THEN
    RAISE EXCEPTION 'Payment amounts do not match the selected method';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID,
      product_name TEXT,
      is_generic BOOLEAN,
      quantity INTEGER,
      price NUMERIC,
      discount_amount NUMERIC,
      discount_reason TEXT,
      selected_beverage_product_id UUID
    )
    WHERE COALESCE(item.quantity, 0) <= 0
       OR COALESCE(item.price, -1) < 0
       OR COALESCE(item.discount_amount, 0) < 0
       OR (COALESCE(item.is_generic, FALSE) AND NULLIF(btrim(COALESCE(item.product_name, '')), '') IS NULL)
       OR (NOT COALESCE(item.is_generic, FALSE) AND item.product_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Invalid sale item payload';
  END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.checkout_token = p_checkout_token;

  IF v_sale.id IS NULL THEN
    INSERT INTO public.sales (
      total, payment_method, cash_amount, card_amount, transfer_amount,
      sale_origin, delivery_platform, platform_amount, cashier_id, customer_id,
      loyalty_reward_applied, loyalty_discount_amount, promotion_code,
      branch_id, cash_session_id, pos_commission_attribution,
      pos_commission_recipient_id, checkout_token
    ) VALUES (
      p_total, v_method, v_cash, v_card, v_transfer,
      'pos', NULL, 0, auth.uid(), p_customer_id,
      COALESCE(p_loyalty_reward_applied, FALSE),
      COALESCE(p_loyalty_discount_amount, 0), p_promotion_code,
      p_branch_id, p_cash_session_id, p_attribution_mode,
      p_commission_recipient_id, p_checkout_token
    )
    ON CONFLICT (checkout_token) DO NOTHING
    RETURNING id INTO v_sale_id;

    v_created := v_sale_id IS NOT NULL;
    IF v_created THEN
      INSERT INTO public.sale_items (
        sale_id, product_id, product_name, is_generic, quantity, price,
        discount_amount, discount_reason, selected_beverage_product_id
      )
      SELECT
        v_sale_id, item.product_id, item.product_name,
        COALESCE(item.is_generic, FALSE), item.quantity, item.price,
        COALESCE(item.discount_amount, 0), item.discount_reason,
        item.selected_beverage_product_id
      FROM jsonb_to_recordset(p_items) AS item(
        product_id UUID,
        product_name TEXT,
        is_generic BOOLEAN,
        quantity INTEGER,
        price NUMERIC,
        discount_amount NUMERIC,
        discount_reason TEXT,
        selected_beverage_product_id UUID
      );
    ELSE
      SELECT sale.* INTO v_sale
      FROM public.sales AS sale
      WHERE sale.checkout_token = p_checkout_token;
    END IF;
  ELSE
    v_sale_id := v_sale.id;
  END IF;

  IF v_created THEN
    SELECT sale.* INTO v_sale FROM public.sales AS sale WHERE sale.id = v_sale_id;
  END IF;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'The checkout token is unavailable to the authenticated user';
  END IF;
  v_sale_id := v_sale.id;

  IF v_sale.cashier_id IS DISTINCT FROM auth.uid()
     OR v_sale.branch_id IS DISTINCT FROM p_branch_id
     OR (p_cash_session_id IS NOT NULL AND v_sale.cash_session_id IS DISTINCT FROM p_cash_session_id)
     OR v_sale.pos_commission_attribution IS DISTINCT FROM p_attribution_mode
     OR v_sale.pos_commission_recipient_id IS DISTINCT FROM p_commission_recipient_id
     OR v_sale.payment_method IS DISTINCT FROM v_method
     OR abs(v_sale.total - p_total) > 0.009
     OR abs(COALESCE(v_sale.cash_amount, 0) - v_cash) > 0.009
     OR abs(COALESCE(v_sale.card_amount, 0) - v_card) > 0.009
     OR abs(COALESCE(v_sale.transfer_amount, 0) - v_transfer) > 0.009
     OR v_sale.customer_id IS DISTINCT FROM p_customer_id
     OR v_sale.loyalty_reward_applied IS DISTINCT FROM COALESCE(p_loyalty_reward_applied, FALSE)
     OR abs(v_sale.loyalty_discount_amount - COALESCE(p_loyalty_discount_amount, 0)) > 0.009
     OR v_sale.promotion_code IS DISTINCT FROM p_promotion_code THEN
    RAISE EXCEPTION 'The checkout token was already used with different sale data';
  END IF;

  SELECT sale.total INTO v_actual_total
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id;
  IF abs(v_actual_total - p_total) > 0.009 THEN
    RAISE EXCEPTION 'The stored sale total differs from the submitted total';
  END IF;

  -- WARNING: this check only compares the persisted total with the submitted total;
  -- it is not proof of independently verified prices or discounts.
  -- The deployed trigger remains the primary generator. Replaying the same
  -- idempotent function here makes commission failures transactional for this
  -- checkout instead of leaving a completed eligible sale without an event.
  FOR v_item IN
    SELECT item.id FROM public.sale_items AS item WHERE item.sale_id = v_sale_id
  LOOP
    PERFORM public.sync_pos_commission_for_sale_item(v_item.id);
  END LOOP;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_aurrera_attributed_pos_sale(
  UUID, UUID, UUID, TEXT, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC,
  UUID, BOOLEAN, NUMERIC, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_aurrera_attributed_pos_sale(
  UUID, UUID, UUID, TEXT, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC,
  UUID, BOOLEAN, NUMERIC, TEXT, JSONB
) TO authenticated;

-- Structural checks are part of the same transaction.
DO $$
BEGIN
  IF to_regprocedure(
      'public.create_aurrera_attributed_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,boolean,numeric,text,jsonb)'
    ) IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'sales'
         AND indexname = 'uq_sales_checkout_token'
     ) THEN
    RAISE EXCEPTION 'Aurrera checkout install incomplete. Rolling back.';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
