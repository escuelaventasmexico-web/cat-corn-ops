BEGIN;

DO $$
BEGIN
  IF to_regclass('public.branch_cash_control_settings') IS NULL
     OR to_regclass('public.branches') IS NULL
     OR to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'Required cash-control relations are missing';
  END IF;

  IF to_regprocedure('public.user_has_branch_access(uuid)') IS NULL
     OR to_regprocedure('public.current_user_is_active_admin()') IS NULL THEN
    RAISE EXCEPTION 'Required authorization helpers are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    WHERE function_row.pronamespace = 'public'::REGNAMESPACE
      AND function_row.proname = 'get_cash_inventory_control_for_branch'
      AND function_row.oid <>
        COALESCE(
          to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)')::OID,
          0::OID
        )
  ) THEN
    RAISE EXCEPTION 'Unexpected get_cash_inventory_control_for_branch overload exists';
  END IF;

  IF to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)') IS NOT NULL
     AND (
       SELECT function_row.prorettype <> 'jsonb'::REGTYPE
       FROM pg_proc AS function_row
       WHERE function_row.oid =
         'public.get_cash_inventory_control_for_branch(uuid)'::REGPROCEDURE
     ) THEN
    RAISE EXCEPTION 'Existing get_cash_inventory_control_for_branch has an incompatible return type';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_inventory_control_for_branch(
  p_branch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_control_enabled BOOLEAN;
  v_requires_opening BOOLEAN;
  v_requires_closing BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = v_actor
      AND COALESCE(profile.is_active, FALSE)
  ) THEN
    RAISE EXCEPTION 'An active profile is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = p_branch_id
      AND branch.active
  ) THEN
    RAISE EXCEPTION 'The selected branch does not exist or is inactive';
  END IF;

  v_is_admin := public.current_user_is_active_admin();
  IF NOT v_is_admin AND NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  SELECT
    COALESCE(setting.active, FALSE),
    COALESCE(setting.active AND setting.require_opening_inventory_count, FALSE),
    COALESCE(setting.active AND setting.require_closing_inventory_count, FALSE)
  INTO v_control_enabled, v_requires_opening, v_requires_closing
  FROM public.branches AS branch
  LEFT JOIN public.branch_cash_control_settings AS setting
    ON setting.branch_id = branch.id
  WHERE branch.id = p_branch_id
    AND branch.active;

  RETURN JSONB_BUILD_OBJECT(
    'branch_id', p_branch_id,
    'control_enabled', v_control_enabled,
    'requires_opening_counts', v_requires_opening,
    'requires_closing_counts', v_requires_closing,
    'corn_label', 'Peso del maíz',
    'corn_unit', 'kg',
    'oil_label', 'Aceite',
    'oil_unit', 'L'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_inventory_control_for_branch(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_inventory_control_for_branch(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
