-- READ ONLY. Run only after the separately reviewed phase 2 SQL.

WITH enforcement AS (
  SELECT COUNT(*) = 1
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%TG_OP = ''INSERT''%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%New manual expenses require concept and destination%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%NEW.type IS DISTINCT FROM OLD.type%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) LIKE '%v_unresolved_event_count > 0%')
    AND BOOL_AND(PG_GET_FUNCTIONDEF(oid) NOT LIKE '%NEW.destination_scope := ''SHARED''%') AS enabled
  FROM pg_proc WHERE oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
), trigger_contract AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(PG_GET_TRIGGERDEF(oid, TRUE) LIKE '%UPDATE OF type,%'), FALSE) AS passed
  FROM pg_trigger
  WHERE tgrelid = 'public.expenses'::REGCLASS
    AND tgname = 'enforce_expense_concept_destination_trigger'
    AND NOT tgisinternal AND tgenabled <> 'D'
), pending AS (
  SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount_mxn), 0) AS amount_mxn,
    COUNT(*) FILTER (WHERE classification_status IS NULL) AS legacy_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE classification_status IS NULL), 0) AS legacy_amount_mxn,
    COUNT(*) FILTER (WHERE destination_scope = 'UNKNOWN') AS unknown_commission_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE destination_scope = 'UNKNOWN'), 0) AS unknown_commission_amount_mxn
  FROM public.expenses
  WHERE classification_status IS NULL OR destination_scope = 'UNKNOWN'
)
SELECT enforcement.enabled AS manual_enforcement_enabled,
  trigger_contract.passed AS trigger_contract_valid,
  pending.expense_count AS pending_classification_count,
  pending.amount_mxn AS pending_classification_amount_mxn,
  pending.legacy_count, pending.legacy_amount_mxn,
  pending.unknown_commission_count, pending.unknown_commission_amount_mxn,
  pending.expense_count = 0 AS classification_complete
FROM enforcement CROSS JOIN trigger_contract CROSS JOIN pending;
