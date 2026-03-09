-- =====================================================
-- FINANCE DOCUMENTS MODULE - FULL SCHEMA
-- Para Cat Corn OPS - Gestión de Documentos Financieros
-- =====================================================

-- =====================================================
-- 1. STORAGE BUCKET (ejecutar en Supabase Dashboard -> Storage)
-- =====================================================
-- NOTA: No se puede crear buckets vía SQL directamente en Supabase.
-- Ve a: Supabase Dashboard -> Storage -> Create Bucket
-- Nombre: "finance_docs"
-- Public: NO (privado)
-- File size limit: 10MB
-- Allowed MIME types: application/pdf, image/jpeg, image/png, image/webp

-- =====================================================
-- 2. TABLE: finance_documents
-- =====================================================
CREATE TABLE IF NOT EXISTS public.finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- User ownership
  user_id uuid NOT NULL,
  
  -- Document metadata
  doc_date date NULL,
  doc_type text NOT NULL DEFAULT 'factura' 
    CHECK (doc_type IN ('factura', 'recibo', 'contrato', 'otro')),
  vendor text NULL,
  description text NULL,
  amount_mxn numeric(12, 2) NULL,
  
  -- File metadata
  file_name text NOT NULL,
  file_ext text NULL,
  mime_type text NULL,
  file_size_bytes bigint NULL,
  
  -- Storage references
  storage_bucket text NOT NULL DEFAULT 'finance_docs',
  storage_path text NOT NULL,
  
  -- Links to other tables (nullable, may not exist yet)
  linked_expense_id uuid NULL,
  linked_fixed_cost_id uuid NULL,
  
  -- Additional fields
  tags text[] NULL,
  notes text NULL
);

-- Add foreign keys if tables exist
-- If expenses table exists:
-- ALTER TABLE public.finance_documents 
--   ADD CONSTRAINT fk_linked_expense 
--   FOREIGN KEY (linked_expense_id) 
--   REFERENCES public.expenses(id) 
--   ON DELETE SET NULL;

-- If fixed_costs table exists:
-- ALTER TABLE public.finance_documents 
--   ADD CONSTRAINT fk_linked_fixed_cost 
--   FOREIGN KEY (linked_fixed_cost_id) 
--   REFERENCES public.fixed_costs(id) 
--   ON DELETE SET NULL;

-- =====================================================
-- 3. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_finance_documents_user_created 
  ON public.finance_documents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_documents_doc_date 
  ON public.finance_documents(doc_date DESC) 
  WHERE doc_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_documents_linked_expense 
  ON public.finance_documents(linked_expense_id) 
  WHERE linked_expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_documents_linked_fixed_cost 
  ON public.finance_documents(linked_fixed_cost_id) 
  WHERE linked_fixed_cost_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_documents_doc_type 
  ON public.finance_documents(doc_type);

-- =====================================================
-- 4. TRIGGER: updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.finance_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own documents
CREATE POLICY "Users can view own finance documents"
  ON public.finance_documents
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own documents
CREATE POLICY "Users can insert own finance documents"
  ON public.finance_documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own documents
CREATE POLICY "Users can update own finance documents"
  ON public.finance_documents
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own documents
CREATE POLICY "Users can delete own finance documents"
  ON public.finance_documents
  FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 6. STORAGE POLICIES (for finance_docs bucket)
-- =====================================================
-- NOTA: Estas policies deben configurarse en Supabase Dashboard -> Storage -> finance_docs -> Policies
-- O ejecutar estos statements SQL si tu versión de Supabase lo soporta:

-- Policy: Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload to own folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'finance_docs' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Allow authenticated users to view their own files
CREATE POLICY "Users can view own files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'finance_docs' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Allow authenticated users to update their own files
CREATE POLICY "Users can update own files"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'finance_docs' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'finance_docs' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Allow authenticated users to delete their own files
CREATE POLICY "Users can delete own files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'finance_docs' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================
-- 7. HELPER FUNCTIONS (Optional)
-- =====================================================

-- Function to get documents by month
CREATE OR REPLACE FUNCTION get_finance_documents_by_month(
  p_month_start date,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  doc_date date,
  doc_type text,
  vendor text,
  description text,
  amount_mxn numeric,
  file_name text,
  file_size_bytes bigint,
  storage_path text,
  linked_expense_id uuid,
  linked_fixed_cost_id uuid,
  tags text[],
  notes text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fd.id,
    fd.created_at,
    fd.doc_date,
    fd.doc_type,
    fd.vendor,
    fd.description,
    fd.amount_mxn,
    fd.file_name,
    fd.file_size_bytes,
    fd.storage_path,
    fd.linked_expense_id,
    fd.linked_fixed_cost_id,
    fd.tags,
    fd.notes
  FROM public.finance_documents fd
  WHERE 
    fd.user_id = p_user_id
    AND (
      -- Match by doc_date in the same month
      (fd.doc_date >= p_month_start AND fd.doc_date < (p_month_start + interval '1 month'))
      OR
      -- If doc_date is null, match by created_at
      (fd.doc_date IS NULL AND fd.created_at >= p_month_start::timestamptz AND fd.created_at < (p_month_start + interval '1 month')::timestamptz)
    )
  ORDER BY COALESCE(fd.doc_date, fd.created_at::date) DESC, fd.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 8. GRANT PERMISSIONS (if needed)
-- =====================================================
-- GRANT ALL ON public.finance_documents TO authenticated;
-- GRANT ALL ON public.finance_documents TO service_role;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Check if table was created:
-- SELECT * FROM public.finance_documents LIMIT 1;

-- Check RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'finance_documents';

-- Check policies:
-- SELECT * FROM pg_policies WHERE tablename = 'finance_documents';

-- =====================================================
-- MANUAL STEPS REQUIRED:
-- =====================================================
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Click "Create Bucket"
-- 3. Name: finance_docs
-- 4. Public: NO (keep it private)
-- 5. Configure policies using the SQL above or via Dashboard UI
-- 6. Set file size limit: 10MB
-- 7. Optional: Set allowed MIME types in bucket settings

-- =====================================================
-- ROLLBACK (if needed)
-- =====================================================
-- DROP POLICY IF EXISTS "Users can delete own finance documents" ON public.finance_documents;
-- DROP POLICY IF EXISTS "Users can update own finance documents" ON public.finance_documents;
-- DROP POLICY IF EXISTS "Users can insert own finance documents" ON public.finance_documents;
-- DROP POLICY IF EXISTS "Users can view own finance documents" ON public.finance_documents;
-- DROP TRIGGER IF EXISTS set_updated_at ON public.finance_documents;
-- DROP FUNCTION IF EXISTS update_updated_at_column();
-- DROP FUNCTION IF EXISTS get_finance_documents_by_month(date, uuid);
-- DROP TABLE IF EXISTS public.finance_documents;
-- DELETE FROM storage.buckets WHERE name = 'finance_docs'; -- Use Dashboard instead
