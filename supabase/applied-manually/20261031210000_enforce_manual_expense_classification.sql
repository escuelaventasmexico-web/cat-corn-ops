-- PHASE 2 - MANUAL REVIEW REQUIRED.
-- Keep outside supabase/migrations until every expense writer is published and
-- smoke-tested. This transaction changes no historical row.

BEGIN;

DO $preflight$
DECLARE
  v_phase_1_function TEXT;
  v_commission_writer TEXT;
  v_commission_writer_owner NAME;
  v_commission_writer_security_definer BOOLEAN;
  v_concept_constraint TEXT;
  v_consistency_constraint TEXT;
  v_authenticated_role OID;
BEGIN
  IF TO_REGCLASS('public.expenses') IS NULL
     OR TO_REGCLASS('public.fixed_costs') IS NULL THEN
    RAISE EXCEPTION 'Required finance tables are missing.';
  END IF;

  v_authenticated_role := TO_REGROLE('authenticated');
  IF v_authenticated_role IS NULL THEN
    RAISE EXCEPTION 'The authenticated database role is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS table_row
    WHERE table_row.oid = 'public.expenses'::REGCLASS
      AND table_row.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.expenses'::REGCLASS
      AND policy_row.polcmd IN ('a', '*')
      AND (policy_row.polroles = ARRAY[0::OID]
        OR v_authenticated_role = ANY(policy_row.polroles))
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.expenses'::REGCLASS
      AND policy_row.polcmd IN ('w', '*')
      AND (policy_row.polroles = ARRAY[0::OID]
        OR v_authenticated_role = ANY(policy_row.polroles))
  ) THEN
    RAISE EXCEPTION 'The deployed expenses RLS insert/update contract differs from the reviewed baseline.';
  END IF;

  SELECT PG_GET_FUNCTIONDEF(procedure_row.oid)
  INTO v_phase_1_function
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()');

  IF v_phase_1_function IS NULL THEN
    RAISE EXCEPTION 'Phase 1 expense classification is not installed.';
  END IF;
  IF v_phase_1_function LIKE '%TG_OP = ''INSERT''%' THEN
    RAISE EXCEPTION 'Phase 2 manual enforcement is already installed; do not execute it twice.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%BEFORE INSERT OR UPDATE OF type,%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%commission_settlement_id%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%concept_code%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%destination_scope%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%classification_status%'
  ) THEN
    RAISE EXCEPTION 'Phase 1 classification trigger is missing or disabled.';
  END IF;
  IF v_phase_1_function NOT LIKE '%v_unresolved_event_count > 0%'
     OR v_phase_1_function NOT LIKE '%NEW.concept_code := ''COMMISSIONS''%'
     OR v_phase_1_function LIKE '%NEW.destination_scope := ''SHARED''%' THEN
    RAISE EXCEPTION 'Phase 1 commission destination resolver differs from the reviewed contract.';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_concept_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c';

  IF v_concept_constraint IS NULL
     OR v_concept_constraint NOT LIKE '%PAYROLL%'
     OR v_concept_constraint NOT LIKE '%RENT%'
     OR v_concept_constraint NOT LIKE '%COMMISSIONS%' THEN
    RAISE EXCEPTION 'The deployed expense concept catalog is missing PAYROLL, RENT or COMMISSIONS.';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_consistency_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_classification_consistency_check'
    AND constraint_row.contype = 'c';

  IF v_consistency_constraint IS NULL
     OR v_consistency_constraint NOT LIKE '%CLASSIFIED%'
     OR v_consistency_constraint NOT LIKE '%SYSTEM%'
     OR v_consistency_constraint NOT LIKE '%commission_settlement_id%' THEN
    RAISE EXCEPTION 'The phase 1 classification consistency constraint differs from the reviewed contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'enforce_fixed_expense_classification_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%BEFORE INSERT OR UPDATE OF type,%'
  ) THEN
    RAISE EXCEPTION 'The fixed-expense obligation trigger is missing or disabled.';
  END IF;

  SELECT
    PG_GET_FUNCTIONDEF(procedure_row.oid),
    PG_GET_USERBYID(procedure_row.proowner),
    procedure_row.prosecdef
  INTO
    v_commission_writer,
    v_commission_writer_owner,
    v_commission_writer_security_definer
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.create_expense_for_paid_commission_settlement()');

  IF v_commission_writer IS NULL
     OR NOT v_commission_writer_security_definer
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'expense_date', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'amount_mxn', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'type', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'category', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'vendor', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'has_invoice', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'payment_method', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'notes', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'fixed_cost_id', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'created_by', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(v_commission_writer_owner, 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles AS owner_role
       JOIN pg_class AS expense_table
         ON expense_table.oid = 'public.expenses'::REGCLASS
       WHERE owner_role.rolname = v_commission_writer_owner
         AND (
           owner_role.rolsuper
           OR owner_role.rolbypassrls
           OR (expense_table.relowner = owner_role.oid
             AND NOT expense_table.relforcerowsecurity)
         )
     )
     OR v_commission_writer NOT LIKE '%INSERT INTO public.expenses%'
     OR v_commission_writer NOT LIKE '%category%'
     OR v_commission_writer NOT LIKE '%''Comisiones''%'
     OR v_commission_writer NOT LIKE '%commission_settlement_id%'
     OR v_commission_writer NOT LIKE '%ON CONFLICT ON CONSTRAINT expenses_commission_settlement_id_key%'
     OR v_commission_writer NOT LIKE '%America/Mexico_City%' THEN
    RAISE EXCEPTION 'The automatic commission expense writer differs from the reviewed contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.commission_settlements'::REGCLASS
      AND trigger_row.tgname = 'commission_settlement_paid_expense_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%AFTER UPDATE OF status%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%create_expense_for_paid_commission_settlement%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
      AND constraint_row.conname = 'expenses_commission_settlement_id_key'
      AND constraint_row.contype = 'u'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Automatic commission expenses are missing their generation trigger, idempotency or mutation protection.';
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
  'Phase 2: new manual expenses require classification; automatic commission expenses remain system-classified; legacy pending rows require classification only before type, date or fixed-obligation changes.';

-- The authenticated client keeps every field used by the published manual
-- form, but cannot claim the system-owned commission relationship. The
-- SECURITY DEFINER settlement writer keeps using its owner privileges.
REVOKE INSERT, UPDATE ON TABLE public.expenses FROM authenticated;
REVOKE INSERT (commission_settlement_id), UPDATE (commission_settlement_id)
  ON TABLE public.expenses FROM authenticated;

GRANT INSERT (
  expense_date, amount_mxn, type, category, vendor, has_invoice,
  payment_method, notes, fixed_cost_id, is_unbudgeted_fixed,
  fixed_cost_unbudgeted_reason, concept_code, destination_scope,
  classification_status
) ON TABLE public.expenses TO authenticated;

GRANT UPDATE (
  expense_date, amount_mxn, type, category, vendor, has_invoice,
  payment_method, notes, fixed_cost_id, is_unbudgeted_fixed,
  fixed_cost_unbudgeted_reason, concept_code, destination_scope,
  classification_status
) ON TABLE public.expenses TO authenticated;

DO $postflight$
DECLARE
  v_manual_column TEXT;
BEGIN
  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated clients still have a path to write commission_settlement_id.';
  END IF;

  FOREACH v_manual_column IN ARRAY ARRAY[
    'expense_date', 'amount_mxn', 'type', 'category', 'vendor', 'has_invoice',
    'payment_method', 'notes', 'fixed_cost_id', 'is_unbudgeted_fixed',
    'fixed_cost_unbudgeted_reason', 'concept_code', 'destination_scope',
    'classification_status'
  ] LOOP
    IF NOT HAS_COLUMN_PRIVILEGE(
      'authenticated', 'public.expenses', v_manual_column, 'INSERT')
      OR NOT HAS_COLUMN_PRIVILEGE(
        'authenticated', 'public.expenses', v_manual_column, 'UPDATE') THEN
      RAISE EXCEPTION 'Authenticated manual writer lost access to column %.', v_manual_column;
    END IF;
  END LOOP;

  IF NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.expenses', 'SELECT')
     OR NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.expenses', 'DELETE') THEN
    RAISE EXCEPTION 'Existing authenticated SELECT or DELETE access changed unexpectedly.';
  END IF;
END;
$postflight$;

COMMIT;
