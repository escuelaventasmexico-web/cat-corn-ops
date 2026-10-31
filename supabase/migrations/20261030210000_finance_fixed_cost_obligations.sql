-- Versioned fixed-cost obligations and obligation-level reconciliation.
-- REVIEWED LOCALLY ONLY. Do not apply automatically: the catalog seed and the
-- finance_month_summary replacement must be installed in this same transaction.

BEGIN;

DO $preflight$
DECLARE
  v_catalog_matches INTEGER;
  v_october_count INTEGER;
  v_october_total NUMERIC;
  v_october_linked INTEGER;
BEGIN
  IF COALESCE(MD5(PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_summary(date)'))), '')
     <> '7a885c282e6dccab0775f51c634bd8d4' THEN
    RAISE EXCEPTION 'finance_month_summary changed after review; stop and export the live definition.';
  END IF;

  SELECT COUNT(*) INTO v_catalog_matches
  FROM public.fixed_costs
  WHERE (id, name, amount_mxn) IN (
    ('46a6d8f9-780e-4f20-b539-1cfc05052881'::UUID, 'Contador', 1000::NUMERIC),
    ('27ed5bd7-d5d5-4ce7-b88e-42be50cecfb8'::UUID, 'INTERNET', 500::NUMERIC),
    ('bab55c5c-c117-41ee-8b66-a7e33da99eab'::UUID, 'LUZ', 1190::NUMERIC),
    ('75321c6e-d834-48be-93e0-d98b35a164a2'::UUID, 'Renta', 6900::NUMERIC)
  );
  IF v_catalog_matches <> 4 OR (SELECT COUNT(*) FROM public.fixed_costs) <> 4 THEN
    RAISE EXCEPTION 'fixed_costs no longer matches the four-row reviewed baseline.';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount_mxn), 0), COUNT(*) FILTER (WHERE fixed_cost_id IS NOT NULL)
  INTO v_october_count, v_october_total, v_october_linked
  FROM public.expenses
  WHERE type::TEXT = 'FIXED'
    AND expense_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';
  IF v_october_count <> 6 OR v_october_total <> 13670 OR v_october_linked <> 0 THEN
    RAISE EXCEPTION 'October FIXED expenses changed: count %, total %, linked %.',
      v_october_count, v_october_total, v_october_linked;
  END IF;
END;
$preflight$;

ALTER TABLE public.fixed_costs
  ALTER COLUMN amount_mxn DROP NOT NULL,
  ADD COLUMN obligation_code TEXT,
  ADD COLUMN scope TEXT,
  ADD COLUMN periodicity TEXT,
  ADD COLUMN payment_interval_months SMALLINT,
  ADD COLUMN monthly_provision_mxn NUMERIC(10, 2),
  ADD COLUMN effective_from DATE,
  ADD COLUMN effective_to DATE,
  ADD COLUMN billing_anchor_month DATE,
  ADD COLUMN configuration_status TEXT;

ALTER TABLE public.fixed_costs
  ADD CONSTRAINT fixed_costs_amount_nonnegative CHECK (amount_mxn IS NULL OR amount_mxn >= 0),
  ADD CONSTRAINT fixed_costs_monthly_provision_nonnegative CHECK (monthly_provision_mxn IS NULL OR monthly_provision_mxn >= 0),
  ADD CONSTRAINT fixed_costs_scope_check CHECK (scope IN ('CHIPITLAN', 'AURRERA', 'SHARED', 'UNASSIGNED')),
  ADD CONSTRAINT fixed_costs_periodicity_check CHECK (periodicity IN ('MONTHLY', 'BIMONTHLY')),
  ADD CONSTRAINT fixed_costs_interval_check CHECK (payment_interval_months IN (1, 2)),
  ADD CONSTRAINT fixed_costs_periodicity_interval_check CHECK (
    (periodicity = 'MONTHLY' AND payment_interval_months = 1)
    OR (periodicity = 'BIMONTHLY' AND payment_interval_months = 2)
  ),
  ADD CONSTRAINT fixed_costs_effective_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  ADD CONSTRAINT fixed_costs_anchor_month_check CHECK (
    billing_anchor_month IS NULL OR billing_anchor_month = DATE_TRUNC('month', billing_anchor_month)::DATE
  ),
  ADD CONSTRAINT fixed_costs_configuration_status_check CHECK (
    configuration_status IN ('READY', 'AMOUNT_PENDING', 'SCHEDULE_PENDING', 'LEGACY')
  ),
  ADD CONSTRAINT fixed_costs_configuration_consistency_check CHECK (
    configuration_status = 'LEGACY'
    OR (
      configuration_status = 'AMOUNT_PENDING'
      AND amount_mxn IS NULL
      AND monthly_provision_mxn IS NULL
    )
    OR (
      configuration_status = 'SCHEDULE_PENDING'
      AND periodicity = 'BIMONTHLY'
      AND amount_mxn IS NOT NULL
      AND monthly_provision_mxn IS NOT NULL
      AND billing_anchor_month IS NULL
    )
    OR (
      configuration_status = 'READY'
      AND amount_mxn IS NOT NULL
      AND monthly_provision_mxn IS NOT NULL
      AND (periodicity = 'MONTHLY' OR billing_anchor_month IS NOT NULL)
    )
  ),
  ADD CONSTRAINT fixed_costs_bimonthly_provision_check CHECK (
    periodicity <> 'BIMONTHLY'
    OR amount_mxn IS NULL
    OR monthly_provision_mxn IS NULL
    OR monthly_provision_mxn * payment_interval_months = amount_mxn
  );

CREATE UNIQUE INDEX fixed_costs_code_version_uidx
  ON public.fixed_costs (obligation_code, effective_from);
CREATE INDEX fixed_costs_effective_period_idx
  ON public.fixed_costs (effective_from, effective_to);

ALTER TABLE public.expenses
  ADD COLUMN is_unbudgeted_fixed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN fixed_cost_unbudgeted_reason TEXT;

ALTER TABLE public.expenses DROP CONSTRAINT expenses_fixed_cost_id_fkey;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_fixed_cost_id_fkey
  FOREIGN KEY (fixed_cost_id) REFERENCES public.fixed_costs(id) ON DELETE RESTRICT;

CREATE INDEX expenses_fixed_cost_date_idx
  ON public.expenses (fixed_cost_id, expense_date) WHERE fixed_cost_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_fixed_expense_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.type::TEXT = 'FIXED' AND NEW.expense_date >= DATE '2026-11-01' THEN
    IF (NEW.fixed_cost_id IS NULL) = (NEW.is_unbudgeted_fixed = FALSE) THEN
      RAISE EXCEPTION 'A fixed expense must select one obligation or be explicitly marked unbudgeted.';
    END IF;
    IF NEW.is_unbudgeted_fixed AND NULLIF(BTRIM(NEW.fixed_cost_unbudgeted_reason), '') IS NULL THEN
      RAISE EXCEPTION 'An unbudgeted fixed expense requires a reason.';
    END IF;
    IF NOT NEW.is_unbudgeted_fixed AND NEW.fixed_cost_unbudgeted_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A linked fixed expense cannot keep an unbudgeted reason.';
    END IF;
  ELSIF NEW.type::TEXT <> 'FIXED' THEN
    IF NEW.fixed_cost_id IS NOT NULL OR NEW.is_unbudgeted_fixed OR NEW.fixed_cost_unbudgeted_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Only FIXED expenses can use a fixed-cost obligation or unbudgeted classification.';
    END IF;
  END IF;

  IF NEW.fixed_cost_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fixed_costs AS cost
    WHERE cost.id = NEW.fixed_cost_id
      AND cost.effective_from <= NEW.expense_date
      AND (cost.effective_to IS NULL OR cost.effective_to >= NEW.expense_date)
  ) THEN
    RAISE EXCEPTION 'The selected fixed-cost obligation is not effective on the expense date.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_fixed_expense_classification_trigger
BEFORE INSERT OR UPDATE OF type, expense_date, fixed_cost_id, is_unbudgeted_fixed, fixed_cost_unbudgeted_reason
ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.enforce_fixed_expense_classification();

CREATE OR REPLACE FUNCTION public.prevent_fixed_cost_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION 'Fixed-cost obligations are historical records. Close effective_to instead of deleting.';
END;
$$;

CREATE TRIGGER prevent_fixed_cost_delete_trigger
BEFORE DELETE ON public.fixed_costs FOR EACH ROW EXECUTE FUNCTION public.prevent_fixed_cost_delete();

UPDATE public.fixed_costs
SET obligation_code = CASE id
      WHEN '46a6d8f9-780e-4f20-b539-1cfc05052881'::UUID THEN 'legacy.contador'
      WHEN '27ed5bd7-d5d5-4ce7-b88e-42be50cecfb8'::UUID THEN 'legacy.internet'
      WHEN 'bab55c5c-c117-41ee-8b66-a7e33da99eab'::UUID THEN 'legacy.luz'
      WHEN '75321c6e-d834-48be-93e0-d98b35a164a2'::UUID THEN 'legacy.renta'
    END,
    scope = 'UNASSIGNED', periodicity = 'MONTHLY', payment_interval_months = 1,
    monthly_provision_mxn = amount_mxn, effective_from = DATE '1900-01-01',
    effective_to = DATE '2026-10-31', billing_anchor_month = NULL,
    configuration_status = 'LEGACY', active = FALSE
WHERE id IN (
  '46a6d8f9-780e-4f20-b539-1cfc05052881'::UUID,
  '27ed5bd7-d5d5-4ce7-b88e-42be50cecfb8'::UUID,
  'bab55c5c-c117-41ee-8b66-a7e33da99eab'::UUID,
  '75321c6e-d834-48be-93e0-d98b35a164a2'::UUID
);

INSERT INTO public.fixed_costs (
  name, amount_mxn, active, notes, obligation_code, scope, periodicity,
  payment_interval_months, monthly_provision_mxn, effective_from, effective_to,
  billing_anchor_month, configuration_status
) VALUES
  ('Renta Aurrera', 5000, TRUE, NULL, 'aurrera.renta', 'AURRERA', 'MONTHLY', 1, 5000, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Mantenimiento del local Aurrera', 1624, TRUE, 'Obligacion independiente de la renta.', 'aurrera.mantenimiento_local', 'AURRERA', 'MONTHLY', 1, 1624, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Internet Aurrera', 500, TRUE, NULL, 'aurrera.internet', 'AURRERA', 'MONTHLY', 1, 500, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Luz Aurrera', NULL, TRUE, 'Importe pendiente de confirmar; no tratar como cero.', 'aurrera.luz', 'AURRERA', 'MONTHLY', 1, NULL, DATE '2026-11-01', NULL, NULL, 'AMOUNT_PENDING'),
  ('Renta Chipitlan', 6964, TRUE, NULL, 'chipitlan.renta', 'CHIPITLAN', 'MONTHLY', 1, 6964, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Internet Chipitlan', 440, TRUE, NULL, 'chipitlan.internet', 'CHIPITLAN', 'MONTHLY', 1, 440, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Luz Chipitlan', 990, TRUE, 'Pago bimestral; provision mensual de $495.', 'chipitlan.luz', 'CHIPITLAN', 'BIMONTHLY', 2, 495, DATE '2026-11-01', NULL, NULL, 'SCHEDULE_PENDING'),
  ('Nomina Angelica', 2500, TRUE, NULL, 'shared.nomina_angelica', 'SHARED', 'MONTHLY', 1, 2500, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Nomina Gerardo', 3500, TRUE, NULL, 'shared.nomina_gerardo', 'SHARED', 'MONTHLY', 1, 3500, DATE '2026-11-01', NULL, NULL, 'READY'),
  ('Contador', 1000, TRUE, NULL, 'shared.contador', 'SHARED', 'MONTHLY', 1, 1000, DATE '2026-11-01', NULL, NULL, 'READY');

-- These fields identify and schedule each version. CHECK constraints alone allow
-- NULL values; enforce their presence after updating legacy rows and seeding November.
ALTER TABLE public.fixed_costs
  ALTER COLUMN obligation_code SET NOT NULL,
  ALTER COLUMN scope SET NOT NULL,
  ALTER COLUMN periodicity SET NOT NULL,
  ALTER COLUMN payment_interval_months SET NOT NULL,
  ALTER COLUMN effective_from SET NOT NULL,
  ALTER COLUMN configuration_status SET NOT NULL;

DO $baseline$
BEGIN
  IF (SELECT COALESCE(SUM(monthly_provision_mxn), 0) FROM public.fixed_costs
      WHERE effective_from = DATE '2026-11-01') <> 22023 THEN
    RAISE EXCEPTION 'Known monthly provision must equal 22023.';
  END IF;
END;
$baseline$;

CREATE OR REPLACE FUNCTION public.prevent_fixed_cost_period_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fixed_costs AS other
    WHERE other.obligation_code = NEW.obligation_code
      AND other.id <> NEW.id
      AND DATERANGE(other.effective_from, COALESCE(other.effective_to, 'infinity'::DATE), '[]')
          && DATERANGE(NEW.effective_from, COALESCE(NEW.effective_to, 'infinity'::DATE), '[]')
  ) THEN
    RAISE EXCEPTION 'Fixed-cost obligation versions cannot overlap.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_fixed_cost_period_overlap_trigger
BEFORE INSERT OR UPDATE OF obligation_code, effective_from, effective_to
ON public.fixed_costs FOR EACH ROW EXECUTE FUNCTION public.prevent_fixed_cost_period_overlap();

CREATE OR REPLACE FUNCTION public.finance_fixed_cost_month_status(p_month_start DATE)
RETURNS TABLE(
  fixed_cost_id UUID, obligation_code TEXT, obligation_name TEXT, obligation_scope TEXT,
  periodicity TEXT, payment_amount_mxn NUMERIC, monthly_provision_mxn NUMERIC,
  amount_known BOOLEAN, schedule_known BOOLEAN, expected_payment_in_month_mxn NUMERIC,
  paid_in_month_mxn NUMERIC, accrued_through_month_mxn NUMERIC,
  paid_through_month_mxn NUMERIC, pending_through_month_mxn NUMERIC,
  credit_through_month_mxn NUMERIC, reconciliation_status TEXT, configuration_status TEXT
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  WITH bounds AS (
    SELECT DATE_TRUNC('month', p_month_start)::DATE AS month_start,
      (DATE_TRUNC('month', p_month_start) + INTERVAL '1 month - 1 day')::DATE AS month_end
  ), applicable AS (
    SELECT cost.*, bounds.month_start, bounds.month_end,
      GREATEST(0, ((EXTRACT(YEAR FROM bounds.month_start)::INTEGER - EXTRACT(YEAR FROM DATE_TRUNC('month', cost.effective_from))::INTEGER) * 12
        + EXTRACT(MONTH FROM bounds.month_start)::INTEGER - EXTRACT(MONTH FROM DATE_TRUNC('month', cost.effective_from))::INTEGER + 1)) AS accrued_months
    FROM public.fixed_costs AS cost CROSS JOIN bounds
    WHERE cost.effective_from <= bounds.month_end
      AND (cost.effective_to IS NULL OR cost.effective_to >= bounds.month_start)
  ), payments AS (
    SELECT applicable.id,
      COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.expense_date BETWEEN applicable.month_start AND applicable.month_end), 0) AS in_month,
      COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.expense_date BETWEEN applicable.effective_from AND applicable.month_end), 0) AS through_month
    FROM applicable LEFT JOIN public.expenses AS expense
      ON expense.fixed_cost_id = applicable.id AND expense.type::TEXT = 'FIXED'
    GROUP BY applicable.id
  )
  SELECT a.id, a.obligation_code, a.name, a.scope, a.periodicity, a.amount_mxn,
    a.monthly_provision_mxn, a.amount_mxn IS NOT NULL,
    a.payment_interval_months = 1 OR a.billing_anchor_month IS NOT NULL,
    CASE WHEN a.amount_mxn IS NULL THEN NULL
      WHEN a.payment_interval_months = 1 THEN a.amount_mxn
      WHEN a.billing_anchor_month IS NULL OR a.month_start < a.billing_anchor_month THEN NULL
      WHEN MOD(((EXTRACT(YEAR FROM a.month_start)::INTEGER - EXTRACT(YEAR FROM a.billing_anchor_month)::INTEGER) * 12
        + EXTRACT(MONTH FROM a.month_start)::INTEGER - EXTRACT(MONTH FROM a.billing_anchor_month)::INTEGER), a.payment_interval_months) = 0
        THEN a.amount_mxn ELSE 0 END,
    CASE WHEN a.month_start < DATE '2026-11-01' THEN NULL ELSE p.in_month END,
    CASE WHEN a.month_start < DATE '2026-11-01' OR a.monthly_provision_mxn IS NULL THEN NULL
      ELSE a.monthly_provision_mxn * a.accrued_months END,
    CASE WHEN a.month_start < DATE '2026-11-01' THEN NULL ELSE p.through_month END,
    CASE WHEN a.month_start < DATE '2026-11-01' OR a.monthly_provision_mxn IS NULL THEN NULL
      ELSE GREATEST(a.monthly_provision_mxn * a.accrued_months - p.through_month, 0) END,
    CASE WHEN a.month_start < DATE '2026-11-01' OR a.monthly_provision_mxn IS NULL THEN NULL
      ELSE GREATEST(p.through_month - a.monthly_provision_mxn * a.accrued_months, 0) END,
    CASE WHEN a.month_start < DATE '2026-11-01' THEN 'LEGACY_UNRECONCILED' ELSE 'BY_OBLIGATION' END,
    a.configuration_status
  FROM applicable AS a JOIN payments AS p ON p.id = a.id
  ORDER BY a.scope, a.name, a.id;
$$;

REVOKE ALL ON FUNCTION public.finance_fixed_cost_month_status(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_fixed_cost_month_status(DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_version_fixed_cost(
  p_fixed_cost_id UUID, p_effective_from DATE, p_name TEXT, p_scope TEXT,
  p_periodicity TEXT, p_amount_mxn NUMERIC, p_monthly_provision_mxn NUMERIC,
  p_billing_anchor_month DATE, p_configuration_status TEXT, p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_previous public.fixed_costs%ROWTYPE;
  v_new_id UUID;
BEGIN
  SELECT * INTO v_previous FROM public.fixed_costs WHERE id = p_fixed_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixed-cost obligation not found.'; END IF;
  IF p_effective_from <= v_previous.effective_from
     OR p_effective_from <> DATE_TRUNC('month', p_effective_from)::DATE THEN
    RAISE EXCEPTION 'A new version must start on a later first day of a month.';
  END IF;
  IF v_previous.effective_to IS NOT NULL AND v_previous.effective_to < p_effective_from THEN
    RAISE EXCEPTION 'This obligation version is already closed.';
  END IF;

  UPDATE public.fixed_costs SET effective_to = p_effective_from - 1, active = FALSE
  WHERE id = p_fixed_cost_id;
  INSERT INTO public.fixed_costs (
    name, amount_mxn, active, notes, obligation_code, scope, periodicity,
    payment_interval_months, monthly_provision_mxn, effective_from, effective_to,
    billing_anchor_month, configuration_status
  ) VALUES (
    p_name, p_amount_mxn, TRUE, p_notes, v_previous.obligation_code, p_scope,
    p_periodicity, CASE WHEN p_periodicity = 'BIMONTHLY' THEN 2 ELSE 1 END,
    p_monthly_provision_mxn, p_effective_from, NULL, p_billing_anchor_month,
    p_configuration_status
  ) RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_version_fixed_cost(UUID, DATE, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_version_fixed_cost(UUID, DATE, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_month_summary(p_month_start DATE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_result JSON; v_month_end DATE;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE;
  v_days_in_month NUMERIC; v_days_elapsed NUMERIC;
  v_sales_mtd_mxn NUMERIC; v_sales_cash_mxn NUMERIC; v_sales_card_mxn NUMERIC;
  v_sales_transfer_mxn NUMERIC; v_sales_projection_mxn NUMERIC; v_sales_target_mxn NUMERIC;
  v_expenses_fixed_mxn NUMERIC; v_expenses_variable_mxn NUMERIC; v_expenses_other_mxn NUMERIC; v_expenses_total_mxn NUMERIC;
  v_fixed_reserved_mxn NUMERIC; v_fixed_due_mxn NUMERIC; v_fixed_linked_registered_mxn NUMERIC;
  v_fixed_unbudgeted_registered_mxn NUMERIC; v_fixed_legacy_unlinked_mxn NUMERIC;
  v_fixed_amount_unknown_count INTEGER; v_fixed_schedule_pending_count INTEGER;
  v_fixed_pending_mxn NUMERIC; v_fixed_obligations JSON; v_reconciliation_status TEXT;
BEGIN
  p_month_start := DATE_TRUNC('month', p_month_start)::DATE;
  v_month_end := (p_month_start + INTERVAL '1 month - 1 day')::DATE;
  v_days_in_month := EXTRACT(DAY FROM v_month_end);
  v_days_elapsed := CASE WHEN v_today < p_month_start THEN 0 ELSE LEAST(v_today, v_month_end) - p_month_start + 1 END;

  SELECT COALESCE(SUM(s.total), 0), COALESCE(SUM(s.card_amount), 0), COALESCE(SUM(s.transfer_amount), 0)
  INTO v_sales_mtd_mxn, v_sales_card_mxn, v_sales_transfer_mxn
  FROM public.sales AS s
  WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE BETWEEN p_month_start AND LEAST(v_today, v_month_end)
    AND s.is_refunded = FALSE;
  v_sales_cash_mxn := v_sales_mtd_mxn - v_sales_card_mxn - v_sales_transfer_mxn;
  v_sales_projection_mxn := CASE WHEN v_days_elapsed > 0 THEN (v_sales_mtd_mxn / v_days_elapsed) * v_days_in_month ELSE 0 END;
  SELECT COALESCE(t.sales_target_mxn, 0) INTO v_sales_target_mxn FROM public.monthly_targets AS t WHERE t.month_start = p_month_start;

  SELECT COALESCE(SUM(e.amount_mxn), 0) INTO v_expenses_fixed_mxn FROM public.expenses e
    WHERE e.expense_date BETWEEN p_month_start AND v_month_end AND e.type::TEXT = 'FIXED';
  SELECT COALESCE(SUM(e.amount_mxn), 0) INTO v_expenses_variable_mxn FROM public.expenses e
    WHERE e.expense_date BETWEEN p_month_start AND v_month_end AND e.type::TEXT = 'VARIABLE';
  SELECT COALESCE(SUM(e.amount_mxn), 0) INTO v_expenses_other_mxn FROM public.expenses e
    WHERE e.expense_date BETWEEN p_month_start AND v_month_end AND e.type::TEXT NOT IN ('FIXED', 'VARIABLE');
  v_expenses_total_mxn := v_expenses_fixed_mxn + v_expenses_variable_mxn + v_expenses_other_mxn;

  SELECT COALESCE(SUM(s.monthly_provision_mxn), 0), COALESCE(SUM(s.expected_payment_in_month_mxn), 0),
    COALESCE(SUM(s.paid_in_month_mxn), 0), COUNT(*) FILTER (WHERE NOT s.amount_known),
    COUNT(*) FILTER (WHERE NOT s.schedule_known),
    CASE WHEN p_month_start < DATE '2026-11-01' THEN NULL ELSE COALESCE(SUM(s.pending_through_month_mxn), 0) END,
    COALESCE(JSON_AGG(TO_JSON(s) ORDER BY s.obligation_scope, s.obligation_name), '[]'::JSON)
  INTO v_fixed_reserved_mxn, v_fixed_due_mxn, v_fixed_linked_registered_mxn,
    v_fixed_amount_unknown_count, v_fixed_schedule_pending_count, v_fixed_pending_mxn, v_fixed_obligations
  FROM public.finance_fixed_cost_month_status(p_month_start) AS s;

  SELECT COALESCE(SUM(e.amount_mxn), 0) INTO v_fixed_unbudgeted_registered_mxn FROM public.expenses e
    WHERE e.expense_date BETWEEN p_month_start AND v_month_end AND e.type::TEXT = 'FIXED' AND e.is_unbudgeted_fixed;
  SELECT COALESCE(SUM(e.amount_mxn), 0) INTO v_fixed_legacy_unlinked_mxn FROM public.expenses e
    WHERE e.expense_date BETWEEN p_month_start AND v_month_end AND e.type::TEXT = 'FIXED'
      AND e.fixed_cost_id IS NULL AND NOT e.is_unbudgeted_fixed;
  v_reconciliation_status := CASE WHEN p_month_start < DATE '2026-11-01' THEN 'LEGACY_UNRECONCILED' ELSE 'BY_OBLIGATION' END;

  v_result := JSON_BUILD_OBJECT(
    'sales_mtd_mxn', v_sales_mtd_mxn, 'sales_cash_mxn', v_sales_cash_mxn,
    'sales_card_mxn', v_sales_card_mxn, 'sales_transfer_mxn', v_sales_transfer_mxn,
    'sales_projection_mxn', v_sales_projection_mxn, 'sales_target_mxn', v_sales_target_mxn,
    'expenses_fixed_mxn', v_expenses_fixed_mxn, 'expenses_variable_mxn', v_expenses_variable_mxn,
    'expenses_other_mxn', v_expenses_other_mxn, 'expenses_total_mxn', v_expenses_total_mxn,
    'fixed_reserved_mxn', v_fixed_reserved_mxn, 'fixed_due_mxn', v_fixed_due_mxn,
    'fixed_registered_mxn', v_expenses_fixed_mxn, 'fixed_linked_registered_mxn', v_fixed_linked_registered_mxn,
    'fixed_unbudgeted_registered_mxn', v_fixed_unbudgeted_registered_mxn,
    'fixed_legacy_unlinked_mxn', v_fixed_legacy_unlinked_mxn,
    'fixed_amount_unknown_count', v_fixed_amount_unknown_count,
    'fixed_schedule_pending_count', v_fixed_schedule_pending_count,
    'fixed_reconciliation_status', v_reconciliation_status, 'fixed_obligations', v_fixed_obligations,
    'fixed_plan_mxn', v_fixed_reserved_mxn,
    'fixed_covered_mxn', CASE WHEN v_reconciliation_status = 'BY_OBLIGATION' THEN v_fixed_linked_registered_mxn ELSE NULL END,
    'fixed_pending_mxn', v_fixed_pending_mxn,
    'pnl', JSON_BUILD_OBJECT('sales_mxn', v_sales_mtd_mxn,
      'cogs_variable_purchases_mxn', v_expenses_variable_mxn,
      'gross_profit_mxn', v_sales_mtd_mxn - v_expenses_variable_mxn,
      'fixed_expenses_mxn', v_expenses_fixed_mxn, 'other_expenses_mxn', v_expenses_other_mxn,
      'net_profit_mxn', v_sales_mtd_mxn - v_expenses_total_mxn)
  );
  RETURN v_result;
END;
$$;

-- Deliberately preserve the deployed RLS policies. Current authenticated write
-- access must be reviewed against real capture roles before it is narrowed.
COMMENT ON COLUMN public.expenses.fixed_cost_id IS
  'Explicit selected obligation; never inferred from amount, vendor, category, or notes.';
COMMENT ON COLUMN public.expenses.is_unbudgeted_fixed IS
  'Explicit exception for a FIXED expense outside the configured budget.';

COMMIT;