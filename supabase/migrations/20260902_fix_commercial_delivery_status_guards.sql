-- Fix source guards for labelled commercial deliveries.
-- commercial_partner_movements uses status; wholesale_orders uses order_status.

BEGIN;

CREATE OR REPLACE FUNCTION public._commercial_delivery_comodato_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.movement_type = 'delivery' AND NEW.status = 'completed' THEN
      RAISE EXCEPTION 'All labelled bags must be released before delivery';
    END IF;
    RETURN NEW;
  END IF;

  v_id := OLD.id;
  v_old_status := OLD.status::TEXT;

  IF NOT EXISTS (
    SELECT 1
    FROM public.commercial_delivery_units AS unit
    WHERE unit.movement_id = v_id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A labelled delivery cannot be deleted';
  END IF;

  v_new_status := NEW.status::TEXT;
  IF v_old_status = 'pending_release'
    AND v_new_status = 'completed'
    AND public._commercial_delivery_source_can_release('comodato', v_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_status = 'pending_release'
    AND v_new_status = 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM public.commercial_delivery_units AS unit
      WHERE unit.movement_id = v_id
        AND unit.status IN ('released', 'spoiled', 'returned_good')
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A labelled delivery cannot be edited outside its verified transition';
END;
$$;

CREATE OR REPLACE FUNCTION public._commercial_delivery_wholesale_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.order_status = 'delivered' THEN
      RAISE EXCEPTION 'All labelled bags must be released before delivery';
    END IF;
    RETURN NEW;
  END IF;

  v_id := OLD.id;
  v_old_status := OLD.order_status::TEXT;

  IF NOT EXISTS (
    SELECT 1
    FROM public.commercial_delivery_units AS unit
    WHERE unit.wholesale_order_id = v_id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A labelled delivery cannot be deleted';
  END IF;

  v_new_status := NEW.order_status::TEXT;
  IF v_old_status = 'pending_release'
    AND v_new_status IN ('delivered', 'completed')
    AND public._commercial_delivery_source_can_release('mayoreo', v_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_status = 'pending_release'
    AND v_new_status = 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM public.commercial_delivery_units AS unit
      WHERE unit.wholesale_order_id = v_id
        AND unit.status IN ('released', 'spoiled', 'returned_good')
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A labelled delivery cannot be edited outside its verified transition';
END;
$$;

CREATE OR REPLACE TRIGGER commercial_delivery_movement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_partner_movements
  FOR EACH ROW
  EXECUTE FUNCTION public._commercial_delivery_comodato_source_guard();

CREATE OR REPLACE TRIGGER commercial_delivery_order_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.wholesale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public._commercial_delivery_wholesale_source_guard();

COMMIT;
