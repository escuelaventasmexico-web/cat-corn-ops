-- Migration: Piece Sale Corrections Audit System
-- Date: 2026-08-02
-- Description: Complete audit system for piece sale item corrections with RPC and RLS
-- Schema: Uses actual Cat Corn OPS tables and columns

BEGIN;

-- ============================================================================
-- 1. TABLE: seller_piece_sale_corrections
-- ============================================================================

-- Create audit table (if not exists for idempotency)
CREATE TABLE IF NOT EXISTS public.seller_piece_sale_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  sale_id uuid NOT NULL,
  sale_item_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  corrected_by uuid NOT NULL,
  
  -- Correction metadata
  correction_reason text NOT NULL,
  
  -- Snapshots
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  
  -- Financial impact
  previous_sale_total numeric NOT NULL,
  new_sale_total numeric NOT NULL,
  previous_commission_total numeric NOT NULL,
  new_commission_total numeric NOT NULL,
  
  -- Payment tracking
  payment_request_id uuid,
  payment_request_reset boolean NOT NULL DEFAULT false,
  
  -- Timestamps
  corrected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT reason_length CHECK (length(trim(correction_reason)) >= 10),
  CONSTRAINT positive_amounts CHECK (
    previous_sale_total > 0 AND
    new_sale_total > 0 AND
    previous_commission_total >= 0 AND
    new_commission_total >= 0
  ),
  
  -- Foreign keys
  CONSTRAINT fk_sale FOREIGN KEY (sale_id)
    REFERENCES public.seller_piece_sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_item FOREIGN KEY (sale_item_id)
    REFERENCES public.seller_piece_sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller FOREIGN KEY (seller_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_corrected_by FOREIGN KEY (corrected_by)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_request FOREIGN KEY (payment_request_id)
    REFERENCES public.partner_payment_verification_requests(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_corrections_sale_id ON public.seller_piece_sale_corrections(sale_id);
CREATE INDEX IF NOT EXISTS idx_corrections_item_id ON public.seller_piece_sale_corrections(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_corrections_seller_id ON public.seller_piece_sale_corrections(seller_id);
CREATE INDEX IF NOT EXISTS idx_corrections_corrected_by ON public.seller_piece_sale_corrections(corrected_by);
CREATE INDEX IF NOT EXISTS idx_corrections_payment_request ON public.seller_piece_sale_corrections(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_corrections_corrected_at ON public.seller_piece_sale_corrections(corrected_at DESC);

-- ============================================================================
-- 2. VIEW: v_piece_sale_correction_history (New)
-- ============================================================================

DROP VIEW IF EXISTS public.v_piece_sale_correction_history;

CREATE VIEW public.v_piece_sale_correction_history AS
SELECT
  c.id as correction_id,
  c.sale_id,
  s.folio as sale_folio,
  c.sale_item_id,
  c.seller_id,
  sp_seller.full_name as seller_name,
  c.corrected_by,
  sp_corrector.full_name as corrected_by_name,
  c.correction_reason,
  c.before_snapshot,
  c.after_snapshot,
  c.previous_sale_total,
  c.new_sale_total,
  c.previous_commission_total,
  c.new_commission_total,
  c.payment_request_reset,
  c.payment_request_id,
  c.corrected_at
FROM public.seller_piece_sale_corrections c
LEFT JOIN public.seller_piece_sales s ON c.sale_id = s.id
LEFT JOIN public.user_profiles sp_seller ON c.seller_id = sp_seller.id
LEFT JOIN public.user_profiles sp_corrector ON c.corrected_by = sp_corrector.id
ORDER BY c.corrected_at DESC;

-- ============================================================================
-- 3. EXTEND v_piece_sale_history WITH CORRECTION INFO
-- ============================================================================

DROP VIEW IF EXISTS public.v_piece_sale_history;

CREATE VIEW public.v_piece_sale_history AS
WITH sale_items AS (
  SELECT
    sale_id,
    json_agg(
      json_build_object(
        'item_id', id,
        'product_id', product_id,
        'product_sku', product_sku,
        'product_name', product_name,
        'product_variant', product_variant,
        'product_size', product_size,
        'product_grams', product_grams,
        'product_key', product_key,
        'quantity', quantity,
        'unit_retail_price', unit_retail_price,
        'subtotal', subtotal,
        'rule_id', rule_id,
        'unit_commission', unit_commission,
        'commission_total', commission_total
      ) ORDER BY created_at
    ) as items_array
  FROM public.seller_piece_sale_items
  GROUP BY sale_id
),
corrections_summary AS (
  SELECT
    sale_id,
    COUNT(*) as corrections_count,
    MAX(correction_reason) as latest_correction_reason,
    MAX(corrected_at) as latest_correction_at,
    MAX(sp.full_name) as latest_corrected_by_name
  FROM public.seller_piece_sale_corrections c
  LEFT JOIN public.user_profiles sp ON c.corrected_by = sp.id
  GROUP BY sale_id
)
SELECT
  s.id as sale_id,
  s.folio,
  s.seller_id,
  up.full_name as seller_name,
  s.sale_date,
  s.payment_method,
  s.payment_reference,
  s.notes,
  s.total_amount,
  s.total_commission,
  s.status,
  s.confirmed_at,
  s.created_at,
  s.updated_at,
  COALESCE(
    (SELECT SUM(quantity)::integer FROM public.seller_piece_sale_items WHERE sale_id = s.id),
    0
  ) as total_units,
  COALESCE(si.items_array, '[]'::json) as items,
  COALESCE(cs.corrections_count, 0) as corrections_count,
  cs.latest_correction_reason,
  cs.latest_correction_at,
  cs.latest_corrected_by_name,
  COALESCE(cs.corrections_count, 0) > 0 as has_corrections
FROM public.seller_piece_sales s
LEFT JOIN public.user_profiles up ON s.seller_id = up.id
LEFT JOIN sale_items si ON s.id = si.sale_id
LEFT JOIN corrections_summary cs ON s.id = cs.sale_id;

-- ============================================================================
-- 4. RPC: correct_piece_sale_item
-- ============================================================================

DROP FUNCTION IF EXISTS public.correct_piece_sale_item(uuid, uuid, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.correct_piece_sale_item(
  p_sale_id uuid,
  p_sale_item_id uuid,
  p_new_product_id uuid,
  p_new_quantity integer,
  p_reason text
)
RETURNS TABLE (
  sale_id uuid,
  sale_folio text,
  sale_item_id uuid,
  previous_total numeric,
  new_total numeric,
  previous_commission numeric,
  new_commission numeric,
  payment_request_status text,
  payment_request_reset boolean,
  correction_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_uid uuid;
  v_sale_record public.seller_piece_sales%ROWTYPE;
  v_item_record public.seller_piece_sale_items%ROWTYPE;
  v_new_product public.products%ROWTYPE;
  v_is_admin boolean;
  v_seller_role text;
  
  v_previous_total numeric;
  v_previous_commission numeric;
  v_new_total numeric;
  v_new_commission numeric;
  
  v_product_key text;
  v_rule_id uuid;
  v_unit_commission numeric;
  v_new_subtotal numeric;
  v_new_commission_total numeric;
  
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_correction_id uuid;
  
  v_commission_event_record public.commission_events%ROWTYPE;
  v_payment_request_record public.partner_payment_verification_requests%ROWTYPE;
  v_should_reset_payment boolean := false;
  
  v_other_item_exists boolean;
  v_payment_reset_id uuid;
  
  v_new_total_all numeric;
  v_new_commission_all numeric;
  v_product_name_actual text;
  v_product_grams_actual numeric;
BEGIN
  -- Get current user
  v_current_uid := auth.uid();
  IF v_current_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Get sale with lock
  SELECT * INTO v_sale_record FROM public.seller_piece_sales
    WHERE id = p_sale_id FOR UPDATE;
  
  IF v_sale_record IS NULL THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  -- Get item with lock
  SELECT * INTO v_item_record FROM public.seller_piece_sale_items
    WHERE id = p_sale_item_id AND sale_id = p_sale_id FOR UPDATE;
  
  IF v_item_record IS NULL THEN
    RAISE EXCEPTION 'Artículo no encontrado en esta venta';
  END IF;

  -- Check authorization
  SELECT role INTO v_seller_role FROM public.user_profiles WHERE id = v_current_uid;
  v_is_admin := v_seller_role = 'admin';
  
  IF NOT v_is_admin AND v_current_uid != v_sale_record.seller_id THEN
    RAISE EXCEPTION 'No autorizado para corregir esta venta';
  END IF;

  -- Validate sale status
  IF v_sale_record.status NOT IN ('draft', 'pending_review', 'payment_rejected') THEN
    RAISE EXCEPTION 'No se puede corregir venta con estado: %', v_sale_record.status;
  END IF;

  -- Check no commission events with problematic status
  IF EXISTS (
    SELECT 1 FROM public.commission_events
    WHERE source_id = p_sale_id
      AND source_item_id = p_sale_item_id
      AND source_type = 'piece_sale'
      AND status IN ('available', 'paid', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'No se puede corregir: existen eventos de comisión en estado conflictivo';
  END IF;

  -- Validate reason
  IF length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'La razón debe tener al menos 10 caracteres';
  END IF;

  -- Validate new quantity
  IF p_new_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  -- Get new product
  SELECT * INTO v_new_product FROM public.products
    WHERE id = p_new_product_id;
  
  IF v_new_product IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  -- Check if product is active (active column, not is_active)
  IF NOT COALESCE(v_new_product.active, true) THEN
    RAISE EXCEPTION 'Producto inactivo';
  END IF;

  IF COALESCE(v_new_product.price, 0) <= 0 THEN
    RAISE EXCEPTION 'Producto sin precio válido';
  END IF;

  -- Check product not already in sale (except current item)
  v_other_item_exists := EXISTS (
    SELECT 1 FROM public.seller_piece_sale_items
    WHERE sale_id = p_sale_id
      AND id != p_sale_item_id
      AND product_id = p_new_product_id
  );
  
  IF v_other_item_exists THEN
    RAISE EXCEPTION 'Este producto ya está incluido en la venta. Modifica esa línea en lugar de crear un duplicado.';
  END IF;

  -- Get actual product name (product_name first, fall back to name)
  v_product_name_actual := COALESCE(
    NULLIF(trim(v_new_product.product_name), ''),
    v_new_product.name
  );

  -- Get actual grams (weight_grams first, fall back to grams)
  v_product_grams_actual := COALESCE(
    v_new_product.weight_grams,
    v_new_product.grams
  );

  -- Calculate product key (using 2 parameters: name and flavor)
  v_product_key := public.commission_product_key(
    v_product_name_actual,
    v_new_product.flavor
  );

  -- Get commission rule
  v_rule_id := public.get_commission_rule_id(
    'venta_pieza'::text,
    v_product_key,
    v_sale_record.sale_date::date
  );

  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'No existe regla de comisión vigente para este producto';
  END IF;

  -- Get commission amount
  v_unit_commission := public.get_commission_rule_amount(
    'venta_pieza'::text,
    v_product_key,
    v_sale_record.sale_date::date
  );

  IF v_unit_commission IS NULL OR v_unit_commission < 0 THEN
    RAISE EXCEPTION 'No se pudo calcular comisión';
  END IF;

  -- Calculate new values
  v_new_subtotal := COALESCE(v_new_product.price, 0) * p_new_quantity;
  v_new_commission_total := v_unit_commission * p_new_quantity;

  -- Save previous totals
  v_previous_total := v_sale_record.total_amount;
  v_previous_commission := v_sale_record.total_commission;

  -- Create before snapshot
  v_before_snapshot := jsonb_build_object(
    'product_id', v_item_record.product_id,
    'product_sku', v_item_record.product_sku,
    'product_name', v_item_record.product_name,
    'product_variant', v_item_record.product_variant,
    'product_size', v_item_record.product_size,
    'product_grams', v_item_record.product_grams,
    'product_key', v_item_record.product_key,
    'quantity', v_item_record.quantity,
    'unit_retail_price', v_item_record.unit_retail_price,
    'subtotal', v_item_record.subtotal,
    'rule_id', v_item_record.rule_id,
    'unit_commission', v_item_record.unit_commission,
    'commission_total', v_item_record.commission_total
  );

  -- Update sale item (no updated_at - seller_piece_sale_items doesn't have it)
  UPDATE public.seller_piece_sale_items
  SET
    product_id = p_new_product_id,
    product_sku = COALESCE(v_new_product.sku_code, ''),
    product_name = v_product_name_actual,
    product_variant = v_new_product.flavor,
    product_size = v_new_product.size,
    product_grams = v_product_grams_actual,
    product_key = v_product_key,
    quantity = p_new_quantity,
    unit_retail_price = COALESCE(v_new_product.price, 0),
    subtotal = v_new_subtotal,
    rule_id = v_rule_id,
    unit_commission = v_unit_commission,
    commission_total = v_new_commission_total
  WHERE id = p_sale_item_id;

  -- Create after snapshot
  v_after_snapshot := jsonb_build_object(
    'product_id', p_new_product_id,
    'product_sku', COALESCE(v_new_product.sku_code, ''),
    'product_name', v_product_name_actual,
    'product_variant', v_new_product.flavor,
    'product_size', v_new_product.size,
    'product_grams', v_product_grams_actual,
    'product_key', v_product_key,
    'quantity', p_new_quantity,
    'unit_retail_price', COALESCE(v_new_product.price, 0),
    'subtotal', v_new_subtotal,
    'rule_id', v_rule_id,
    'unit_commission', v_unit_commission,
    'commission_total', v_new_commission_total
  );

  -- Find commission event (using commission_events, not seller_commission_events)
  SELECT * INTO v_commission_event_record
  FROM public.commission_events
  WHERE source_id = p_sale_id
    AND source_item_id = p_sale_item_id
    AND source_type = 'piece_sale'
    AND status = 'pending'
  LIMIT 1;

  IF v_commission_event_record.id IS NOT NULL THEN
    -- Update existing event
    UPDATE public.commission_events
    SET
      rule_id = v_rule_id,
      product_key = v_product_key,
      product_name = v_product_name_actual,
      product_variant = v_new_product.flavor,
      product_size = v_new_product.size,
      quantity = p_new_quantity,
      unit_commission = v_unit_commission,
      commission_amount = v_new_commission_total,
      metadata = metadata || jsonb_build_object(
        'corrected', true,
        'last_correction_reason', p_reason,
        'last_corrected_at', now()::text,
        'last_corrected_by', v_current_uid::text,
        'previous_product', (v_before_snapshot->>'product_name'),
        'previous_commission_amount', (v_before_snapshot->>'commission_total')::numeric
      ),
      updated_at = now()
    WHERE id = v_commission_event_record.id;
  ELSE
    -- Commission event missing - abort correction
    RAISE EXCEPTION 'Evento de comisión faltante para esta venta. Contacta soporte.';
  END IF;

  -- Recalculate sale totals from all items
  SELECT
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(commission_total), 0)
  INTO v_new_total_all, v_new_commission_all
  FROM public.seller_piece_sale_items
  WHERE sale_id = p_sale_id;

  -- Update sale totals
  UPDATE public.seller_piece_sales
  SET
    total_amount = v_new_total_all,
    total_commission = v_new_commission_all,
    updated_at = now()
  WHERE id = p_sale_id;

  v_new_total := v_new_total_all;
  v_new_commission := v_new_commission_all;

  -- Handle payment request update (using piece_sale_id and scheme)
  SELECT * INTO v_payment_request_record
  FROM public.partner_payment_verification_requests
  WHERE piece_sale_id = p_sale_id
    AND scheme = 'venta_pieza'
    AND status IN ('draft', 'pending_review', 'rejected')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment_request_record.id IS NOT NULL THEN
    IF v_payment_request_record.payment_method = 'cash' THEN
      -- For cash: just update amount, keep in review
      UPDATE public.partner_payment_verification_requests
      SET
        amount = v_new_total,
        updated_at = now()
      WHERE id = v_payment_request_record.id;
      
      v_should_reset_payment := false;

    ELSIF v_payment_request_record.payment_method = 'transfer' THEN
      -- For transfer: check if amount changed
      IF v_payment_request_record.amount != v_new_total THEN
        -- Amount changed: reset payment
        UPDATE public.partner_payment_verification_requests
        SET
          status = 'draft',
          amount = v_new_total,
          submitted_at = NULL,
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_notes = NULL,
          rejection_reason = NULL,
          proof_path = NULL,
          proof_file_name = NULL,
          proof_mime_type = NULL,
          proof_size_bytes = NULL,
          approved_payment_id = NULL,
          updated_at = now()
        WHERE id = v_payment_request_record.id;

        -- Update sale to draft
        UPDATE public.seller_piece_sales
        SET
          status = 'draft',
          updated_at = now()
        WHERE id = p_sale_id;

        v_should_reset_payment := true;
        v_payment_reset_id := v_payment_request_record.id;

      ELSE
        -- Amount didn't change: keep as is
        UPDATE public.partner_payment_verification_requests
        SET
          updated_at = now()
        WHERE id = v_payment_request_record.id;
        
        v_should_reset_payment := false;
      END IF;

    END IF;
  END IF;

  -- Create correction record
  INSERT INTO public.seller_piece_sale_corrections (
    sale_id,
    sale_item_id,
    seller_id,
    corrected_by,
    correction_reason,
    before_snapshot,
    after_snapshot,
    previous_sale_total,
    new_sale_total,
    previous_commission_total,
    new_commission_total,
    payment_request_id,
    payment_request_reset
  )
  VALUES (
    p_sale_id,
    p_sale_item_id,
    v_sale_record.seller_id,
    v_current_uid,
    p_reason,
    v_before_snapshot,
    v_after_snapshot,
    v_previous_total,
    v_new_total,
    v_previous_commission,
    v_new_commission,
    COALESCE(v_payment_reset_id, v_payment_request_record.id),
    v_should_reset_payment
  )
  RETURNING id INTO v_correction_id;

  -- Return result
  RETURN QUERY
  SELECT
    p_sale_id,
    v_sale_record.folio,
    p_sale_item_id,
    v_previous_total,
    v_new_total,
    v_previous_commission,
    v_new_commission,
    COALESCE(v_payment_request_record.status, 'none')::text,
    v_should_reset_payment,
    v_correction_id;
END;
$$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.seller_piece_sale_corrections ENABLE ROW LEVEL SECURITY;

-- Vendedor puede ver solo sus correcciones, admin ve todas
DROP POLICY IF EXISTS seller_view_own_corrections ON public.seller_piece_sale_corrections;
CREATE POLICY seller_view_own_corrections ON public.seller_piece_sale_corrections
FOR SELECT
USING (
  seller_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- No INSERT directo desde frontend
DROP POLICY IF EXISTS prevent_insert ON public.seller_piece_sale_corrections;
CREATE POLICY prevent_insert ON public.seller_piece_sale_corrections
FOR INSERT
WITH CHECK (false);

-- No UPDATE directo
DROP POLICY IF EXISTS prevent_update ON public.seller_piece_sale_corrections;
CREATE POLICY prevent_update ON public.seller_piece_sale_corrections
FOR UPDATE
USING (false);

-- No DELETE directo
DROP POLICY IF EXISTS prevent_delete ON public.seller_piece_sale_corrections;
CREATE POLICY prevent_delete ON public.seller_piece_sale_corrections
FOR DELETE
USING (false);

-- Grant RPC execution to authenticated users
GRANT EXECUTE ON FUNCTION public.correct_piece_sale_item(uuid, uuid, uuid, integer, text) TO authenticated;

-- ============================================================================
-- 6. NOTIFICATION AND COMMIT
-- ============================================================================

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- 7. VALIDATION QUERIES (Run after migration succeeds)
-- ============================================================================

/*

-- Validate table created
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'seller_piece_sale_corrections';

-- Validate RPC created
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'correct_piece_sale_item';

-- Validate view created
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name = 'v_piece_sale_correction_history';

-- Check RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'seller_piece_sale_corrections';

-- Verify commission_events not altered
SELECT COUNT(*) as commission_events_count
FROM public.commission_events
WHERE source_type = 'piece_sale';

-- Verify seller_piece_sales not altered
SELECT COUNT(*) as piece_sales_count
FROM public.seller_piece_sales;

-- Verify inventory not altered
SELECT COUNT(*) as total_inventory_items
FROM public.v_seller_piece_stock;

*/
