-- READ ONLY. Run before the stage-1 available-funds migration.
-- It does not infer whether a historical CARD expense was debit or credit.

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('sales', 'expenses', 'v_b2b_confirmed_payments')
  AND column_name IN (
    'id', 'created_at', 'expense_date', 'amount_mxn', 'total', 'sale_origin',
    'payment_method', 'cash_amount', 'card_amount', 'transfer_amount',
    'platform_amount', 'is_refunded', 'refunded_at', 'business_date', 'amount'
  )
ORDER BY table_name, ordinal_position;

SELECT
  lower(COALESCE(sale_origin, 'pos')) AS sale_origin,
  upper(payment_method::TEXT) AS payment_method,
  COALESCE(is_refunded, false) AS is_refunded,
  COUNT(*) AS movement_count,
  COALESCE(SUM(total), 0) AS amount_mxn,
  MIN(created_at) AS first_created_at,
  MAX(created_at) AS last_created_at
FROM public.sales
WHERE created_at >= TIMESTAMPTZ '2026-11-01 00:00:00 America/Mexico_City'
  AND created_at < TIMESTAMPTZ '2026-12-01 00:00:00 America/Mexico_City'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

SELECT
  expense_date,
  payment_method,
  COUNT(*) AS expense_count,
  COALESCE(SUM(amount_mxn), 0) AS amount_mxn,
  MIN(created_at) AS first_created_at,
  MAX(created_at) AS last_created_at
FROM public.expenses
WHERE expense_date >= DATE '2026-11-01'
  AND expense_date < DATE '2026-12-01'
GROUP BY expense_date, payment_method
ORDER BY expense_date, payment_method;

SELECT
  id,
  expense_date,
  created_at,
  amount_mxn,
  type,
  payment_method,
  concept_code,
  destination_scope,
  vendor,
  notes
FROM public.expenses
WHERE expense_date >= DATE '2026-11-01'
  AND expense_date < DATE '2026-12-01'
ORDER BY expense_date, created_at, id;

SELECT
  source_type,
  payment_method,
  COUNT(*) AS collection_count,
  COALESCE(SUM(amount), 0) AS amount_mxn,
  MIN(business_date) AS first_business_date,
  MAX(business_date) AS last_business_date,
  MIN(created_at) AS first_created_at,
  MAX(created_at) AS last_created_at
FROM public.v_b2b_confirmed_payments
WHERE business_date >= DATE '2026-11-01'
  AND business_date < DATE '2026-12-01'
GROUP BY source_type, payment_method
ORDER BY source_type, payment_method;

SELECT
  COUNT(*) FILTER (WHERE upper(payment_method::TEXT) = 'CARD') AS historical_card_expense_count,
  COALESCE(SUM(amount_mxn) FILTER (WHERE upper(payment_method::TEXT) = 'CARD'), 0) AS historical_card_expense_mxn,
  'Requires human review: legacy CARD does not distinguish debit, credit or Mercado Pago.' AS limitation
FROM public.expenses
WHERE expense_date < DATE '2026-11-01';

SELECT
  lower(COALESCE(sale_origin, 'pos')) AS excluded_channel,
  COUNT(*) AS movement_count,
  COALESCE(SUM(total), 0) AS amount_mxn,
  'Stage 1 reports this channel as a limitation instead of assuming collection timing.' AS limitation
FROM public.sales
WHERE created_at >= TIMESTAMPTZ '2026-11-01 00:00:00 America/Mexico_City'
  AND created_at < TIMESTAMPTZ '2026-12-01 00:00:00 America/Mexico_City'
  AND lower(COALESCE(sale_origin, 'pos')) IN ('order', 'delivery')
GROUP BY 1
ORDER BY 1;

SELECT
  id,
  created_at,
  refunded_at,
  total,
  payment_method,
  sale_origin,
  'Confirm whether and when money actually left the company; a refund flag alone is not a disbursement timestamp.' AS limitation
FROM public.sales
WHERE COALESCE(is_refunded, false)
  AND (
    refunded_at IS NULL
    OR (
      refunded_at >= TIMESTAMPTZ '2026-11-01 00:00:00 America/Mexico_City'
      AND refunded_at < TIMESTAMPTZ '2026-12-01 00:00:00 America/Mexico_City'
    )
  )
ORDER BY created_at, id;
