import { supabase } from '../supabase';

// =====================================================
// TYPES & INTERFACES
// =====================================================

export type DocType = 'factura' | 'recibo' | 'contrato' | 'otro';

export interface FinanceDocument {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  doc_date: string | null;
  doc_type: DocType;
  vendor: string | null;
  description: string | null;
  amount_mxn: number | null;
  file_name: string;
  file_ext: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  document_kind: string | null;
  linked_expense_id: string | null;
  linked_fixed_cost_id: string | null;
  tags: string[] | null;
  notes: string | null;
}

export interface UploadDocumentPayload {
  file: File;
  doc_date?: string | null;
  doc_type: DocType;
  vendor?: string | null;
  description?: string | null;
  amount_mxn?: number | null;
  linked_expense_id?: string | null;
  linked_fixed_cost_id?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

export interface UpdateDocumentPayload {
  doc_date?: string | null;
  doc_type?: DocType;
  vendor?: string | null;
  description?: string | null;
  amount_mxn?: number | null;
  linked_expense_id?: string | null;
  linked_fixed_cost_id?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

// =====================================================
// CONSTANTS
// =====================================================

export const FINANCE_DOCS_BUCKET = 'expense-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg'
];

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Generate safe file path for storage
 */
const generateStoragePath = (userId: string, fileName: string): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.getTime();
  
  // Sanitize filename
  const safeFileName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_');
  
  return `${userId}/${year}/${month}/${timestamp}_${safeFileName}`;
};

/**
 * Validate file before upload
 */
const validateFile = (file: File): { valid: boolean; error?: string } => {
  if (!file) {
    return { valid: false, error: 'No se seleccionó ningún archivo' };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `El archivo excede el tamaño máximo de ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: 'Tipo de archivo no permitido. Solo: PDF, JPG, PNG, WEBP' };
  }
  
  return { valid: true };
};

/**
 * Get file extension from filename
 */
const getFileExtension = (fileName: string): string | null => {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : null;
};

// =====================================================
// PUBLIC API FUNCTIONS
// =====================================================

/**
 * Upload a finance document with metadata
 */
export const uploadFinanceDoc = async (
  payload: UploadDocumentPayload
): Promise<{ data: FinanceDocument | null; error: Error | null }> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    // Validate file
    const validation = validateFile(payload.file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Usuario no autenticado');
    }

    // Generate storage path
    const storagePath = generateStoragePath(user.id, payload.file.name);

    // Upload file to storage
    const { error: uploadError } = await supabase.storage
      .from(FINANCE_DOCS_BUCKET)
      .upload(storagePath, payload.file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Error al subir archivo: ${uploadError.message}`);
    }

    // Insert metadata record
    const { data: docData, error: insertError } = await supabase
      .from('finance_documents')
      .insert({
        user_id: user.id,
        doc_date: payload.doc_date || null,
        doc_type: payload.doc_type,
        vendor: payload.vendor || null,
        description: payload.description || null,
        amount_mxn: payload.amount_mxn || null,
        file_name: payload.file.name,
        file_ext: getFileExtension(payload.file.name),
        mime_type: payload.file.type,
        file_size_bytes: payload.file.size,
        storage_bucket: FINANCE_DOCS_BUCKET,
        storage_path: storagePath,
        linked_expense_id: payload.linked_expense_id || null,
        linked_fixed_cost_id: payload.linked_fixed_cost_id || null,
        tags: payload.tags || null,
        notes: payload.notes || null
      })
      .select()
      .single();

    if (insertError) {
      // Rollback: delete uploaded file
      await supabase.storage.from(FINANCE_DOCS_BUCKET).remove([storagePath]);
      throw new Error(`Error al guardar metadata: ${insertError.message}`);
    }

    return { data: docData, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
};

/**
 * List all finance documents for current user
 * Optional: filter by month
 */
export const listFinanceDocs = async (
  monthStart?: string
): Promise<{ data: FinanceDocument[] | null; error: Error | null }> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    let query = supabase
      .from('finance_documents')
      .select('*')
      .order('created_at', { ascending: false });

    // Optional: filter by month
    if (monthStart) {
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      query = query.or(
        `doc_date.gte.${monthStart},doc_date.lt.${monthEnd.toISOString().split('T')[0]}`
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error al listar documentos: ${error.message}`);
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
};

/**
 * Update finance document metadata
 */
export const updateFinanceDoc = async (
  id: string,
  payload: UpdateDocumentPayload
): Promise<{ data: FinanceDocument | null; error: Error | null }> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    const { data, error } = await supabase
      .from('finance_documents')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error al actualizar documento: ${error.message}`);
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
};

/**
 * Delete finance document (removes file from storage and DB record)
 */
export const deleteFinanceDoc = async (
  id: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    // Get document to retrieve storage_path
    const { data: doc, error: fetchError } = await supabase
      .from('finance_documents')
      .select('storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !doc) {
      throw new Error('Documento no encontrado');
    }

    // Delete file from storage
    const { error: storageError } = await supabase.storage
      .from(FINANCE_DOCS_BUCKET)
      .remove([doc.storage_path]);

    if (storageError) {
      console.warn('Error al eliminar archivo del storage:', storageError);
      // Continue anyway to delete DB record
    }

    // Delete DB record
    const { error: deleteError } = await supabase
      .from('finance_documents')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw new Error(`Error al eliminar registro: ${deleteError.message}`);
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err as Error };
  }
};

/**
 * Get signed URL for viewing/downloading private file
 */
export const getFinanceDocSignedUrl = async (
  storagePath: string,
  expiresIn: number = 300 // 5 minutes default
): Promise<{ url: string | null; error: Error | null }> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    const { data, error } = await supabase.storage
      .from(FINANCE_DOCS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      throw new Error(`Error al generar URL: ${error.message}`);
    }

    return { url: data.signedUrl, error: null };
  } catch (err) {
    return { url: null, error: err as Error };
  }
};

/**
 * Download file (opens in new tab)
 */
export const downloadFinanceDoc = async (
  storagePath: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { url, error } = await getFinanceDocSignedUrl(storagePath, 60);
    
    if (error || !url) {
      throw new Error(error?.message || 'Error al generar URL de descarga');
    }

    // Open in new tab
    window.open(url, '_blank');

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err as Error };
  }
};

/**
 * Validate if the finance_docs bucket exists
 * Attempts a simple operation to check bucket accessibility
 */
export const validateFinanceDocsBucket = async (): Promise<{
  exists: boolean;
  error: Error | null;
}> => {
  try {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    // Try to list files in the bucket (empty list is OK, we just need to check if bucket exists)
    const { error } = await supabase.storage
      .from(FINANCE_DOCS_BUCKET)
      .list('', { limit: 1 });

    if (error) {
      // Bucket not found or no access
      if (error.message.includes('Bucket not found') || error.message.includes('not found')) {
        console.error(`❌ Bucket "${FINANCE_DOCS_BUCKET}" no existe en Supabase Storage`);
        throw new Error(`El bucket "${FINANCE_DOCS_BUCKET}" no existe en Supabase Storage. Créalo en Dashboard → Storage`);
      }
      throw new Error(`Error al verificar bucket: ${error.message}`);
    }

    console.log(`✅ Bucket "${FINANCE_DOCS_BUCKET}" verificado correctamente`);
    return { exists: true, error: null };
  } catch (err) {
    return { exists: false, error: err as Error };
  }
};
