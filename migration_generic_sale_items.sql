-- ============================================================
-- Migration: Generic / manual sale items support
-- Run this in Supabase → SQL Editor before using "Venta genérica"
-- ============================================================

-- 1. product_name: stores the display name directly on the row.
--    Required when product_id is NULL (generic item, no SKU).
--    Also acts as a denormalized cache for regular items.
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS product_name TEXT;

-- 2. is_generic: marks items that were entered manually without a catalog SKU.
--    These items must NOT affect inventory counts.
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS is_generic BOOLEAN NOT NULL DEFAULT false;

-- ── Sanity check ──────────────────────────────────────────────
-- product_id is already nullable in the original schema (no NOT NULL constraint).
-- No change needed for that column.

-- ── Optional: backfill product_name for existing rows ─────────
-- UPDATE sale_items si
--   SET product_name = COALESCE(p.product_name, p.name)
--   FROM products p
--   WHERE si.product_id = p.id AND si.product_name IS NULL;

COMMENT ON COLUMN sale_items.product_name IS
  'Display name of the product. Required when product_id IS NULL (generic/manual item).';

COMMENT ON COLUMN sale_items.is_generic IS
  'TRUE for manually-entered products with no catalog SKU. Inventory is never decremented for these.';
