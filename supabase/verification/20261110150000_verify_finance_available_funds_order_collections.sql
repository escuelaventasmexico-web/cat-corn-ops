-- Solo lectura. No crea, modifica ni elimina datos o funciones.
WITH function_contract AS (
  SELECT
    pg_get_functiondef('public.finance_month_available_funds_v2(date)'::REGPROCEDURE) AS definition,
    has_function_privilege(
      'authenticated',
      'public.finance_month_available_funds_v2(date)',
      'EXECUTE'
    ) AS authenticated_can_execute
), november_order_sales AS (
  SELECT
    sale.id,
    (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS payment_business_date,
    sale.total,
    upper(sale.payment_method::TEXT) AS payment_method,
    sale.cash_amount,
    sale.card_amount,
    sale.transfer_amount,
    sale.sale_origin,
    sale.promotion_code,
    sale.is_refunded
  FROM public.sales sale
  WHERE lower(COALESCE(sale.sale_origin, '')) = 'order'
    AND (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE >= DATE '2026-11-01'
    AND (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < DATE '2026-12-01'
), real_case AS (
  SELECT
    COUNT(*) FILTER (WHERE payment_business_date = DATE '2026-11-10') AS paid_order_count,
    COALESCE(SUM(total) FILTER (
      WHERE payment_business_date = DATE '2026-11-10'
        AND payment_method IN ('CASH','CARD','TRANSFER','MIXED')), 0) AS paid_order_total,
    COALESCE(SUM(COALESCE(NULLIF(cash_amount, 0), total)) FILTER (
      WHERE payment_business_date = DATE '2026-11-10'
        AND payment_method = 'CASH'), 0) AS cash_total,
    COALESCE(SUM(COALESCE(NULLIF(card_amount, 0), total)) FILTER (
      WHERE payment_business_date = DATE '2026-11-10'
        AND payment_method = 'CARD'), 0) AS card_total,
    COALESCE(SUM(COALESCE(NULLIF(transfer_amount, 0), total)) FILTER (
      WHERE payment_business_date = DATE '2026-11-10'
        AND payment_method = 'TRANSFER'), 0) AS transfer_total,
    COUNT(*) FILTER (
      WHERE payment_business_date = DATE '2026-11-10'
        AND payment_method NOT IN ('CASH','CARD','TRANSFER','MIXED')) AS unreconciled_count,
    COUNT(*) - COUNT(DISTINCT id) AS duplicate_sale_ids
  FROM november_order_sales
), overlap AS (
  SELECT COUNT(*) AS order_rows_also_classified_as_pos
  FROM november_order_sales sale
  WHERE lower(COALESCE(sale.sale_origin, 'pos')) = 'pos'
), checks AS (
  SELECT
    contract.authenticated_can_execute
      AND contract.definition LIKE '%public.finance_month_available_funds(p_month_start)%'
      AND contract.definition LIKE '%lower(COALESCE(sale.sale_origin, '''')) = ''order''%'
      AND contract.definition LIKE '%sale.created_at AT TIME ZONE ''America/Mexico_City''%'
      AND contract.definition LIKE '%order_collections_mxn%'
      AND contract.definition LIKE '%order_collections_by_method%'
      AND contract.definition NOT LIKE '%v_opening_amount%'
      AS structural_checks_passed,
    real.paid_order_count,
    real.paid_order_total,
    real.cash_total,
    real.card_total,
    real.transfer_total,
    real.unreconciled_count,
    real.duplicate_sale_ids,
    overlap.order_rows_also_classified_as_pos,
    round((8036.40 + real.paid_order_total)::NUMERIC, 2) AS reported_case_balance_after_orders,
    real.paid_order_total = 268
      AND real.cash_total = 124
      AND real.card_total = 0
      AND real.transfer_total = 144
      AND real.unreconciled_count = 0
      AND real.duplicate_sale_ids = 0
      AND overlap.order_rows_also_classified_as_pos = 0
      AS real_268_case_passed
  FROM function_contract contract
  CROSS JOIN real_case real
  CROSS JOIN overlap
)
SELECT
  checks.*,
  checks.structural_checks_passed
    AND checks.real_268_case_passed
    AND checks.reported_case_balance_after_orders = 8304.40
    AS all_checks_passed
FROM checks;
