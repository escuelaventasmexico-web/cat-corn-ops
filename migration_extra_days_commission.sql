-- Migration: Extra Days Commission Management
-- Purpose: Allow admins to register manual compensation for extra work days
-- Architecture: Backend-driven via SECURITY DEFINER RPCs
-- Schema changes: NONE (reuses existing 'adjustment' source_type)
-- Date: 2026-08-12

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. RPC: CREATE EXTRA DAY COMMISSION
-- ════════════════════════════════════════════════════════════════════════════════
-- Purpose: Register a new extra day payment for a seller
-- Security: SECURITY DEFINER ensures only backend validates
-- Input validation: Done on backend and frontend
-- Returns: success status + commission_event_id or error message

DROP FUNCTION IF EXISTS public.create_extra_day_commission(uuid, numeric, date, text) CASCADE;

CREATE FUNCTION public.create_extra_day_commission(
  p_seller_id UUID,
  p_amount NUMERIC,
  p_work_date DATE,
  p_description TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  commission_event_id UUID,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_seller_profile public.user_profiles%ROWTYPE;
  v_new_event_id UUID;
  v_today_date DATE;
  v_earned_at TIMESTAMPTZ;
  v_work_date_start TIMESTAMPTZ;
  v_work_date_end TIMESTAMPTZ;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 1: Verify caller is admin
  -- ─────────────────────────────────────────────────────────────────────────────
  v_admin_id := auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, 'User not authenticated'::TEXT;
    RETURN;
  END IF;
  
  -- Check admin role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles 
    WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, NULL::UUID, 'Only admins can create extra day payments'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 2: Verify seller exists and is active
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT * INTO v_seller_profile
  FROM public.user_profiles
  WHERE id = p_seller_id
    AND role = 'socios_comerciales'
    AND is_active = true;
  
  IF v_seller_profile IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, 'Seller not found or inactive'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 3: Validate business date (not future)
  -- ─────────────────────────────────────────────────────────────────────────────
  v_today_date := CURRENT_DATE AT TIME ZONE 'America/Mexico_City';
  
  IF p_work_date > v_today_date THEN
    RETURN QUERY SELECT false, NULL::UUID, 'Work date cannot be in the future'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 4: Validate amount
  -- ─────────────────────────────────────────────────────────────────────────────
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT false, NULL::UUID, 'Amount must be greater than zero'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 5: Validate description
  -- ─────────────────────────────────────────────────────────────────────────────
  IF TRIM(COALESCE(p_description, '')) = '' THEN
    RETURN QUERY SELECT false, NULL::UUID, 'Description is required'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 6: Create commission_event
  -- ─────────────────────────────────────────────────────────────────────────────
  -- earned_at: Convert work_date to TIMESTAMPTZ (start of day UTC)
  v_work_date_start := (p_work_date::TIMESTAMPTZ AT TIME ZONE 'America/Mexico_City' AT TIME ZONE 'UTC');
  v_earned_at := v_work_date_start;
  
  INSERT INTO public.commission_events (
    seller_id,
    partner_id,
    source_type,
    source_id,
    source_item_id,
    rule_id,
    product_key,
    product_name,
    product_variant,
    product_size,
    quantity,
    unit_commission,
    commission_amount,
    release_condition,
    status,
    earned_at,
    available_at,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    p_seller_id,                 -- seller_id
    NULL,                         -- partner_id (admin adjustment, no partner)
    'adjustment',                 -- source_type
    NULL,                         -- source_id (no originating event)
    NULL,                         -- source_item_id
    NULL,                         -- rule_id (manual, not rule-based)
    NULL,                         -- product_key
    NULL,                         -- product_name
    NULL,                         -- product_variant
    NULL,                         -- product_size
    NULL,                         -- quantity
    NULL,                         -- unit_commission
    p_amount,                     -- commission_amount
    'manual_review',              -- release_condition
    'available',                  -- status (admin approves directly)
    v_earned_at,                  -- earned_at (work date)
    NOW() AT TIME ZONE 'UTC',     -- available_at (immediately available)
    jsonb_build_object(
      'adjustment_type', 'extra_day',
      'description', TRIM(p_description),
      'work_date', p_work_date::TEXT,
      'created_by_admin', v_admin_id,
      'created_at_admin', NOW() AT TIME ZONE 'UTC'
    ),                            -- metadata
    NOW() AT TIME ZONE 'UTC',     -- created_at
    NOW() AT TIME ZONE 'UTC'      -- updated_at
  )
  RETURNING id INTO v_new_event_id;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 7: Return success
  -- ─────────────────────────────────────────────────────────────────────────────
  RETURN QUERY SELECT true, v_new_event_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::UUID, SQLERRM::TEXT;

END $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. RPC: CANCEL EXTRA DAY COMMISSION
-- ════════════════════════════════════════════════════════════════════════════════
-- Purpose: Cancel an existing extra day payment
-- Security: SECURITY DEFINER, only admin
-- Constraints:
--   - Must be status='available' (cannot cancel if already paid)
--   - Must be source_type='adjustment' with adjustment_type='extra_day'
-- Returns: success status or error message

DROP FUNCTION IF EXISTS public.cancel_extra_day_commission(uuid, text) CASCADE;

CREATE FUNCTION public.cancel_extra_day_commission(
  p_commission_event_id UUID,
  p_cancellation_reason TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_event public.commission_events%ROWTYPE;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 1: Verify caller is admin
  -- ─────────────────────────────────────────────────────────────────────────────
  v_admin_id := auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated'::TEXT;
    RETURN;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles 
    WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can cancel extra day payments'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 2: Fetch and validate commission event
  -- ─────────────────────────────────────────────────────────────────────────────
  SELECT * INTO v_event
  FROM public.commission_events
  WHERE id = p_commission_event_id;
  
  IF v_event IS NULL THEN
    RETURN QUERY SELECT false, 'Commission event not found'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 3: Verify it's an extra_day adjustment
  -- ─────────────────────────────────────────────────────────────────────────────
  IF v_event.source_type != 'adjustment' THEN
    RETURN QUERY SELECT false, 'Commission is not an adjustment'::TEXT;
    RETURN;
  END IF;
  
  IF (v_event.metadata->>'adjustment_type') != 'extra_day' THEN
    RETURN QUERY SELECT false, 'Commission is not an extra day payment'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 4: Verify status is 'available' (cannot cancel if paid)
  -- ─────────────────────────────────────────────────────────────────────────────
  IF v_event.status = 'paid' THEN
    RETURN QUERY SELECT false, 'Este pago ya fue liquidado y no puede cancelarse desde esta opción.'::TEXT;
    RETURN;
  END IF;
  
  IF v_event.status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'Commission already cancelled'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 5: Validate cancellation reason
  -- ─────────────────────────────────────────────────────────────────────────────
  IF TRIM(COALESCE(p_cancellation_reason, '')) = '' THEN
    RETURN QUERY SELECT false, 'Cancellation reason is required'::TEXT;
    RETURN;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 6: Update to cancelled status
  -- ─────────────────────────────────────────────────────────────────────────────
  UPDATE public.commission_events
  SET
    status = 'cancelled',
    cancelled_at = NOW() AT TIME ZONE 'UTC',
    cancellation_reason = TRIM(p_cancellation_reason),
    metadata = jsonb_set(
      metadata,
      '{cancelled_by_admin}',
      to_jsonb(v_admin_id::TEXT)
    ) || jsonb_build_object(
      'cancelled_at_admin', (NOW() AT TIME ZONE 'UTC')::TEXT
    ),
    updated_at = NOW() AT TIME ZONE 'UTC'
  WHERE id = p_commission_event_id;
  
  -- ─────────────────────────────────────────────────────────────────────────────
  -- Step 7: Return success
  -- ─────────────────────────────────────────────────────────────────────────────
  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;

END $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. VERIFICATION QUERIES (For manual inspection, not executed)
-- ════════════════════════════════════════════════════════════════════════════════

-- Verify commission_events table structure
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'commission_events'
-- ORDER BY ordinal_position;

-- Verify source_type constraint includes 'adjustment'
-- SELECT constraint_name, constraint_definition
-- FROM information_schema.table_constraints t
-- JOIN information_schema.check_constraints c
--   ON t.constraint_name = c.constraint_name
-- WHERE t.table_name = 'commission_events'
--   AND t.constraint_type = 'CHECK';

-- Verify RLS policies exist
-- SELECT polname, polcmd, polroles, polqual
-- FROM pg_policies
-- WHERE tablename = 'commission_events';

-- Verify schema_version after migration
-- SELECT version, description FROM schema_migrations
-- ORDER BY version DESC LIMIT 1;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════════
-- POST-MIGRATION TESTING (Manual steps)
-- ════════════════════════════════════════════════════════════════════════════════

/*

Test Case 1: Create Extra Day Commission
─────────────────────────────────────────

WITH admin_test AS (
  SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1
),
seller_test AS (
  SELECT id FROM user_profiles WHERE role = 'socios_comerciales' AND is_active = true LIMIT 1
)
SELECT *
FROM create_extra_day_commission(
  (SELECT id FROM seller_test),
  300.00,
  CURRENT_DATE AT TIME ZONE 'America/Mexico_City',
  'Apoyo en tienda durante turno adicional'
);

Expected: success=true, commission_event_id=<UUID>


Test Case 2: Verify Commission Event Created
──────────────────────────────────────────────

SELECT id, seller_id, source_type, commission_amount, status, metadata
FROM commission_events
WHERE source_type = 'adjustment'
  AND (metadata->>'adjustment_type') = 'extra_day'
ORDER BY created_at DESC
LIMIT 1;

Expected: Row with status='available', commission_amount=300.00


Test Case 3: Check available_total Includes Extra Day
───────────────────────────────────────────────────────

SELECT available_total
FROM v_seller_commission_monthly_summary
WHERE seller_id = (SELECT id FROM seller_test LIMIT 1)
  AND month_start = CURRENT_DATE AT TIME ZONE 'America/Mexico_City' - INTERVAL '(EXTRACT(day FROM CURRENT_DATE AT TIME ZONE ''America/Mexico_City'') - 1) days';

Expected: available_total includes the $300.00


Test Case 4: Cancel Extra Day Commission
──────────────────────────────────────────

SELECT *
FROM cancel_extra_day_commission(
  <commission_event_id_from_test_2>,
  'Captura incorrecta'
);

Expected: success=true


Test Case 5: Verify Cancellation Reflected
────────────────────────────────────────────

SELECT id, status, cancelled_at, cancellation_reason
FROM commission_events
WHERE id = <commission_event_id_from_test_2>;

Expected: status='cancelled', cancellation_reason='Captura incorrecta', cancelled_at=NOW()


Test Case 6: Verify available_total Excludes Cancelled
─────────────────────────────────────────────────────────

SELECT available_total
FROM v_seller_commission_monthly_summary
WHERE seller_id = (SELECT id FROM seller_test LIMIT 1)
  AND month_start = ...;

Expected: available_total DECREASED by $300.00

*/

-- End of Migration: Extra Days Commission Management
