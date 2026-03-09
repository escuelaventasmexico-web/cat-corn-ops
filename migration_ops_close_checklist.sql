-- ============================================================
-- Migration: ops_close_daily_checklist
-- Adds status/closed_at/closed_by columns to daily_checklists
-- and an RPC to close a checklist.
-- Run in: Supabase SQL Editor
-- ============================================================

-- 1. Add columns to daily_checklists if they don't exist
ALTER TABLE public.daily_checklists
  ADD COLUMN IF NOT EXISTS status      text        NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS closed_at   timestamptz          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS closed_by   text                 DEFAULT NULL;

-- Optional: add a check constraint to restrict valid values
ALTER TABLE public.daily_checklists
  DROP CONSTRAINT IF EXISTS daily_checklists_status_check;

ALTER TABLE public.daily_checklists
  ADD CONSTRAINT daily_checklists_status_check
  CHECK (status IN ('OPEN', 'CLOSED'));

-- 2. RPC: ops_close_daily_checklist
CREATE OR REPLACE FUNCTION public.ops_close_daily_checklist(
  p_checklist_id uuid,
  p_closed_by    text
)
RETURNS TABLE (
  id               uuid,
  checklist_date   date,
  responsible_name text,
  status           text,
  closed_at        timestamptz,
  closed_by        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the checklist exists
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_checklists dc
    WHERE dc.id = p_checklist_id
  ) THEN
    RAISE EXCEPTION 'Checklist % not found', p_checklist_id;
  END IF;

  -- Update and return the record
  RETURN QUERY
  UPDATE public.daily_checklists dc
  SET
    status     = 'CLOSED',
    closed_at  = now(),
    closed_by  = p_closed_by
  WHERE dc.id = p_checklist_id
  RETURNING
    dc.id,
    dc.checklist_date,
    dc.responsible_name,
    dc.status,
    dc.closed_at,
    dc.closed_by;
END;
$$;

-- 3. Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.ops_close_daily_checklist(uuid, text)
  TO authenticated;
