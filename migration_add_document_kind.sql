-- ============================================================================
-- ADD document_kind COLUMN to finance_documents
-- ============================================================================
-- Allows storing the kind of document:
--   • invoice_pdf    → PDF de factura
--   • invoice_xml    → XML de factura (CFDI)
--   • receipt_image  → Imagen del ticket/comprobante
--
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================================

-- 1) Add the column (nullable, no default — backwards-compatible)
ALTER TABLE public.finance_documents
  ADD COLUMN IF NOT EXISTS document_kind text NULL;

-- 2) Index for fast lookups by expense + kind
CREATE INDEX IF NOT EXISTS idx_finance_documents_expense_kind
  ON public.finance_documents(linked_expense_id, document_kind);
