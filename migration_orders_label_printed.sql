-- ============================================================
-- Migration: Track label printing per order
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS label_printed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.label_printed IS
  'TRUE when the shipping/name label has been printed for this order. Visual only — does not affect order status or billing.';
