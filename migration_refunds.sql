-- ============================================================
-- Migration: Refund / devolución support
-- Run this in Supabase → SQL Editor
-- ============================================================

-- 1. Add refund columns to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS is_refunded  BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- Index for fast "exclude refunded" filter used everywhere
CREATE INDEX IF NOT EXISTS idx_sales_is_refunded ON public.sales (is_refunded);

-- 2. Audit log table for refunds
CREATE TABLE IF NOT EXISTS public.refunds_log (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  sale_id      UUID        NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount       NUMERIC     NOT NULL,
  reason       TEXT,
  refunded_by  UUID        REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: authenticated users can read & insert
ALTER TABLE public.refunds_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read refunds_log"   ON public.refunds_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert refunds_log" ON public.refunds_log FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Helper RPC: mark a sale as refunded + insert audit row
--    Call from the frontend: supabase.rpc('refund_sale', { p_sale_id, p_reason })
CREATE OR REPLACE FUNCTION public.refund_sale(
  p_sale_id UUID,
  p_reason  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_amount NUMERIC;
  v_already BOOLEAN;
BEGIN
  -- Guard: already refunded?
  SELECT is_refunded, total
    INTO v_already, v_amount
    FROM public.sales
   WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_sale_id;
  END IF;

  IF v_already THEN
    RAISE EXCEPTION 'Esta venta ya fue devuelta.';
  END IF;

  -- Mark as refunded
  UPDATE public.sales
     SET is_refunded  = true,
         refunded_at  = NOW(),
         refund_reason = p_reason
   WHERE id = p_sale_id;

  -- Audit log
  INSERT INTO public.refunds_log (sale_id, amount, reason, refunded_by)
  VALUES (p_sale_id, v_amount, p_reason, auth.uid());
END;
$$;

COMMENT ON COLUMN public.sales.is_refunded   IS 'TRUE when the sale has been voided/returned. Never delete — only flag.';
COMMENT ON COLUMN public.sales.refunded_at   IS 'Timestamp when the refund was processed.';
COMMENT ON COLUMN public.sales.refund_reason IS 'Optional reason entered by the cashier.';
