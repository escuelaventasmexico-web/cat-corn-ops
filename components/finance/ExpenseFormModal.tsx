import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase';
import { X, Save, Upload, FileText, FileCode, Eye, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { FinanceDocument, FINANCE_DOCS_BUCKET, getFinanceDocSignedUrl } from '../../lib/financeDocuments';

interface Expense {
  id: string;
  expense_date: string;
  amount_mxn: number;
  type: 'FIXED' | 'VARIABLE' | 'OTHER';
  category: string | null;
  vendor: string | null;
  has_invoice: boolean;
  payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  notes: string | null;
  fixed_cost_id: string | null;
}

interface ExpenseFormModalProps {
  expense: Expense | null;
  onClose: () => void;
}

type DocKind = 'invoice_pdf' | 'invoice_xml' | 'receipt_image';

export const ExpenseFormModal = ({ expense, onClose }: ExpenseFormModalProps) => {
  const [formData, setFormData] = useState({
    expense_date: expense?.expense_date || new Date().toISOString().split('T')[0],
    amount_mxn: expense?.amount_mxn || 0,
    type: expense?.type || 'VARIABLE' as const,
    category: expense?.category || '',
    vendor: expense?.vendor || '',
    has_invoice: expense?.has_invoice || false,
    payment_method: expense?.payment_method || 'CASH' as const,
    notes: expense?.notes || '',
    fixed_cost_id: expense?.fixed_cost_id || null
  });
  const [saving, setSaving] = useState(false);

  // ── Multi-document state (keyed by DocKind) ──
  const [existingDocs, setExistingDocs] = useState<Partial<Record<DocKind, FinanceDocument>>>({});
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<DocKind, File>>>({});
  const [uploadingKind, setUploadingKind] = useState<DocKind | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const refFor = (k: DocKind) =>
    k === 'invoice_pdf' ? pdfInputRef : k === 'invoice_xml' ? xmlInputRef : receiptInputRef;

  // Load existing documents when editing
  useEffect(() => {
    if (expense?.id) loadExistingDocs(expense.id);
  }, [expense?.id]);

  // Clear incompatible pending files when toggling has_invoice
  useEffect(() => {
    setPendingFiles(prev => {
      const next = { ...prev };
      if (formData.has_invoice) {
        delete next.receipt_image;
      } else {
        delete next.invoice_pdf;
        delete next.invoice_xml;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.has_invoice]);

  const loadExistingDocs = async (expenseId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('finance_documents')
      .select('*')
      .eq('linked_expense_id', expenseId);
    if (error || !data) return;
    const map: Partial<Record<DocKind, FinanceDocument>> = {};
    for (const doc of data) {
      const kind = doc.document_kind as DocKind | null;
      if (kind && ['invoice_pdf', 'invoice_xml', 'receipt_image'].includes(kind)) {
        map[kind] = doc;
      }
    }
    setExistingDocs(map);
  };

  /** Upload one file to storage and upsert its finance_documents row */
  const uploadOneDoc = async (file: File, expenseId: string, kind: DocKind) => {
    if (!supabase) throw new Error('Supabase no configurado');
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const prefixMap: Record<DocKind, string> = {
      invoice_pdf: 'invoice-pdf',
      invoice_xml: 'invoice-xml',
      receipt_image: 'receipt',
    };
    const storagePath = `expenses/${expenseId}/${prefixMap[kind]}-${ts}-${safeName}`;

    // Delete old file from storage if replacing
    const existing = existingDocs[kind];
    if (existing) {
      await supabase.storage.from(FINANCE_DOCS_BUCKET).remove([existing.storage_path]);
    }

    // Upload new file
    const { error: upErr } = await supabase.storage
      .from(FINANCE_DOCS_BUCKET)
      .upload(storagePath, file, { cacheControl: '3600', upsert: false });
    if (upErr) throw new Error(upErr.message);

    const docTypeMap: Record<DocKind, string> = {
      invoice_pdf: 'factura',
      invoice_xml: 'factura',
      receipt_image: 'recibo',
    };
    const meta = {
      storage_path: storagePath,
      file_size_bytes: file.size,
      file_name: file.name,
      file_ext: file.name.split('.').pop()?.toLowerCase() || null,
      mime_type: file.type || 'application/octet-stream',
      document_kind: kind,
    };

    if (existing) {
      const { data, error } = await supabase
        .from('finance_documents')
        .update({ ...meta, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      setExistingDocs(prev => ({ ...prev, [kind]: data }));
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('finance_documents')
        .insert({
          user_id: user?.id,
          linked_expense_id: expenseId,
          storage_bucket: FINANCE_DOCS_BUCKET,
          doc_type: docTypeMap[kind],
          ...meta,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      setExistingDocs(prev => ({ ...prev, [kind]: data }));
    }
  };

  /** File-select handler factory for each document kind */
  const handleFileForKind = (kind: DocKind) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocError(null);
    if (file.size > 10 * 1024 * 1024) {
      setDocError('El archivo excede 10 MB');
      const r = refFor(kind); if (r.current) r.current.value = '';
      return;
    }

    if (expense?.id) {
      // Existing expense → upload immediately
      setUploadingKind(kind);
      try {
        await uploadOneDoc(file, expense.id, kind);
        setPendingFiles(prev => { const n = { ...prev }; delete n[kind]; return n; });
      } catch (err: any) {
        setDocError(err.message || 'Error al subir archivo');
      } finally {
        setUploadingKind(null);
        const r = refFor(kind); if (r.current) r.current.value = '';
      }
    } else {
      // New expense → stage locally, upload after save
      setPendingFiles(prev => ({ ...prev, [kind]: file }));
      const r = refFor(kind); if (r.current) r.current.value = '';
    }
  };

  const handleViewDoc = async (kind: DocKind) => {
    const doc = existingDocs[kind];
    if (!doc) return;
    const { url, error } = await getFinanceDocSignedUrl(doc.storage_path, 3600);
    if (error || !url) {
      setDocError('Error al generar URL del documento');
      return;
    }
    window.open(url, '_blank');
  };

  /** Reusable document-slot renderer */
  const renderDocSlot = (kind: DocKind, label: string, accept: string, icon: React.ReactNode) => {
    const doc = existingDocs[kind];
    const pending = pendingFiles[kind];
    const busy = uploadingKind === kind;
    const ref = refFor(kind);

    return (
      <div className="bg-[#1C1A1A] border border-white/10 rounded-lg p-4">
        <p className="text-xs font-semibold text-cc-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
          {icon} {label}
        </p>

        {doc ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={18} className="text-cc-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-cc-text-main text-sm truncate">{doc.file_name}</p>
                <p className="text-cc-text-muted text-xs">
                  {doc.file_size_bytes
                    ? doc.file_size_bytes > 1024 * 1024
                      ? `${(doc.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`
                      : `${(doc.file_size_bytes / 1024).toFixed(1)} KB`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => handleViewDoc(kind)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cc-primary/20 text-cc-primary rounded-lg text-sm hover:bg-cc-primary/30 transition-colors">
                <Eye size={14} /> Ver
              </button>
              <button type="button" onClick={() => ref.current?.click()} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#363636] text-cc-text-muted rounded-lg text-sm hover:bg-[#404040] transition-colors disabled:opacity-50">
                {busy ? <><Loader2 size={14} className="animate-spin" /> Subiendo...</> : <><RefreshCw size={14} /> Reemplazar</>}
              </button>
            </div>
          </div>
        ) : pending ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={18} className="text-cc-accent shrink-0" />
              <div className="min-w-0">
                <p className="text-cc-text-main text-sm truncate">{pending.name}</p>
                <p className="text-cc-text-muted text-xs">
                  {pending.size > 1024 * 1024
                    ? `${(pending.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${(pending.size / 1024).toFixed(1)} KB`}
                  {' · Se subirá al guardar'}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => ref.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#363636] text-cc-text-muted rounded-lg text-sm hover:bg-[#404040] transition-colors">
              <RefreshCw size={14} /> Cambiar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => ref.current?.click()} disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-white/10 rounded-lg text-cc-text-muted hover:border-cc-primary/40 hover:text-cc-primary transition-colors disabled:opacity-50 text-sm">
            {busy ? <><Loader2 size={18} className="animate-spin" /> Subiendo...</> : <><Upload size={18} /> Seleccionar archivo</>}
          </button>
        )}

        <input ref={ref} type="file" accept={accept} onChange={handleFileForKind(kind)} className="hidden" />
      </div>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const payload = {
        ...formData,
        category: formData.category || null,
        vendor: formData.vendor || null,
        notes: formData.notes || null,
      };

      let expenseId: string | undefined;

      if (expense) {
        // Update existing expense
        const { error } = await supabase
          .from('expenses')
          .update(payload)
          .eq('id', expense.id);
        if (error) throw error;
        expenseId = expense.id;
      } else {
        // Insert new expense and get its ID
        const { data: newExpense, error } = await supabase
          .from('expenses')
          .insert([payload])
          .select('id')
          .single();
        if (error) throw error;
        expenseId = newExpense?.id;
      }

      // Upload all pending files
      if (expenseId) {
        const entries = Object.entries(pendingFiles) as [DocKind, File][];
        const uploadErrors: string[] = [];
        for (const [kind, file] of entries) {
          try {
            await uploadOneDoc(file, expenseId, kind);
          } catch (err: any) {
            uploadErrors.push(err.message || kind);
          }
        }
        if (uploadErrors.length > 0) {
          alert('Gasto guardado. Algunos documentos fallaron:\n' + uploadErrors.join('\n'));
        }
      }

      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar gasto');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2A2A2A] rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#242424]">
          <h3 className="text-2xl font-bold text-cc-cream">
            {expense ? 'Editar Gasto' : 'Nuevo Gasto'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Fecha *
              </label>
              <input
                type="date"
                value={formData.expense_date}
                onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Monto (MXN) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount_mxn}
                onChange={(e) => setFormData({ ...formData, amount_mxn: parseFloat(e.target.value) || 0 })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Tipo *
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="VARIABLE">Variable</option>
                <option value="FIXED">Fijo</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Método de Pago *
              </label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as any })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Categoría
              </label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                placeholder="Ej: Insumos, Servicios, etc."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Proveedor
              </label>
              <input
                type="text"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                placeholder="Nombre del proveedor"
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.has_invoice}
                  onChange={(e) => setFormData({ ...formData, has_invoice: e.target.checked })}
                  className="w-4 h-4 rounded border-white/10 bg-[#1C1A1A] text-cc-primary focus:ring-2 focus:ring-cc-primary"
                />
                <span className="text-sm text-cc-text-muted">¿Tiene factura?</span>
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Notas
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                rows={3}
                placeholder="Información adicional..."
              />
            </div>
          </div>

          {/* ── Document attachment section ── */}
          <div className="mt-6 pt-5 border-t border-white/10">
            <label className="block text-sm font-medium text-cc-text-muted mb-3">
              <FileText size={16} className="inline mr-1.5 -mt-0.5" />
              Documentos adjuntos
            </label>

            {formData.has_invoice ? (
              <div className="space-y-3">
                {renderDocSlot('invoice_pdf', 'Factura PDF', '.pdf', <FileText size={12} />)}
                {renderDocSlot('invoice_xml', 'Factura XML', '.xml,application/xml,text/xml', <FileCode size={12} />)}

                {((existingDocs.invoice_pdf || pendingFiles.invoice_pdf) &&
                  !(existingDocs.invoice_xml || pendingFiles.invoice_xml)) && (
                  <p className="text-amber-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Falta el XML de la factura
                  </p>
                )}
                {((existingDocs.invoice_xml || pendingFiles.invoice_xml) &&
                  !(existingDocs.invoice_pdf || pendingFiles.invoice_pdf)) && (
                  <p className="text-amber-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Falta el PDF de la factura
                  </p>
                )}
              </div>
            ) : (
              renderDocSlot('receipt_image', 'Ticket / Comprobante', 'image/jpeg,image/png,image/webp', <FileText size={12} />)
            )}

            {docError && (
              <p className="mt-2 text-red-400 text-sm">⚠ {docError}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#363636] hover:bg-[#404040] border border-white/10 rounded-lg text-cc-text-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium disabled:opacity-50"
            >
              <Save size={20} />
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
