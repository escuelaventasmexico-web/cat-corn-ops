-- CAT CORN: prospective operations-management concept and Enrique destination.
-- MANUAL MIGRATION FOR REVIEW. Do not run through an automatic deployment.
-- Apply before publishing the matching UI, then run the read-only verifier.
-- This migration changes only catalog constraints and prospective validation;
-- it never updates, infers or reclassifies an existing expense.

BEGIN;

DO $preflight$
DECLARE
  v_concept_constraint TEXT;
  v_destination_constraint TEXT;
  v_consistency_constraint TEXT;
  v_fixed_scope_constraint TEXT;
  v_enforcement_definition TEXT;
BEGIN
  IF TO_REGCLASS('public.expenses') IS NULL
     OR TO_REGCLASS('public.fixed_costs') IS NULL THEN
    RAISE EXCEPTION 'Missing public.expenses or public.fixed_costs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Missing authenticated role';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_concept_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c';

  IF v_concept_constraint IS NULL
     OR NOT (v_concept_constraint LIKE ALL (ARRAY[
       '%CORN%', '%OIL%', '%SEASONINGS%', '%CARAMEL%', '%PACKAGING%',
       '%STATIONERY%', '%CLEANING%', '%FUEL%', '%SERVICES%',
       '%MAINTENANCE%', '%PAYROLL%', '%RENT%', '%COMMISSIONS%', '%OTHER%'
     ]))
     OR v_concept_constraint LIKE '%OPERATIONS_MANAGEMENT%' THEN
    RAISE EXCEPTION 'The deployed concept catalog differs from the reviewed baseline or OPERATIONS_MANAGEMENT is already installed';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_destination_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_destination_scope_check'
    AND constraint_row.contype = 'c';

  IF v_destination_constraint IS NULL
     OR NOT (v_destination_constraint LIKE ALL (ARRAY[
       '%AURRERA%', '%CHIPITLAN%', '%SHARED%', '%MIXED%', '%UNKNOWN%'
     ]))
     OR v_destination_constraint LIKE '%ENRIQUE%' THEN
    RAISE EXCEPTION 'The deployed destination catalog differs from the reviewed baseline or ENRIQUE is already installed';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_consistency_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_classification_consistency_check'
    AND constraint_row.contype = 'c';

  IF v_consistency_constraint IS NULL
     OR v_consistency_constraint NOT LIKE '%commission_origin_scope%'
     OR v_consistency_constraint NOT LIKE '%classification_status%'
     OR v_consistency_constraint LIKE '%ENRIQUE%' THEN
    RAISE EXCEPTION 'The deployed classification-consistency contract differs from the reviewed baseline';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_fixed_scope_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.fixed_costs'::REGCLASS
    AND constraint_row.conname = 'fixed_costs_scope_check'
    AND constraint_row.contype = 'c';

  IF v_fixed_scope_constraint IS NULL
     OR NOT (v_fixed_scope_constraint LIKE ALL (ARRAY[
       '%AURRERA%', '%CHIPITLAN%', '%SHARED%'
     ]))
     OR v_fixed_scope_constraint LIKE '%ENRIQUE%' THEN
    RAISE EXCEPTION 'The fixed-cost scope contract differs from the reviewed baseline';
  END IF;

  IF TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.enforce_expense_concept_destination()';
  END IF;

  SELECT PG_GET_FUNCTIONDEF(
    TO_REGPROCEDURE('public.enforce_expense_concept_destination()'))
  INTO v_enforcement_definition;

  IF v_enforcement_definition NOT LIKE '%commission_origin_scope%'
     OR v_enforcement_definition NOT LIKE '%NEW.destination_scope := ''SHARED''%'
     OR v_enforcement_definition NOT LIKE '%New manual expenses require concept and destination.%'
     OR v_enforcement_definition LIKE '%ENRIQUE%' THEN
    RAISE EXCEPTION 'The deployed manual/commission classification function differs from the reviewed baseline';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
         AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled <> 'D'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
         AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled <> 'D'
     )
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'The deployed trigger or commission-link protection contract differs from the reviewed baseline';
  END IF;
END;
$preflight$;

ALTER TABLE public.expenses
  DROP CONSTRAINT expenses_concept_code_check,
  DROP CONSTRAINT expenses_destination_scope_check,
  DROP CONSTRAINT expenses_classification_consistency_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_concept_code_check CHECK (
    concept_code IS NULL OR concept_code IN (
      'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'STATIONERY',
      'CLEANING', 'FUEL', 'SERVICES', 'MAINTENANCE',
      'OPERATIONS_MANAGEMENT', 'PAYROLL', 'RENT', 'COMMISSIONS', 'OTHER'
    )
  ),
  ADD CONSTRAINT expenses_destination_scope_check CHECK (
    destination_scope IS NULL OR destination_scope IN (
      'AURRERA', 'CHIPITLAN', 'SHARED', 'ENRIQUE', 'MIXED', 'UNKNOWN'
    )
  ),
  ADD CONSTRAINT expenses_classification_consistency_check CHECK ((
    (classification_status IS NULL AND concept_code IS NULL
      AND destination_scope IS NULL AND commission_origin_scope IS NULL)
    OR
    (classification_status = 'CLASSIFIED' AND concept_code IS NOT NULL
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'SHARED', 'ENRIQUE')
      AND commission_origin_scope IS NULL)
    OR
    (classification_status = 'SYSTEM'
      AND commission_settlement_id IS NOT NULL
      AND concept_code = 'COMMISSIONS'
      AND (
        (destination_scope = 'SHARED'
          AND commission_origin_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'))
        OR
        (commission_origin_scope IS NULL
          AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'))
      ))
  ) IS TRUE);

COMMENT ON COLUMN public.expenses.concept_code IS
  'Stable prospective expense concept, including OPERATIONS_MANAGEMENT. NULL means pending human classification; no historical concept is inferred.';

COMMENT ON COLUMN public.expenses.destination_scope IS
  'Manual destination: AURRERA, CHIPITLAN, SHARED or ENRIQUE. Linked fixed expenses still inherit fixed_costs.scope. System commissions preserve their protected shared/origin contract.';

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
    NEW.destination_scope := 'SHARED';
    NEW.commission_origin_scope := CASE
      WHEN v_commission_event_count = 0 OR v_unresolved_event_count > 0 THEN 'UNKNOWN'
      WHEN v_resolved_destination_count = 1 THEN v_single_destination
      ELSE 'MIXED'
    END;
    NEW.classification_status := 'SYSTEM';
    RETURN NEW;
  END IF;

  NEW.commission_origin_scope := NULL;
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
     OR NEW.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED', 'ENRIQUE') THEN
    RAISE EXCEPTION 'Manual expenses require AURRERA, CHIPITLAN, SHARED or ENRIQUE as destination.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_expense_concept_destination() IS
  'New manual expenses require a stable concept and AURRERA, CHIPITLAN, SHARED or ENRIQUE destination; fixed expenses inherit obligation scope; automatic commissions preserve protected shared budget destination and operational origin.';

DO $postflight$
DECLARE
  v_concept_constraint TEXT;
  v_destination_constraint TEXT;
  v_consistency_constraint TEXT;
  v_fixed_scope_constraint TEXT;
  v_enforcement_definition TEXT;
BEGIN
  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_concept_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check';

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_destination_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_destination_scope_check';

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_consistency_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_classification_consistency_check';

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_fixed_scope_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.fixed_costs'::REGCLASS
    AND constraint_row.conname = 'fixed_costs_scope_check';

  SELECT PG_GET_FUNCTIONDEF(
    TO_REGPROCEDURE('public.enforce_expense_concept_destination()'))
  INTO v_enforcement_definition;

  IF v_concept_constraint NOT LIKE '%OPERATIONS_MANAGEMENT%'
     OR v_destination_constraint NOT LIKE '%ENRIQUE%'
     OR v_consistency_constraint NOT LIKE '%ENRIQUE%'
     OR v_enforcement_definition NOT LIKE '%ENRIQUE%'
     OR v_fixed_scope_constraint LIKE '%ENRIQUE%' THEN
    RAISE EXCEPTION 'The prospective concept/destination contract was not installed as reviewed';
  END IF;

  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
         AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'The protected commission link changed unexpectedly';
  END IF;
END;
$postflight$;

COMMIT;
