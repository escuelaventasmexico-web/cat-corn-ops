-- ============================================================================
-- Migration: Fix finance_month_summary + finance_daily_series
-- AND create new RPCs for daily breakdown & calendar with YoY comparison
-- ============================================================================
-- FIXES:
--   1. Timezone: use AT TIME ZONE 'America/Mexico_City' instead of ::DATE (UTC)
--   2. Casing:   expense type is an enum — use type::TEXT instead of UPPER(type)
-- NOTE: sales table has no 'status' column — no cancelled-sale filter needed.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) FIX: finance_month_summary
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_month_summary(p_month_start DATE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_month_end DATE;
    v_days_in_month NUMERIC;
    v_days_elapsed NUMERIC;

    -- Sales
    v_sales_mtd_mxn NUMERIC;
    v_sales_cash_mxn NUMERIC;
    v_sales_card_mxn NUMERIC;
    v_sales_projection_mxn NUMERIC;
    v_sales_target_mxn NUMERIC;

    -- Expenses by type (from expenses table)
    v_expenses_fixed_mxn NUMERIC;
    v_expenses_variable_mxn NUMERIC;
    v_expenses_other_mxn NUMERIC;
    v_expenses_total_mxn NUMERIC;

    -- Fixed costs plan (from fixed_costs table)
    v_fixed_plan_mxn NUMERIC;
    v_fixed_covered_mxn NUMERIC;
    v_fixed_pending_mxn NUMERIC;
BEGIN
    -- Calculate month boundaries and days
    v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_days_in_month := EXTRACT(DAY FROM v_month_end);
    v_days_elapsed := EXTRACT(DAY FROM LEAST(CURRENT_DATE, v_month_end));

    -- ══════════════════════════════════════════════════════════════════
    -- Sales MTD — FIX: timezone Mexico
    -- cash_amount in DB stores what customer handed over (includes change),
    -- so we DERIVE cash as total − card to guarantee cash + card = total.
    -- ══════════════════════════════════════════════════════════════════
    SELECT
        COALESCE(SUM(total), 0),
        COALESCE(SUM(card_amount), 0)
    INTO v_sales_mtd_mxn, v_sales_card_mxn
    FROM public.sales
    WHERE (created_at AT TIME ZONE 'America/Mexico_City')::DATE
          BETWEEN p_month_start AND LEAST(CURRENT_DATE, v_month_end);

    -- Derive cash = total - card (guarantees cash + card = total always)
    v_sales_cash_mxn := v_sales_mtd_mxn - v_sales_card_mxn;

    -- Sales projection (based on daily average)
    IF v_days_elapsed > 0 THEN
        v_sales_projection_mxn := (v_sales_mtd_mxn / v_days_elapsed) * v_days_in_month;
    ELSE
        v_sales_projection_mxn := 0;
    END IF;

    -- Sales target for the month
    SELECT COALESCE(sales_target_mxn, 0) INTO v_sales_target_mxn
    FROM public.monthly_targets
    WHERE month_start = p_month_start;

    -- Fixed costs plan (from fixed_costs table where active = true)
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_fixed_plan_mxn
    FROM public.fixed_costs
    WHERE active = true;

    -- ══════════════════════════════════════════════════════════════════
    -- Expenses — FIX: cast enum type::TEXT for comparison
    -- ══════════════════════════════════════════════════════════════════

    -- Expenses: Fixed (paid)
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_fixed_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
      AND type::TEXT = 'FIXED';

    -- Expenses: Variable
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_variable_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
      AND type::TEXT = 'VARIABLE';

    -- Expenses: Other (anything not FIXED or VARIABLE)
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_other_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
      AND type::TEXT NOT IN ('FIXED', 'VARIABLE');

    -- Total expenses (sum of all types)
    v_expenses_total_mxn := v_expenses_fixed_mxn + v_expenses_variable_mxn + v_expenses_other_mxn;

    -- Fixed covered: only what's been paid
    v_fixed_covered_mxn := v_expenses_fixed_mxn;

    -- Fixed pending: plan minus what's been paid
    v_fixed_pending_mxn := GREATEST(v_fixed_plan_mxn - v_expenses_fixed_mxn, 0);

    -- Build JSON result with PNL breakdown
    v_result := json_build_object(
        'sales_mtd_mxn', v_sales_mtd_mxn,
        'sales_cash_mxn', v_sales_cash_mxn,
        'sales_card_mxn', v_sales_card_mxn,
        'sales_projection_mxn', v_sales_projection_mxn,
        'sales_target_mxn', v_sales_target_mxn,
        'expenses_fixed_mxn', v_expenses_fixed_mxn,
        'expenses_variable_mxn', v_expenses_variable_mxn,
        'expenses_other_mxn', v_expenses_other_mxn,
        'expenses_total_mxn', v_expenses_total_mxn,
        'fixed_plan_mxn', v_fixed_plan_mxn,
        'fixed_covered_mxn', v_fixed_covered_mxn,
        'fixed_pending_mxn', v_fixed_pending_mxn,
        'pnl', json_build_object(
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) FIX: finance_daily_series
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.finance_daily_series(DATE);
CREATE OR REPLACE FUNCTION public.finance_daily_series(p_month_start DATE)
RETURNS TABLE (
    day TEXT,
    sales_mxn NUMERIC,
    expenses_mxn NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_month_end DATE;
BEGIN
    v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            p_month_start::TIMESTAMP,
            v_month_end::TIMESTAMP,
            '1 day'::INTERVAL
        )::DATE AS date
    ),
    daily_sales AS (
        SELECT
            (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS date,
            COALESCE(SUM(total), 0) AS sales
        FROM public.sales
        WHERE (created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN p_month_start AND v_month_end
        GROUP BY (created_at AT TIME ZONE 'America/Mexico_City')::DATE
    ),
    daily_expenses AS (
        SELECT
            expense_date AS date,
            COALESCE(SUM(amount_mxn), 0) AS expenses
        FROM public.expenses
        WHERE expense_date BETWEEN p_month_start AND v_month_end
        GROUP BY expense_date
    )
    SELECT
        TO_CHAR(ds.date, 'DD') AS day,
        COALESCE(s.sales, 0)   AS sales_mxn,
        COALESCE(e.expenses, 0) AS expenses_mxn
    FROM date_series ds
    LEFT JOIN daily_sales s   ON ds.date = s.date
    LEFT JOIN daily_expenses e ON ds.date = e.date
    ORDER BY ds.date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) NEW: finance_daily_breakdown
--    Detailed daily sales breakdown for a given month
--    Used by the "Historial Diario" modal
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.finance_daily_breakdown(DATE);
CREATE OR REPLACE FUNCTION public.finance_daily_breakdown(p_month_start DATE)
RETURNS TABLE (
    sale_date     DATE,
    total_sales   NUMERIC,
    cash_sales    NUMERIC,
    card_sales    NUMERIC,
    mixed_count   BIGINT,
    ticket_count  BIGINT,
    avg_ticket    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_month_end DATE;
BEGIN
    v_month_end := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            p_month_start::TIMESTAMP,
            LEAST(CURRENT_DATE, v_month_end)::TIMESTAMP,
            '1 day'::INTERVAL
        )::DATE AS date
    ),
    daily AS (
        SELECT
            (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
            COALESCE(SUM(s.total), 0)        AS total_sales,
            COALESCE(SUM(s.cash_amount), 0)  AS cash_sales,
            COALESCE(SUM(s.card_amount), 0)  AS card_sales,
            COUNT(*) FILTER (WHERE UPPER(s.payment_method::TEXT) = 'MIXED') AS mixed_count,
            COUNT(*)                          AS ticket_count
        FROM public.sales s
        WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN p_month_start AND LEAST(CURRENT_DATE, v_month_end)
        GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    )
    SELECT
        ds.date                         AS sale_date,
        COALESCE(dy.total_sales, 0)     AS total_sales,
        COALESCE(dy.cash_sales, 0)      AS cash_sales,
        COALESCE(dy.card_sales, 0)      AS card_sales,
        COALESCE(dy.mixed_count, 0)     AS mixed_count,
        COALESCE(dy.ticket_count, 0)    AS ticket_count,
        CASE WHEN COALESCE(dy.ticket_count, 0) > 0
             THEN ROUND(dy.total_sales / dy.ticket_count, 2)
             ELSE 0
        END                             AS avg_ticket
    FROM date_series ds
    LEFT JOIN daily dy ON ds.date = dy.d
    ORDER BY ds.date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) NEW: finance_calendar_with_yoy
--    Monthly calendar with year-over-year comparison
--    Used by the interactive calendar widget
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.finance_calendar_with_yoy(DATE);
CREATE OR REPLACE FUNCTION public.finance_calendar_with_yoy(p_month_start DATE)
RETURNS TABLE (
    sale_date         DATE,
    total_sales       NUMERIC,
    cash_sales        NUMERIC,
    card_sales        NUMERIC,
    ticket_count      BIGINT,
    avg_ticket        NUMERIC,
    prev_year_sales   NUMERIC,
    yoy_diff_abs      NUMERIC,
    yoy_diff_pct      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_month_end      DATE;
    v_prev_month_start DATE;
    v_prev_month_end   DATE;
BEGIN
    v_month_end        := (p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_prev_month_start := (p_month_start - INTERVAL '1 year')::DATE;
    v_prev_month_end   := (v_prev_month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            p_month_start::TIMESTAMP,
            v_month_end::TIMESTAMP,
            '1 day'::INTERVAL
        )::DATE AS date
    ),
    -- Current year daily sales
    current_daily AS (
        SELECT
            (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
            COALESCE(SUM(s.total), 0)       AS total_sales,
            COALESCE(SUM(s.cash_amount), 0) AS cash_sales,
            COALESCE(SUM(s.card_amount), 0) AS card_sales,
            COUNT(*)                         AS ticket_count
        FROM public.sales s
        WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN p_month_start AND v_month_end
        GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    ),
    -- Previous year daily sales (same month, 1 year back)
    prev_daily AS (
        SELECT
            (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
            COALESCE(SUM(s.total), 0) AS total_sales
        FROM public.sales s
        WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN v_prev_month_start AND v_prev_month_end
        GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    )
    SELECT
        ds.date                                           AS sale_date,
        COALESCE(c.total_sales, 0)                        AS total_sales,
        COALESCE(c.cash_sales, 0)                         AS cash_sales,
        COALESCE(c.card_sales, 0)                         AS card_sales,
        COALESCE(c.ticket_count, 0)                       AS ticket_count,
        CASE WHEN COALESCE(c.ticket_count, 0) > 0
             THEN ROUND(c.total_sales / c.ticket_count, 2)
             ELSE 0
        END                                               AS avg_ticket,
        -- Match by day-of-month to compare same calendar day
        COALESCE(p.total_sales, 0)                        AS prev_year_sales,
        COALESCE(c.total_sales, 0) - COALESCE(p.total_sales, 0) AS yoy_diff_abs,
        CASE WHEN COALESCE(p.total_sales, 0) > 0
             THEN ROUND(
                ((COALESCE(c.total_sales, 0) - p.total_sales) / p.total_sales) * 100, 2
             )
             ELSE NULL
        END                                               AS yoy_diff_pct
    FROM date_series ds
    LEFT JOIN current_daily c ON ds.date = c.d
    LEFT JOIN prev_daily    p ON EXTRACT(DAY FROM ds.date) = EXTRACT(DAY FROM p.d)
    ORDER BY ds.date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.finance_month_summary(DATE)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_daily_series(DATE)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_daily_breakdown(DATE)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_calendar_with_yoy(DATE)  TO authenticated;
