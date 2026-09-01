-- Individual, opaque barcode control for commercial-partner deliveries.
-- Apply after the 20260829 migrations. This migration is intentionally not run by the app.

BEGIN;

-- Only these two known constraints are replaced; no dynamic discovery is used.
ALTER TABLE public.commercial_partner_movements
  DROP CONSTRAINT IF EXISTS commercial_partner_movements_status_check;
ALTER TABLE public.wholesale_orders
  DROP CONSTRAINT IF EXISTS wholesale_orders_order_status_check;
ALTER TABLE public.commercial_partner_movements
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT commercial_partner_movements_status_check
    CHECK (status IN ('pending_release', 'completed', 'cancelled'));
ALTER TABLE public.commercial_partner_movement_items
  ADD COLUMN IF NOT EXISTS product_id UUID NULL
    REFERENCES public.products(id) ON DELETE RESTRICT;
ALTER TABLE public.wholesale_orders
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT wholesale_orders_order_status_check
    CHECK (order_status IN ('draft', 'pending_release', 'delivered', 'cancelled'));

CREATE TABLE public.commercial_delivery_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_value TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('comodato', 'mayoreo')),
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  movement_id UUID REFERENCES public.commercial_partner_movements(id) ON DELETE RESTRICT,
  wholesale_order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  source_item_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_lot_id UUID REFERENCES public.product_lots(id) ON DELETE RESTRICT,
  product_code TEXT NOT NULL, product_name TEXT NOT NULL, product_variant TEXT, product_size TEXT,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(12,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','printed','scanned','released','returned_good','spoiled','voided','replaced')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), generated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  printed_at TIMESTAMPTZ, printed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ, scanned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ, released_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  spoiled_at TIMESTAMPTZ, spoiled_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ, voided_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  spoilage_movement_id UUID REFERENCES public.commercial_partner_movements(id) ON DELETE RESTRICT,
  print_count INTEGER NOT NULL DEFAULT 0 CHECK (print_count >= 0), last_reprint_reason TEXT,
  replaces_unit_id UUID REFERENCES public.commercial_delivery_units(id) ON DELETE RESTRICT,
  replaced_by_unit_id UUID REFERENCES public.commercial_delivery_units(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commercial_delivery_units_one_source CHECK (
    (source_type = 'comodato' AND movement_id IS NOT NULL AND wholesale_order_id IS NULL) OR
    (source_type = 'mayoreo' AND movement_id IS NULL AND wholesale_order_id IS NOT NULL)
  )
);
CREATE TABLE public.commercial_delivery_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('generated','printed','reprinted','scanned','released','spoiled','returned_good','voided','replaced','spoilage_exception')),
  actor_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  movement_id UUID REFERENCES public.commercial_partner_movements(id) ON DELETE RESTRICT,
  wholesale_order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  delivery_unit_id UUID REFERENCES public.commercial_delivery_units(id) ON DELETE RESTRICT,
  reason TEXT, metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX commercial_delivery_units_partner_status_idx ON public.commercial_delivery_units(partner_id,status,generated_at DESC);
CREATE INDEX commercial_delivery_units_movement_idx ON public.commercial_delivery_units(movement_id) WHERE movement_id IS NOT NULL;
CREATE INDEX commercial_delivery_units_order_idx ON public.commercial_delivery_units(wholesale_order_id) WHERE wholesale_order_id IS NOT NULL;
CREATE INDEX commercial_delivery_audit_partner_idx ON public.commercial_delivery_audit_events(partner_id,occurred_at DESC);

ALTER TABLE public.commercial_delivery_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_delivery_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY commercial_delivery_units_read_authenticated ON public.commercial_delivery_units FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.role='admin' AND p.is_active)
  OR EXISTS (SELECT 1 FROM public.commercial_partners cp WHERE cp.id=partner_id AND cp.assigned_to=auth.uid())
);
CREATE POLICY commercial_delivery_units_no_direct_write ON public.commercial_delivery_units FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY commercial_delivery_audit_read_authenticated ON public.commercial_delivery_audit_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.role='admin' AND p.is_active)
  OR EXISTS (SELECT 1 FROM public.commercial_partners cp WHERE cp.id=partner_id AND cp.assigned_to=auth.uid())
);
CREATE POLICY commercial_delivery_audit_no_direct_write ON public.commercial_delivery_audit_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._commercial_delivery_actor(p_partner_id UUID,p_admin_only BOOLEAN DEFAULT false)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID:=auth.uid(); v_role TEXT; v_active BOOLEAN; v_assigned UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  SELECT role,is_active INTO v_role,v_active FROM public.user_profiles WHERE id=v_actor;
  IF NOT COALESCE(v_active,false) OR v_role NOT IN ('admin','socios_comerciales') THEN RAISE EXCEPTION 'Active commercial-partner role is required'; END IF;
  IF p_admin_only AND v_role<>'admin' THEN RAISE EXCEPTION 'Administrator role is required'; END IF;
  IF v_role='socios_comerciales' THEN SELECT assigned_to INTO v_assigned FROM public.commercial_partners WHERE id=p_partner_id;
    IF v_assigned IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Partner is not assigned to current user'; END IF;
  END IF;
  RETURN v_actor;
END; $$;

-- No actor parameter: the event always records the authenticated user.
CREATE OR REPLACE FUNCTION public._commercial_delivery_audit(p_event TEXT,p_partner UUID,p_movement UUID,p_order UUID,p_unit UUID DEFAULT NULL,p_reason TEXT DEFAULT NULL,p_metadata JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner);
  INSERT INTO public.commercial_delivery_audit_events(event_type,actor_id,partner_id,movement_id,wholesale_order_id,delivery_unit_id,reason,metadata)
  VALUES(p_event,v_actor,p_partner,p_movement,p_order,p_unit,NULLIF(BTRIM(p_reason),''),COALESCE(p_metadata,'{}'::JSONB));
END; $$;
REVOKE ALL ON FUNCTION public._commercial_delivery_audit(TEXT,UUID,UUID,UUID,UUID,TEXT,JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._commercial_delivery_source_status(p_type TEXT,p_source UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
  SELECT CASE p_type WHEN 'comodato' THEN (SELECT status::TEXT FROM public.commercial_partner_movements WHERE id=p_source)
                     WHEN 'mayoreo' THEN (SELECT order_status::TEXT FROM public.wholesale_orders WHERE id=p_source) END;
$$;

-- A source may transition only when its original required quantity is exactly released.
CREATE OR REPLACE FUNCTION public._commercial_delivery_source_can_release(p_type TEXT,p_source UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_required INTEGER; v_released INTEGER; v_pending INTEGER; v_voided INTEGER; v_bad_replacement INTEGER;
BEGIN
  IF p_type='comodato' THEN SELECT COALESCE(SUM(quantity_delivered),0)::INTEGER INTO v_required FROM public.commercial_partner_movement_items WHERE movement_id=p_source;
  ELSE SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_required FROM public.wholesale_order_items WHERE wholesale_order_id=p_source; END IF;
  SELECT COUNT(*) FILTER(WHERE status='released'),COUNT(*) FILTER(WHERE status IN('generated','printed','scanned')),COUNT(*) FILTER(WHERE status='voided'),
    COUNT(*) FILTER(WHERE status='replaced' AND (replaced_by_unit_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.commercial_delivery_units s WHERE s.id=u.replaced_by_unit_id AND s.status='released')))
  INTO v_released,v_pending,v_voided,v_bad_replacement
  FROM public.commercial_delivery_units u WHERE u.source_type=p_type AND ((p_type='comodato' AND u.movement_id=p_source) OR (p_type='mayoreo' AND u.wholesale_order_id=p_source));
  RETURN v_required>0 AND v_released=v_required AND v_pending=0 AND v_voided=0 AND v_bad_replacement=0;
END; $$;

CREATE OR REPLACE FUNCTION public._commercial_delivery_units_ready_for_release(p_type TEXT,p_source UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_required INTEGER; v_active INTEGER; v_unscanned INTEGER; v_voided INTEGER; v_bad_replacement INTEGER;
BEGIN
  IF p_type='comodato' THEN SELECT COALESCE(SUM(quantity_delivered),0)::INTEGER INTO v_required FROM public.commercial_partner_movement_items WHERE movement_id=p_source;
  ELSE SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_required FROM public.wholesale_order_items WHERE wholesale_order_id=p_source; END IF;
  SELECT COUNT(*) FILTER(WHERE status IN('generated','printed','scanned','released')),COUNT(*) FILTER(WHERE status IN('generated','printed')),COUNT(*) FILTER(WHERE status='voided'),COUNT(*) FILTER(WHERE status='replaced' AND replaced_by_unit_id IS NULL)
  INTO v_active,v_unscanned,v_voided,v_bad_replacement FROM public.commercial_delivery_units u
  WHERE u.source_type=p_type AND ((p_type='comodato' AND u.movement_id=p_source) OR (p_type='mayoreo' AND u.wholesale_order_id=p_source));
  RETURN v_required>0 AND v_active=v_required AND v_unscanned=0 AND v_voided=0 AND v_bad_replacement=0;
END; $$;

CREATE OR REPLACE FUNCTION public._commercial_delivery_source_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_type TEXT:=CASE WHEN TG_TABLE_NAME='commercial_partner_movements' THEN 'comodato' ELSE 'mayoreo' END; v_id UUID; v_old TEXT; v_new TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF (v_type='comodato' AND NEW.movement_type='delivery' AND NEW.status='completed') OR (v_type='mayoreo' AND NEW.order_status='delivered') THEN RAISE EXCEPTION 'All labelled bags must be released before delivery'; END IF;
    RETURN NEW;
  END IF;
  v_id:=OLD.id; v_old:=CASE WHEN v_type='comodato' THEN OLD.status::TEXT ELSE OLD.order_status::TEXT END;
  IF NOT EXISTS(SELECT 1 FROM public.commercial_delivery_units u WHERE (v_type='comodato' AND u.movement_id=v_id) OR (v_type='mayoreo' AND u.wholesale_order_id=v_id)) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'A labelled delivery cannot be deleted'; END IF;
  v_new:=CASE WHEN v_type='comodato' THEN NEW.status::TEXT ELSE NEW.order_status::TEXT END;
  IF v_old='pending_release' AND v_new IN('completed','delivered') AND public._commercial_delivery_source_can_release(v_type,v_id) THEN RETURN NEW; END IF;
  IF v_old='pending_release' AND v_new='cancelled' AND NOT EXISTS(SELECT 1 FROM public.commercial_delivery_units u WHERE ((v_type='comodato' AND u.movement_id=v_id) OR (v_type='mayoreo' AND u.wholesale_order_id=v_id)) AND u.status IN('released','spoiled','returned_good')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A labelled delivery cannot be edited outside its verified transition';
END; $$;
CREATE TRIGGER commercial_delivery_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_partner_movements FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_source_guard();
CREATE TRIGGER commercial_delivery_order_guard BEFORE INSERT OR UPDATE OR DELETE ON public.wholesale_orders FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_source_guard();

CREATE OR REPLACE FUNCTION public._commercial_delivery_item_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_id UUID:=CASE WHEN TG_TABLE_NAME='commercial_partner_movement_items' THEN COALESCE(OLD.movement_id,NEW.movement_id) ELSE COALESCE(OLD.wholesale_order_id,NEW.wholesale_order_id) END;
BEGIN
  IF (TG_TABLE_NAME='commercial_partner_movement_items' AND EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE movement_id=v_id)) OR (TG_TABLE_NAME='wholesale_order_items' AND EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE wholesale_order_id=v_id)) THEN RAISE EXCEPTION 'Items of a labelled delivery cannot be edited or deleted'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER commercial_delivery_movement_item_guard BEFORE UPDATE OR DELETE ON public.commercial_partner_movement_items FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_item_guard();
CREATE TRIGGER commercial_delivery_order_item_guard BEFORE UPDATE OR DELETE ON public.wholesale_order_items FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_item_guard();

CREATE OR REPLACE FUNCTION public._commercial_delivery_unit_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_type TEXT; v_source UUID; v_status TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commercial delivery units cannot be deleted'; END IF;
  v_type:=NEW.source_type; v_source:=COALESCE(NEW.movement_id,NEW.wholesale_order_id); v_status:=public._commercial_delivery_source_status(v_type,v_source);
  IF TG_OP='INSERT' THEN IF NEW.status<>'generated' OR v_status<>'pending_release' THEN RAISE EXCEPTION 'New units must belong to a pending release'; END IF; RETURN NEW; END IF;
  IF NEW.barcode_value IS DISTINCT FROM OLD.barcode_value OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.movement_id IS DISTINCT FROM OLD.movement_id OR NEW.wholesale_order_id IS DISTINCT FROM OLD.wholesale_order_id OR NEW.source_item_id IS DISTINCT FROM OLD.source_item_id OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_lot_id IS DISTINCT FROM OLD.product_lot_id OR NEW.product_code IS DISTINCT FROM OLD.product_code OR NEW.product_name IS DISTINCT FROM OLD.product_name OR NEW.product_variant IS DISTINCT FROM OLD.product_variant OR NEW.product_size IS DISTINCT FROM OLD.product_size OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN RAISE EXCEPTION 'Delivery unit identity and financial snapshot are immutable'; END IF;
  IF OLD.status='generated' AND NEW.status='printed' AND NEW.print_count=OLD.print_count+1 THEN NULL;
  ELSIF OLD.status='printed' AND NEW.status='printed' AND NEW.print_count=OLD.print_count+1 AND NULLIF(BTRIM(NEW.last_reprint_reason),'') IS NOT NULL THEN NULL;
  ELSIF OLD.status='printed' AND NEW.status='scanned' THEN NULL;
  ELSIF OLD.status='scanned' AND NEW.status='released' AND v_status='pending_release' AND public._commercial_delivery_units_ready_for_release(v_type,v_source) THEN NULL;
  ELSIF OLD.status IN('generated','printed') AND NEW.status='replaced' AND NEW.replaced_by_unit_id IS NOT NULL THEN NULL;
  ELSIF OLD.status IN('generated','printed') AND NEW.status='voided' AND v_status='cancelled' THEN NULL;
  ELSIF OLD.status='released' AND NEW.status='spoiled' AND NEW.spoilage_movement_id IS NOT NULL THEN NULL;
  ELSE RAISE EXCEPTION 'Invalid delivery-unit transition from % to %',OLD.status,NEW.status; END IF;
  NEW.updated_at:=now(); RETURN NEW;
END; $$;
CREATE TRIGGER commercial_delivery_unit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_delivery_units FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_unit_guard();

CREATE OR REPLACE FUNCTION public.create_comodato_delivery_with_units(p_partner_id UUID,p_movement_date DATE,p_next_visit_date DATE,p_next_visit_reason TEXT,p_notes TEXT,p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_movement UUID; v_item JSONB; v_item_id UUID; v_product JSONB; v_product_id UUID; v_qty INTEGER; v_i INTEGER; v_unit UUID; v_lot UUID; v_code TEXT; v_name TEXT; v_variant TEXT; v_size TEXT; v_cost NUMERIC;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner_id); IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;
  INSERT INTO public.commercial_partner_movements(partner_id,movement_type,movement_date,next_visit_date,next_visit_reason,notes,status) VALUES(p_partner_id,'delivery',COALESCE(p_movement_date,(now() AT TIME ZONE 'America/Mexico_City')::DATE),p_next_visit_date,NULLIF(BTRIM(p_next_visit_reason),''),NULLIF(BTRIM(p_notes),''),'pending_release') RETURNING id INTO v_movement;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity_delivered')::INTEGER; IF v_qty IS NULL OR v_qty<1 OR (v_item->>'quantity_delivered')::NUMERIC<>v_qty THEN RAISE EXCEPTION 'Delivery quantities must be positive whole bags'; END IF;
    v_product_id:=NULLIF(v_item->>'product_id','')::UUID; SELECT to_jsonb(p) INTO v_product FROM public.products p WHERE p.id=v_product_id; IF v_product IS NULL THEN RAISE EXCEPTION 'Every delivery item requires one real product_id'; END IF;
    v_code:=NULLIF(v_product->>'sku_code',''); v_name:=COALESCE(NULLIF(v_product->>'product_name',''),NULLIF(v_product->>'name','')); v_variant:=COALESCE(NULLIF(v_product->>'product_variant',''),NULLIF(v_product->>'category',''),NULLIF(v_product->>'flavor','')); v_size:=COALESCE(NULLIF(v_product->>'product_size',''),NULLIF(v_product->>'size_label',''),NULLIF(v_product->>'size',''),CASE WHEN NULLIF(v_product->>'weight_grams','') IS NOT NULL THEN (v_product->>'weight_grams')||' gr' WHEN NULLIF(v_product->>'grams','') IS NOT NULL THEN (v_product->>'grams')||' gr' END); v_cost:=NULLIF(v_product->>'unit_cost','')::NUMERIC;
    IF v_code IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'The selected product must have SKU and presentation data'; END IF;
    v_lot:=NULLIF(v_item->>'product_lot_id','')::UUID; IF v_lot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.product_lots WHERE id=v_lot AND product_id=v_product_id) THEN RAISE EXCEPTION 'The selected lot does not belong to the selected product'; END IF;
    INSERT INTO public.commercial_partner_movement_items(movement_id,partner_id,product_id,product_name,product_variant,product_size,quantity_delivered,quantity_sold,quantity_withdrawn,quantity_spoiled,quantity_adjusted,price_to_catcorn,suggested_retail_price,amount_due,notes) VALUES(v_movement,p_partner_id,v_product_id,v_name,v_variant,v_size,v_qty,0,0,0,0,COALESCE((v_item->>'price_to_catcorn')::NUMERIC,0),COALESCE((v_item->>'suggested_retail_price')::NUMERIC,0),0,NULLIF(BTRIM(v_item->>'notes'),'')) RETURNING id INTO v_item_id;
    FOR v_i IN 1..v_qty LOOP INSERT INTO public.commercial_delivery_units(barcode_value,source_type,partner_id,movement_id,source_item_id,product_id,product_lot_id,product_code,product_name,product_variant,product_size,unit_price,unit_cost,generated_by) VALUES('CCU1-'||replace(gen_random_uuid()::TEXT,'-',''),'comodato',p_partner_id,v_movement,v_item_id,v_product_id,v_lot,v_code,v_name,v_variant,v_size,COALESCE((v_item->>'price_to_catcorn')::NUMERIC,0),v_cost,v_actor) RETURNING id INTO v_unit; PERFORM public._commercial_delivery_audit('generated',p_partner_id,v_movement,NULL,v_unit,NULL,jsonb_build_object('source_item_id',v_item_id)); END LOOP;
  END LOOP;
  RETURN jsonb_build_object('movement_id',v_movement,'status','pending_release','units_generated',(SELECT count(*) FROM public.commercial_delivery_units WHERE movement_id=v_movement));
END; $$;

CREATE OR REPLACE FUNCTION public.create_wholesale_order_with_units(p_partner_id UUID,p_order_date DATE,p_notes TEXT,p_items JSONB,p_payment_terms_hours INTEGER DEFAULT 72)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_order UUID; v_order_date DATE; v_item JSONB; v_item_id UUID; v_product JSONB; v_product_id UUID; v_qty INTEGER; v_i INTEGER; v_unit UUID; v_lot UUID; v_code TEXT; v_name TEXT; v_variant TEXT; v_size TEXT; v_cost NUMERIC;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner_id); IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one item is required'; END IF; IF COALESCE(p_payment_terms_hours,72)<1 THEN RAISE EXCEPTION 'Payment terms must be positive'; END IF;
  v_order_date:=COALESCE(p_order_date,(now() AT TIME ZONE 'America/Mexico_City')::DATE);
  INSERT INTO public.wholesale_orders(partner_id,order_date,delivery_date,payment_terms_hours,minimum_order_pieces,order_status,payment_due_at,notes) VALUES(p_partner_id,v_order_date,v_order_date,COALESCE(p_payment_terms_hours,72),10,'pending_release',NULL,NULLIF(BTRIM(p_notes),'')) RETURNING id INTO v_order;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::INTEGER; IF v_qty IS NULL OR v_qty<1 OR (v_item->>'quantity')::NUMERIC<>v_qty THEN RAISE EXCEPTION 'Order quantities must be positive whole bags'; END IF;
    v_product_id:=NULLIF(v_item->>'product_id','')::UUID; SELECT to_jsonb(p) INTO v_product FROM public.products p WHERE p.id=v_product_id; IF v_product IS NULL THEN RAISE EXCEPTION 'Every order item requires one real product_id'; END IF;
    v_code:=NULLIF(v_product->>'sku_code',''); v_name:=COALESCE(NULLIF(v_product->>'product_name',''),NULLIF(v_product->>'name','')); v_variant:=COALESCE(NULLIF(v_product->>'product_variant',''),NULLIF(v_product->>'category',''),NULLIF(v_product->>'flavor','')); v_size:=COALESCE(NULLIF(v_product->>'product_size',''),NULLIF(v_product->>'size_label',''),NULLIF(v_product->>'size',''),CASE WHEN NULLIF(v_product->>'weight_grams','') IS NOT NULL THEN (v_product->>'weight_grams')||' gr' WHEN NULLIF(v_product->>'grams','') IS NOT NULL THEN (v_product->>'grams')||' gr' END); v_cost:=NULLIF(v_product->>'unit_cost','')::NUMERIC;
    IF v_code IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'The selected product must have SKU and presentation data'; END IF;
    v_lot:=NULLIF(v_item->>'product_lot_id','')::UUID; IF v_lot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.product_lots WHERE id=v_lot AND product_id=v_product_id) THEN RAISE EXCEPTION 'The selected lot does not belong to the selected product'; END IF;
    INSERT INTO public.wholesale_order_items(wholesale_order_id,partner_id,product_code,product_name,product_variant,product_size,quantity,unit_price) VALUES(v_order,p_partner_id,v_code,v_name,v_variant,v_size,v_qty,COALESCE((v_item->>'unit_price')::NUMERIC,0)) RETURNING id INTO v_item_id;
    FOR v_i IN 1..v_qty LOOP INSERT INTO public.commercial_delivery_units(barcode_value,source_type,partner_id,wholesale_order_id,source_item_id,product_id,product_lot_id,product_code,product_name,product_variant,product_size,unit_price,unit_cost,generated_by) VALUES('CCU1-'||replace(gen_random_uuid()::TEXT,'-',''),'mayoreo',p_partner_id,v_order,v_item_id,v_product_id,v_lot,v_code,v_name,v_variant,v_size,COALESCE((v_item->>'unit_price')::NUMERIC,0),v_cost,v_actor) RETURNING id INTO v_unit; PERFORM public._commercial_delivery_audit('generated',p_partner_id,NULL,v_order,v_unit,NULL,jsonb_build_object('source_item_id',v_item_id)); END LOOP;
  END LOOP;
  RETURN jsonb_build_object('wholesale_order_id',v_order,'status','pending_release','units_generated',(SELECT count(*) FROM public.commercial_delivery_units WHERE wholesale_order_id=v_order));
END; $$;

CREATE OR REPLACE FUNCTION public.mark_commercial_delivery_units_printed(p_unit_ids UUID[],p_reprint_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_unit RECORD; v_count INTEGER; v_type TEXT; v_source UUID;
BEGIN
  IF COALESCE(cardinality(p_unit_ids),0)=0 THEN RAISE EXCEPTION 'At least one label is required'; END IF;
  IF cardinality(p_unit_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_unit_ids) AS x(id)) THEN RAISE EXCEPTION 'Duplicate label ids are not allowed'; END IF;
  SELECT count(*) INTO v_count FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids);
  SELECT source_type,COALESCE(movement_id,wholesale_order_id) INTO v_type,v_source FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids) ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_count<>cardinality(p_unit_ids) THEN RAISE EXCEPTION 'Every requested label id must exist'; END IF;
  IF EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids) AND (source_type IS DISTINCT FROM v_type OR COALESCE(movement_id,wholesale_order_id) IS DISTINCT FROM v_source)) THEN RAISE EXCEPTION 'Labels must belong to one pending delivery source'; END IF;
  IF public._commercial_delivery_source_status(v_type,v_source)<>'pending_release' THEN RAISE EXCEPTION 'Labels can only be printed for a pending release'; END IF;
  IF EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids) AND status NOT IN('generated','printed')) THEN RAISE EXCEPTION 'Only generated labels may be printed or reprinted'; END IF;
  IF EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids) AND status='printed') AND NULLIF(BTRIM(p_reprint_reason),'') IS NULL THEN RAISE EXCEPTION 'A reprint reason is required'; END IF;
  FOR v_unit IN SELECT * FROM public.commercial_delivery_units WHERE id=ANY(p_unit_ids) ORDER BY id FOR UPDATE LOOP
    v_actor:=public._commercial_delivery_actor(v_unit.partner_id);
    UPDATE public.commercial_delivery_units SET status='printed',printed_at=now(),printed_by=v_actor,print_count=print_count+1,last_reprint_reason=CASE WHEN v_unit.status='printed' THEN NULLIF(BTRIM(p_reprint_reason),'') ELSE last_reprint_reason END WHERE id=v_unit.id;
    PERFORM public._commercial_delivery_audit(CASE WHEN v_unit.status='printed' THEN 'reprinted' ELSE 'printed' END,v_unit.partner_id,v_unit.movement_id,v_unit.wholesale_order_id,v_unit.id,p_reprint_reason,'{}'::JSONB);
  END LOOP;
  RETURN jsonb_build_object('printed',v_count);
END; $$;

CREATE OR REPLACE FUNCTION public.scan_commercial_delivery_unit_for_release(p_barcode_value TEXT,p_partner_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_now TIMESTAMPTZ:=now(); v_total INTEGER; v_scanned INTEGER; v_hours INTEGER;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner_id); SELECT * INTO v_unit FROM public.commercial_delivery_units WHERE barcode_value=BTRIM(p_barcode_value) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown delivery label'; END IF; IF v_unit.partner_id<>p_partner_id THEN RAISE EXCEPTION 'This label belongs to another partner'; END IF; IF v_unit.status<>'printed' THEN RAISE EXCEPTION 'Label is not ready for release (%)',v_unit.status; END IF;
  IF public._commercial_delivery_source_status(v_unit.source_type,COALESCE(v_unit.movement_id,v_unit.wholesale_order_id))<>'pending_release' THEN RAISE EXCEPTION 'The label source is not pending release'; END IF;
  IF v_unit.source_type='comodato' THEN PERFORM 1 FROM public.commercial_partner_movements WHERE id=v_unit.movement_id FOR UPDATE; ELSE PERFORM 1 FROM public.wholesale_orders WHERE id=v_unit.wholesale_order_id FOR UPDATE; END IF;
  UPDATE public.commercial_delivery_units SET status='scanned',scanned_at=v_now,scanned_by=v_actor WHERE id=v_unit.id; PERFORM public._commercial_delivery_audit('scanned',v_unit.partner_id,v_unit.movement_id,v_unit.wholesale_order_id,v_unit.id,NULL,'{}'::JSONB);
  SELECT COUNT(*) FILTER(WHERE status IN('generated','printed','scanned','released')),COUNT(*) FILTER(WHERE status IN('scanned','released')) INTO v_total,v_scanned FROM public.commercial_delivery_units WHERE source_type=v_unit.source_type AND ((v_unit.source_type='comodato' AND movement_id=v_unit.movement_id) OR (v_unit.source_type='mayoreo' AND wholesale_order_id=v_unit.wholesale_order_id));
  IF v_total=v_scanned AND public._commercial_delivery_units_ready_for_release(v_unit.source_type,COALESCE(v_unit.movement_id,v_unit.wholesale_order_id)) THEN
    UPDATE public.commercial_delivery_units SET status='released',released_at=v_now,released_by=v_actor WHERE source_type=v_unit.source_type AND ((v_unit.source_type='comodato' AND movement_id=v_unit.movement_id) OR (v_unit.source_type='mayoreo' AND wholesale_order_id=v_unit.wholesale_order_id)) AND status='scanned';
    IF v_unit.source_type='comodato' THEN UPDATE public.commercial_partner_movements SET status='completed',released_at=v_now,movement_date=(v_now AT TIME ZONE 'America/Mexico_City')::DATE WHERE id=v_unit.movement_id; PERFORM public._commercial_delivery_audit('released',v_unit.partner_id,v_unit.movement_id,NULL,NULL,NULL,jsonb_build_object('released_units',v_total));
    ELSE SELECT COALESCE(payment_terms_hours,72) INTO v_hours FROM public.wholesale_orders WHERE id=v_unit.wholesale_order_id FOR UPDATE; UPDATE public.wholesale_orders SET order_status='delivered',released_at=v_now,delivery_date=(v_now AT TIME ZONE 'America/Mexico_City')::DATE,payment_due_at=v_now+make_interval(hours=>v_hours) WHERE id=v_unit.wholesale_order_id; PERFORM public._commercial_delivery_audit('released',v_unit.partner_id,NULL,v_unit.wholesale_order_id,NULL,NULL,jsonb_build_object('released_units',v_total)); END IF;
    RETURN jsonb_build_object('released',true,'scanned',v_total,'total',v_total,'released_at',v_now);
  END IF;
  RETURN jsonb_build_object('released',false,'scanned',v_scanned,'total',v_total);
END; $$;

CREATE OR REPLACE FUNCTION public.register_partner_spoilage_by_barcode(p_barcode_value TEXT,p_partner_id UUID,p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_movement UUID; v_item UUID;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner_id); SELECT * INTO v_unit FROM public.commercial_delivery_units WHERE barcode_value=BTRIM(p_barcode_value) FOR UPDATE;
  IF NOT FOUND OR v_unit.partner_id<>p_partner_id THEN RAISE EXCEPTION 'Delivery label does not belong to this partner'; END IF; IF v_unit.source_type<>'comodato' OR v_unit.status<>'released' THEN RAISE EXCEPTION 'Only released comodato units can be spoiled'; END IF;
  INSERT INTO public.commercial_partner_movements(partner_id,movement_type,movement_date,status,notes) VALUES(p_partner_id,'spoilage',(now() AT TIME ZONE 'America/Mexico_City')::DATE,'completed',NULLIF(BTRIM(p_reason),'')) RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id,partner_id,product_id,product_name,product_variant,product_size,quantity_delivered,quantity_sold,quantity_withdrawn,quantity_spoiled,quantity_adjusted,price_to_catcorn,suggested_retail_price,amount_due,notes) VALUES(v_movement,p_partner_id,v_unit.product_id,v_unit.product_name,v_unit.product_variant,v_unit.product_size,0,0,0,1,0,v_unit.unit_price,0,0,NULLIF(BTRIM(p_reason),'')) RETURNING id INTO v_item;
  UPDATE public.commercial_delivery_units SET status='spoiled',spoiled_at=now(),spoiled_by=v_actor,spoilage_movement_id=v_movement WHERE id=v_unit.id;
  PERFORM public._commercial_delivery_audit('spoiled',p_partner_id,v_movement,NULL,v_unit.id,p_reason,jsonb_build_object('source_item_id',v_unit.source_item_id,'spoilage_item_id',v_item));
  RETURN jsonb_build_object('delivery_unit_id',v_unit.id,'movement_id',v_movement,'product_name',v_unit.product_name,'released_at',v_unit.released_at,'unit_cost',v_unit.unit_cost);
END; $$;

CREATE OR REPLACE FUNCTION public.register_partner_spoilage_exception(p_partner_id UUID,p_item JSONB,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_movement UUID; v_product JSONB; v_product_id UUID;
BEGIN
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'An exception reason is required'; END IF; v_actor:=public._commercial_delivery_actor(p_partner_id,true); v_product_id:=NULLIF(p_item->>'product_id','')::UUID; SELECT to_jsonb(p) INTO v_product FROM public.products p WHERE p.id=v_product_id; IF v_product IS NULL THEN RAISE EXCEPTION 'A real product_id is required'; END IF;
  INSERT INTO public.commercial_partner_movements(partner_id,movement_type,movement_date,status,notes) VALUES(p_partner_id,'spoilage',(now() AT TIME ZONE 'America/Mexico_City')::DATE,'completed',p_reason) RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id,partner_id,product_id,product_name,product_variant,product_size,quantity_spoiled,price_to_catcorn,amount_due,notes) VALUES(v_movement,p_partner_id,v_product_id,COALESCE(NULLIF(v_product->>'product_name',''),NULLIF(v_product->>'name','')),COALESCE(NULLIF(v_product->>'product_variant',''),NULLIF(v_product->>'category',''),NULLIF(v_product->>'flavor','')),COALESCE(NULLIF(v_product->>'product_size',''),NULLIF(v_product->>'size_label',''),NULLIF(v_product->>'size','')),1,COALESCE((p_item->>'unit_price')::NUMERIC,0),0,p_reason);
  PERFORM public._commercial_delivery_audit('spoilage_exception',p_partner_id,v_movement,NULL,NULL,p_reason,jsonb_build_object('historical_or_unlabelled',true)); RETURN jsonb_build_object('movement_id',v_movement,'exception',true);
END; $$;

CREATE OR REPLACE FUNCTION public.void_or_replace_commercial_delivery_unit(p_unit_id UUID,p_reason TEXT,p_replace BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_new UUID; v_status TEXT;
BEGIN
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF; SELECT * INTO v_unit FROM public.commercial_delivery_units WHERE id=p_unit_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Delivery unit not found'; END IF; v_actor:=public._commercial_delivery_actor(v_unit.partner_id,true); IF v_unit.status NOT IN('generated','printed') THEN RAISE EXCEPTION 'Only unreleased units can be replaced or voided'; END IF;
  v_status:=public._commercial_delivery_source_status(v_unit.source_type,COALESCE(v_unit.movement_id,v_unit.wholesale_order_id)); IF v_status='pending_release' AND NOT p_replace THEN RAISE EXCEPTION 'A pending delivery unit must be replaced'; END IF; IF v_status<>'cancelled' AND NOT p_replace THEN RAISE EXCEPTION 'Only a fully cancelled source can void a unit'; END IF;
  IF p_replace THEN
    INSERT INTO public.commercial_delivery_units(barcode_value,source_type,partner_id,movement_id,wholesale_order_id,source_item_id,product_id,product_lot_id,product_code,product_name,product_variant,product_size,unit_price,unit_cost,generated_by,replaces_unit_id) VALUES('CCU1-'||replace(gen_random_uuid()::TEXT,'-',''),v_unit.source_type,v_unit.partner_id,v_unit.movement_id,v_unit.wholesale_order_id,v_unit.source_item_id,v_unit.product_id,v_unit.product_lot_id,v_unit.product_code,v_unit.product_name,v_unit.product_variant,v_unit.product_size,v_unit.unit_price,v_unit.unit_cost,v_actor,v_unit.id) RETURNING id INTO v_new;
    UPDATE public.commercial_delivery_units SET status='replaced',voided_at=now(),voided_by=v_actor,replaced_by_unit_id=v_new WHERE id=v_unit.id; PERFORM public._commercial_delivery_audit('replaced',v_unit.partner_id,v_unit.movement_id,v_unit.wholesale_order_id,v_unit.id,p_reason,jsonb_build_object('replacement_unit_id',v_new));
  ELSE UPDATE public.commercial_delivery_units SET status='voided',voided_at=now(),voided_by=v_actor WHERE id=v_unit.id; PERFORM public._commercial_delivery_audit('voided',v_unit.partner_id,v_unit.movement_id,v_unit.wholesale_order_id,v_unit.id,p_reason,'{}'::JSONB); END IF;
  RETURN jsonb_build_object('voided_unit_id',v_unit.id,'replacement_unit_id',v_new);
END; $$;

-- Keep the existing trigger name and signature. A due date begins only when the
-- source has actually been released; legacy delivered rows retain a date fallback.
CREATE OR REPLACE FUNCTION public.set_wholesale_payment_due_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NEW.order_status IN ('draft', 'pending_release') THEN
    NEW.payment_due_at := NULL;
  ELSIF NEW.order_status IN ('delivered', 'completed') THEN
    IF NEW.released_at IS NOT NULL THEN
      NEW.payment_due_at := NEW.released_at
        + make_interval(hours => COALESCE(NEW.payment_terms_hours, 72));
    ELSIF NEW.delivery_date IS NOT NULL THEN
      NEW.payment_due_at := (NEW.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City')
        + make_interval(hours => COALESCE(NEW.payment_terms_hours, 72));
    ELSE
      NEW.payment_due_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Exact consumer contract: pending sources expose informational totals but no debt.
CREATE OR REPLACE VIEW public.v_wholesale_order_totals WITH (security_invoker=true) AS
SELECT
  wo.id AS wholesale_order_id,
  wo.partner_id,
  wo.contract_id,
  wo.order_folio::TEXT AS order_folio,
  wo.order_date,
  wo.delivery_date,
  wo.payment_due_at,
  wo.minimum_order_pieces,
  wo.order_status::TEXT AS order_status,
  COALESCE(SUM(woi.quantity), 0::BIGINT) AS total_pieces,
  COALESCE(SUM(woi.subtotal), 0)::NUMERIC AS total_amount,
  CASE WHEN wo.order_status IN ('delivered', 'completed') THEN
    COALESCE((SELECT SUM(wp.amount) FROM public.wholesale_payments wp
      WHERE wp.wholesale_order_id=wo.id AND wp.status='completed'),0)::NUMERIC
  ELSE 0::NUMERIC END AS total_paid,
  CASE WHEN wo.order_status IN ('delivered', 'completed') THEN
    GREATEST(COALESCE(SUM(woi.subtotal),0)
      - COALESCE((SELECT SUM(wp.amount) FROM public.wholesale_payments wp
        WHERE wp.wholesale_order_id=wo.id AND wp.status='completed'),0),0)::NUMERIC
  ELSE 0::NUMERIC END AS pending_amount,
  CASE
    WHEN wo.order_status='cancelled' THEN 'cancelled'
    WHEN wo.order_status NOT IN ('delivered','completed') THEN 'not_released'
    WHEN COALESCE((SELECT SUM(wp.amount) FROM public.wholesale_payments wp
      WHERE wp.wholesale_order_id=wo.id AND wp.status='completed'),0) <= 0 THEN 'pending'
    WHEN COALESCE((SELECT SUM(wp.amount) FROM public.wholesale_payments wp
      WHERE wp.wholesale_order_id=wo.id AND wp.status='completed'),0)
      < COALESCE(SUM(woi.subtotal),0) THEN 'partial'
    ELSE 'paid'
  END::TEXT AS computed_payment_status
FROM public.wholesale_orders wo
LEFT JOIN public.wholesale_order_items woi ON woi.wholesale_order_id=wo.id
GROUP BY wo.id;

CREATE OR REPLACE VIEW public.v_commercial_partner_wholesale_summary WITH (security_invoker=true) AS
WITH released_orders AS (
  SELECT *
  FROM public.wholesale_orders
  WHERE lower(COALESCE(order_status::TEXT, '')) IN ('delivered', 'completed')
)
SELECT
  cp.id AS partner_id,
  cp.folio::TEXT AS folio,
  cp.business_name::TEXT AS business_name,
  cp.responsible_name::TEXT AS responsible_name,
  cp.partner_model::TEXT AS partner_model,
  cp.wholesale_status::TEXT AS wholesale_status,
  COALESCE(SUM(t.total_amount), 0)::NUMERIC AS total_purchased,
  COALESCE(SUM(t.total_paid), 0)::NUMERIC AS total_paid,
  COALESCE(SUM(t.pending_amount), 0)::NUMERIC AS pending_balance,
  COALESCE(SUM(t.total_pieces), 0)::NUMERIC AS total_pieces,
  COUNT(DISTINCT wo.id)::BIGINT AS purchase_count,
  MAX(wo.delivery_date)::DATE AS last_purchase_date
FROM public.commercial_partners cp
LEFT JOIN released_orders wo ON wo.partner_id=cp.id
LEFT JOIN public.v_wholesale_order_totals t ON t.wholesale_order_id=wo.id
GROUP BY cp.id, cp.folio, cp.business_name, cp.responsible_name, cp.partner_model, cp.wholesale_status;

CREATE OR REPLACE VIEW public.v_commercial_partner_wholesale_top_products WITH (security_invoker=true) AS
SELECT DISTINCT ON (wo.partner_id)
  wo.partner_id,
  woi.product_name::TEXT AS product_name,
  woi.product_variant::TEXT AS product_variant,
  woi.product_size::TEXT AS product_size,
  COALESCE(SUM(woi.quantity), 0::BIGINT) AS total_quantity,
  COALESCE(SUM(woi.subtotal), 0)::NUMERIC AS total_amount
FROM public.wholesale_orders wo
JOIN public.wholesale_order_items woi ON woi.wholesale_order_id=wo.id
WHERE lower(COALESCE(wo.order_status::TEXT, '')) IN ('delivered', 'completed')
GROUP BY wo.partner_id, woi.product_name, woi.product_variant, woi.product_size
ORDER BY wo.partner_id, total_quantity DESC, total_amount DESC, woi.product_name, woi.product_variant, woi.product_size;

CREATE OR REPLACE VIEW public.v_b2b_top_products WITH (security_invoker=true) AS
WITH comodato_products AS (
  SELECT
    m.partner_id,
    COALESCE(NULLIF(TRIM(i.product_name),''),'Sin nombre')::TEXT AS product_name,
    COALESCE(NULLIF(TRIM(i.product_variant),''),'Sin variante')::TEXT AS product_variant,
    COALESCE(NULLIF(TRIM(i.product_size),''),'Sin tamaño')::TEXT AS product_size,
    COALESCE(i.quantity_sold,0) AS quantity,
    COALESCE(i.amount_due, i.quantity_sold * i.price_to_catcorn, 0)::NUMERIC AS amount
  FROM public.commercial_partner_movements m
  JOIN public.commercial_partner_movement_items i ON i.movement_id=m.id
  WHERE lower(COALESCE(m.movement_type::TEXT, '')) IN ('liquidacion', 'liquidación', 'liquidation')
    AND lower(COALESCE(m.status::TEXT, ''))='completed'
    AND COALESCE(i.quantity_sold,0)>0
), wholesale_products AS (
  SELECT
    wo.partner_id,
    COALESCE(NULLIF(TRIM(woi.product_name),''),'Sin nombre')::TEXT AS product_name,
    COALESCE(NULLIF(TRIM(woi.product_variant),''),'Sin variante')::TEXT AS product_variant,
    COALESCE(NULLIF(TRIM(woi.product_size),''),'Sin tamaño')::TEXT AS product_size,
    COALESCE(SUM(woi.quantity),0)::NUMERIC AS quantity,
    SUM(COALESCE(woi.quantity, 0)::NUMERIC * COALESCE(woi.unit_price, 0::NUMERIC))::NUMERIC AS amount
  FROM public.wholesale_orders wo
  JOIN public.wholesale_order_items woi ON woi.wholesale_order_id=wo.id
  WHERE lower(COALESCE(wo.order_status::TEXT, '')) IN ('delivered', 'completed')
  GROUP BY wo.partner_id, woi.product_name, woi.product_variant, woi.product_size
), all_products AS (
  SELECT partner_id, product_name, product_variant, product_size, quantity, amount, 'comodato'::TEXT AS source FROM comodato_products
  UNION ALL
  SELECT partner_id, product_name, product_variant, product_size, quantity, amount, 'mayoreo'::TEXT AS source FROM wholesale_products
), grouped AS (
  SELECT
    product_name,
    product_variant,
    product_size,
    COALESCE(SUM(quantity),0)::INTEGER AS total_quantity,
    COALESCE(SUM(amount),0)::NUMERIC AS total_amount,
    COALESCE(SUM(quantity) FILTER (WHERE source='comodato'),0)::INTEGER AS comodato_quantity,
    COALESCE(SUM(quantity) FILTER (WHERE source='mayoreo'),0)::INTEGER AS wholesale_quantity,
    COALESCE(SUM(amount) FILTER (WHERE source='comodato'),0)::NUMERIC AS comodato_amount,
    COALESCE(SUM(amount) FILTER (WHERE source='mayoreo'),0)::NUMERIC AS wholesale_amount,
    COUNT(DISTINCT partner_id)::INTEGER AS partners_count
  FROM all_products
  GROUP BY product_name, product_variant, product_size
)
SELECT
  product_name,
  product_variant,
  product_size,
  total_quantity,
  total_amount,
  comodato_quantity,
  wholesale_quantity,
  comodato_amount,
  wholesale_amount,
  partners_count,
  RANK() OVER (ORDER BY total_quantity DESC, total_amount DESC)::INTEGER AS rank_by_quantity
FROM grouped;

CREATE OR REPLACE VIEW public.v_b2b_partner_next_visit WITH (security_invoker=true) AS
SELECT DISTINCT ON (m.partner_id)
  m.partner_id,
  m.next_visit_date,
  m.next_visit_reason::TEXT AS next_visit_reason,
  m.movement_date AS movement_date,
  m.movement_type::TEXT AS movement_type,
  m.notes::TEXT AS movement_notes
FROM public.commercial_partner_movements m
WHERE lower(COALESCE(m.status::TEXT, ''))='completed' AND m.next_visit_date IS NOT NULL
ORDER BY m.partner_id, m.movement_date DESC NULLS LAST, m.created_at DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public._commercial_delivery_comodato_payment_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_type TEXT; v_status TEXT;
BEGIN IF NEW.movement_id IS NULL THEN RETURN NEW; END IF; SELECT movement_type::TEXT,status::TEXT INTO v_type,v_status FROM public.commercial_partner_movements WHERE id=NEW.movement_id; IF v_type IS DISTINCT FROM 'settlement' OR v_status IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'Comodato payments require a completed settlement movement'; END IF; RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public._commercial_delivery_wholesale_payment_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_status TEXT;
BEGIN IF NEW.wholesale_order_id IS NULL THEN RETURN NEW; END IF; SELECT order_status::TEXT INTO v_status FROM public.wholesale_orders WHERE id=NEW.wholesale_order_id; IF v_status NOT IN('delivered','completed') THEN RAISE EXCEPTION 'Wholesale payments are unavailable until the delivery is released'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER commercial_delivery_comodato_payment_guard BEFORE INSERT OR UPDATE ON public.commercial_partner_payments FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_comodato_payment_guard();
CREATE TRIGGER commercial_delivery_wholesale_payment_guard BEFORE INSERT OR UPDATE ON public.wholesale_payments FOR EACH ROW EXECUTE FUNCTION public._commercial_delivery_wholesale_payment_guard();

-- Preserve every established payment-review column and retain Venta por pieza.
CREATE OR REPLACE VIEW public.v_pending_payment_verifications WITH (security_invoker=true) AS
SELECT
  r.id AS request_id,
  r.folio,
  r.scheme,
  r.partner_id,
  cp.folio AS partner_folio,
  cp.business_name,
  cp.responsible_name,
  r.amount,
  r.payment_date,
  r.payment_method,
  r.payment_reference,
  r.notes,
  r.proof_path,
  r.proof_file_name,
  r.proof_mime_type,
  r.proof_size_bytes,
  r.submitted_by,
  up.full_name AS seller_name,
  r.submitted_at,
  r.movement_id,
  r.wholesale_order_id,
  CASE
    WHEN r.scheme='comodato' THEN 'COMODATO-' || LEFT(r.movement_id::TEXT,8)
    WHEN r.scheme='mayoreo' THEN wo.order_folio
    WHEN r.scheme='venta_pieza' THEN sps.folio
  END::TEXT AS source_folio,
  CASE
    WHEN r.scheme='comodato' THEN COALESCE((
      SELECT SUM(i.amount_due) FROM public.commercial_partner_movement_items i
      WHERE i.movement_id=r.movement_id AND i.quantity_sold>0
    ),0)::NUMERIC
    WHEN r.scheme='mayoreo' THEN COALESCE((
      SELECT t.total_amount FROM public.v_wholesale_order_totals t
      WHERE t.wholesale_order_id=r.wholesale_order_id
    ),0)::NUMERIC
    WHEN r.scheme='venta_pieza' THEN COALESCE(sps.total_amount,0)::NUMERIC
    ELSE 0::NUMERIC
  END AS source_total,
  CASE
    WHEN r.scheme='comodato' THEN COALESCE((
      SELECT SUM(p.amount) FROM public.commercial_partner_payments p
      WHERE p.movement_id=r.movement_id AND p.status IN ('completed','paid')
    ),0)::NUMERIC
    WHEN r.scheme='mayoreo' THEN COALESCE((
      SELECT t.total_paid FROM public.v_wholesale_order_totals t
      WHERE t.wholesale_order_id=r.wholesale_order_id
    ),0)::NUMERIC
    WHEN r.scheme='venta_pieza' THEN COALESCE((
      SELECT SUM(spp.amount) FROM public.seller_piece_payments spp
      WHERE spp.sale_id=r.piece_sale_id AND spp.status='completed'
    ),0)::NUMERIC
    ELSE 0::NUMERIC
  END AS source_paid,
  CASE
    WHEN r.scheme='comodato' THEN public.get_comodato_movement_pending_balance(r.movement_id)
    WHEN r.scheme='mayoreo' THEN public.get_wholesale_order_pending_balance(r.wholesale_order_id)
    WHEN r.scheme='venta_pieza' THEN public.get_piece_sale_pending_balance(r.piece_sale_id)
  END::NUMERIC AS current_source_balance,
  CASE
    WHEN r.scheme='venta_pieza' THEN public.get_piece_sale_pending_balance(r.piece_sale_id)
    ELSE (
      GREATEST(
        COALESCE((
          SELECT SUM(i.amount_due)
          FROM public.commercial_partner_movement_items AS i
          JOIN public.commercial_partner_movements AS m ON m.id=i.movement_id
          WHERE m.partner_id=r.partner_id
            AND LOWER(TRIM(m.movement_type::TEXT))='settlement'
            AND LOWER(TRIM(m.status::TEXT))='completed'
            AND i.quantity_sold>0
        ),0)
        - COALESCE((
          SELECT SUM(p.amount)
          FROM public.commercial_partner_payments AS p
          WHERE p.partner_id=r.partner_id
            AND LOWER(TRIM(p.status::TEXT)) IN ('completed','paid')
        ),0),
        0
      )
      + COALESCE((
        SELECT SUM(GREATEST(COALESCE(v.pending_amount,0),0))
        FROM public.v_wholesale_order_totals AS v
        JOIN public.wholesale_orders AS o ON o.id=v.wholesale_order_id
        WHERE o.partner_id=r.partner_id
      ),0)
    )
  END::NUMERIC AS current_partner_balance,
  FLOOR(EXTRACT(EPOCH FROM (NOW()-r.submitted_at))/60::NUMERIC)::INTEGER AS minutes_since_submission,
  r.piece_sale_id,
  CASE WHEN r.scheme='venta_pieza' THEN COALESCE((
    SELECT SUM(piece_item.quantity)::INTEGER
    FROM public.seller_piece_sale_items piece_item
    WHERE piece_item.sale_id=r.piece_sale_id
  ),0) END AS piece_units
FROM public.partner_payment_verification_requests r
LEFT JOIN public.commercial_partners cp ON r.partner_id=cp.id
LEFT JOIN public.user_profiles up ON r.submitted_by=up.id
LEFT JOIN public.commercial_partner_movements m ON r.movement_id=m.id
LEFT JOIN public.wholesale_orders wo ON r.wholesale_order_id=wo.id
LEFT JOIN public.seller_piece_sales sps ON r.piece_sale_id=sps.id
WHERE r.status='pending_review'
  AND (r.scheme<>'comodato' OR lower(TRIM(COALESCE(m.status::TEXT,'')))='completed')
  AND (r.scheme<>'mayoreo' OR lower(TRIM(COALESCE(wo.order_status::TEXT,''))) IN ('delivered','completed'))
ORDER BY r.submitted_at DESC;

REVOKE ALL ON FUNCTION public.create_comodato_delivery_with_units(UUID,DATE,DATE,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_wholesale_order_with_units(UUID,DATE,TEXT,JSONB,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_commercial_delivery_units_printed(UUID[],TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_commercial_delivery_unit_for_release(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_partner_spoilage_by_barcode(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_partner_spoilage_exception(UUID,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_or_replace_commercial_delivery_unit(UUID,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_comodato_delivery_with_units(UUID,DATE,DATE,TEXT,TEXT,JSONB),public.create_wholesale_order_with_units(UUID,DATE,TEXT,JSONB,INTEGER),public.mark_commercial_delivery_units_printed(UUID[],TEXT),public.scan_commercial_delivery_unit_for_release(TEXT,UUID),public.register_partner_spoilage_by_barcode(TEXT,UUID,TEXT),public.register_partner_spoilage_exception(UUID,JSONB,TEXT),public.void_or_replace_commercial_delivery_unit(UUID,TEXT,BOOLEAN) TO authenticated;

COMMIT;
