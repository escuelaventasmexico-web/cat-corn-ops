BEGIN;

-- Phase 1B: branch traceability for POS sales and cash-register sessions only.
-- Legacy public RPCs are deliberately preserved pending their diagnostic review.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
      AND code = 'chipitlan_01'
      AND active
  ) THEN
    RAISE EXCEPTION 'Phase 1A branch chipitlan_01 is required before Phase 1B';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
      AND code = 'aurrera_la_luna_02'
      AND active
  ) THEN
    RAISE EXCEPTION 'Phase 1A branch aurrera_la_luna_02 is required before Phase 1B';
  END IF;
END;
$$;

-- The deployed legacy cash RPCs are not versioned in this repository.  They
-- are intentionally left intact: replacing them after checking only a
-- signature would discard unknown validations, audit behaviour or role checks.
-- Run the pre-apply read-only diagnostic in the verification file and version
-- their actual definitions before a later migration changes those public names.

ALTER TABLE public.cash_register_sessions
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS branch_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_register_sessions'
      AND column_name = 'branch_id' AND data_type <> 'uuid'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales'
      AND column_name = 'branch_id' AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'An existing Phase 1B branch_id column has an incompatible type';
  END IF;
END;
$$;

-- Historical POS and cash data belongs to Chipitlán 01.
UPDATE public.cash_register_sessions
SET branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
WHERE branch_id IS NULL;

UPDATE public.sales
SET branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
WHERE branch_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cash_register_sessions'::REGCLASS
      AND conname = 'cash_register_sessions_branch_id_fkey'
      AND pg_get_constraintdef(oid, true) <> 'FOREIGN KEY (branch_id) REFERENCES branches(id)'
  ) THEN
    RAISE EXCEPTION 'cash_register_sessions_branch_id_fkey exists with an incompatible definition';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cash_register_sessions'::REGCLASS
      AND conname = 'cash_register_sessions_branch_id_fkey'
  ) THEN
    ALTER TABLE public.cash_register_sessions
      ADD CONSTRAINT cash_register_sessions_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::REGCLASS
      AND conname = 'sales_branch_id_fkey'
      AND pg_get_constraintdef(oid, true) <> 'FOREIGN KEY (branch_id) REFERENCES branches(id)'
  ) THEN
    RAISE EXCEPTION 'sales_branch_id_fkey exists with an incompatible definition';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::REGCLASS
      AND conname = 'sales_branch_id_fkey'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.cash_register_sessions
  VALIDATE CONSTRAINT cash_register_sessions_branch_id_fkey;

ALTER TABLE public.sales
  VALIDATE CONSTRAINT sales_branch_id_fkey;

ALTER TABLE public.cash_register_sessions
  ALTER COLUMN branch_id SET NOT NULL,
  ALTER COLUMN branch_id SET DEFAULT 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID;

ALTER TABLE public.sales
  ALTER COLUMN branch_id SET NOT NULL,
  ALTER COLUMN branch_id SET DEFAULT 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'cash_register_sessions_one_open_per_branch_idx'
      AND (indexdef NOT ILIKE 'CREATE UNIQUE INDEX % ON public.cash_register_sessions USING btree (branch_id)%'
        OR indexdef NOT ILIKE '%WHERE (closed_at IS NULL)%')
  ) THEN
    RAISE EXCEPTION 'cash_register_sessions_one_open_per_branch_idx exists with an incompatible definition';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS cash_register_sessions_branch_opened_at_idx
  ON public.cash_register_sessions (branch_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS sales_branch_created_at_idx
  ON public.sales (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_branch_cash_session_idx
  ON public.sales (branch_id, cash_session_id)
  WHERE cash_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_register_sessions_one_open_per_branch_idx
  ON public.cash_register_sessions (branch_id)
  WHERE closed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_cash_register_session_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'The branch of a cash-register session cannot be changed';
  END IF;

  IF NOT public.user_has_branch_access(NEW.branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  RETURN NEW;
END;
$$;

-- Replace exactly one active legacy assignment trigger whose function assigns a
-- cash session but has no branch predicate.  The old trigger/function was not
-- versioned locally, so this discovery is deliberately strict: zero or more
-- than one candidate aborts rather than silently leaving a global mechanism.
DO $$
DECLARE
  v_trigger_names TEXT[];
BEGIN
  SELECT array_agg(trigger.tgname ORDER BY trigger.tgname)
    INTO v_trigger_names
  FROM pg_trigger AS trigger
  JOIN pg_proc AS function ON function.oid = trigger.tgfoid
  WHERE trigger.tgrelid = 'public.sales'::REGCLASS
    AND NOT trigger.tgisinternal
    AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_session_id%'
    AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_register_sessions%'
    AND LOWER(pg_get_functiondef(function.oid)) NOT LIKE '%branch_id%';

  IF COALESCE(cardinality(v_trigger_names), 0) > 1 THEN
    RAISE EXCEPTION 'More than one global sale-to-cash-session trigger was found (%); run the Phase 1B diagnostic before continuing', v_trigger_names;
  END IF;

  IF COALESCE(cardinality(v_trigger_names), 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.sales'::REGCLASS
         AND tgname = 'assign_sale_to_branch_cash_session'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'No legacy global sale-to-cash-session trigger could be identified; run the Phase 1B diagnostic before continuing';
  END IF;

  IF COALESCE(cardinality(v_trigger_names), 0) = 1 THEN
    EXECUTE format('DROP TRIGGER %I ON public.sales', v_trigger_names[1]);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_sale_to_branch_cash_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_branch UUID;
  v_session_closed_at TIMESTAMPTZ;
  v_session_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'The branch of a sale cannot be changed';
    END IF;

    -- POS creates the association on INSERT.  The current application updates
    -- refunds afterwards, so a normal update must not require an open box.
    IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id THEN
      RAISE EXCEPTION 'The cash-register session of a sale cannot be changed';
    END IF;

    IF NOT public.user_has_branch_access(NEW.branch_id) THEN
      RAISE EXCEPTION 'Active access to the selected branch is required';
    END IF;

    RETURN NEW;
  END IF;

  IF NOT public.user_has_branch_access(NEW.branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  IF COALESCE(NEW.sale_origin, 'pos') <> 'pos' THEN
    RETURN NEW;
  END IF;

  IF NEW.cashier_id IS NOT NULL AND NEW.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'The POS cashier must be the authenticated user';
  END IF;
  NEW.cashier_id := auth.uid();

  IF NEW.cash_session_id IS NULL THEN
    SELECT session.id, session.branch_id, session.closed_at
      INTO v_session_id, v_session_branch, v_session_closed_at
      FROM public.cash_register_sessions AS session
     WHERE session.branch_id = NEW.branch_id
       AND session.closed_at IS NULL
     FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'An open cash-register session is required for the sale branch';
    END IF;

    NEW.cash_session_id := v_session_id;
  ELSE
    SELECT session.branch_id, session.closed_at
      INTO v_session_branch, v_session_closed_at
      FROM public.cash_register_sessions AS session
     WHERE session.id = NEW.cash_session_id;

    IF v_session_branch IS NULL THEN
      RAISE EXCEPTION 'Cash-register session % does not exist', NEW.cash_session_id;
    END IF;

    IF v_session_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cash-register session % is closed', NEW.cash_session_id;
    END IF;

    IF NEW.branch_id IS DISTINCT FROM v_session_branch THEN
      RAISE EXCEPTION 'A sale and its cash-register session must belong to the same branch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_cash_register_session_branch ON public.cash_register_sessions;
CREATE TRIGGER aa_enforce_cash_register_session_branch
  BEFORE INSERT OR UPDATE ON public.cash_register_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_register_session_branch();

DROP TRIGGER IF EXISTS aa_enforce_sale_branch ON public.sales;
DROP TRIGGER IF EXISTS zz_assert_sale_branch_after_write ON public.sales;
DROP TRIGGER IF EXISTS assign_sale_to_branch_cash_session ON public.sales;
CREATE TRIGGER assign_sale_to_branch_cash_session
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.assign_sale_to_branch_cash_session();

-- RLS is explicitly enabled.  These policies do not grant DELETE.
ALTER TABLE public.cash_register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_withdrawals ENABLE ROW LEVEL SECURITY;

-- PostgreSQL OR-combines permissive RLS policies.  Remove every existing data
-- policy on these three Phase 1B tables, then recreate the complete
-- branch-aware set below.  This is stricter than trying to recognise only
-- USING (true), which could leave another branch-bypassing policy active.
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('cash_register_sessions', 'sales', 'cash_withdrawals')
      AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, policy_record.tablename);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS cash_register_sessions_branch_select ON public.cash_register_sessions;
DROP POLICY IF EXISTS cash_register_sessions_branch_insert ON public.cash_register_sessions;
DROP POLICY IF EXISTS cash_register_sessions_branch_update ON public.cash_register_sessions;
CREATE POLICY cash_register_sessions_branch_select
  ON public.cash_register_sessions
  FOR SELECT TO authenticated
  USING (public.user_has_branch_access(branch_id));

CREATE POLICY cash_register_sessions_branch_insert
  ON public.cash_register_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_branch_access(branch_id));

CREATE POLICY cash_register_sessions_branch_update
  ON public.cash_register_sessions
  FOR UPDATE TO authenticated
  USING (public.user_has_branch_access(branch_id))
  WITH CHECK (public.user_has_branch_access(branch_id));

DROP POLICY IF EXISTS sales_branch_select ON public.sales;
DROP POLICY IF EXISTS sales_branch_insert ON public.sales;
DROP POLICY IF EXISTS sales_branch_update ON public.sales;
CREATE POLICY sales_branch_select
  ON public.sales
  FOR SELECT TO authenticated
  USING (public.user_has_branch_access(branch_id));

CREATE POLICY sales_branch_insert
  ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_branch_access(branch_id));

CREATE POLICY sales_branch_update
  ON public.sales
  FOR UPDATE TO authenticated
  USING (public.user_has_branch_access(branch_id))
  WITH CHECK (public.user_has_branch_access(branch_id));

DROP POLICY IF EXISTS cash_withdrawals_branch_select ON public.cash_withdrawals;
DROP POLICY IF EXISTS cash_withdrawals_branch_insert ON public.cash_withdrawals;
DROP POLICY IF EXISTS cash_withdrawals_branch_update ON public.cash_withdrawals;
CREATE POLICY cash_withdrawals_branch_select
  ON public.cash_withdrawals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cash_register_sessions AS session
      WHERE session.id = cash_withdrawals.session_id
        AND public.user_has_branch_access(session.branch_id)
    )
  );

REVOKE ALL ON TABLE public.cash_register_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.sales FROM PUBLIC;
REVOKE ALL ON TABLE public.cash_withdrawals FROM PUBLIC;
REVOKE DELETE ON TABLE public.cash_register_sessions FROM authenticated;
REVOKE DELETE ON TABLE public.sales FROM authenticated;
REVOKE DELETE ON TABLE public.cash_withdrawals FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cash_register_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sales TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cash_withdrawals TO authenticated;

CREATE POLICY cash_withdrawals_branch_insert
  ON public.cash_withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cash_register_sessions AS session
      WHERE session.id = cash_withdrawals.session_id
        AND session.closed_at IS NULL
        AND public.user_has_branch_access(session.branch_id)
    )
  );

CREATE POLICY cash_withdrawals_branch_update
  ON public.cash_withdrawals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cash_register_sessions AS session
      WHERE session.id = cash_withdrawals.session_id
        AND public.user_has_branch_access(session.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cash_register_sessions AS session
      WHERE session.id = cash_withdrawals.session_id
        AND public.user_has_branch_access(session.branch_id)
    )
  );

-- Branch-aware RPCs for the selector phase.  They are separate names rather
-- than overloads, so PostgREST cannot choose an ambiguous signature.
CREATE OR REPLACE FUNCTION public.open_cash_register_session_for_branch(
  p_branch_id UUID,
  p_opening_cash NUMERIC,
  p_opened_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to open a cash-register session';
  END IF;

  IF NOT public.user_has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'Active access to the selected branch is required';
  END IF;

  IF p_opened_by IS NOT NULL AND p_opened_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The session opener must be the authenticated user';
  END IF;

  INSERT INTO public.cash_register_sessions (branch_id, opening_cash, opened_by, notes)
  VALUES (p_branch_id, p_opening_cash, v_actor, p_notes)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_open_cash_register_session_for_branch(
  p_branch_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT session.id
  FROM public.cash_register_sessions AS session
  WHERE session.branch_id = p_branch_id
    AND session.closed_at IS NULL
    AND public.user_has_branch_access(p_branch_id)
  ORDER BY session.opened_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.register_cash_withdrawal_for_branch(
  p_branch_id UUID,
  p_session_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_trigger_type TEXT,
  p_created_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_withdrawal_id UUID;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to register a cash withdrawal';
  END IF;

  IF p_created_by IS NOT NULL AND p_created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The withdrawal creator must be the authenticated user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_register_sessions AS session
    WHERE session.id = p_session_id
      AND session.branch_id = p_branch_id
      AND session.closed_at IS NULL
      AND public.user_has_branch_access(session.branch_id)
  ) THEN
    RAISE EXCEPTION 'An open cash-register session for the selected branch is required';
  END IF;

  INSERT INTO public.cash_withdrawals (
    session_id, amount, reason, trigger_type, created_by, notes
  )
  VALUES (
    p_session_id, p_amount, p_reason, p_trigger_type, v_actor, p_notes
  )
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register_session_for_branch(
  p_branch_id UUID,
  p_session_id UUID,
  p_counted_cash NUMERIC,
  p_closed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_opening_cash NUMERIC;
  v_cash_sales NUMERIC;
  v_withdrawals NUMERIC;
  v_expected NUMERIC;
  v_difference NUMERIC;
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to close a cash-register session';
  END IF;

  IF p_closed_by IS NOT NULL AND p_closed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The session closer must be the authenticated user';
  END IF;

  SELECT session.opening_cash
    INTO v_opening_cash
    FROM public.cash_register_sessions AS session
   WHERE session.id = p_session_id
     AND session.branch_id = p_branch_id
     AND session.closed_at IS NULL
     AND public.user_has_branch_access(session.branch_id)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open cash-register session % was not found for the selected branch', p_session_id;
  END IF;

  SELECT COALESCE(SUM(CASE
    WHEN UPPER(payment_method::TEXT) = 'CASH' THEN total
    WHEN UPPER(payment_method::TEXT) = 'MIXED' THEN COALESCE(cash_amount, 0)
    ELSE 0
  END), 0)
    INTO v_cash_sales
    FROM public.sales
   WHERE cash_session_id = p_session_id
     AND branch_id = p_branch_id
     AND COALESCE(is_refunded, false) = false
     AND COALESCE(sale_origin, 'pos') = 'pos';

  SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals
    FROM public.cash_withdrawals
   WHERE session_id = p_session_id;

  v_expected := v_opening_cash + v_cash_sales - v_withdrawals;
  v_difference := p_counted_cash - v_expected;

  UPDATE public.cash_register_sessions
     SET status = 'closed',
         closed_at = now(),
         closed_by = v_actor,
         counted_cash = p_counted_cash,
         expected_cash = v_expected,
         difference = v_difference,
         close_notes = p_notes
   WHERE id = p_session_id
     AND branch_id = p_branch_id
     AND closed_at IS NULL;

  RETURN json_build_object(
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_difference
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_register_session_for_branch(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_open_cash_register_session_for_branch(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_cash_withdrawal_for_branch(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_cash_register_session_for_branch(UUID, UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.open_cash_register_session_for_branch(UUID, NUMERIC, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_cash_register_session_for_branch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_cash_withdrawal_for_branch(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register_session_for_branch(UUID, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- Existing legacy RPCs and cash-reporting views are intentionally untouched
-- until the pre-apply diagnostic captures their deployed definitions.  The
-- branch-aware RPCs above are new public names and do not replace them.

COMMIT;
