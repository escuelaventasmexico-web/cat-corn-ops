-- Prevent direct invocation of the internal commercial-delivery audit helper.
-- Apply after 20260830_commercial_delivery_unit_control.sql.

BEGIN;

REVOKE EXECUTE ON FUNCTION public._commercial_delivery_audit(
  TEXT,
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public._commercial_delivery_audit(
  TEXT,
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB
) FROM anon;

REVOKE EXECUTE ON FUNCTION public._commercial_delivery_audit(
  TEXT,
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public._commercial_delivery_audit(
  TEXT,
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB
) FROM service_role;

COMMIT;
