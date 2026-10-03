BEGIN;

-- Fail before replacing a policy if the deployed effective definition is not
-- the branch-scoped contract established by the multibranch migrations.
DO $$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.branches') IS NULL
     OR to_regclass('public.user_branch_access') IS NULL
     OR to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'Required sales-history relations are missing';
  END IF;

  SELECT pg_get_functiondef('public.user_has_branch_access(uuid)'::REGPROCEDURE)
    INTO v_definition;
  IF v_definition IS NULL
     OR lower(v_definition) NOT LIKE '%user_branch_access%'
     OR lower(v_definition) NOT LIKE '%access.active%'
     OR lower(v_definition) NOT LIKE '%profile.is_active%'
     OR lower(v_definition) NOT LIKE '%branch.active%' THEN
    RAISE EXCEPTION 'user_has_branch_access(uuid) has an unexpected effective definition';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sales' AND cmd = 'SELECT') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'sales' AND cmd = 'SELECT'
         AND (
           policyname <> 'sales_branch_select'
           OR NOT (roles @> ARRAY['authenticated'::NAME])
           OR lower(COALESCE(qual, '')) NOT LIKE '%user_has_branch_access%branch_id%'
         )
     ) THEN
    RAISE EXCEPTION 'The effective sales SELECT policies require manual review';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sale_items' AND cmd = 'SELECT') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'sale_items' AND cmd = 'SELECT'
         AND (
           policyname <> 'sale_items_branch_select'
           OR NOT (roles @> ARRAY['authenticated'::NAME])
           OR lower(COALESCE(qual, '')) NOT LIKE '%user_has_branch_access%branch_id%'
           OR lower(COALESCE(qual, '')) NOT LIKE '%sale_id%'
         )
     ) THEN
    RAISE EXCEPTION 'The effective sale_items SELECT policies require manual review';
  END IF;

  IF to_regclass('public.sale_item_combo_components') IS NOT NULL AND (
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sale_item_combo_components' AND cmd = 'SELECT') <> 1
    OR EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sale_item_combo_components' AND cmd = 'SELECT'
        AND (
          policyname <> 'sale_item_combo_components_branch_select'
          OR NOT (roles @> ARRAY['authenticated'::NAME])
          OR lower(COALESCE(qual, '')) NOT LIKE '%user_has_branch_access%sale.branch_id%'
        )
    )
  ) THEN
    RAISE EXCEPTION 'The effective combo snapshot SELECT policies require manual review';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'admin'
      AND COALESCE(profile.is_active, FALSE)
  );
$$;

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
        AND COALESCE(profile.is_active, FALSE)
        AND (
          profile.role = 'admin'
          OR EXISTS (
            SELECT 1
            FROM public.user_branch_access AS access
            WHERE access.user_id = profile.id
              AND access.branch_id = p_branch_id
              AND access.active
          )
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = p_branch_id
        AND branch.active
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_active_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.user_has_branch_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_branch_access(UUID) TO authenticated;

DROP POLICY IF EXISTS sales_branch_select ON public.sales;
CREATE POLICY sales_branch_select
  ON public.sales
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active_admin()
    OR (
      branch_id IS NOT NULL
      AND public.user_has_branch_access(branch_id)
    )
  );

DROP POLICY IF EXISTS sale_items_branch_select ON public.sale_items;
CREATE POLICY sale_items_branch_select
  ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales AS parent_sale
      WHERE parent_sale.id = sale_items.sale_id
        AND (
          public.current_user_is_active_admin()
          OR (
            parent_sale.branch_id IS NOT NULL
            AND public.user_has_branch_access(parent_sale.branch_id)
          )
        )
    )
  );

DO $$
BEGIN
  IF to_regclass('public.sale_item_combo_components') IS NOT NULL THEN
    DROP POLICY IF EXISTS sale_item_combo_components_branch_select
      ON public.sale_item_combo_components;
    CREATE POLICY sale_item_combo_components_branch_select
      ON public.sale_item_combo_components
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.sale_items AS item
          JOIN public.sales AS sale ON sale.id = item.sale_id
          WHERE item.id = sale_item_combo_components.sale_item_id
            AND (
              public.current_user_is_active_admin()
              OR (
                sale.branch_id IS NOT NULL
                AND public.user_has_branch_access(sale.branch_id)
              )
            )
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.v_sales_history
WITH (security_invoker = true)
AS
SELECT
  sale.id,
  sale.total,
  sale.payment_method,
  sale.cash_amount,
  sale.card_amount,
  sale.transfer_amount,
  sale.created_at,
  sale.branch_id,
  branch.name AS branch_name,
  COALESCE(sale.is_refunded, FALSE) AS is_refunded,
  sale.refunded_at,
  sale.refund_reason,
  sale.sale_origin,
  sale.delivery_platform,
  sale.promotion_code,
  sale.customer_id
FROM public.sales AS sale
LEFT JOIN public.branches AS branch
  ON branch.id = sale.branch_id;

REVOKE ALL ON TABLE public.v_sales_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_sales_history TO authenticated;

COMMENT ON VIEW public.v_sales_history IS
  'Read-only sales-history source. Uses sales RLS, preserves sales without branch or cash session, and only LEFT JOINs optional branch metadata.';

NOTIFY pgrst, 'reload schema';

COMMIT;
