-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Exclude piece_sale commissions when payment is rejected
-- ═════════════════════════════════════════════════════════════════════════════
--
-- PURPOSE:
-- When a piece_sale payment is rejected (seller_piece_sales.status='payment_rejected'),
-- the associated commission_events should be excluded from "pending" calculations
-- until the sale is corrected and resubmitted.
--
-- MECHANISM:
-- Create a helper view that filters out piece_sale commission events whose
-- related sale is in payment_rejected status.
--
-- ═════════════════════════════════════════════════════════════════════════════

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. Create helper view: v_commission_events_effective
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- This view returns only "effective" commission events:
-- - For piece_sale events: excludes those where seller_piece_sales.status='payment_rejected'
-- - For other events: returns all (unchanged)

DROP VIEW IF EXISTS public.v_commission_events_effective;

CREATE VIEW public.v_commission_events_effective AS
SELECT
  ce.*
FROM public.commission_events ce
WHERE
  -- If it's NOT a piece_sale, always include
  ce.source_type != 'piece_sale'
  OR
  -- If it IS a piece_sale, only include if the sale is NOT payment_rejected
  (
    ce.source_type = 'piece_sale'
    AND NOT EXISTS (
      SELECT 1
      FROM public.seller_piece_sales sps
      WHERE sps.id = ce.source_id
        AND sps.status = 'payment_rejected'
    )
  );

-- Verify view created
SELECT COUNT(*) as effective_commissions_count
FROM public.v_commission_events_effective
WHERE source_type = 'piece_sale';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. DROP AND RECREATE v_seller_commission_movements to use effective events
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- This view shows seller commission movements
-- By using v_commission_events_effective, it automatically excludes
-- piece_sale events whose sale is payment_rejected

DROP VIEW IF EXISTS public.v_seller_commission_movements CASCADE;

CREATE VIEW public.v_seller_commission_movements AS
SELECT
  ce.id as commission_event_id,
  ce.seller_id,
  ce.partner_id,
  p.folio as partner_folio,
  p.business_name,
  p.responsible_name,
  ce.earned_at,
  ce.source_type,
  ce.source_id,
  ce.source_item_id,
  ce.source_folio,
  ce.product_key,
  ce.product_name,
  ce.product_variant,
  ce.product_size,
  ce.quantity,
  ce.unit_commission,
  ce.commission_amount,
  ce.release_condition,
  ce.status,
  ce.available_at,
  ce.paid_at,
  ce.cancelled_at,
  ce.created_at,
  ce.updated_at
FROM public.v_commission_events_effective ce
LEFT JOIN public.user_profiles p ON ce.partner_id = p.id
WHERE ce.seller_id IS NOT NULL;

-- Verify view created
SELECT COUNT(*) FROM public.v_seller_commission_movements;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. TEST: Verify piece_sale with payment_rejected is excluded
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- After this migration, if a seller_piece_sales has status='payment_rejected',
-- any associated commission_events will be automatically excluded from:
-- - v_seller_commission_movements
-- - Any dependent views/dashboards using v_seller_commission_movements
--
-- Once the sale is corrected and status changes back to 'draft' or 'pending_review',
-- the commission will reappear automatically in the view.

SELECT
  sps.folio as sale_folio,
  sps.status as sale_status,
  ce.id as event_id,
  ce.commission_amount,
  ce.status as event_status,
  CASE
    WHEN sps.status = 'payment_rejected' THEN 'EXCLUDED (payment_rejected)'
    ELSE 'INCLUDED'
  END as visibility_status
FROM public.commission_events ce
LEFT JOIN public.seller_piece_sales sps ON ce.source_id = sps.id
WHERE ce.source_type = 'piece_sale'
ORDER BY sps.updated_at DESC
LIMIT 20;
