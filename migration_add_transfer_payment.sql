-- ============================================================================
-- Migration: Add TRANSFER payment method + fix finance breakdown
-- ============================================================================
-- This migration:
--   1. Adds 'transfer' to the payment_method enum (if not already present)
--   2. Adds transfer_amount column to sales table
--   3. Back-fills transfer_amount for any existing TRANSFER rows
--   4. Recreates finance_month_summary with 3-way split (cash / card / transfer)
--      using the DERIVED approach: cash = total − card − transfer
--   5. Recreates finance_daily_breakdown with transfer_sales column
--   6. Recreates finance_calendar_with_yoy with transfer_sales column
--   7. Updates the cash register views/RPCs so TRANSFER sales don't inflate
--      cash or card totals (transfers are outside the physical register)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Add 'transfer' to the payment_method enum IF it doesn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Check if 'transfer' already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'payment_method'::regtype
      AND enumlabel = 'transfer'
  ) THEN
    ALTER TYPE payment_method ADD VALUE 'transfer';
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Add transfer_amount column to sales (if not exists)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC DEFAULT 0;

-- Back-fill: any existing TRANSFER sales should have transfer_amount = total
UPDATE public.sales
   SET transfer_amount = total
 WHERE UPPER(payment_method::TEXT) = 'TRANSFER'
   AND (transfer_amount IS NULL OR transfer_amount = 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) FIX: finance_month_summary — 3-way split (cash / card / transfer)
--    cash is DERIVED as total − card − transfer to guarantee identity
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
    v_sales_transfer_mxn NUMERIC;
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
    -- Sales MTD — timezone Mexico, 3-way split
    -- card_amount is always correct (exact terminal charge)
    -- transfer_amount is always correct (exact transfer amount)
    -- cash is DERIVED = total − card − transfer  (guarantees identity)
    -- ══════════════════════════════════════════════════════════════════
    SELECT
        COALESCE(SUM(total), 0),
        COALESCE(SUM(card_amount), 0),
        COALESCE(SUM(transfer_amount), 0)
    INTO v_sales_mtd_mxn, v_sales_card_mxn, v_sales_transfer_mxn
    FROM public.sales
    WHERE (created_at AT TIME ZONE 'America/Mexico_City')::DATE
          BETWEEN p_month_start AND LEAST(CURRENT_DATE, v_month_end);

    -- Derive cash = total - card - transfer (always exact)
    v_sales_cash_mxn := v_sales_mtd_mxn - v_sales_card_mxn - v_sales_transfer_mxn;

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
    -- Expenses — cast enum type::TEXT for comparison
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

    -- Expenses: Other
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_other_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
      AND type::TEXT NOT IN ('FIXED', 'VARIABLE');

    -- Total expenses
    v_expenses_total_mxn := v_expenses_fixed_mxn + v_expenses_variable_mxn + v_expenses_other_mxn;

    -- Fixed covered / pending
    v_fixed_covered_mxn := v_expenses_fixed_mxn;
    v_fixed_pending_mxn := GREATEST(v_fixed_plan_mxn - v_expenses_fixed_mxn, 0);

    -- Build JSON result
    v_result := json_build_object(
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
-- 4) FIX: finance_daily_series (unchanged except timezone)
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
-- 5) FIX: finance_daily_breakdown — add transfer_sales column
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.finance_daily_breakdown(DATE);
CREATE OR REPLACE FUNCTION public.finance_daily_breakdown(p_month_start DATE)
RETURNS TABLE (
    sale_date       DATE,
    total_sales     NUMERIC,
    cash_sales      NUMERIC,
    card_sales      NUMERIC,
    transfer_sales  NUMERIC,
    mixed_count     BIGINT,
    ticket_count    BIGINT,
    avg_ticket      NUMERIC
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
            COALESCE(SUM(s.total), 0)             AS total_sales,
            COALESCE(SUM(s.card_amount), 0)       AS card_sales,
            COALESCE(SUM(s.transfer_amount), 0)   AS transfer_sales,
            COUNT(*) FILTER (WHERE UPPER(s.payment_method::TEXT) = 'MIXED') AS mixed_count,
            COUNT(*)                               AS ticket_count
        FROM public.sales s
        WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN p_month_start AND LEAST(CURRENT_DATE, v_month_end)
        GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    )
    SELECT
        ds.date                                                         AS sale_date,
        COALESCE(dy.total_sales, 0)                                     AS total_sales,
        COALESCE(dy.total_sales, 0) - COALESCE(dy.card_sales, 0) - COALESCE(dy.transfer_sales, 0) AS cash_sales,
        COALESCE(dy.card_sales, 0)                                      AS card_sales,
        COALESCE(dy.transfer_sales, 0)                                  AS transfer_sales,
        COALESCE(dy.mixed_count, 0)                                     AS mixed_count,
        COALESCE(dy.ticket_count, 0)                                    AS ticket_count,
        CASE WHEN COALESCE(dy.ticket_count, 0) > 0
             THEN ROUND(dy.total_sales / dy.ticket_count, 2)
             ELSE 0
        END                                                             AS avg_ticket
    FROM date_series ds
    LEFT JOIN daily dy ON ds.date = dy.d
    ORDER BY ds.date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) FIX: finance_calendar_with_yoy — add transfer_sales column
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.finance_calendar_with_yoy(DATE);
CREATE OR REPLACE FUNCTION public.finance_calendar_with_yoy(p_month_start DATE)
RETURNS TABLE (
    sale_date         DATE,
    total_sales       NUMERIC,
    cash_sales        NUMERIC,
    card_sales        NUMERIC,
    transfer_sales    NUMERIC,
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
    v_month_end        DATE;
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
    current_daily AS (
        SELECT
            (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
            COALESCE(SUM(s.total), 0)             AS total_sales,
            COALESCE(SUM(s.card_amount), 0)       AS card_sales,
            COALESCE(SUM(s.transfer_amount), 0)   AS transfer_sales,
            COUNT(*)                               AS ticket_count
        FROM public.sales s
        WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
              BETWEEN p_month_start AND v_month_end
        GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    ),
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
        ds.date                                                             AS sale_date,
        COALESCE(c.total_sales, 0)                                          AS total_sales,
        COALESCE(c.total_sales, 0) - COALESCE(c.card_sales, 0) - COALESCE(c.transfer_sales, 0) AS cash_sales,
        COALESCE(c.card_sales, 0)                                           AS card_sales,
        COALESCE(c.transfer_sales, 0)                                       AS transfer_sales,
        COALESCE(c.ticket_count, 0)                                         AS ticket_count,
        CASE WHEN COALESCE(c.ticket_count, 0) > 0
             THEN ROUND(c.total_sales / c.ticket_count, 2)
             ELSE 0
        END                                                                 AS avg_ticket,
        COALESCE(p.total_sales, 0)                                          AS prev_year_sales,
        COALESCE(c.total_sales, 0) - COALESCE(p.total_sales, 0)            AS yoy_diff_abs,
        CASE WHEN COALESCE(p.total_sales, 0) > 0
             THEN ROUND(
                ((COALESCE(c.total_sales, 0) - p.total_sales) / p.total_sales) * 100, 2
             )
             ELSE NULL
        END                                                                 AS yoy_diff_pct
    FROM date_series ds
    LEFT JOIN current_daily c ON ds.date = c.d
    LEFT JOIN prev_daily    p ON EXTRACT(DAY FROM ds.date) = EXTRACT(DAY FROM p.d)
    ORDER BY ds.date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) UPDATE cash register views — TRANSFER must NOT inflate cash/card
--    Transfer sales don't go through the physical register at all.
-- ─────────────────────────────────────────────────────────────────────────────

-- 7a) Sessions summary view
CREATE OR REPLACE VIEW public.v_cash_register_sessions_summary AS
SELECT
  s.id                     AS session_id,
  s.status,
  s.opened_at,
  s.closed_at,
  s.opening_cash,
  s.opened_by,
  s.closed_by,
  s.notes,
  s.close_notes,

  COALESCE(cash_agg.cash_total, 0)   AS calculated_cash_sales,
  COALESCE(cash_agg.card_total, 0)   AS calculated_card_sales,
  COALESCE(wd_agg.wd_total, 0)       AS calculated_withdrawals_total,

  COALESCE(cash_agg.cash_total, 0)
    + COALESCE(cash_agg.card_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS calculated_expected_cash_on_hand,

  CASE
    WHEN s.counted_cash IS NOT NULL THEN
      s.counted_cash
        - (COALESCE(cash_agg.cash_total, 0)
           + COALESCE(cash_agg.card_total, 0)
           - COALESCE(wd_agg.wd_total, 0))
    ELSE NULL
  END AS calculated_cash_difference,

  COALESCE(cash_agg.sales_count, 0)  AS sales_count,
  COALESCE(wd_agg.wd_count, 0)       AS withdrawals_count,

  -- Legacy aliases
  COALESCE(cash_agg.cash_total, 0)   AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0)   AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)       AS withdrawals_total,
  COALESCE(cash_agg.cash_total, 0)
    + COALESCE(cash_agg.card_total, 0)
    - COALESCE(wd_agg.wd_total, 0)   AS expected_cash,
  s.counted_cash,
  s.difference

FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    -- TRANSFER excluded: it doesn't touch the physical register
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.cash_amount, CASE WHEN UPPER(sa.payment_method::TEXT) IN ('CASH','MIXED') THEN sa.total ELSE 0 END)
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.card_amount, CASE WHEN UPPER(sa.payment_method::TEXT) = 'CARD' THEN sa.total ELSE 0 END)
    END) AS card_total,
    COUNT(*)::int AS sales_count
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT
    SUM(w.amount) AS wd_total,
    COUNT(*)::int AS wd_count
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

ORDER BY s.opened_at DESC;


-- 7b) Open session status view
CREATE OR REPLACE VIEW public.v_open_cash_register_status AS
SELECT
  s.id                     AS session_id,
  s.opening_cash,
  COALESCE(cash_agg.cash_total, 0) AS cash_sales_total,
  COALESCE(cash_agg.card_total, 0) AS card_sales_total,
  COALESCE(wd_agg.wd_total, 0)    AS withdrawals_total,
  s.opening_cash
    + COALESCE(cash_agg.cash_total, 0)
    - COALESCE(wd_agg.wd_total, 0) AS current_cash,
  (s.opening_cash + COALESCE(cash_agg.cash_total, 0) - COALESCE(wd_agg.wd_total, 0)) > 5000
    AS needs_withdrawal,
  s.opened_at,
  s.opened_by,
  s.notes
FROM public.cash_register_sessions s

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.cash_amount, CASE WHEN UPPER(sa.payment_method::TEXT) IN ('CASH','MIXED') THEN sa.total ELSE 0 END)
    END) AS cash_total,
    SUM(CASE
      WHEN UPPER(sa.payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(sa.card_amount, CASE WHEN UPPER(sa.payment_method::TEXT) = 'CARD' THEN sa.total ELSE 0 END)
    END) AS card_total
  FROM public.sales sa
  WHERE sa.cash_session_id = s.id
) cash_agg ON TRUE

LEFT JOIN LATERAL (
  SELECT SUM(w.amount) AS wd_total
  FROM public.cash_withdrawals w
  WHERE w.session_id = s.id
) wd_agg ON TRUE

WHERE s.closed_at IS NULL
ORDER BY s.opened_at DESC
LIMIT 1;


-- 7c) Close session RPC — TRANSFER excluded from expected cash
CREATE OR REPLACE FUNCTION public.close_cash_register_session(
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_closed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_cash_sales   NUMERIC;
  v_card_sales   NUMERIC;
  v_withdrawals  NUMERIC;
  v_expected     NUMERIC;
  v_difference   NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(cash_amount, CASE WHEN UPPER(payment_method::TEXT) IN ('CASH','MIXED') THEN total ELSE 0 END)
    END), 0),
    COALESCE(SUM(CASE
      WHEN UPPER(payment_method::TEXT) = 'TRANSFER' THEN 0
      ELSE COALESCE(card_amount, CASE WHEN UPPER(payment_method::TEXT) = 'CARD' THEN total ELSE 0 END)
    END), 0)
    INTO v_cash_sales, v_card_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  v_expected   := v_cash_sales + v_card_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  UPDATE public.cash_register_sessions
     SET status       = 'closed',
         closed_at    = NOW(),
         closed_by    = p_closed_by,
         counted_cash = p_counted_cash,
         expected_cash = v_expected,
         difference   = v_difference,
         close_notes  = p_notes
   WHERE id = p_session_id
     AND closed_at IS NULL;

  RETURN json_build_object(
    'expected_cash', v_expected,
    'counted_cash',  p_counted_cash,
    'difference',    v_difference
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.finance_month_summary(DATE)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_daily_series(DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_daily_breakdown(DATE)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_calendar_with_yoy(DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register_session(UUID, NUMERIC, UUID, TEXT) TO authenticated;
