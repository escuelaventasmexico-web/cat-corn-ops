-- Prospective expense classification by stable concept and destination.
-- Existing rows stay NULL (shown as pending) and the previous frontend remains
-- compatible while the new frontend is published.

BEGIN;

DO $preflight$
BEGIN
  IF TO_REGCLASS('public.expenses') IS NULL OR TO_REGCLASS('public.fixed_costs') IS NULL THEN
    RAISE EXCEPTION 'Required finance tables are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name = 'commission_settlement_id'
  ) OR TO_REGPROCEDURE('public.create_expense_for_paid_commission_settlement()') IS NULL THEN
    RAISE EXCEPTION 'The reviewed automatic commission-expense contract is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fixed_costs'
      AND column_name = 'scope'
  ) OR TO_REGPROCEDURE('public.finance_month_summary(date)') IS NULL THEN
    RAISE EXCEPTION 'The reviewed fixed-cost/finance contract is missing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name IN ('concept_code', 'destination_scope', 'classification_status')
  ) THEN
    RAISE EXCEPTION 'Expense classification columns already exist; inspect the live schema before continuing.';
  END IF;
END;
$preflight$;

ALTER TABLE public.expenses
  ADD COLUMN concept_code TEXT,
  ADD COLUMN destination_scope TEXT,
  ADD COLUMN classification_status TEXT;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_concept_code_check CHECK (
    concept_code IS NULL OR concept_code IN (
      'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'FUEL', 'SERVICES',
      'COMMISSIONS', 'OTHER'
    )
  ),
  ADD CONSTRAINT expenses_destination_scope_check CHECK (
    destination_scope IS NULL OR destination_scope IN (
      'AURRERA', 'CHIPITLAN', 'SHARED', 'MIXED', 'UNKNOWN'
    )
  ),
  ADD CONSTRAINT expenses_classification_status_check CHECK (
    classification_status IS NULL OR classification_status IN ('CLASSIFIED', 'SYSTEM')
  ),
  ADD CONSTRAINT expenses_classification_consistency_check CHECK ((
    (classification_status IS NULL AND concept_code IS NULL AND destination_scope IS NULL)
    OR
    (classification_status = 'CLASSIFIED' AND concept_code IS NOT NULL
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'SHARED'))
    OR
    (
      classification_status = 'SYSTEM'
      AND commission_settlement_id IS NOT NULL
      AND concept_code = 'COMMISSIONS'
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN')
    )
  ) IS TRUE);

CREATE INDEX expenses_concept_date_idx
  ON public.expenses (concept_code, expense_date)
  WHERE concept_code IS NOT NULL;

CREATE INDEX expenses_destination_date_idx
  ON public.expenses (destination_scope, expense_date)
  WHERE destination_scope IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_expense_concept_destination()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_fixed_scope TEXT;
  v_commission_event_count INTEGER;
  v_unresolved_event_count INTEGER;
  v_resolved_destination_count INTEGER;
  v_single_destination TEXT;
BEGIN
  -- Commission concept is structural. Destination is resolved only from every
  -- settlement event through its POS sale and stable branch code. Any event
  -- without that complete path leaves the settlement destination UNKNOWN.
  IF NEW.commission_settlement_id IS NOT NULL THEN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE resolved.destination_scope IS NULL),
      COUNT(DISTINCT resolved.destination_scope),
      MIN(resolved.destination_scope)
    INTO
      v_commission_event_count,
      v_unresolved_event_count,
      v_resolved_destination_count,
      v_single_destination
    FROM (
      SELECT CASE branch.code
        WHEN 'aurrera_la_luna_02' THEN 'AURRERA'
        WHEN 'chipitlan_01' THEN 'CHIPITLAN'
        ELSE NULL
      END AS destination_scope
      FROM public.commission_settlement_items AS item
      JOIN public.commission_events AS event
        ON event.id = item.commission_event_id
      LEFT JOIN public.sales AS sale
        ON event.source_type = 'pos_sale'
        AND sale.id = event.source_id
      LEFT JOIN public.branches AS branch
        ON branch.id = sale.branch_id
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

  -- NULL across all three columns is the backwards-compatible/pending state.
  IF NEW.classification_status IS NULL
     AND NEW.concept_code IS NULL
     AND NEW.destination_scope IS NULL THEN
    IF TG_OP = 'UPDATE' AND (
      NEW.type IS DISTINCT FROM OLD.type
      OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
      OR NEW.fixed_cost_id IS DISTINCT FROM OLD.fixed_cost_id
    ) THEN
      RAISE EXCEPTION 'Classify this pending expense before changing type, date or fixed-cost obligation.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.classification_status IS DISTINCT FROM 'CLASSIFIED'
     OR NEW.concept_code IS NULL THEN
    RAISE EXCEPTION 'Manual expenses require a complete concept and destination classification.';
  END IF;

  IF NEW.fixed_cost_id IS NOT NULL THEN
    SELECT cost.scope
    INTO v_fixed_scope
    FROM public.fixed_costs AS cost
    WHERE cost.id = NEW.fixed_cost_id
      AND cost.effective_from <= NEW.expense_date
      AND (cost.effective_to IS NULL OR cost.effective_to >= NEW.expense_date);

    IF v_fixed_scope IS NULL OR v_fixed_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
      RAISE EXCEPTION 'The selected fixed-cost obligation has no valid destination for this expense date.';
    END IF;

    -- Linked fixed expenses inherit scope; the client must not ask twice.
    NEW.destination_scope := v_fixed_scope;
  ELSIF NEW.destination_scope IS NULL
     OR NEW.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
    RAISE EXCEPTION 'Manual expenses require AURRERA, CHIPITLAN or SHARED as destination.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_expense_concept_destination_trigger
BEFORE INSERT OR UPDATE OF
  type, expense_date, fixed_cost_id, commission_settlement_id,
  concept_code, destination_scope, classification_status
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_expense_concept_destination();

COMMENT ON COLUMN public.expenses.concept_code IS
  'Stable prospective concept. NULL means pending human classification.';
COMMENT ON COLUMN public.expenses.destination_scope IS
  'Destination. Manual: AURRERA, CHIPITLAN or SHARED. System commissions may resolve to MIXED or UNKNOWN; UNKNOWN is never treated as SHARED.';
COMMENT ON COLUMN public.expenses.classification_status IS
  'CLASSIFIED for explicit capture, SYSTEM for analyzed automatic commissions, NULL for legacy/transition pending review.';
COMMENT ON COLUMN public.expenses.category IS
  'Legacy free-text field. New capture uses concept_code and never infers from this value.';

-- Deliberately unchanged: RLS, historical expenses, finance RPCs and the
-- automatic commission writer. The trigger enriches future commission rows.

COMMIT;
