-- AUTHENTICATED INTEGRATION TEST. Run separately in SQL Editor after the base
-- verifier. It selects an existing active admin, simulates the authenticated
-- database role, writes only inside this transaction and always ROLLBACKs.

BEGIN;

DO $select_admin$
DECLARE
  v_admin_id UUID;
  v_unauthorized_id UUID;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.user_profiles
  WHERE role = 'admin' AND is_active
  ORDER BY id
  LIMIT 1;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'No active admin exists for the authenticated test.'; END IF;
  SELECT id INTO v_unauthorized_id
  FROM public.user_profiles
  WHERE role <> 'admin' AND is_active
  ORDER BY id
  LIMIT 1;
  IF v_unauthorized_id IS NULL THEN
    RAISE EXCEPTION 'No active non-admin profile exists for the unauthorized read test.';
  END IF;
  PERFORM set_config('test.finance_admin_id', v_admin_id::TEXT, true);
  PERFORM set_config('test.finance_unauthorized_id', v_unauthorized_id::TEXT, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$select_admin$;

SET LOCAL ROLE authenticated;

DO $integration$
DECLARE
  v_opening_id UUID;
  v_expense_id UUID;
  v_expense_ids UUID[] := ARRAY[]::UUID[];
  v_amount NUMERIC;
  v_snapshot JSONB;
  v_spoof_blocked BOOLEAN := false;
  v_card_result JSONB;
  v_card_retry_result JSONB;
  v_reversal_result JSONB;
  v_reversal_retry_result JSONB;
  v_card_token UUID := gen_random_uuid();
  v_payment_id UUID;
  v_card_id UUID;
  v_second_card_id UUID;
  v_direct_update_blocked BOOLEAN := false;
  v_unauthorized_rpc_blocked BOOLEAN := false;
  v_unauthorized_visible_count INTEGER;
  v_admin_id UUID := current_setting('test.finance_admin_id')::UUID;
  v_unauthorized_id UUID := current_setting('test.finance_unauthorized_id')::UUID;
  v_payment public.finance_credit_card_payments%ROWTYPE;
BEGIN
  INSERT INTO public.finance_month_opening_balances (
    month_start, amount_mxn, cutoff_business_date, notes
  ) VALUES (
    DATE '2099-01-01', 10010, DATE '2099-01-01', 'ROLLBACK integration test'
  ) RETURNING id INTO v_opening_id;

  FOREACH v_amount IN ARRAY ARRAY[5000::NUMERIC, 1000::NUMERIC, 390::NUMERIC] LOOP
    INSERT INTO public.expenses (
      expense_date, amount_mxn, type, category, vendor, has_invoice,
      payment_method, notes, concept_code, destination_scope,
      classification_status, liquidity_treatment, payment_instrument, credit_card_id
    ) VALUES (
      DATE '2099-01-01', v_amount, 'OTHER', 'OTHER', 'ROLLBACK test', false,
      'CASH', concat('ROLLBACK real payment ', v_amount), 'OTHER', 'SHARED',
      'CLASSIFIED', 'IMMEDIATE', 'CASH', NULL
    ) RETURNING id INTO v_expense_id;

    v_expense_ids := array_append(v_expense_ids, v_expense_id);
    INSERT INTO public.finance_opening_day_movement_decisions (
      opening_balance_id, source_type, source_id, position, notes
    ) VALUES (
      v_opening_id, 'EXPENSE', v_expense_id, 'AFTER_OPENING', 'ROLLBACK confirmed by user'
    );
  END LOOP;

  -- Both INSERT and UPDATE privileges on the new liquidity fields are real.
  UPDATE public.expenses
  SET payment_method = 'TRANSFER', payment_instrument = 'TRANSFER'
  WHERE id = v_expense_ids[3];

  BEGIN
    EXECUTE format(
      'INSERT INTO public.expenses '
      || '(expense_date,amount_mxn,type,category,payment_method,concept_code,destination_scope,classification_status,liquidity_treatment,payment_instrument,commission_settlement_id) '
      || 'VALUES (DATE ''2099-01-01'',1,''OTHER'',''OTHER'',''CASH'',''OTHER'',''SHARED'',''CLASSIFIED'',''IMMEDIATE'',''CASH'',%L)',
      gen_random_uuid()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_spoof_blocked := true;
  END;
  IF NOT v_spoof_blocked THEN
    RAISE EXCEPTION 'authenticated unexpectedly wrote commission_settlement_id';
  END IF;

  SELECT public.finance_month_available_funds(DATE '2099-01-01') INTO v_snapshot;
  IF (v_snapshot #>> '{outflows,immediate_expenses_mxn}')::NUMERIC <> 6390
     OR (v_snapshot ->> 'known_available_mxn')::NUMERIC <> 3620 THEN
    RAISE EXCEPTION 'Three-payment integration failed: %', v_snapshot;
  END IF;

  INSERT INTO public.finance_month_opening_balances (
    month_start, amount_mxn, cutoff_business_date, notes
  ) VALUES (
    DATE '2099-02-01', 3920, DATE '2099-02-01', 'ROLLBACK card-payment test'
  );

  SELECT public.finance_register_credit_card_payment(
    NULL, 'ROLLBACK new card', 4940, DATE '2099-02-02', 'PARTIAL',
    'TRANSFER', 'ROLLBACK', 'ROLLBACK atomic new card + payment', v_card_token
  ) INTO v_card_result;
  IF v_card_result ->> 'credit_card_id' IS NULL OR v_card_result ->> 'payment_id' IS NULL THEN
    RAISE EXCEPTION 'Atomic new-card payment did not return both identifiers: %', v_card_result;
  END IF;
  v_card_id := (v_card_result ->> 'credit_card_id')::UUID;
  v_payment_id := (v_card_result ->> 'payment_id')::UUID;

  SELECT public.finance_register_credit_card_payment(
    NULL, 'ROLLBACK new card', 4940, DATE '2099-02-02', 'PARTIAL',
    'TRANSFER', 'ROLLBACK', 'ROLLBACK atomic new card + payment', v_card_token
  ) INTO v_card_retry_result;
  IF v_card_retry_result IS DISTINCT FROM v_card_result THEN
    RAISE EXCEPTION 'Idempotent retry returned a different card or payment: %, %',
      v_card_result, v_card_retry_result;
  END IF;

  INSERT INTO public.finance_credit_cards (name)
  VALUES ('ROLLBACK second card') RETURNING id INTO v_second_card_id;

  BEGIN
    EXECUTE format(
      'UPDATE public.finance_credit_card_payments '
      || 'SET amount_mxn = 1, payment_date = DATE ''2099-02-03'', '
      || 'credit_card_id = %L, idempotency_key = %L WHERE id = %L',
      v_second_card_id, gen_random_uuid(), v_payment_id
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_update_blocked := true;
  END;
  IF NOT v_direct_update_blocked THEN
    RAISE EXCEPTION 'authenticated unexpectedly changed immutable card-payment facts';
  END IF;

  SELECT public.finance_month_available_funds(DATE '2099-02-01') INTO v_snapshot;
  IF (v_snapshot #>> '{outflows,credit_card_payments_mxn}')::NUMERIC <> 4940
     OR (v_snapshot ->> 'known_available_mxn')::NUMERIC <> -1020 THEN
    RAISE EXCEPTION '3920 - 4940 integration failed: %', v_snapshot;
  END IF;

  -- A valid authenticated profile without Finanzas access sees no rows in any
  -- new table and cannot call the SECURITY DEFINER balance RPC.
  PERFORM set_config('request.jwt.claim.sub', v_unauthorized_id::TEXT, true);
  SELECT
    (SELECT COUNT(*) FROM public.finance_month_opening_balances)
    + (SELECT COUNT(*) FROM public.finance_opening_day_movement_decisions)
    + (SELECT COUNT(*) FROM public.finance_credit_cards)
    + (SELECT COUNT(*) FROM public.finance_credit_card_payments)
  INTO v_unauthorized_visible_count;
  IF v_unauthorized_visible_count <> 0 THEN
    RAISE EXCEPTION 'non-admin authenticated profile read protected finance rows: %',
      v_unauthorized_visible_count;
  END IF;
  BEGIN
    PERFORM public.finance_month_available_funds(DATE '2099-02-01');
  EXCEPTION WHEN insufficient_privilege THEN
    v_unauthorized_rpc_blocked := true;
  END;
  IF NOT v_unauthorized_rpc_blocked THEN
    RAISE EXCEPTION 'non-admin authenticated profile unexpectedly called available funds RPC';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::TEXT, true);
  SELECT public.finance_reverse_credit_card_payment(
    v_payment_id, 'ROLLBACK correction test'
  ) INTO v_reversal_result;

  SELECT payment.* INTO v_payment
  FROM public.finance_credit_card_payments payment
  WHERE payment.id = v_payment_id;
  IF v_payment.status <> 'REVERSED'
     OR v_payment.amount_mxn <> 4940
     OR v_payment.payment_date <> DATE '2099-02-02'
     OR v_payment.credit_card_id <> v_card_id
     OR v_payment.idempotency_key <> v_card_token
     OR v_payment.reversal_reason <> 'ROLLBACK correction test'
     OR v_payment.reversed_by <> v_admin_id
     OR v_payment.reversed_at IS NULL THEN
    RAISE EXCEPTION 'Controlled reversal changed immutable facts or missed audit data: %', row_to_json(v_payment);
  END IF;

  SELECT public.finance_reverse_credit_card_payment(
    v_payment_id, 'ROLLBACK retry ignored'
  ) INTO v_reversal_retry_result;
  IF COALESCE((v_reversal_retry_result ->> 'already_reversed')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated reversal was not idempotent: %', v_reversal_retry_result;
  END IF;

  SELECT public.finance_month_available_funds(DATE '2099-02-01') INTO v_snapshot;
  IF (v_snapshot #>> '{outflows,credit_card_payments_mxn}')::NUMERIC <> 0
     OR (v_snapshot ->> 'known_available_mxn')::NUMERIC <> 3920 THEN
    RAISE EXCEPTION 'Reversal did not restore the available-funds calculation: %', v_snapshot;
  END IF;

  RAISE NOTICE 'authenticated integration passed: admin-only reads/RPC, immutable payment facts, controlled reversal, liquidity grants, spoof protection, 6390 expenses, -1020 then 3920';
END;
$integration$;

RESET ROLE;
ROLLBACK;
