-- READ ONLY. SQL Editor structural/data verifier.
-- It intentionally does not invoke session-dependent RPCs. Run the separate
-- authenticated integration verifier for RLS and client-write behavior.

WITH structural AS (
  SELECT
    TO_REGCLASS('public.finance_month_opening_balances') IS NOT NULL AS opening_table_exists,
    TO_REGCLASS('public.finance_opening_day_movement_decisions') IS NOT NULL AS decisions_table_exists,
    TO_REGCLASS('public.finance_credit_cards') IS NOT NULL AS cards_table_exists,
    TO_REGCLASS('public.finance_credit_card_payments') IS NOT NULL AS card_payments_table_exists,
    TO_REGPROCEDURE('public.finance_month_available_funds(date)') IS NOT NULL AS rpc_exists,
    TO_REGPROCEDURE('public.finance_has_available_funds_access()') IS NOT NULL AS access_helper_exists,
    TO_REGPROCEDURE('public.finance_is_after_opening(uuid,date,date,text,uuid)') IS NOT NULL AS cutoff_helper_exists,
    TO_REGPROCEDURE('public.finance_register_credit_card_payment(uuid,text,numeric,date,text,text,text,text,uuid)') IS NOT NULL AS card_payment_rpc_exists,
    TO_REGPROCEDURE('public.finance_reverse_credit_card_payment(uuid,text)') IS NOT NULL AS card_reversal_rpc_exists,
    EXISTS (
      SELECT 1 FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = TO_REGCLASS('public.finance_credit_card_payments')
        AND trigger_row.tgname = 'enforce_credit_card_payment_history_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) AS card_history_trigger_exists,
    COUNT(*) FILTER (WHERE column_name IN (
      'liquidity_treatment', 'payment_instrument', 'credit_card_id'
    )) = 3 AS expense_columns_exist
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'expenses'
), privileges AS (
  SELECT
    HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'liquidity_treatment', 'INSERT')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'liquidity_treatment', 'UPDATE')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'payment_instrument', 'INSERT')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'payment_instrument', 'UPDATE')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'credit_card_id', 'INSERT')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'credit_card_id', 'UPDATE')
      AS liquidity_columns_writable,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS commission_link_protected,
    HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_credit_card_payments', 'SELECT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_credit_card_payments', 'INSERT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_credit_card_payments', 'UPDATE')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_credit_card_payments', 'DELETE')
      AS card_payments_read_only_for_client
), rls_contract AS (
  SELECT
    (
      SELECT COUNT(*) = 4
      FROM pg_class table_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname IN (
          'finance_month_opening_balances', 'finance_credit_cards',
          'finance_credit_card_payments', 'finance_opening_day_movement_decisions'
        )
        AND table_row.relrowsecurity
    ) AS rls_enabled_on_all_new_tables,
    COUNT(*) FILTER (
      WHERE tablename IN (
        'finance_month_opening_balances', 'finance_credit_cards',
        'finance_credit_card_payments', 'finance_opening_day_movement_decisions'
      )
        AND cmd = 'SELECT'
        AND COALESCE(qual, '') LIKE '%finance_has_available_funds_access%'
    ) = 4 AS all_new_table_reads_require_finance_access,
    COUNT(*) FILTER (
      WHERE tablename = 'finance_credit_card_payments'
        AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) = 0 AS no_direct_card_payment_write_policy
  FROM pg_policies
  WHERE schemaname = 'public'
), untouched AS (
  SELECT
    COUNT(*) FILTER (
      WHERE expense_date < DATE '2026-11-01'
        AND (liquidity_treatment IS NOT NULL OR payment_instrument IS NOT NULL OR credit_card_id IS NOT NULL)
    ) AS historical_rows_changed_by_stage_1,
    COUNT(*) FILTER (
      WHERE expense_date >= DATE '2026-11-01'
        AND (liquidity_treatment IS NULL OR liquidity_treatment = 'PENDING')
    ) AS current_pending_count,
    COALESCE(SUM(amount_mxn) FILTER (
      WHERE expense_date >= DATE '2026-11-01'
        AND (liquidity_treatment IS NULL OR liquidity_treatment = 'PENDING')
    ), 0) AS current_pending_mxn
  FROM public.expenses
), contracts AS (
  SELECT
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_has_available_funds_access()'))
      LIKE '%profile.role = ''admin''%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_has_available_funds_access()'))
        LIKE '%profile.is_active%' AS access_matches_finance_module,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%finance_has_available_funds_access()%' AS rpc_requires_finance_access,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%v_opening_amount + v_pos + v_b2b - v_expenses - v_card_payments%' AS formula_matches,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%public.v_b2b_confirmed_payments%' AS confirmed_b2b_used,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%sale.refunded_at AT TIME ZONE ''America/Mexico_City''%' AS refund_event_date_used,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%finance_opening_day_movement_decisions%' AS same_day_decisions_used,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      LIKE '%ambiguous_cutoff_movements%' AS ambiguity_blocks_exact_balance,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_available_funds(date)'))
      NOT LIKE '%expense.created_at >%' AS expenses_ignore_capture_time,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_is_after_opening(uuid,date,date,text,uuid)'))
      LIKE '%p_movement_business_date > p_cutoff_business_date%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_is_after_opening(uuid,date,date,text,uuid)'))
        LIKE '%finance_opening_day_movement_decisions%' AS cutoff_requires_same_day_decision,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_reverse_credit_card_payment(uuid,text)'))
      LIKE '%status = ''REVERSED''%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_reverse_credit_card_payment(uuid,text)'))
        LIKE '%reversal_reason%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_reverse_credit_card_payment(uuid,text)'))
        LIKE '%finance_has_available_funds_access()%' AS controlled_reversal_contract,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_credit_card_payment_history()'))
      LIKE '%NEW.amount_mxn IS DISTINCT FROM OLD.amount_mxn%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_credit_card_payment_history()'))
        LIKE '%NEW.payment_date IS DISTINCT FROM OLD.payment_date%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_credit_card_payment_history()'))
        LIKE '%NEW.credit_card_id IS DISTINCT FROM OLD.credit_card_id%'
      AND PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_credit_card_payment_history()'))
        LIKE '%NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key%'
      AS immutable_card_payment_facts,
    PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_summary(date)'))
      NOT LIKE '%finance_month_opening_balances%' AS existing_summary_unchanged
)
SELECT
  structural.*,
  privileges.*,
  rls_contract.*,
  contracts.*,
  untouched.*,
  (
    structural.opening_table_exists
    AND structural.decisions_table_exists
    AND structural.cards_table_exists
    AND structural.card_payments_table_exists
    AND structural.rpc_exists
    AND structural.access_helper_exists
    AND structural.cutoff_helper_exists
    AND structural.card_payment_rpc_exists
    AND structural.card_reversal_rpc_exists
    AND structural.card_history_trigger_exists
    AND structural.expense_columns_exist
    AND privileges.liquidity_columns_writable
    AND privileges.commission_link_protected
    AND privileges.card_payments_read_only_for_client
    AND rls_contract.rls_enabled_on_all_new_tables
    AND rls_contract.all_new_table_reads_require_finance_access
    AND rls_contract.no_direct_card_payment_write_policy
    AND contracts.access_matches_finance_module
    AND contracts.rpc_requires_finance_access
    AND contracts.formula_matches
    AND contracts.confirmed_b2b_used
    AND contracts.refund_event_date_used
    AND contracts.same_day_decisions_used
    AND contracts.ambiguity_blocks_exact_balance
    AND contracts.expenses_ignore_capture_time
    AND contracts.cutoff_requires_same_day_decision
    AND contracts.controlled_reversal_contract
    AND contracts.immutable_card_payment_facts
    AND contracts.existing_summary_unchanged
    AND untouched.historical_rows_changed_by_stage_1 = 0
  ) AS structural_checks_passed,
  (untouched.current_pending_count = 0) AS exact_liquidity_classification_complete
FROM structural, privileges, rls_contract, contracts, untouched;

SELECT month_start, amount_mxn, cutoff_business_date, notes
FROM public.finance_month_opening_balances
ORDER BY month_start DESC;

SELECT
  COUNT(*) AS november_1_pos_count,
  COALESCE(SUM(total), 0) AS november_1_pos_mxn,
  COUNT(*) = 4 AND COALESCE(SUM(total), 0) = 285 AS matches_diagnosed_snapshot
FROM public.sales
WHERE lower(COALESCE(sale_origin, 'pos')) = 'pos'
  AND (created_at AT TIME ZONE 'America/Mexico_City')::DATE = DATE '2026-11-01';

SELECT
  expense_date, amount_mxn, vendor, notes,
  liquidity_treatment, payment_instrument, created_at,
  (liquidity_treatment = 'IMMEDIATE') AS recognized_as_real_outflow
FROM public.expenses
WHERE expense_date = DATE '2026-11-01'
  AND amount_mxn IN (5000, 1000, 390)
ORDER BY amount_mxn DESC, id;

SELECT
  COUNT(*) FILTER (WHERE liquidity_treatment = 'IMMEDIATE') AS real_payments_recognized_count,
  COALESCE(SUM(amount_mxn) FILTER (WHERE liquidity_treatment = 'IMMEDIATE'), 0) AS real_payments_recognized_mxn,
  COUNT(*) FILTER (WHERE liquidity_treatment IS NULL OR liquidity_treatment = 'PENDING') AS pending_payment_review_count,
  COALESCE(SUM(amount_mxn) FILTER (
    WHERE liquidity_treatment IS NULL OR liquidity_treatment = 'PENDING'
  ), 0) AS pending_payment_review_mxn,
  'Uses expense_date plus explicit same-day decision; never created_at.' AS recognition_rule
FROM public.expenses
WHERE expense_date >= DATE '2026-11-01'
  AND expense_date < DATE '2026-12-01';

SELECT
  sale.id, sale.total, sale.created_at AS original_sale_at, sale.refunded_at,
  (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE AS refund_business_date,
  ((sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < DATE '2026-11-01') AS sale_precedes_november
FROM public.sales sale
WHERE COALESCE(sale.is_refunded, false)
  AND (
    sale.refunded_at IS NULL
    OR (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE >= DATE '2026-11-01'
  )
ORDER BY sale.refunded_at NULLS FIRST, sale.id;

SELECT
  opening.month_start, decision.source_type, decision.source_id,
  decision.position, decision.notes, decision.created_at
FROM public.finance_opening_day_movement_decisions decision
JOIN public.finance_month_opening_balances opening ON opening.id = decision.opening_balance_id
ORDER BY opening.month_start, decision.source_type, decision.source_id;

SELECT
  card.name, payment.payment_kind, payment.amount_mxn, payment.payment_date,
  payment.source_instrument, payment.status, payment.reference,
  payment.reversed_at, payment.reversal_reason
FROM public.finance_credit_card_payments payment
JOIN public.finance_credit_cards card ON card.id = payment.credit_card_id
ORDER BY payment.payment_date DESC, payment.created_at DESC;
