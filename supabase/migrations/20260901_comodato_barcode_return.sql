-- Barcode-controlled returns in good condition for released comodato units.
-- Apply after 20260830_commercial_delivery_unit_control.sql and 20260831.

BEGIN;

ALTER TABLE public.commercial_delivery_units
  ADD COLUMN IF NOT EXISTS returned_good_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS returned_good_by UUID NULL
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_movement_id UUID NULL
    REFERENCES public.commercial_partner_movements(id) ON DELETE RESTRICT;

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
  ELSIF OLD.status='released' AND NEW.status='returned_good' AND NEW.returned_good_at IS NOT NULL AND NEW.returned_good_by IS NOT NULL AND NEW.return_movement_id IS NOT NULL THEN NULL;
  ELSE RAISE EXCEPTION 'Invalid delivery-unit transition from % to %',OLD.status,NEW.status; END IF;
  NEW.updated_at:=now(); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.register_partner_return_by_barcode(p_barcode_value TEXT,p_partner_id UUID,p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_returned public.commercial_delivery_units%ROWTYPE; v_movement UUID; v_item UUID;
BEGIN
  v_actor:=public._commercial_delivery_actor(p_partner_id);
  SELECT * INTO v_unit FROM public.commercial_delivery_units WHERE barcode_value=BTRIM(p_barcode_value) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etiqueta de entrega desconocida'; END IF;
  IF v_unit.partner_id<>p_partner_id THEN RAISE EXCEPTION 'Esta etiqueta pertenece a otro socio'; END IF;
  IF v_unit.source_type='mayoreo' THEN RAISE EXCEPTION 'Esta etiqueta corresponde a un pedido de Mayoreo y no puede retirarse por este flujo'; END IF;
  IF v_unit.source_type<>'comodato' THEN RAISE EXCEPTION 'Esta etiqueta no corresponde a una entrega de Comodato'; END IF;
  IF v_unit.status<>'released' THEN
    CASE v_unit.status
      WHEN 'returned_good' THEN RAISE EXCEPTION 'Esta etiqueta ya fue retirada en buen estado';
      WHEN 'spoiled' THEN RAISE EXCEPTION 'Esta etiqueta ya fue registrada como merma';
      WHEN 'voided' THEN RAISE EXCEPTION 'Esta etiqueta fue anulada';
      WHEN 'replaced' THEN RAISE EXCEPTION 'Esta etiqueta fue reemplazada';
      ELSE RAISE EXCEPTION 'Sólo una etiqueta liberada puede retirarse (%)', v_unit.status;
    END CASE;
  END IF;
  INSERT INTO public.commercial_partner_movements(partner_id,movement_type,movement_date,status,notes)
  VALUES(p_partner_id,'withdrawal',(now() AT TIME ZONE 'America/Mexico_City')::DATE,'completed',NULLIF(BTRIM(p_reason),''))
  RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id,partner_id,product_id,product_name,product_variant,product_size,quantity_delivered,quantity_sold,quantity_withdrawn,quantity_spoiled,quantity_adjusted,price_to_catcorn,suggested_retail_price,amount_due,notes)
  VALUES(v_movement,p_partner_id,v_unit.product_id,v_unit.product_name,v_unit.product_variant,v_unit.product_size,0,0,1,0,0,v_unit.unit_price,0,0,NULLIF(BTRIM(p_reason),''))
  RETURNING id INTO v_item;
  UPDATE public.commercial_delivery_units
  SET status='returned_good',returned_good_at=now(),returned_good_by=v_actor,return_movement_id=v_movement
  WHERE id=v_unit.id RETURNING * INTO v_returned;
  PERFORM public._commercial_delivery_audit('returned_good',p_partner_id,v_movement,NULL,v_unit.id,p_reason,jsonb_build_object('return_item_id',v_item,'source_item_id',v_unit.source_item_id));
  RETURN jsonb_build_object('delivery_unit',to_jsonb(v_returned),'product',jsonb_build_object('id',v_unit.product_id,'code',v_unit.product_code,'name',v_unit.product_name,'variant',v_unit.product_variant,'size',v_unit.product_size,'price_to_catcorn',v_unit.unit_price),'movement_id',v_movement,'status','returned_good');
END; $$;

CREATE OR REPLACE FUNCTION public.register_partner_return_exception(p_partner_id UUID,p_item JSONB,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v_actor UUID; v_product JSONB; v_product_id UUID; v_movement UUID; v_item UUID;
BEGIN
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'La excepción histórica requiere un motivo'; END IF;
  v_actor:=public._commercial_delivery_actor(p_partner_id,true);
  v_product_id:=NULLIF(p_item->>'product_id','')::UUID;
  SELECT to_jsonb(p) INTO v_product FROM public.products p WHERE p.id=v_product_id;
  IF v_product IS NULL THEN RAISE EXCEPTION 'La excepción requiere un product_id real'; END IF;
  INSERT INTO public.commercial_partner_movements(partner_id,movement_type,movement_date,status,notes)
  VALUES(p_partner_id,'withdrawal',(now() AT TIME ZONE 'America/Mexico_City')::DATE,'completed',p_reason)
  RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id,partner_id,product_id,product_name,product_variant,product_size,quantity_delivered,quantity_sold,quantity_withdrawn,quantity_spoiled,quantity_adjusted,price_to_catcorn,suggested_retail_price,amount_due,notes)
  VALUES(v_movement,p_partner_id,v_product_id,COALESCE(NULLIF(v_product->>'product_name',''),NULLIF(v_product->>'name','')),COALESCE(NULLIF(v_product->>'product_variant',''),NULLIF(v_product->>'category',''),NULLIF(v_product->>'flavor','')),COALESCE(NULLIF(v_product->>'product_size',''),NULLIF(v_product->>'size_label',''),NULLIF(v_product->>'size','')),0,0,1,0,0,COALESCE((p_item->>'unit_price')::NUMERIC,0),0,0,p_reason)
  RETURNING id INTO v_item;
  PERFORM public._commercial_delivery_audit('returned_good',p_partner_id,v_movement,NULL,NULL,p_reason,jsonb_build_object('historical_return_without_label',true,'return_item_id',v_item,'product_id',v_product_id));
  RETURN jsonb_build_object('movement_id',v_movement,'exception',true,'status','returned_good');
END; $$;

REVOKE ALL ON FUNCTION public.register_partner_return_by_barcode(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_partner_return_exception(UUID,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_partner_return_by_barcode(TEXT,UUID,TEXT),public.register_partner_return_exception(UUID,JSONB,TEXT) TO authenticated;

COMMIT;
