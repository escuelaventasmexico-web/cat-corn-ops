-- READ ONLY. Run after reviewing and manually applying the matching migration.
-- It does not call finance_month_available_funds because SQL Editor has no
-- authenticated auth.uid(); the same components are reconciled directly.

WITH object_checks AS (
  SELECT
    TO_REGCLASS('public.finance_opening_day_source_defaults') IS NOT NULL
      AS source_defaults_exists,
    TO_REGCLASS('public.finance_expense_liquidity_adjustments') IS NOT NULL
      AS adjustment_history_exists,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expenses'
        AND column_name = 'commission_origin_scope'
    ) AS commission_origin_exists,
    TO_REGPROCEDURE('public.finance_clear_opening_movement_decision(uuid,text,uuid)') IS NOT NULL
      AS clear_exception_rpc_exists,
    TO_REGPROCEDURE('public.finance_set_commission_liquidity_adjustment(uuid,text,text,text,uuid)') IS NOT NULL
      AS adjustment_rpc_exists
), function_checks AS (
  SELECT
    POSITION('finance_opening_day_source_defaults' IN
      PG_GET_FUNCTIONDEF('public.finance_is_after_opening(uuid,date,date,text,uuid)'::REGPROCEDURE)) > 0
      AS source_default_is_used,
    POSITION('finance_expense_liquidity_adjustments' IN
      PG_GET_FUNCTIONDEF('public.finance_month_available_funds(date)'::REGPROCEDURE)) > 0
      AS adjustment_is_used,
    POSITION('opening_day_pos' IN
      PG_GET_FUNCTIONDEF('public.finance_month_available_funds(date)'::REGPROCEDURE)) > 0
      AS pos_detail_is_returned,
    POSITION('NEW.destination_scope := ''SHARED''' IN
      PG_GET_FUNCTIONDEF('public.enforce_expense_concept_destination()'::REGPROCEDURE)) > 0
      AS commission_budget_is_shared,
    POSITION('NEW.commission_origin_scope := CASE' IN
      PG_GET_FUNCTIONDEF('public.enforce_expense_concept_destination()'::REGPROCEDURE)) > 0
      AS commission_origin_is_separate,
    POSITION('NEW.liquidity_treatment := ''IMMEDIATE''' IN
      PG_GET_FUNCTIONDEF('public.enforce_expense_liquidity_classification()'::REGPROCEDURE)) > 0
      AND POSITION('upper(NEW.payment_method::TEXT) = ''CASH''' IN
      PG_GET_FUNCTIONDEF('public.enforce_expense_liquidity_classification()'::REGPROCEDURE)) > 0
      AND POSITION('upper(NEW.payment_method::TEXT) = ''TRANSFER''' IN
      PG_GET_FUNCTIONDEF('public.enforce_expense_liquidity_classification()'::REGPROCEDURE)) > 0
      AS future_cash_transfer_commissions_are_immediate
), permission_checks AS (
  SELECT
    HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_opening_day_source_defaults', 'SELECT')
      AND HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_opening_day_source_defaults', 'INSERT')
      AND HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_opening_day_source_defaults', 'UPDATE')
      AS source_default_client_permissions,
    HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'SELECT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'INSERT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'UPDATE')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'DELETE')
      AS adjustment_history_is_write_protected,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_origin_scope', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_origin_scope', 'UPDATE')
      AS commission_origin_is_write_protected
), november_opening AS (
  SELECT opening.*
  FROM public.finance_month_opening_balances opening
  WHERE opening.month_start = DATE '2026-11-01'
), november_pos_default AS (
  SELECT source_default.*
  FROM public.finance_opening_day_source_defaults source_default
  JOIN november_opening opening ON opening.id = source_default.opening_balance_id
  WHERE source_default.source_type = 'POS_SALE'
), gerardo_adjustment AS (
  SELECT adjustment.*, expense.amount_mxn, expense.commission_settlement_id,
    expense.payment_method, expense.liquidity_treatment AS stored_treatment,
    decision.position AS opening_position
  FROM public.finance_expense_liquidity_adjustments adjustment
  JOIN public.expenses expense ON expense.id = adjustment.expense_id
  JOIN november_opening opening ON true
  JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = opening.id
    AND decision.source_type = 'EXPENSE'
    AND decision.source_id = expense.id
  WHERE adjustment.idempotency_key = '20261101-2200-4000-8000-000000000100'::UUID
), pos_total AS (
  SELECT COALESCE(SUM(CASE upper(sale.payment_method::TEXT)
      WHEN 'CASH' THEN sale.total
      WHEN 'CARD' THEN COALESCE(NULLIF(sale.card_amount, 0), sale.total)
      WHEN 'TRANSFER' THEN COALESCE(NULLIF(sale.transfer_amount, 0), sale.total)
      WHEN 'MIXED' THEN COALESCE(sale.cash_amount, 0) + COALESCE(sale.card_amount, 0) + COALESCE(sale.transfer_amount, 0)
      ELSE 0 END), 0) AS amount_mxn
  FROM public.sales sale
  JOIN november_opening opening ON true
  LEFT JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = opening.id
    AND decision.source_type = 'POS_SALE' AND decision.source_id = sale.id
  LEFT JOIN november_pos_default source_default ON true
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
      < DATE '2026-12-01'
    AND lower(COALESCE(sale.sale_origin, 'pos')) = 'pos'
    AND CASE
      WHEN (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE > opening.cutoff_business_date THEN true
      WHEN (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < opening.cutoff_business_date THEN false
      ELSE COALESCE(decision.position, source_default.position) = 'AFTER_OPENING'
    END
), b2b_total AS (
  SELECT COALESCE(SUM(payment.amount), 0) AS amount_mxn
  FROM public.v_b2b_confirmed_payments payment
  JOIN november_opening opening ON true
  LEFT JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = opening.id
    AND decision.source_type = CASE payment.source_type
      WHEN 'comodato' THEN 'B2B_COMODATO'
      WHEN 'mayoreo' THEN 'B2B_MAYOREO'
      ELSE 'B2B_VENTA_PIEZA' END
    AND decision.source_id = payment.id
  WHERE payment.business_date < DATE '2026-12-01'
    AND CASE
      WHEN payment.business_date > opening.cutoff_business_date THEN true
      WHEN payment.business_date < opening.cutoff_business_date THEN false
      ELSE decision.position = 'AFTER_OPENING'
    END
), expense_total AS (
  SELECT COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses expense
  JOIN november_opening opening ON true
  LEFT JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = opening.id
    AND decision.source_type = 'EXPENSE' AND decision.source_id = expense.id
  LEFT JOIN LATERAL (
    SELECT entry.liquidity_treatment
    FROM public.finance_expense_liquidity_adjustments entry
    WHERE entry.expense_id = expense.id
    ORDER BY entry.created_at DESC, entry.id DESC LIMIT 1
  ) adjustment ON true
  WHERE expense.expense_date < DATE '2026-12-01'
    AND COALESCE(adjustment.liquidity_treatment, expense.liquidity_treatment) = 'IMMEDIATE'
    AND CASE
      WHEN expense.expense_date > opening.cutoff_business_date THEN true
      WHEN expense.expense_date < opening.cutoff_business_date THEN false
      ELSE decision.position = 'AFTER_OPENING'
    END
), card_payment_total AS (
  SELECT COALESCE(SUM(payment.amount_mxn), 0) AS amount_mxn
  FROM public.finance_credit_card_payments payment
  JOIN november_opening opening ON true
  LEFT JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = opening.id
    AND decision.source_type = 'CREDIT_CARD_PAYMENT' AND decision.source_id = payment.id
  WHERE payment.status = 'POSTED' AND payment.payment_date < DATE '2026-12-01'
    AND CASE
      WHEN payment.payment_date > opening.cutoff_business_date THEN true
      WHEN payment.payment_date < opening.cutoff_business_date THEN false
      ELSE decision.position = 'AFTER_OPENING'
    END
), november_reconciliation AS (
  SELECT opening.amount_mxn AS opening_mxn,
    pos.amount_mxn AS pos_mxn, b2b.amount_mxn AS b2b_mxn,
    expense.amount_mxn AS expenses_mxn, card.amount_mxn AS card_payments_mxn,
    round(opening.amount_mxn + pos.amount_mxn + b2b.amount_mxn
      - expense.amount_mxn - card.amount_mxn, 2) AS expected_available_mxn
  FROM november_opening opening
  CROSS JOIN pos_total pos CROSS JOIN b2b_total b2b
  CROSS JOIN expense_total expense CROSS JOIN card_payment_total card
)
SELECT
  object_checks.*,
  function_checks.*,
  permission_checks.*,
  (SELECT COUNT(*) = 1 AND bool_and(position = 'AFTER_OPENING')
    FROM november_pos_default) AS november_pos_joint_after_opening,
  (SELECT COUNT(*) = 1
      AND bool_and(amount_mxn = 100)
      AND bool_and(upper(payment_method::TEXT) = 'CASH')
      AND bool_and(liquidity_treatment = 'IMMEDIATE')
      AND bool_and(payment_instrument = 'CASH')
      AND bool_and(opening_position = 'AFTER_OPENING')
    FROM gerardo_adjustment) AS gerardo_100_adjusted_once_without_amount_change,
  reconciliation.opening_mxn,
  reconciliation.pos_mxn,
  reconciliation.b2b_mxn,
  reconciliation.expenses_mxn,
  reconciliation.card_payments_mxn,
  reconciliation.expected_available_mxn,
  reconciliation.expected_available_mxn = 3805 AS expected_3805_confirmed,
  (
    object_checks.source_defaults_exists
    AND object_checks.adjustment_history_exists
    AND object_checks.commission_origin_exists
    AND object_checks.clear_exception_rpc_exists
    AND object_checks.adjustment_rpc_exists
    AND function_checks.source_default_is_used
    AND function_checks.adjustment_is_used
    AND function_checks.pos_detail_is_returned
    AND function_checks.commission_budget_is_shared
    AND function_checks.commission_origin_is_separate
    AND function_checks.future_cash_transfer_commissions_are_immediate
    AND permission_checks.source_default_client_permissions
    AND permission_checks.adjustment_history_is_write_protected
    AND permission_checks.commission_origin_is_write_protected
  ) AS structural_checks_passed
FROM object_checks
CROSS JOIN function_checks
CROSS JOIN permission_checks
CROSS JOIN november_reconciliation reconciliation;
