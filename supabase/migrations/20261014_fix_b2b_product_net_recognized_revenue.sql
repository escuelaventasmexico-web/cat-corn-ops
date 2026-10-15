-- CAT CORN | Correccion del ingreso neto reconocido en reporte Productos B2B.
-- NO cambia movimientos, cobros, inventarios ni registros historicos.
-- Opera sobre la definicion desplegada y aborta si no coincide con el contrato esperado.
-- Importante: amount_due = 0 representa ingreso bruto = 0 para comodato.
BEGIN;

DO $migration$
DECLARE
  v_definition TEXT;
  v_old TEXT[];
  v_new TEXT[];
  v_hits INTEGER;
  v_i INTEGER;
BEGIN
  IF to_regprocedure('public.get_b2b_product_analytics(timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'La RPC public.get_b2b_product_analytics(timestamptz,timestamptz) no existe';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='commercial_partner_movement_items'
         AND column_name='amount_adjusted'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='commercial_partner_movement_items'
         AND column_name='adjusts_movement_item_id'
    ) THEN
    RAISE EXCEPTION 'Faltan columnas de ajustes administrativos; no se aplico la migracion';
  END IF;

  SELECT pg_get_functiondef('public.get_b2b_product_analytics(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;

  -- Evitar declarar exito si la RPC tiene una implementacion parcialmente modificada.
  IF POSITION('approved_adjustment_amount' IN LOWER(v_definition)) > 0 THEN
    IF POSITION('gross_recognized_revenue' IN LOWER(v_definition)) > 0
       AND POSITION('comodato_approved_adjustments' IN LOWER(v_definition)) > 0
       AND POSITION('mf.source_item_id::text' IN LOWER(v_definition)) > 0
       AND POSITION('coalesce(mf.recorded_amount, 0)' IN LOWER(v_definition)) > 0 THEN
      RAISE NOTICE 'La version revisada de la RPC parece estar instalada; no se modifico';
      RETURN;
    ELSE
      RAISE EXCEPTION 'Se detecto una version parcial/diferente de la RPC; detenga la migracion y revise la definicion';
    END IF;
  END IF;

  v_old := ARRAY[
$old1$
  period_sales AS (
    SELECT
      mf.*,
      mf.quantity_sold AS units,
      CASE
        WHEN mf.source_type = 'comodato' AND mf.recorded_amount = 0
          THEN mf.quantity_sold * mf.unit_price
        ELSE mf.recorded_amount
      END AS amount
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    WHERE mf.quantity_sold > 0
$old1$,
$old2$
      SUM(units) AS units_sold,
      SUM(amount) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_revenue
    FROM period_sales
    GROUP BY product_key
$old2$,
$old3$
      COALESCE(sales.units_sold, 0) AS units_sold,
      COALESCE(sales.generated_revenue, 0) AS generated_revenue,
      COALESCE(sales.distinct_partners, 0) AS distinct_partners,
      COALESCE(sales.comodato_units, 0) AS comodato_units,
      COALESCE(sales.comodato_revenue, 0) AS comodato_revenue,
$old3$,
$old4$
      COALESCE(SUM(units), 0) AS units_sold,
      COALESCE(SUM(amount), 0) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
$old4$,
$old5$
      'units_sold', summary.units_sold,
      'generated_revenue', summary.generated_revenue,
      'distinct_partners', summary.distinct_partners,
      'comodato_units', summary.comodato_units,
      'comodato_revenue', summary.comodato_revenue,
$old5$
  ];

  v_new := ARRAY[
$new1$
  period_sales AS (
    SELECT
      mf.*,
      mf.quantity_sold AS units,
      economics.gross_amount,
      economics.approved_adjustment_amount,
      GREATEST(economics.gross_amount - economics.approved_adjustment_amount, 0) AS amount
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    CROSS JOIN LATERAL (
      SELECT
        -- Fuente contable: amount_due. Un importe cero no genera venta ficticia.
        COALESCE(mf.recorded_amount, 0)::NUMERIC AS gross_amount,
        CASE WHEN mf.source_type = 'comodato' THEN COALESCE((
          SELECT SUM(COALESCE(adjustment_item.amount_adjusted, 0))
          FROM public.commercial_partner_movement_items AS adjustment_item
          JOIN public.commercial_partner_movements AS adjustment_movement
            ON adjustment_movement.id = adjustment_item.movement_id
          WHERE adjustment_item.adjusts_movement_item_id::TEXT = mf.source_item_id::TEXT
            AND LOWER(BTRIM(adjustment_movement.movement_type::TEXT)) = 'adjustment'
            AND LOWER(BTRIM(adjustment_movement.status::TEXT)) = 'completed'
        ), 0) ELSE 0 END::NUMERIC AS approved_adjustment_amount
    ) AS economics
    WHERE mf.quantity_sold > 0
$new1$,
$new2$
      SUM(units) AS units_sold,
      SUM(gross_amount) AS gross_recognized_revenue,
      SUM(approved_adjustment_amount) AS approved_adjustments,
      SUM(amount) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(gross_amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_gross_revenue,
      COALESCE(SUM(approved_adjustment_amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_approved_adjustments,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_revenue
    FROM period_sales
    GROUP BY product_key
$new2$,
$new3$
      COALESCE(sales.units_sold, 0) AS units_sold,
      COALESCE(sales.gross_recognized_revenue, 0) AS gross_recognized_revenue,
      COALESCE(sales.approved_adjustments, 0) AS approved_adjustments,
      COALESCE(sales.generated_revenue, 0) AS generated_revenue,
      COALESCE(sales.distinct_partners, 0) AS distinct_partners,
      COALESCE(sales.comodato_units, 0) AS comodato_units,
      COALESCE(sales.comodato_gross_revenue, 0) AS comodato_gross_revenue,
      COALESCE(sales.comodato_approved_adjustments, 0) AS comodato_approved_adjustments,
      COALESCE(sales.comodato_revenue, 0) AS comodato_revenue,
$new3$,
$new4$
      COALESCE(SUM(units), 0) AS units_sold,
      COALESCE(SUM(gross_amount), 0) AS gross_recognized_revenue,
      COALESCE(SUM(approved_adjustment_amount), 0) AS approved_adjustments,
      COALESCE(SUM(amount), 0) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(gross_amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_gross_revenue,
      COALESCE(SUM(approved_adjustment_amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_approved_adjustments,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
$new4$,
$new5$
      'units_sold', summary.units_sold,
      'gross_recognized_revenue', summary.gross_recognized_revenue,
      'approved_adjustments', summary.approved_adjustments,
      'generated_revenue', summary.generated_revenue,
      'distinct_partners', summary.distinct_partners,
      'comodato_units', summary.comodato_units,
      'comodato_gross_revenue', summary.comodato_gross_revenue,
      'comodato_approved_adjustments', summary.comodato_approved_adjustments,
      'comodato_revenue', summary.comodato_revenue,
$new5$
  ];

  -- Prevalidar TODOS los bloques antes de alterar la definicion, sin sustituciones parciales.
  IF array_length(v_old, 1) IS DISTINCT FROM array_length(v_new, 1) THEN
    RAISE EXCEPTION 'Error de preparacion: bloques de reemplazo incompletos';
  END IF;
  FOR v_i IN 1..array_length(v_old, 1) LOOP
    v_hits := (LENGTH(v_definition) - LENGTH(REPLACE(v_definition, v_old[v_i], '')))
              / NULLIF(LENGTH(v_old[v_i]), 0);
    IF v_hits IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'No se aplica migracion: bloque % encontrado % veces. La RPC desplegada difiere de la version revisada.', v_i, v_hits;
    END IF;
  END LOOP;

  FOR v_i IN 1..array_length(v_old, 1) LOOP
    v_definition := REPLACE(v_definition, v_old[v_i], v_new[v_i]);
  END LOOP;

  EXECUTE v_definition;
  RAISE NOTICE 'RPC B2B Productos actualizada conservando su firma y permisos existentes';
END;
$migration$;

COMMENT ON FUNCTION public.get_b2b_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Reporte B2B Productos: ingresos de comodato netos de ajustes completados vinculados al renglon; las unidades fisicas no se alteran. Un amount_due de cero no se convierte en ingreso.';

NOTIFY pgrst, 'reload schema';
COMMIT;
