-- Allow active administrators to read the pending-payment tray without
-- exposing the restricted balance helpers called by its security-invoker view.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_pending_payment_verifications_admin()
RETURNS SETOF public.v_pending_payment_verifications
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  PERFORM 1
  FROM public.user_profiles AS profile
  WHERE profile.id = v_actor
    AND profile.role = 'admin'
    AND profile.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active administrators can view pending payment verifications';
  END IF;

  RETURN QUERY
  SELECT pending.*
  FROM public.v_pending_payment_verifications AS pending
  ORDER BY pending.submitted_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_payment_verifications_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_payment_verifications_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pending_payment_verifications_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
