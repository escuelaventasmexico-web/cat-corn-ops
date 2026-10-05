BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('20261003_rename_seller_identity', 0));

DO $$
DECLARE
  v_full_name TEXT;
  v_alias TEXT;
  v_role TEXT;
  v_is_active BOOLEAN;
BEGIN
  IF to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.user_branch_access') IS NULL
     OR to_regclass('public.branches') IS NULL THEN
    RAISE EXCEPTION 'Required identity and branch-access tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND lower(auth_user.email) = 'angelicagut@catcorn.com.mx'
  ) THEN
    RAISE EXCEPTION
      'Auth identity mismatch for b5fe98b7-d5ff-457e-8176-ed66a13af84b; expected angelicagut@catcorn.com.mx';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id <> 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND lower(auth_user.email) = 'angelicagut@catcorn.com.mx'
  ) THEN
    RAISE EXCEPTION 'The expected Auth email belongs to another UUID';
  END IF;

  SELECT profile.full_name, profile.commercial_alias, profile.role, profile.is_active
  INTO v_full_name, v_alias, v_role, v_is_active
  FROM public.user_profiles AS profile
  WHERE profile.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The expected seller profile does not exist';
  END IF;

  IF upper(btrim(COALESCE(v_alias, ''))) NOT IN ('BIANCA', 'ANGELICA') THEN
    RAISE EXCEPTION 'Unexpected initial commercial alias: %', v_alias;
  END IF;

  IF btrim(COALESCE(v_full_name, '')) NOT IN (
    'Blanca Paniagua', 'Bianca', 'Angelica Gutierrez'
  ) THEN
    RAISE EXCEPTION 'Unexpected initial full name: %', v_full_name;
  END IF;

  IF v_role IS DISTINCT FROM 'vendedora' OR v_is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'The expected active vendedora role is not present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id <> 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND upper(btrim(COALESCE(profile.commercial_alias, ''))) IN ('BIANCA', 'ANGELICA')
  ) THEN
    RAISE EXCEPTION 'BIANCA or ANGELICA is assigned to another profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND branch.code = 'chipitlan_01'
      AND branch.active
  ) THEN
    RAISE EXCEPTION 'The active Chipitlan branch does not match the expected UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND branch.code = 'aurrera_la_luna_02'
      AND branch.active
  ) THEN
    RAISE EXCEPTION 'The active Aurrera branch does not match the expected UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branch_access AS access
    WHERE access.user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND access.branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND access.active
  ) THEN
    RAISE EXCEPTION 'The seller must retain active access to Chipitlan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_branch_access AS access
    WHERE access.user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND access.branch_id <> 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND access.active
  ) THEN
    RAISE EXCEPTION 'The seller has unexpected active access outside Chipitlan';
  END IF;
END;
$$;

UPDATE public.user_profiles
SET full_name = 'Angelica Gutierrez',
    commercial_alias = 'ANGELICA',
    updated_at = now()
WHERE id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
  AND upper(btrim(COALESCE(commercial_alias, ''))) IN ('BIANCA', 'ANGELICA')
  AND (
    full_name IS DISTINCT FROM 'Angelica Gutierrez'
    OR commercial_alias IS DISTINCT FROM 'ANGELICA'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    JOIN public.user_profiles AS profile ON profile.id = auth_user.id
    WHERE auth_user.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND lower(auth_user.email) = 'angelicagut@catcorn.com.mx'
      AND profile.full_name = 'Angelica Gutierrez'
      AND profile.commercial_alias = 'ANGELICA'
      AND profile.role = 'vendedora'
      AND profile.is_active
  ) THEN
    RAISE EXCEPTION 'Final seller identity validation failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_branch_access AS access
    WHERE access.user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND access.branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND access.active
  ) OR EXISTS (
    SELECT 1
    FROM public.user_branch_access AS access
    WHERE access.user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
      AND access.branch_id <> 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND access.active
  ) THEN
    RAISE EXCEPTION 'Final branch-access validation failed';
  END IF;
END;
$$;

COMMIT;
