-- ============================================================================
-- CORRECCIÓN: wholesale_payments.payment_date bug UTC
-- ============================================================================
-- Date: 2026-08-07
-- Issue: Payment dated 2026-08-08 should be 2026-08-07 (registered at night Mexico time)
--
-- Root Cause:
--   ReportPaymentModal.tsx line 31 used: new Date().toISOString().split('T')[0]
--   This returns UTC date, not Mexico business date.
--   When user reports payment at 23:30 Mexico time on Aug 7:
--     - Local time: 2026-08-07 23:30 (América/Mexico_City)
--     - UTC time: 2026-08-08 05:30 (GMT+0)
--     - Bug extracted: "2026-08-08" ❌
--     - Correct date: "2026-08-07" ✅
--
-- Solution Applied:
--   Updated ReportPaymentModal.tsx to use getBusinessDateString() helper
--   Helper uses Intl.DateTimeFormat with 'America/Mexico_City' timezone
--
-- SQL Correction:
--   This statement fixes the historical record.
--   DO NOT execute until business logic is verified.
--
-- ============================================================================

BEGIN;

-- Update the wholesale payment record that was incorrectly dated
UPDATE public.wholesale_payments
SET
  payment_date = '2026-08-07 00:00:00+00'::TIMESTAMPTZ,
  updated_at = NOW()
WHERE
  id = '50637f02-0b8d-4b42-87d0-d40421cf47d1'
  AND payment_date = '2026-08-08 00:00:00+00'::TIMESTAMPTZ
  AND amount = 185.00
  AND status = 'completed';

-- Verify the change
SELECT id, payment_date, amount, status, updated_at
FROM public.wholesale_payments
WHERE id = '50637f02-0b8d-4b42-87d0-d40421cf47d1';

COMMIT;

-- ============================================================================
-- VALIDATION CHECK (run after migration):
-- ============================================================================
-- 
-- SELECT * FROM public.wholesale_payments
-- WHERE id = '50637f02-0b8d-4b42-87d0-d40421cf47d1';
-- 
-- Expected result:
-- - payment_date: 2026-08-07 00:00:00+00 (NOT 2026-08-08)
-- - amount: 185.00
-- - status: completed
--
-- ============================================================================
