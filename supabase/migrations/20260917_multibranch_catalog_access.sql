BEGIN;

-- Phase 1A: shared branch catalog and authenticated-user access grants only.
-- No operational table is changed in this migration.

CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT branches_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT branches_name_not_blank CHECK (btrim(name) <> '')
);

-- Stable identifiers used by subsequent migrations and the application.
-- A re-evaluation never reactivates or overwrites an existing branch.
INSERT INTO public.branches (id, code, name, active, sort_order)
VALUES
  (
    'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID,
    'chipitlan_01',
    'Chipitlán 01',
    true,
    1
  ),
  (
    'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID,
    'aurrera_la_luna_02',
    'Aurrera La Luna 02',
    true,
    2
  )
ON CONFLICT (code) DO NOTHING;

-- Fail loudly if a stable code was already associated with another UUID.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE code = 'chipitlan_01'
      AND id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
  ) THEN
    RAISE EXCEPTION
      'Branch code chipitlan_01 is not associated with its expected stable UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE code = 'aurrera_la_luna_02'
      AND id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
  ) THEN
    RAISE EXCEPTION
      'Branch code aurrera_la_luna_02 is not associated with its expected stable UUID';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.user_branch_access (
  user_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  PRIMARY KEY (user_id, branch_id),
  CONSTRAINT user_branch_access_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.user_profiles(id)
    ON DELETE CASCADE,
  CONSTRAINT user_branch_access_branch_id_fkey
    FOREIGN KEY (branch_id)
    REFERENCES public.branches(id)
    ON DELETE CASCADE,
  CONSTRAINT user_branch_access_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL
);

-- Initial grant only. Re-evaluating the migration never reactivates an access
-- that an administrator has subsequently disabled.
INSERT INTO public.user_branch_access (
  user_id,
  branch_id,
  active,
  created_by
)
SELECT
  profile.id,
  branch.id,
  true,
  auth.uid()
FROM public.user_profiles AS profile
CROSS JOIN public.branches AS branch
WHERE COALESCE(profile.is_active, false)
  AND branch.code IN ('chipitlan_01', 'aurrera_la_luna_02')
ON CONFLICT (user_id, branch_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS branches_active_sort_order_idx
  ON public.branches (active, sort_order, code);

CREATE INDEX IF NOT EXISTS user_branch_access_active_user_idx
  ON public.user_branch_access (user_id, branch_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS user_branch_access_active_branch_idx
  ON public.user_branch_access (branch_id, user_id)
  WHERE active;

CREATE OR REPLACE FUNCTION public.set_branches_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS branches_set_updated_at ON public.branches;
CREATE TRIGGER branches_set_updated_at
BEFORE UPDATE ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.set_branches_updated_at();

CREATE OR REPLACE FUNCTION public.user_has_branch_access(p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND COALESCE(profile.is_active, false)
    )
    AND EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = p_branch_id
        AND branch.active
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = auth.uid()
        AND access.branch_id = p_branch_id
        AND access.active
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_branch_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_branch_access(UUID) TO authenticated;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.branches FROM PUBLIC;
REVOKE ALL ON TABLE public.user_branch_access FROM PUBLIC;

-- Supabase projects can grant table privileges to authenticated through
-- ALTER DEFAULT PRIVILEGES. Revoke DELETE explicitly so the protection does
-- not depend only on the absence of an RLS DELETE policy.
REVOKE DELETE ON TABLE public.branches FROM authenticated;
REVOKE DELETE ON TABLE public.user_branch_access FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.branches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_branch_access TO authenticated;

DROP POLICY IF EXISTS branches_select_active_with_access ON public.branches;
CREATE POLICY branches_select_active_with_access
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    (active AND public.user_has_branch_access(id))
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

DROP POLICY IF EXISTS branches_admin_insert ON public.branches;
CREATE POLICY branches_admin_insert
  ON public.branches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

DROP POLICY IF EXISTS branches_admin_update ON public.branches;
CREATE POLICY branches_admin_update
  ON public.branches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

DROP POLICY IF EXISTS user_branch_access_select_own_or_admin
  ON public.user_branch_access;
CREATE POLICY user_branch_access_select_own_or_admin
  ON public.user_branch_access
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

DROP POLICY IF EXISTS user_branch_access_admin_insert
  ON public.user_branch_access;
CREATE POLICY user_branch_access_admin_insert
  ON public.user_branch_access
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

DROP POLICY IF EXISTS user_branch_access_admin_update
  ON public.user_branch_access;
CREATE POLICY user_branch_access_admin_update
  ON public.user_branch_access
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role = 'admin'
        AND COALESCE(profile.is_active, false)
    )
  );

COMMIT;
