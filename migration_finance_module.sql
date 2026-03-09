-- Migration: Finance Module Tables and RPCs
-- Created: 2026-02-24

-- ============================================
-- TABLES
-- ============================================

-- Expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_date DATE NOT NULL,
    amount_mxn NUMERIC(10, 2) NOT NULL CHECK (amount_mxn >= 0),
    type TEXT NOT NULL CHECK (type IN ('FIXED', 'VARIABLE', 'OTHER')),
    category TEXT,
    vendor TEXT,
    has_invoice BOOLEAN DEFAULT FALSE,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'TRANSFER', 'OTHER')),
    notes TEXT,
    fixed_cost_id UUID REFERENCES public.fixed_costs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fixed costs table
CREATE TABLE IF NOT EXISTS public.fixed_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    amount_mxn NUMERIC(10, 2) NOT NULL CHECK (amount_mxn >= 0),
    active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly targets table
CREATE TABLE IF NOT EXISTS public.monthly_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    month_start DATE NOT NULL UNIQUE,
    sales_target_mxn NUMERIC(10, 2) NOT NULL CHECK (sales_target_mxn >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expense documents table
CREATE TABLE IF NOT EXISTS public.expense_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    mime_type TEXT,
    storage_path TEXT NOT NULL,
    file_size BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON public.expenses(type);
CREATE INDEX IF NOT EXISTS idx_expense_documents_expense_id ON public.expense_documents(expense_id);
CREATE INDEX IF NOT EXISTS idx_monthly_targets_month ON public.monthly_targets(month_start DESC);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_documents ENABLE ROW LEVEL SECURITY;

-- Expenses policies
CREATE POLICY "Expenses viewable by authenticated users" ON public.expenses
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Expenses insertable by authenticated users" ON public.expenses
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Expenses updatable by authenticated users" ON public.expenses
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Expenses deletable by authenticated users" ON public.expenses
    FOR DELETE TO authenticated USING (true);

-- Fixed costs policies
CREATE POLICY "Fixed costs viewable by authenticated users" ON public.fixed_costs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Fixed costs insertable by authenticated users" ON public.fixed_costs
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Fixed costs updatable by authenticated users" ON public.fixed_costs
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Fixed costs deletable by authenticated users" ON public.fixed_costs
    FOR DELETE TO authenticated USING (true);

-- Monthly targets policies
CREATE POLICY "Monthly targets viewable by authenticated users" ON public.monthly_targets
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Monthly targets insertable by authenticated users" ON public.monthly_targets
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Monthly targets updatable by authenticated users" ON public.monthly_targets
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Monthly targets deletable by authenticated users" ON public.monthly_targets
    FOR DELETE TO authenticated USING (true);

-- Expense documents policies
CREATE POLICY "Expense documents viewable by authenticated users" ON public.expense_documents
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Expense documents insertable by authenticated users" ON public.expense_documents
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Expense documents deletable by authenticated users" ON public.expense_documents
    FOR DELETE TO authenticated USING (true);

-- ============================================
-- RPC FUNCTIONS
-- ============================================

-- Function: finance_month_summary
-- Returns summary statistics for a given month (Opción B: solo pagado)
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

    -- Sales MTD (Month to Date)
    SELECT COALESCE(SUM(total), 0) INTO v_sales_mtd_mxn
    FROM public.sales
    WHERE created_at::DATE BETWEEN p_month_start AND LEAST(CURRENT_DATE, v_month_end);

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

    -- Expenses: Fixed (paid) - type = 'Fijo'
    -- If status column exists, filter by status = 'Pagado'
    -- Otherwise, count all fixed expenses in the month
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_fixed_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
    AND type = 'Fijo';
    -- Note: If you add a status column later, add: AND status = 'Pagado'

    -- Expenses: Variable - type = 'Variable'
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_variable_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
    AND type = 'Variable';

    -- Expenses: Other - type = 'Otro' (or anything else)
    SELECT COALESCE(SUM(amount_mxn), 0) INTO v_expenses_other_mxn
    FROM public.expenses
    WHERE expense_date BETWEEN p_month_start AND v_month_end
    AND type NOT IN ('Fijo', 'Variable');

    -- Total expenses (sum of all types)
    v_expenses_total_mxn := v_expenses_fixed_mxn + v_expenses_variable_mxn + v_expenses_other_mxn;

    -- Fixed covered: only what's been paid
    v_fixed_covered_mxn := v_expenses_fixed_mxn;

    -- Fixed pending: plan minus what's been paid (Opción B)
    v_fixed_pending_mxn := GREATEST(v_fixed_plan_mxn - v_expenses_fixed_mxn, 0);

    -- Build JSON result with PNL breakdown
    v_result := json_build_object(
        'sales_mtd_mxn', v_sales_mtd_mxn,
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

-- Function: finance_daily_series
-- Returns daily sales and expenses for a given month
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
            created_at::DATE AS date,
            COALESCE(SUM(total), 0) AS sales
        FROM public.sales
        WHERE created_at::DATE BETWEEN p_month_start AND v_month_end
        GROUP BY created_at::DATE
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
        COALESCE(s.sales, 0) AS sales_mxn,
        COALESCE(e.expenses, 0) AS expenses_mxn
    FROM date_series ds
    LEFT JOIN daily_sales s ON ds.date = s.date
    LEFT JOIN daily_expenses e ON ds.date = e.date
    ORDER BY ds.date;
END;
$$;

-- ============================================
-- STORAGE BUCKET (Execute in Supabase Dashboard)
-- ============================================

-- Create bucket 'expense-documents' (private)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('expense-documents', 'expense-documents', false)
-- ON CONFLICT DO NOTHING;

-- Storage policies for expense-documents bucket
-- CREATE POLICY "Authenticated users can upload expense documents"
-- ON storage.objects FOR INSERT TO authenticated
-- WITH CHECK (bucket_id = 'expense-documents');

-- CREATE POLICY "Authenticated users can view expense documents"
-- ON storage.objects FOR SELECT TO authenticated
-- USING (bucket_id = 'expense-documents');

-- CREATE POLICY "Authenticated users can delete expense documents"
-- ON storage.objects FOR DELETE TO authenticated
-- USING (bucket_id = 'expense-documents');

-- ============================================
-- GRANTS
-- ============================================

GRANT ALL ON public.expenses TO authenticated;
GRANT ALL ON public.fixed_costs TO authenticated;
GRANT ALL ON public.monthly_targets TO authenticated;
GRANT ALL ON public.expense_documents TO authenticated;

GRANT EXECUTE ON FUNCTION public.finance_month_summary(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_daily_series(DATE) TO authenticated;
