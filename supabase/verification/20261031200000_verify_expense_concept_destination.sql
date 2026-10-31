-- READ ONLY. Phase 1 verifier: structural readiness and classification coverage
-- are deliberately reported separately. Compatibility mode still permits NULL.

WITH required_columns AS (
  SELECT COUNT(*) = 3 AS passed
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'expenses'
    AND column_name IN ('concept_code', 'destination_scope', 'classification_status')
    AND is_nullable = 'YES'
), required_constraints AS (
  SELECT COUNT(*) = 4 AS passed
  FROM pg_constraint
  WHERE conrelid = 'public.expenses'::REGCLASS
    AND conname IN (
      'expenses_concept_code_check', 'expenses_destination_scope_check',
      'expenses_classification_status_check', 'expenses_classification_consistency_check'
    )
), required_indexes AS (
  SELECT COUNT(*) = 2 AS passed
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'expenses'
    AND indexname IN ('expenses_concept_date_idx', 'expenses_destination_date_idx')
), classification_trigger AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(tgenabled <> 'D'), FALSE) AS passed
  FROM pg_trigger
  WHERE tgrelid = 'public.expenses'::REGCLASS
    AND tgname = 'enforce_expense_concept_destination_trigger' AND NOT tgisinternal
), classification_function AS (
  SELECT COUNT(*) = 1
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%NEW.concept_code := ''COMMISSIONS''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%v_unresolved_event_count > 0%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%THEN ''UNKNOWN''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) NOT LIKE '%NEW.destination_scope := ''SHARED''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%NEW.destination_scope := v_fixed_scope%') AS passed
  FROM pg_proc
  WHERE oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
), data_consistency AS (
  SELECT COUNT(*) = 0 AS passed
  FROM public.expenses
  WHERE (
    (classification_status IS NULL AND concept_code IS NULL AND destination_scope IS NULL)
    OR (classification_status = 'CLASSIFIED' AND concept_code IS NOT NULL
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'SHARED'))
    OR (classification_status = 'SYSTEM' AND commission_settlement_id IS NOT NULL
      AND concept_code = 'COMMISSIONS'
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'))
  ) IS NOT TRUE
), linked_fixed_consistency AS (
  SELECT COUNT(*) = 0 AS passed
  FROM public.expenses AS expense
  JOIN public.fixed_costs AS cost ON cost.id = expense.fixed_cost_id
  WHERE expense.classification_status = 'CLASSIFIED'
    AND expense.destination_scope IS DISTINCT FROM cost.scope
), commission_contract AS (
  SELECT TO_REGPROCEDURE('public.create_expense_for_paid_commission_settlement()') IS NOT NULL
    AND TO_REGPROCEDURE('public.protect_commission_settlement_expense()') IS NOT NULL AS passed
), finance_contract AS (
  SELECT COUNT(DISTINCT procedure_row.proname) = 4 AS passed
  FROM pg_proc AS procedure_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'finance_month_summary', 'finance_daily_series',
      'finance_daily_breakdown', 'finance_calendar_with_yoy'
    )
), pending AS (
  SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount_mxn), 0) AS amount_mxn,
    COUNT(*) FILTER (WHERE classification_status IS NULL) AS legacy_or_transition_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE classification_status IS NULL), 0) AS legacy_or_transition_amount_mxn,
    COUNT(*) FILTER (WHERE destination_scope = 'UNKNOWN') AS unknown_commission_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE destination_scope = 'UNKNOWN'), 0) AS unknown_commission_amount_mxn
  FROM public.expenses
  WHERE classification_status IS NULL OR destination_scope = 'UNKNOWN'
), structural AS (
  SELECT (SELECT passed FROM required_columns)
    AND (SELECT passed FROM required_constraints)
    AND (SELECT passed FROM required_indexes)
    AND (SELECT passed FROM classification_trigger)
    AND (SELECT passed FROM classification_function)
    AND (SELECT passed FROM data_consistency)
    AND (SELECT passed FROM linked_fixed_consistency)
    AND (SELECT passed FROM commission_contract)
    AND (SELECT passed FROM finance_contract) AS passed
), october_snapshot AS (
  SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount_mxn), 0) AS amount_mxn,
    MD5(COALESCE(STRING_AGG(CONCAT_WS('|', id, expense_date, amount_mxn, type,
      category, vendor, payment_method, fixed_cost_id, commission_settlement_id),
      E'\n' ORDER BY id), '')) AS reviewed_core_data_md5
  FROM public.expenses
  WHERE expense_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
), finance_definitions AS (
  SELECT JSONB_OBJECT_AGG(procedure_row.oid::REGPROCEDURE::TEXT,
    MD5(PG_GET_FUNCTIONDEF(procedure_row.oid))) AS definition_md5
  FROM pg_proc AS procedure_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN (
      'finance_month_summary', 'finance_daily_series',
      'finance_daily_breakdown', 'finance_calendar_with_yoy'
    )
)
SELECT
  (SELECT passed FROM structural) AS structural_checks_passed,
  TRUE AS compatibility_mode_allows_pending,
  FALSE AS manual_enforcement_enabled,
  pending.expense_count AS pending_classification_count,
  pending.amount_mxn AS pending_classification_amount_mxn,
  pending.legacy_or_transition_count,
  pending.legacy_or_transition_amount_mxn,
  pending.unknown_commission_count,
  pending.unknown_commission_amount_mxn,
  pending.expense_count = 0 AS classification_complete,
  october_snapshot.expense_count AS october_expense_count,
  october_snapshot.amount_mxn AS october_expense_amount_mxn,
  october_snapshot.reviewed_core_data_md5 AS october_core_data_md5,
  finance_definitions.definition_md5 AS finance_function_md5
FROM pending CROSS JOIN october_snapshot CROSS JOIN finance_definitions;
