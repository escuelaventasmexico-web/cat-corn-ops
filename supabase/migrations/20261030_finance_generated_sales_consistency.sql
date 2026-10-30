-- Keep financial RPCs on generated, non-refunded sales only.
--
-- IMPORTANT: compare these definitions with the output of
-- supabase/diagnostics/20261030_export_deployed_finance_rpc_definitions.sql
-- before applying. This reviewed migration has not been executed against Supabase.

BEGIN;

-- Abort atomically if any reviewed production definition changed.
DO $preflight$
DECLARE
  v_wrong TEXT;
BEGIN
  SELECT expected.signature
  INTO v_wrong
  FROM (VALUES
    ('finance_calendar_with_yoy(date)', '4a9b6d43f09f5467fbfd372ff0c4ddbe'),
    ('finance_daily_breakdown(date)', '46c2af56cbfd288848a8e8570403bfc6'),
    ('finance_daily_series(date)', '4c5f8b7dd5309f73bd98a7400054aae0'),
    ('finance_month_summary(date)', '8ec8e7294ca10436bafb0771a46b12e0')
  ) AS expected(signature, definition_md5)
  WHERE COALESCE(
    MD5(PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.' || expected.signature))),
    ''
  ) <> expected.definition_md5
  LIMIT 1;

  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION
      'Financial RPC changed since review: %. Stop and compare its live definition.',
      v_wrong;
  END IF;
END;
$preflight$;


CREATE OR REPLACE FUNCTION public.finance_month_summary(p_month_start DATE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_result JSON;
  v_month_end DATE;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE;
  v_days_in_month NUMERIC;
  v_days_elapsed NUMERIC;
  v_sales_mtd_mxn NUMERIC;
  v_sales_cash_mxn NUMERIC;
  v_sales_card_mxn NUMERIC;
  v_sales_transfer_mxn NUMERIC;
  v_sales_projection_mxn NUMERIC;
  v_sales_target_mxn NUMERIC;
  v_expenses_fixed_mxn NUMERIC;
  v_expenses_variable_mxn NUMERIC;
  v_expenses_other_mxn NUMERIC;
  v_expenses_total_mxn NUMERIC;
  v_fixed_plan_mxn NUMERIC;
  v_fixed_covered_mxn NUMERIC;
  v_fixed_pending_mxn NUMERIC;
BEGIN
  v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_days_in_month := EXTRACT(DAY FROM v_month_end);
  v_days_elapsed := CASE
    WHEN v_today < p_month_start THEN 0
    ELSE LEAST(v_today, v_month_end) - p_month_start + 1
  END;

  SELECT
    COALESCE(SUM(sale.total), 0),
    COALESCE(SUM(sale.card_amount), 0),
    COALESCE(SUM(sale.transfer_amount), 0)
  INTO v_sales_mtd_mxn, v_sales_card_mxn, v_sales_transfer_mxn
  FROM public.sales AS sale
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
        BETWEEN p_month_start AND LEAST(v_today, v_month_end)
    AND sale.is_refunded = FALSE;

  v_sales_cash_mxn := v_sales_mtd_mxn - v_sales_card_mxn - v_sales_transfer_mxn;
  v_sales_projection_mxn := CASE
    WHEN v_days_elapsed > 0 THEN (v_sales_mtd_mxn / v_days_elapsed) * v_days_in_month
    ELSE 0
  END;

  SELECT COALESCE(target.sales_target_mxn, 0)
  INTO v_sales_target_mxn
  FROM public.monthly_targets AS target
  WHERE target.month_start = p_month_start;

  SELECT COALESCE(SUM(cost.amount_mxn), 0)
  INTO v_fixed_plan_mxn
  FROM public.fixed_costs AS cost
  WHERE cost.active = TRUE;

  SELECT COALESCE(SUM(expense.amount_mxn), 0)
  INTO v_expenses_fixed_mxn
  FROM public.expenses AS expense
  WHERE expense.expense_date BETWEEN p_month_start AND v_month_end
    AND expense.type::TEXT = 'FIXED';

  SELECT COALESCE(SUM(expense.amount_mxn), 0)
  INTO v_expenses_variable_mxn
  FROM public.expenses AS expense
  WHERE expense.expense_date BETWEEN p_month_start AND v_month_end
    AND expense.type::TEXT = 'VARIABLE';

  SELECT COALESCE(SUM(expense.amount_mxn), 0)
  INTO v_expenses_other_mxn
  FROM public.expenses AS expense
  WHERE expense.expense_date BETWEEN p_month_start AND v_month_end
    AND expense.type::TEXT NOT IN ('FIXED', 'VARIABLE');

  v_expenses_total_mxn := v_expenses_fixed_mxn + v_expenses_variable_mxn + v_expenses_other_mxn;
  v_fixed_covered_mxn := v_expenses_fixed_mxn;
  v_fixed_pending_mxn := GREATEST(v_fixed_plan_mxn - v_expenses_fixed_mxn, 0);

  v_result := JSON_BUILD_OBJECT(
    'sales_mtd_mxn', v_sales_mtd_mxn,
    'sales_cash_mxn', v_sales_cash_mxn,
    'sales_card_mxn', v_sales_card_mxn,
    'sales_transfer_mxn', v_sales_transfer_mxn,
    'sales_projection_mxn', v_sales_projection_mxn,
    'sales_target_mxn', v_sales_target_mxn,
    'expenses_fixed_mxn', v_expenses_fixed_mxn,
    'expenses_variable_mxn', v_expenses_variable_mxn,
    'expenses_other_mxn', v_expenses_other_mxn,
    'expenses_total_mxn', v_expenses_total_mxn,
    'fixed_plan_mxn', v_fixed_plan_mxn,
    'fixed_covered_mxn', v_fixed_covered_mxn,
    'fixed_pending_mxn', v_fixed_pending_mxn,
    'pnl', JSON_BUILD_OBJECT(
      'sales_mxn', v_sales_mtd_mxn,
      'cogs_variable_purchases_mxn', v_expenses_variable_mxn,
      'gross_profit_mxn', v_sales_mtd_mxn - v_expenses_variable_mxn,
      'fixed_expenses_mxn', v_expenses_fixed_mxn,
      'other_expenses_mxn', v_expenses_other_mxn,
      'net_profit_mxn', v_sales_mtd_mxn - v_expenses_total_mxn
    )
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_daily_series(p_month_start DATE)
RETURNS TABLE(day TEXT, sales_mxn NUMERIC, expenses_mxn NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_end DATE;
BEGIN
  v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  RETURN QUERY
  WITH date_series AS (
    SELECT GENERATE_SERIES(p_month_start::TIMESTAMP, v_month_end::TIMESTAMP, '1 day'::INTERVAL)::DATE AS date
  ),
  daily_sales AS (
    SELECT
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS date,
      COALESCE(SUM(sale.total), 0) AS sales
    FROM public.sales AS sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_month_start AND v_month_end
      AND sale.is_refunded = FALSE
    GROUP BY (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
  ),
  daily_expenses AS (
    SELECT expense.expense_date AS date, COALESCE(SUM(expense.amount_mxn), 0) AS expenses
    FROM public.expenses AS expense
    WHERE expense.expense_date BETWEEN p_month_start AND v_month_end
    GROUP BY expense.expense_date
  )
  SELECT TO_CHAR(series.date, 'DD'), COALESCE(sales.sales, 0), COALESCE(expenses.expenses, 0)
  FROM date_series AS series
  LEFT JOIN daily_sales AS sales ON sales.date = series.date
  LEFT JOIN daily_expenses AS expenses ON expenses.date = series.date
  ORDER BY series.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_daily_breakdown(p_month_start DATE)
RETURNS TABLE(
  sale_date DATE,
  total_sales NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  transfer_sales NUMERIC,
  mixed_count BIGINT,
  ticket_count BIGINT,
  avg_ticket NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_end DATE;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE;
BEGIN
  v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  RETURN QUERY
  WITH date_series AS (
    SELECT GENERATE_SERIES(
      p_month_start::TIMESTAMP,
      LEAST(v_today, v_month_end)::TIMESTAMP,
      '1 day'::INTERVAL
    )::DATE AS date
  ),
  daily AS (
    SELECT
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS date,
      COALESCE(SUM(sale.total), 0) AS total_sales,
      COALESCE(SUM(sale.card_amount), 0) AS card_sales,
      COALESCE(SUM(sale.transfer_amount), 0) AS transfer_sales,
      COUNT(*) FILTER (WHERE UPPER(sale.payment_method::TEXT) = 'MIXED') AS mixed_count,
      COUNT(*) AS ticket_count
    FROM public.sales AS sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
          BETWEEN p_month_start AND LEAST(v_today, v_month_end)
      AND sale.is_refunded = FALSE
    GROUP BY (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
  )
  SELECT
    series.date,
    COALESCE(daily.total_sales, 0),
    COALESCE(daily.total_sales, 0) - COALESCE(daily.card_sales, 0) - COALESCE(daily.transfer_sales, 0),
    COALESCE(daily.card_sales, 0),
    COALESCE(daily.transfer_sales, 0),
    COALESCE(daily.mixed_count, 0),
    COALESCE(daily.ticket_count, 0),
    CASE WHEN COALESCE(daily.ticket_count, 0) > 0
      THEN ROUND(daily.total_sales / daily.ticket_count, 2)
      ELSE 0
    END
  FROM date_series AS series
  LEFT JOIN daily ON daily.date = series.date
  ORDER BY series.date;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_calendar_with_yoy(p_month_start DATE)
RETURNS TABLE(
  sale_date DATE,
  total_sales NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  transfer_sales NUMERIC,
  ticket_count BIGINT,
  avg_ticket NUMERIC,
  prev_year_sales NUMERIC,
  yoy_diff_abs NUMERIC,
  yoy_diff_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_end DATE;
  v_prev_month_start DATE;
  v_prev_month_end DATE;
BEGIN
  v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_prev_month_start := (p_month_start - INTERVAL '1 year')::DATE;
  v_prev_month_end := (v_prev_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  RETURN QUERY
  WITH date_series AS (
    SELECT GENERATE_SERIES(p_month_start::TIMESTAMP, v_month_end::TIMESTAMP, '1 day'::INTERVAL)::DATE AS date
  ),
  current_daily AS (
    SELECT
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS date,
      COALESCE(SUM(sale.total), 0) AS total_sales,
      COALESCE(SUM(sale.card_amount), 0) AS card_sales,
      COALESCE(SUM(sale.transfer_amount), 0) AS transfer_sales,
      COUNT(*) AS ticket_count
    FROM public.sales AS sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_month_start AND v_month_end
      AND sale.is_refunded = FALSE
    GROUP BY (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
  ),
  previous_daily AS (
    SELECT
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS date,
      COALESCE(SUM(sale.total), 0) AS total_sales
    FROM public.sales AS sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN v_prev_month_start AND v_prev_month_end
      AND sale.is_refunded = FALSE
    GROUP BY (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE
  )
  SELECT
    series.date,
    COALESCE(current_sales.total_sales, 0),
    COALESCE(current_sales.total_sales, 0) - COALESCE(current_sales.card_sales, 0) - COALESCE(current_sales.transfer_sales, 0),
    COALESCE(current_sales.card_sales, 0),
    COALESCE(current_sales.transfer_sales, 0),
    COALESCE(current_sales.ticket_count, 0),
    CASE WHEN COALESCE(current_sales.ticket_count, 0) > 0
      THEN ROUND(current_sales.total_sales / current_sales.ticket_count, 2)
      ELSE 0
    END,
    COALESCE(previous_sales.total_sales, 0),
    COALESCE(current_sales.total_sales, 0) - COALESCE(previous_sales.total_sales, 0),
    CASE WHEN COALESCE(previous_sales.total_sales, 0) > 0
      THEN ROUND(((COALESCE(current_sales.total_sales, 0) - previous_sales.total_sales) / previous_sales.total_sales) * 100, 2)
      ELSE NULL
    END
  FROM date_series AS series
  LEFT JOIN current_daily AS current_sales ON current_sales.date = series.date
  LEFT JOIN previous_daily AS previous_sales ON EXTRACT(DAY FROM series.date) = EXTRACT(DAY FROM previous_sales.date)
  ORDER BY series.date;
END;
$$;


COMMIT;