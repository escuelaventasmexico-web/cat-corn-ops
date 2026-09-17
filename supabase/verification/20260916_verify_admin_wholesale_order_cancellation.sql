-- Read-only verifier for one administratively cancelled Mayoreo order.
-- Replace the UUID below, then run this query after the migration and one
-- successful cancellation. It returns exactly one JSONB object.

WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::UUID AS order_id
),
function_contract AS (
  SELECT
    pg_get_functiondef('public.admin_cancel_wholesale_order(uuid,text,text)'::REGPROCEDURE) AS definition,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc AS proc
      CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS privilege
      WHERE proc.oid = 'public.admin_cancel_wholesale_order(uuid,text,text)'::REGPROCEDURE
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) AS no_public_execute
),
facts AS (
  SELECT
    params.order_id,
    EXISTS (
      SELECT 1 FROM public.wholesale_orders AS orders
      WHERE orders.id = params.order_id AND orders.order_status = 'cancelled'
    ) AS order_preserved_and_cancelled,
    (SELECT COUNT(*) FROM public.wholesale_order_items AS item WHERE item.wholesale_order_id = params.order_id) AS preserved_item_count,
    (SELECT COUNT(*) FROM public.commercial_delivery_units AS unit WHERE unit.wholesale_order_id = params.order_id) AS preserved_label_count,
    (SELECT COUNT(*) FROM public.commercial_delivery_units AS unit
      WHERE unit.wholesale_order_id = params.order_id AND unit.status = 'voided') AS voided_label_count,
    (SELECT COUNT(*) FROM public.commercial_delivery_units AS unit
      WHERE unit.wholesale_order_id = params.order_id
        AND unit.status IN ('generated', 'printed', 'scanned', 'released', 'returned_good', 'spoiled', 'replaced')) AS non_voided_label_count,
    (SELECT COUNT(*) FROM public.wholesale_payments AS payment WHERE payment.wholesale_order_id = params.order_id) AS payment_count,
    (SELECT COUNT(*) FROM public.partner_payment_verification_requests AS request
      WHERE request.scheme = 'mayoreo' AND request.wholesale_order_id = params.order_id
        AND LOWER(COALESCE(request.status::TEXT, '')) = 'approved') AS approved_request_count,
    (SELECT COUNT(*) FROM public.commission_events AS event WHERE event.source_id = params.order_id) AS commission_consequence_count,
    (SELECT COUNT(*) FROM public.commercial_delivery_audit_events AS audit
      WHERE audit.wholesale_order_id = params.order_id
        AND audit.event_type = 'admin_delivery_cancelled') AS cancellation_audit_count,
    (SELECT audit.metadata FROM public.commercial_delivery_audit_events AS audit
      WHERE audit.wholesale_order_id = params.order_id
        AND audit.event_type = 'admin_delivery_cancelled'
      ORDER BY audit.occurred_at DESC LIMIT 1) AS cancellation_metadata,
    function_contract.definition,
    function_contract.no_public_execute
  FROM params CROSS JOIN function_contract
)
SELECT jsonb_build_object(
  'order_id', order_id,
  'order_preserved_and_cancelled', order_preserved_and_cancelled,
  'items_preserved', preserved_item_count > 0,
  'labels_preserved', preserved_label_count > 0,
  'labels_voided_not_deleted', preserved_label_count > 0
    AND voided_label_count = preserved_label_count
    AND non_voided_label_count = 0,
  'no_registered_payments', payment_count = 0,
  'no_approved_payment_requests', approved_request_count = 0,
  'no_downstream_commissions', commission_consequence_count = 0,
  'one_administrative_audit', cancellation_audit_count = 1
    AND COALESCE((cancellation_metadata ->> 'voided_units')::INTEGER, -1) = voided_label_count,
  'administrator_only_permission',
    has_function_privilege('authenticated', 'public.admin_cancel_wholesale_order(uuid,text,text)'::REGPROCEDURE, 'EXECUTE')
    AND no_public_execute,
  'rpc_blocks_payments_and_approved_requests',
    POSITION('wholesale_payments' IN LOWER(definition)) > 0
    AND POSITION('partner_payment_verification_requests' IN LOWER(definition)) > 0,
  'rpc_blocks_released_and_terminal_units',
    POSITION('incompatible labels' IN LOWER(definition)) > 0
    AND POSITION('generated' IN LOWER(definition)) > 0
    AND POSITION('printed' IN LOWER(definition)) > 0
    AND POSITION('scanned' IN LOWER(definition)) > 0,
  'rpc_has_no_physical_delete', POSITION('delete from' IN LOWER(definition)) = 0,
  'all_checks_passed',
    order_preserved_and_cancelled
    AND preserved_item_count > 0
    AND preserved_label_count > 0
    AND voided_label_count = preserved_label_count
    AND non_voided_label_count = 0
    AND payment_count = 0
    AND approved_request_count = 0
    AND commission_consequence_count = 0
    AND cancellation_audit_count = 1
    AND COALESCE((cancellation_metadata ->> 'voided_units')::INTEGER, -1) = voided_label_count
    AND has_function_privilege('authenticated', 'public.admin_cancel_wholesale_order(uuid,text,text)'::REGPROCEDURE, 'EXECUTE')
    AND no_public_execute
    AND POSITION('wholesale_payments' IN LOWER(definition)) > 0
    AND POSITION('partner_payment_verification_requests' IN LOWER(definition)) > 0
    AND POSITION('incompatible labels' IN LOWER(definition)) > 0
    AND POSITION('delete from' IN LOWER(definition)) = 0
) AS verification
FROM facts;
