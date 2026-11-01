-- READ ONLY. Run only after the separately reviewed phase 2 SQL.
-- structural_checks_passed confirms the prospective contracts only. It does
-- not mean that historical pending rows have been classified.

WITH enforcement AS (
  SELECT COUNT(*) = 1
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%TG_OP = ''INSERT''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%New manual expenses require concept and destination%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%NEW.type IS DISTINCT FROM OLD.type%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%v_unresolved_event_count > 0%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%NEW.concept_code := ''COMMISSIONS''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) NOT LIKE '%NEW.destination_scope := ''SHARED''%') AS enabled,
    COUNT(*) = 1
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%IF NEW.classification_status IS NULL%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%NEW.type IS DISTINCT FROM OLD.type%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%NEW.expense_date IS DISTINCT FROM OLD.expense_date%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%NEW.fixed_cost_id IS DISTINCT FROM OLD.fixed_cost_id%')
      AS legacy_pending_compatible
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
), trigger_contract AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%BEFORE INSERT OR UPDATE OF type,%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%commission_settlement_id%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%concept_code%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%destination_scope%'
      AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%classification_status%'
    ), FALSE) AS passed
  FROM pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
    AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgenabled <> 'D'
), classification_constraints AS (
  SELECT
    COUNT(*) FILTER (
      WHERE constraint_row.conname = 'expenses_concept_code_check'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%PAYROLL%'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%RENT%'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%COMMISSIONS%'
    ) = 1 AS concept_catalog_valid,
    COUNT(*) FILTER (
      WHERE constraint_row.conname = 'expenses_classification_consistency_check'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%CLASSIFIED%'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%SYSTEM%'
        AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%commission_settlement_id%'
    ) = 1 AS consistency_valid
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.contype = 'c'
), commission_writer AS (
  SELECT COUNT(*) = 1
    AND BOOL_AND(procedure_row.prosecdef)
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'expense_date', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'amount_mxn', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'type', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'category', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'vendor', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'has_invoice', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'payment_method', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'notes', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'fixed_cost_id', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'created_by', 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      PG_GET_USERBYID(procedure_row.proowner), 'public.expenses', 'commission_settlement_id', 'INSERT'))
    AND BOOL_AND(EXISTS (
      SELECT 1
      FROM pg_roles AS owner_role
      JOIN pg_class AS expense_table
        ON expense_table.oid = 'public.expenses'::REGCLASS
      WHERE owner_role.oid = procedure_row.proowner
        AND (
          owner_role.rolsuper
          OR owner_role.rolbypassrls
          OR (expense_table.relowner = owner_role.oid
            AND NOT expense_table.relforcerowsecurity)
        )
    ))
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%INSERT INTO public.expenses%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%category%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%''Comisiones''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%commission_settlement_id%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%ON CONFLICT ON CONSTRAINT expenses_commission_settlement_id_key%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%America/Mexico_City%') AS passed
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.create_expense_for_paid_commission_settlement()')
), manual_columns(column_name) AS (
  VALUES
    ('expense_date'), ('amount_mxn'), ('type'), ('category'), ('vendor'),
    ('has_invoice'), ('payment_method'), ('notes'), ('fixed_cost_id'),
    ('is_unbudgeted_fixed'), ('fixed_cost_unbudgeted_reason'),
    ('concept_code'), ('destination_scope'), ('classification_status')
), manual_column_permissions AS (
  SELECT COUNT(*) = 14
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      'authenticated', 'public.expenses', manual_columns.column_name, 'INSERT'))
    AND BOOL_AND(HAS_COLUMN_PRIVILEGE(
      'authenticated', 'public.expenses', manual_columns.column_name, 'UPDATE')) AS passed
  FROM manual_columns
), authenticated_boundary AS (
  SELECT
    NOT HAS_COLUMN_PRIVILEGE(
        'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE(
        'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS protected_system_column,
    HAS_TABLE_PRIVILEGE('authenticated', 'public.expenses', 'SELECT')
      AND HAS_TABLE_PRIVILEGE('authenticated', 'public.expenses', 'DELETE')
      AS existing_table_access_preserved,
    EXISTS (
      SELECT 1
      FROM pg_class AS table_row
      WHERE table_row.oid = 'public.expenses'::REGCLASS
        AND table_row.relrowsecurity
    ) AND EXISTS (
      SELECT 1
      FROM pg_policy AS policy_row
      WHERE policy_row.polrelid = 'public.expenses'::REGCLASS
        AND policy_row.polcmd IN ('a', '*')
        AND (policy_row.polroles = ARRAY[0::OID]
          OR TO_REGROLE('authenticated') = ANY(policy_row.polroles))
    ) AND EXISTS (
      SELECT 1
      FROM pg_policy AS policy_row
      WHERE policy_row.polrelid = 'public.expenses'::REGCLASS
        AND policy_row.polcmd IN ('w', '*')
        AND (policy_row.polroles = ARRAY[0::OID]
          OR TO_REGROLE('authenticated') = ANY(policy_row.polroles))
    ) AS rls_write_policies_preserved
), fixed_expense_contract AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%BEFORE INSERT OR UPDATE OF type,%'
    ), FALSE) AS passed
  FROM pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
    AND trigger_row.tgname = 'enforce_fixed_expense_classification_trigger'
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgenabled <> 'D'
), commission_guards AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.commission_settlements'::REGCLASS
        AND trigger_row.tgname = 'commission_settlement_paid_expense_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
        AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%AFTER UPDATE OF status%'
        AND PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) LIKE '%create_expense_for_paid_commission_settlement%'
    ) AS generation_trigger_valid,
    EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
        AND constraint_row.conname = 'expenses_commission_settlement_id_key'
        AND constraint_row.contype = 'u'
    ) AS idempotency_valid,
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
        AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) AS mutation_protection_valid
), invalid_manual AS (
  SELECT COUNT(*) AS expense_count, COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.commission_settlement_id IS NULL
    AND expense.classification_status IS NOT NULL
    AND (
      expense.classification_status = 'CLASSIFIED'
      AND expense.concept_code IS NOT NULL
      AND expense.destination_scope IN ('AURRERA', 'CHIPITLAN', 'SHARED')
    ) IS NOT TRUE
), invalid_new_commission AS (
  -- Phase 1 deliberately left existing automatic commissions with all three
  -- classification fields NULL. Once phase 2 is enabled, the BEFORE INSERT
  -- trigger assigns SYSTEM/COMMISSIONS/destination to every legitimate new
  -- linked expense. Therefore only a non-NULL but malformed system tuple is a
  -- prospective contract failure; NULL linked rows remain legacy pending.
  SELECT COUNT(*) AS expense_count, COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.commission_settlement_id IS NOT NULL
    AND expense.classification_status IS NOT NULL
    AND (
      expense.classification_status = 'SYSTEM'
      AND expense.concept_code = 'COMMISSIONS'
      AND expense.destination_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN')
    ) IS NOT TRUE
), legacy_pending AS (
  -- Report manual legacy rows and historical automatic commissions separately.
  -- Neither count participates in structural_checks_passed.
  SELECT
    COUNT(*) FILTER (
      WHERE expense.commission_settlement_id IS NULL
        AND expense.classification_status IS NULL
    ) AS manual_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.commission_settlement_id IS NULL
        AND expense.classification_status IS NULL
    ), 0) AS manual_amount_mxn,
    COUNT(*) FILTER (
      WHERE expense.commission_settlement_id IS NOT NULL
        AND expense.classification_status IS NULL
    ) AS automatic_commission_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.commission_settlement_id IS NOT NULL
        AND expense.classification_status IS NULL
    ), 0) AS automatic_commission_amount_mxn
  FROM public.expenses AS expense
), pending AS (
  SELECT
    COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn,
    COUNT(*) FILTER (WHERE expense.classification_status IS NULL) AS legacy_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.classification_status IS NULL), 0) AS legacy_amount_mxn,
    COUNT(*) FILTER (WHERE expense.destination_scope = 'UNKNOWN') AS unknown_commission_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.destination_scope = 'UNKNOWN'), 0) AS unknown_commission_amount_mxn
  FROM public.expenses AS expense
  WHERE expense.classification_status IS NULL
     OR expense.destination_scope = 'UNKNOWN'
)
SELECT
  enforcement.enabled AS manual_enforcement_enabled,
  enforcement.legacy_pending_compatible AS legacy_pending_compatibility_valid,
  trigger_contract.passed AS trigger_contract_valid,
  classification_constraints.concept_catalog_valid,
  classification_constraints.consistency_valid AS classification_consistency_valid,
  fixed_expense_contract.passed AS fixed_expense_obligation_contract_valid,
  commission_writer.passed AS automatic_commission_writer_valid,
  manual_column_permissions.passed AS authenticated_manual_columns_valid,
  authenticated_boundary.protected_system_column AS commission_settlement_id_write_protected,
  authenticated_boundary.existing_table_access_preserved,
  authenticated_boundary.rls_write_policies_preserved,
  commission_guards.generation_trigger_valid AS automatic_commission_generation_trigger_valid,
  commission_guards.idempotency_valid AS automatic_commission_idempotency_valid,
  commission_guards.mutation_protection_valid AS automatic_commission_protection_valid,
  invalid_manual.expense_count AS invalid_classified_manual_count,
  invalid_manual.amount_mxn AS invalid_classified_manual_amount_mxn,
  invalid_new_commission.expense_count AS invalid_new_automatic_commission_count,
  invalid_new_commission.amount_mxn AS invalid_new_automatic_commission_amount_mxn,
  legacy_pending.manual_count AS legacy_manual_pending_count,
  legacy_pending.manual_amount_mxn AS legacy_manual_pending_amount_mxn,
  legacy_pending.automatic_commission_count AS legacy_automatic_commission_pending_count,
  legacy_pending.automatic_commission_amount_mxn AS legacy_automatic_commission_pending_amount_mxn,
  pending.expense_count AS pending_classification_count,
  pending.amount_mxn AS pending_classification_amount_mxn,
  pending.legacy_count,
  pending.legacy_amount_mxn,
  pending.unknown_commission_count,
  pending.unknown_commission_amount_mxn,
  pending.expense_count = 0 AS classification_complete,
  enforcement.enabled
    AND enforcement.legacy_pending_compatible
    AND trigger_contract.passed
    AND classification_constraints.concept_catalog_valid
    AND classification_constraints.consistency_valid
    AND fixed_expense_contract.passed
    AND commission_writer.passed
    AND manual_column_permissions.passed
    AND authenticated_boundary.protected_system_column
    AND authenticated_boundary.existing_table_access_preserved
    AND authenticated_boundary.rls_write_policies_preserved
    AND commission_guards.generation_trigger_valid
    AND commission_guards.idempotency_valid
    AND commission_guards.mutation_protection_valid
    AND invalid_manual.expense_count = 0
    AND invalid_new_commission.expense_count = 0 AS structural_checks_passed
FROM enforcement
CROSS JOIN trigger_contract
CROSS JOIN classification_constraints
CROSS JOIN fixed_expense_contract
CROSS JOIN commission_writer
CROSS JOIN manual_column_permissions
CROSS JOIN authenticated_boundary
CROSS JOIN commission_guards
CROSS JOIN invalid_manual
CROSS JOIN invalid_new_commission
CROSS JOIN legacy_pending
CROSS JOIN pending;