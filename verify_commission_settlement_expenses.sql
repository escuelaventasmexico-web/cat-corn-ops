-- Read-only verification for the commission settlement -> expense integration.
-- Run only after migration_commission_settlement_expenses.sql has been applied.
-- Returns exactly one row containing one JSONB object.

WITH paid_settlements AS (
  SELECT
    cs.id,
    cs.folio,
    cs.status::TEXT AS status,
    cs.total_amount,
    cs.payment_method::TEXT AS payment_method,
    cs.paid_at,
    CASE
      WHEN cs.paid_at IS NOT NULL
        THEN (cs.paid_at AT TIME ZONE 'America/Mexico_City')::DATE
    END AS expected_expense_date,
    CASE LOWER(cs.payment_method::TEXT)
      WHEN 'cash' THEN 'CASH'
      WHEN 'transfer' THEN 'TRANSFER'
    END AS expected_payment_method
  FROM public.commission_settlements AS cs
  WHERE cs.status::TEXT = 'paid'
),
paid_without_expense AS (
  SELECT
    ps.id AS settlement_id,
    ps.folio,
    ps.total_amount,
    ps.payment_method,
    ps.paid_at
  FROM paid_settlements AS ps
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expenses AS e
    WHERE e.commission_settlement_id = ps.id
  )
),
duplicate_expenses AS (
  SELECT
    e.commission_settlement_id AS settlement_id,
    COUNT(*) AS expense_count,
    ARRAY_AGG(e.id ORDER BY e.id) AS expense_ids
  FROM public.expenses AS e
  WHERE e.commission_settlement_id IS NOT NULL
  GROUP BY e.commission_settlement_id
  HAVING COUNT(*) > 1
),
amount_mismatches AS (
  SELECT
    ps.id AS settlement_id,
    ps.folio,
    ps.total_amount AS settlement_amount,
    e.id AS expense_id,
    e.amount_mxn AS expense_amount
  FROM paid_settlements AS ps
  JOIN public.expenses AS e
    ON e.commission_settlement_id = ps.id
  WHERE e.amount_mxn IS DISTINCT FROM ps.total_amount
),
date_mismatches AS (
  SELECT
    ps.id AS settlement_id,
    ps.folio,
    ps.paid_at,
    ps.expected_expense_date,
    e.id AS expense_id,
    e.expense_date
  FROM paid_settlements AS ps
  JOIN public.expenses AS e
    ON e.commission_settlement_id = ps.id
  WHERE e.expense_date IS DISTINCT FROM ps.expected_expense_date
),
payment_method_mismatches AS (
  SELECT
    ps.id AS settlement_id,
    ps.folio,
    ps.payment_method AS settlement_payment_method,
    ps.expected_payment_method,
    e.id AS expense_id,
    e.payment_method::TEXT AS expense_payment_method
  FROM paid_settlements AS ps
  JOIN public.expenses AS e
    ON e.commission_settlement_id = ps.id
  WHERE e.payment_method::TEXT IS DISTINCT FROM ps.expected_payment_method
),
expenses_linked_to_non_paid AS (
  SELECT
    e.id AS expense_id,
    e.commission_settlement_id AS settlement_id,
    cs.folio,
    cs.status::TEXT AS settlement_status,
    e.amount_mxn,
    e.expense_date
  FROM public.expenses AS e
  LEFT JOIN public.commission_settlements AS cs
    ON cs.id = e.commission_settlement_id
  WHERE e.commission_settlement_id IS NOT NULL
    AND cs.status::TEXT IS DISTINCT FROM 'paid'
),
target_folio AS (
  SELECT
    cs.id AS settlement_id,
    cs.folio,
    cs.status::TEXT AS settlement_status,
    cs.total_amount AS settlement_amount,
    cs.payment_method::TEXT AS settlement_payment_method,
    cs.paid_at,
    e.id AS expense_id,
    e.expense_date,
    e.amount_mxn AS expense_amount,
    e.type::TEXT AS expense_type,
    e.category,
    e.vendor,
    e.has_invoice,
    e.payment_method::TEXT AS expense_payment_method,
    e.created_by
  FROM public.commission_settlements AS cs
  LEFT JOIN public.expenses AS e
    ON e.commission_settlement_id = cs.id
  WHERE cs.folio = 'COM-202608-00002'
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed',
    (SELECT COUNT(*) = 0 FROM paid_without_expense)
    AND (SELECT COUNT(*) = 0 FROM duplicate_expenses)
    AND (SELECT COUNT(*) = 0 FROM amount_mismatches)
    AND (SELECT COUNT(*) = 0 FROM date_mismatches)
    AND (SELECT COUNT(*) = 0 FROM payment_method_mismatches)
    AND (SELECT COUNT(*) = 0 FROM expenses_linked_to_non_paid)
    AND (SELECT COUNT(*) = 1 FROM target_folio WHERE expense_id IS NOT NULL),
  'summary', JSONB_BUILD_OBJECT(
    'paid_settlements_without_expense', (SELECT COUNT(*) FROM paid_without_expense),
    'settlements_with_multiple_expenses', (SELECT COUNT(*) FROM duplicate_expenses),
    'amount_mismatches', (SELECT COUNT(*) FROM amount_mismatches),
    'local_date_mismatches', (SELECT COUNT(*) FROM date_mismatches),
    'payment_method_mismatches', (SELECT COUNT(*) FROM payment_method_mismatches),
    'expenses_linked_to_non_paid', (SELECT COUNT(*) FROM expenses_linked_to_non_paid),
    'target_folio_expenses', (SELECT COUNT(*) FROM target_folio WHERE expense_id IS NOT NULL)
  ),
  'checks', JSONB_BUILD_OBJECT(
    'paid_settlements_without_expense', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM paid_without_expense AS x),
      '[]'::JSONB
    ),
    'settlements_with_multiple_expenses', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM duplicate_expenses AS x),
      '[]'::JSONB
    ),
    'amount_mismatches', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM amount_mismatches AS x),
      '[]'::JSONB
    ),
    'local_date_mismatches', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM date_mismatches AS x),
      '[]'::JSONB
    ),
    'payment_method_mismatches', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM payment_method_mismatches AS x),
      '[]'::JSONB
    ),
    'expenses_linked_to_non_paid', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM expenses_linked_to_non_paid AS x),
      '[]'::JSONB
    ),
    'COM-202608-00002', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x)) FROM target_folio AS x),
      '[]'::JSONB
    )
  )
) AS commission_expense_verification;
