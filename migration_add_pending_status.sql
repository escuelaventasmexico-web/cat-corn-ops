-- ============================================================
-- Migration: Add PENDING to check_item_status enum
-- and update ops_get_or_create_daily_checklist to use PENDING
-- Run in: Supabase SQL Editor
-- ============================================================

-- 1. Add PENDING value to the existing enum (safe if already exists)
ALTER TYPE public.check_item_status ADD VALUE IF NOT EXISTS 'PENDING';

-- 2. Re-create ops_get_or_create_daily_checklist using PENDING as default status
--    (Replace this with the actual body of your existing function,
--     only changing 'OK'::check_item_status → 'PENDING'::check_item_status
--     in the INSERT into daily_checklist_items)
--
-- IMPORTANT: The function below assumes the existing signature and logic.
-- If your function body differs, only change the INSERT status value.
--
-- Find the INSERT statement inside ops_get_or_create_daily_checklist and update it:

-- Step 2a: View the current function body to confirm the INSERT location:
-- SELECT pg_get_functiondef('public.ops_get_or_create_daily_checklist'::regproc);

-- Step 2b: Apply a targeted UPDATE to the existing function definition.
-- Because ALTER TYPE … ADD VALUE cannot run inside a transaction with DDL that
-- uses the new value, we wrap only the function replacement here.

-- Replace the function (adjust body if yours differs):
CREATE OR REPLACE FUNCTION public.ops_get_or_create_daily_checklist(
  p_checklist_date   date,
  p_responsible_name text
)
RETURNS TABLE (
  checklist_id     uuid,
  checklist_date   date,
  responsible_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checklist_id uuid;
BEGIN
  -- Try to find existing checklist for the date
  SELECT dc.id
    INTO v_checklist_id
    FROM public.daily_checklists dc
   WHERE dc.checklist_date   = p_checklist_date
     AND dc.responsible_name = p_responsible_name
   LIMIT 1;

  -- If not found, create one and populate items from the master task list
  IF v_checklist_id IS NULL THEN
    INSERT INTO public.daily_checklists (checklist_date, responsible_name, status)
    VALUES (p_checklist_date, p_responsible_name, 'OPEN')
    RETURNING id INTO v_checklist_id;

    -- Insert one checklist item per active task, default status = PENDING
    INSERT INTO public.daily_checklist_items (checklist_id, task_id, status)
    SELECT
      v_checklist_id,
      otm.id,
      'PENDING'::public.check_item_status   -- ← was 'OK', now PENDING
    FROM public.operational_tasks_master otm
    WHERE otm.is_active = true               -- adjust column name if different
    ORDER BY otm.sort_order;
  END IF;

  -- Return the checklist record
  RETURN QUERY
  SELECT dc.id, dc.checklist_date, dc.responsible_name
    FROM public.daily_checklists dc
   WHERE dc.id = v_checklist_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_get_or_create_daily_checklist(date, text)
  TO authenticated;
