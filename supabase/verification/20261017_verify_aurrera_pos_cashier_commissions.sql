-- CAT CORN | POS AURRERA | VERIFICADOR V3 SOLO LECTURA
-- Ejecutar UNICAMENTE despues de aplicar una migracion POS Aurrera revisada.
-- NOTA: la verificacion estatica no sustituye probar una venta real autorizada.
BEGIN READ ONLY;

WITH expected AS (
  SELECT
    'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::uuid AS aurrera_id,
    'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::uuid AS angelica_id,
    '682568c5-4339-4af5-85ef-71c8b2febd59'::uuid AS gerardo_id
), expected_rates(scheme, product_key, amount) AS (
  VALUES
    ('vendedora_pos'::text, 'michi_clasico'::text, 2::numeric),
    ('vendedora_pos', 'michi_sabores', 2),
    ('vendedora_pos', 'caramelo_michi', 2),
    ('vendedora_pos', 'gato_mayor_clasico', 5),
    ('vendedora_pos', 'gato_mayor_sabores', 5),
    ('vendedora_pos', 'caramelo_gato_mayor', 5),
    ('vendedora_pos', 'jefe_felino_clasico', 10),
    ('vendedora_pos', 'jefe_felino_sabores', 10),
    ('venta_pieza', 'michi_clasico', 5),
    ('venta_pieza', 'michi_sabores', 5),
    ('venta_pieza', 'caramelo_michi', 5),
    ('venta_pieza', 'gato_mayor_clasico', 10),
    ('venta_pieza', 'gato_mayor_sabores', 10),
    ('venta_pieza', 'caramelo_gato_mayor', 10),
    ('venta_pieza', 'jefe_felino_clasico', 15),
    ('venta_pieza', 'jefe_felino_sabores', 15)
), actual_rates AS (
  SELECT r.scheme::text AS scheme, r.product_key::text AS product_key,
         r.commission_amount AS amount
  FROM public.commission_rules r
  WHERE r.active AND r.scheme::text IN ('vendedora_pos','venta_pieza')
    AND r.valid_from = CASE r.scheme::text
      WHEN 'vendedora_pos' THEN DATE '2026-09-30' ELSE DATE '2026-07-01' END
), column_checks AS (
  SELECT
    COUNT(*) = 3
      AND BOOL_AND((c.column_name IN ('checkout_token','pos_commission_recipient_id') AND c.data_type='uuid')
        OR (c.column_name='pos_commission_attribution' AND c.data_type='text'))
      AND BOOL_AND(c.is_nullable='YES') AS passed
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='sales'
    AND c.column_name IN ('checkout_token','pos_commission_recipient_id','pos_commission_attribution')
), funcs AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.validate_aurrera_pos_commission_attribution()')) AS validator,
    pg_get_functiondef(to_regprocedure('public.sync_pos_commission_for_sale_item(uuid)')) AS synchronizer,
    pg_get_functiondef(to_regprocedure('public.create_aurrera_attributed_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,boolean,numeric,text,jsonb)')) AS checkout
), checks AS (
  SELECT
    COALESCE((SELECT passed FROM column_checks),FALSE) AS nullable_typed_columns,
    EXISTS(SELECT 1 FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename='sales'
        AND i.indexname='uq_sales_checkout_token' AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%checkout_token%')
        AS unique_checkout_token,
    EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.sales'::regclass
        AND t.tgname='trg_validate_aurrera_pos_commission_attribution' AND NOT t.tgisinternal)
        AS attribution_trigger_installed,
    COALESCE((SELECT validator ILIKE '%POS commission attribution and checkout token are immutable%'
      AND validator ILIKE '%deployment bridge%'
      AND validator ILIKE '%administrator%'
      FROM funcs),FALSE) AS immutable_attribution_and_rollout_bridge,
    COALESCE((SELECT synchronizer ILIKE '%v_sale.pos_commission_attribution = ''administrator''%'
      AND synchronizer ILIKE '%v_recipient_id := v_sale.pos_commission_recipient_id%'
      AND synchronizer ILIKE '%v_recipient_id := v_sale.cashier_id%'
      AND synchronizer ILIKE '%product_combos%'
      FROM funcs),FALSE) AS existing_pos_commission_engine_reused,
    COALESCE((SELECT checkout ILIKE '%ON CONFLICT (checkout_token) DO NOTHING%'
      AND checkout ILIKE '%INSERT INTO public.sale_items%'
      AND checkout ILIKE '%sync_pos_commission_for_sale_item%'
      AND checkout ILIKE '%v_cash + v_card + v_transfer%'
      FROM funcs),FALSE) AS checkout_atomic_idempotent_and_mixed_payments,
    NOT EXISTS(SELECT * FROM expected_rates EXCEPT SELECT * FROM actual_rates)
      AND NOT EXISTS(SELECT * FROM actual_rates EXCEPT SELECT * FROM expected_rates)
      AS expected_pos_rates_exact,
    NOT EXISTS(SELECT 1 FROM public.commission_events e WHERE e.source_type='pos_sale' AND e.source_item_id IS NOT NULL
       GROUP BY e.source_item_id HAVING count(*)>1) AS no_duplicate_pos_event_by_source_item,
    NOT EXISTS(SELECT 1 FROM public.sales s
      JOIN public.commission_events e ON e.source_type='pos_sale' AND e.source_id=s.id
      JOIN expected ex ON true
      WHERE s.branch_id=ex.aurrera_id AND s.pos_commission_attribution='administrator')
      AS administrator_has_zero_commissions,
    NOT EXISTS(SELECT 1 FROM public.sales s
      JOIN public.commission_events e ON e.source_type='pos_sale' AND e.source_id=s.id
      JOIN expected ex ON true
      WHERE s.branch_id=ex.aurrera_id AND s.pos_commission_attribution='employee'
       AND e.seller_id IS DISTINCT FROM s.pos_commission_recipient_id)
      AS employee_events_match_recipient,
    COALESCE((SELECT validator ILIKE '%Administrator attribution requires an active authenticated administrator%'
      FROM funcs),FALSE) AS admin_requires_authorized_session,
    COALESCE((SELECT checkout ILIKE '%p_cash_session_id IS NOT NULL AND v_sale.cash_session_id%'
      FROM funcs),FALSE) AS cash_session_retry_handles_implicit_session,
    EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=
      to_regprocedure('public.create_aurrera_attributed_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,boolean,numeric,text,jsonb)')
      AND NOT p.prosecdef) AS checkout_security_invoker
), warnings AS (
  SELECT
    (SELECT COUNT(*) FROM public.sales s
      JOIN expected e ON true WHERE s.branch_id=e.aurrera_id
      AND s.pos_commission_attribution='employee') AS attributed_employee_sales,
    (SELECT COUNT(*) FROM public.sales s
      JOIN expected e ON true WHERE s.branch_id=e.aurrera_id
      AND s.pos_commission_attribution='administrator') AS attributed_administrator_sales,
    (SELECT COUNT(*) FROM public.sales s
      JOIN public.commission_events e ON e.source_type='pos_sale' AND e.source_id=s.id
      WHERE s.is_refunded AND e.status::text IN ('pending','available'))
      AS refunded_sales_with_active_unpaid_commissions,
    (SELECT COUNT(*) FROM public.sales s
      JOIN public.commission_events e ON e.source_type='pos_sale' AND e.source_id=s.id
      WHERE s.is_refunded
        AND COALESCE(to_jsonb(e)->>'payment_status','')='paid'
        AND COALESCE((e.metadata->>'requires_manual_adjustment')::boolean,FALSE)=FALSE)
      AS refunded_sales_with_paid_commissions_not_flagged,
    'Las ventas reembolsadas se informan aparte: no se suponen correctamente tratadas por este cambio de selector.'::text AS note
)
SELECT jsonb_build_object(
  'verification_type', 'aurrera_pos_cashier_commissions_post_migration_read_only',
  'all_checks_passed', NOT EXISTS(
      SELECT 1 FROM checks c, LATERAL jsonb_each_text(to_jsonb(c)) x
      WHERE x.value IS DISTINCT FROM 'true'),
  'checks', (SELECT to_jsonb(c) FROM checks c),
  'observations', (SELECT to_jsonb(w) FROM warnings w),
  'limitation', 'Los checks de ausencia de duplicados y comisiones del Administrador pueden ser vacuos antes de la primera venta atribuida. Requiere prueba autenticada de cobro y reembolso. El total y los precios no quedan auditados independientemente contra el catalogo por esta verificacion.'
) AS verification;
ROLLBACK;
