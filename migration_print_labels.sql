-- ============================================================
-- Migration: Print Labels flow
-- Adds barcode_value to products table and creates
-- the print_sku_labels RPC that records label prints.
-- ============================================================

-- 1) Add barcode_value column to products
--    Each product gets a fixed barcode derived from its sku_code.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode_value TEXT;

-- Back-fill existing products: use sku_code as the barcode_value
UPDATE products
SET barcode_value = sku_code
WHERE barcode_value IS NULL AND sku_code IS NOT NULL;

-- Create unique index (allow NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_value
  ON products (barcode_value)
  WHERE barcode_value IS NOT NULL;

-- 2) Table to keep a log of label print runs
CREATE TABLE IF NOT EXISTS label_print_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id),
  units       INT  NOT NULL CHECK (units > 0),
  printed_at  TIMESTAMPTZ DEFAULT NOW(),
  printed_by  UUID REFERENCES profiles(id)
);

-- 3) RPC: print_sku_labels
--    NOTE: This function ALREADY EXISTS in the database.
--    It handles inventory deduction, production logging,
--    and returns JSON: { ok, message, sku_code, barcode_value, units_printed }
--    DO NOT recreate or modify it.
