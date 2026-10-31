-- PHASE 2 - MANUAL REVIEW REQUIRED.
-- Keep outside supabase/migrations until every expense writer is published and
-- smoke-tested. This transaction changes no historical row.

BEGIN;

DO $preflight$
BEGIN
  IF TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 expense classification is not installed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.expenses'::REGCLASS
      AND tgname = 'enforce_expense_concept_destination_trigger'
      AND NOT tgisinternal AND tgenabled <> 'D'
      AND PG_GET_TRIGGERDEF(oid, TRUE) LIKE '%UPDATE OF type,%'
  ) THEN
    RAISE EXCEPTION 'Phase 1 classification trigger is missing or disabled.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
      AND PG_GET_FUNCTIONDEF(oid) NOT LIKE '%v_unresolved_event_count > 0%'
  ) THEN
    RAISE EXCEPTION 'Phase 1 commission destination resolver differs from the reviewed contract.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_expense_concept_destination()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE
  v_fixed_scope TEXT;
  v_commission_event_count INTEGER;
  v_unresolved_event_count INTEGER;
  v_resolved_destination_count INTEGER;
  v_single_destination TEXT;
BEGIN
  IF NEW.commission_settlement_id IS NOT NULL THEN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE resolved.destination_scope IS NULL),
      COUNT(DISTINCT resolved.destination_scope), MIN(resolved.destination_scope)
    INTO v_commission_event_count, v_unresolved_event_count,
      v_resolved_destination_count, v_single_destination
    FROM (
      SELECT CASE branch.code
        WHEN 'aurrera_la_luna_02' THEN 'AURRERA'
        WHEN 'chipitlan_01' THEN 'CHIPITLAN'
        ELSE NULL
      END AS destination_scope
      FROM public.commission_settlement_items AS item
      JOIN public.commission_events AS event ON event.id = item.commission_event_id
      LEFT JOIN public.sales AS sale
        ON event.source_type = 'pos_sale' AND sale.id = event.source_id
      LEFT JOIN public.branches AS branch ON branch.id = sale.branch_id
      WHERE item.settlement_id = NEW.commission_settlement_id
    ) AS resolved;

    NEW.concept_code := 'COMMISSIONS';
    NEW.destination_scope := CASE
      WHEN v_commission_event_count = 0 OR v_unresolved_event_count > 0 THEN 'UNKNOWN'
      WHEN v_resolved_destination_count = 1 THEN v_single_destination
      ELSE 'MIXED'
    END;
    NEW.classification_status := 'SYSTEM';
    RETURN NEW;
  END IF;

  IF NEW.classification_status IS NULL AND NEW.concept_code IS NULL
     AND NEW.destination_scope IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'New manual expenses require concept and destination.';
    END IF;
    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
       OR NEW.fixed_cost_id IS DISTINCT FROM OLD.fixed_cost_id THEN
      RAISE EXCEPTION 'Classify this legacy expense before changing type, date or fixed-cost obligation.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.classification_status IS DISTINCT FROM 'CLASSIFIED' OR NEW.concept_code IS NULL THEN
    RAISE EXCEPTION 'Manual expenses require a complete concept and destination classification.';
  END IF;

  IF NEW.fixed_cost_id IS NOT NULL THEN
    SELECT cost.scope INTO v_fixed_scope
    FROM public.fixed_costs AS cost
    WHERE cost.id = NEW.fixed_cost_id AND cost.effective_from <= NEW.expense_date
      AND (cost.effective_to IS NULL OR cost.effective_to >= NEW.expense_date);
    IF v_fixed_scope IS NULL OR v_fixed_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
      RAISE EXCEPTION 'The selected fixed-cost obligation has no valid destination for this expense date.';
    END IF;
    NEW.destination_scope := v_fixed_scope;
  ELSIF NEW.destination_scope IS NULL
     OR NEW.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
    RAISE EXCEPTION 'Manual expenses require AURRERA, CHIPITLAN or SHARED as destination.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_expense_concept_destination() IS
  'Phase 2: new manual expenses require classification; legacy pending rows require it before type, date or fixed obligation changes.';

COMMIT;
