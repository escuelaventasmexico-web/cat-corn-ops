-- READ ONLY. Ejecutar solamente despues de la migracion corregida.
-- Una sola consulta: Supabase muestra all_checks_passed junto con los detalles.
WITH october AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(amount_mxn), 0) AS registered_mxn,
    COUNT(*) FILTER (WHERE fixed_cost_id IS NOT NULL) AS linked_count
  FROM public.expenses
  WHERE type::TEXT = 'FIXED'
    AND expense_date >= DATE '2026-10-01'
    AND expense_date < DATE '2026-11-01'
), november_catalog AS (
  SELECT COUNT(*) AS obligation_count,
    COALESCE(SUM(monthly_provision_mxn), 0) AS reserved_mxn,
    COUNT(*) FILTER (WHERE amount_mxn IS NULL) AS unknown_amount_count,
    COUNT(*) FILTER (
      WHERE configuration_status = 'SCHEDULE_PENDING'
    ) AS pending_schedule_count
  FROM public.fixed_costs
  WHERE effective_from <= DATE '2026-11-30'
    AND (effective_to IS NULL OR effective_to >= DATE '2026-11-01')
), summaries AS (
  SELECT public.finance_month_summary(DATE '2026-10-01')::JSONB AS oct,
    public.finance_month_summary(DATE '2026-11-01')::JSONB AS nov
), checks AS (
  SELECT
    (o.expense_count = 6 AND o.registered_mxn = 13670 AND o.linked_count = 0)
      AS october_legacy_untouched,
    COALESCE(s.oct->>'fixed_reconciliation_status' = 'LEGACY_UNRECONCILED', FALSE)
      AS october_unreconciled_visible,
    COALESCE((s.oct->>'fixed_registered_mxn')::NUMERIC = 13670, FALSE)
      AS october_registered_total_preserved,
    COALESCE(s.oct->'fixed_pending_mxn' = 'null'::JSONB, FALSE)
      AS october_pending_not_claimed,
    (n.obligation_count = 10 AND n.reserved_mxn = 22023)
      AS november_catalog_and_reserve_correct,
    (n.unknown_amount_count = 1 AND EXISTS (
      SELECT 1 FROM public.fixed_costs
      WHERE obligation_code = 'aurrera.luz'
        AND amount_mxn IS NULL
        AND monthly_provision_mxn IS NULL
        AND effective_from = DATE '2026-11-01'
    )) AS aurrera_electricity_unknown,
    (n.pending_schedule_count = 1 AND EXISTS (
      SELECT 1 FROM public.fixed_costs
      WHERE obligation_code = 'chipitlan.luz'
        AND configuration_status = 'SCHEDULE_PENDING'
        AND amount_mxn = 990
        AND monthly_provision_mxn = 495
        AND billing_anchor_month IS NULL
        AND effective_from = DATE '2026-11-01'
    )) AS chipitlan_schedule_pending,
    COALESCE((s.nov->>'fixed_reserved_mxn')::NUMERIC = 22023, FALSE)
      AS summary_uses_monthly_provision,
    COALESCE((s.nov->>'fixed_due_mxn')::NUMERIC = 21528, FALSE)
      AS due_excludes_unconfigured_items,
    COALESCE(s.nov->>'fixed_reconciliation_status' = 'BY_OBLIGATION', FALSE)
      AS november_reconciliation_enabled,
    EXISTS (
      SELECT 1 FROM pg_constraint AS c
      WHERE c.conrelid = 'public.expenses'::REGCLASS
        AND c.confrelid = 'public.fixed_costs'::REGCLASS
        AND c.conname = 'expenses_fixed_cost_id_fkey'
        AND c.confdeltype = 'r'
    ) AS expense_links_use_delete_restrict,
    (
      SELECT COUNT(DISTINCT column_name) = 6
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fixed_costs'
        AND column_name IN (
          'obligation_code', 'scope', 'periodicity',
          'payment_interval_months', 'effective_from', 'configuration_status'
        )
        AND is_nullable = 'NO'
    ) AS required_catalog_fields_not_null,
    NOT EXISTS (
      SELECT 1 FROM public.fixed_costs
      WHERE obligation_code = 'shared.enrique'
    ) AS enrique_not_inserted,
    (
      SELECT COUNT(*) = 3
      FROM pg_trigger AS t
      WHERE NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
        AND (
          (t.tgrelid = 'public.expenses'::REGCLASS
            AND t.tgname = 'enforce_fixed_expense_classification_trigger')
          OR (t.tgrelid = 'public.fixed_costs'::REGCLASS
            AND t.tgname IN (
              'prevent_fixed_cost_delete_trigger',
              'prevent_fixed_cost_period_overlap_trigger'
            ))
        )
    ) AS classification_and_catalog_guards_enabled
  FROM october AS o
  CROSS JOIN november_catalog AS n
  CROSS JOIN summaries AS s
), obligation_detail AS (
  SELECT COALESCE(JSONB_AGG(TO_JSONB(status_row)
    ORDER BY status_row.obligation_scope, status_row.obligation_name), '[]'::JSONB)
    AS rows
  FROM public.finance_fixed_cost_month_status(DATE '2026-11-01') AS status_row
), policies AS (
  SELECT COALESCE(JSONB_AGG(TO_JSONB(policy_row)
    ORDER BY policy_row.tablename, policy_row.policyname), '[]'::JSONB)
    AS rows
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN ('fixed_costs', 'expenses')
)
SELECT
  (SELECT COALESCE(BOOL_AND(value = 'true'), FALSE)
   FROM JSONB_EACH_TEXT(TO_JSONB(c))) AS all_checks_passed,
  c.*,
  d.rows AS november_obligation_detail,
  p.rows AS current_rls_policies
FROM checks AS c
CROSS JOIN obligation_detail AS d
CROSS JOIN policies AS p;
