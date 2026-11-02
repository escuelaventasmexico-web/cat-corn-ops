import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase';
import { X, Save, Upload, FileText, FileCode, Eye, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { FinanceDocument, FINANCE_DOCS_BUCKET, getFinanceDocSignedUrl } from '../../lib/financeDocuments';
import { getInitialExpenseDate } from '../../lib/expenseDate.js';
import {
  getExpenseLiquidityTreatment,
  getLegacyPaymentMethod,
  type ExpenseLiquidityTreatment,
  type ExpensePaymentInstrument,
} from '../../lib/availableFunds.js';
import { createFinanceCreditCard, listFinanceCreditCards, type FinanceCreditCard } from '../../services/availableFundsService';
import {
  EXPENSE_CONCEPT_OPTIONS,
  EXPENSE_DESTINATION_OPTIONS,
  getExpenseDestinationLabel,
  getExpenseSaveErrorMessage,
  getLegacyExpenseCategory,
  type ExpenseConceptCode,
  type ManualExpenseDestinationScope,
} from '../../lib/expenseClassification.js';

interface Expense {
  id: string;
  expense_date: string;
  amount_mxn: number;
  type: 'FIXED' | 'VARIABLE' | 'OTHER';
  vendor: string | null;
  has_invoice: boolean;
  payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  notes: string | null;
  fixed_cost_id: string | null;
  is_unbudgeted_fixed?: boolean;
  fixed_cost_unbudgeted_reason?: string | null;
  commission_settlement_id?: string | null;
  concept_code?: ExpenseConceptCode | null;
  destination_scope?: ManualExpenseDestinationScope | 'MIXED' | 'UNKNOWN' | null;
  classification_status?: 'CLASSIFIED' | 'SYSTEM' | null;
  liquidity_treatment?: ExpenseLiquidityTreatment | null;
  payment_instrument?: ExpensePaymentInstrument | null;
  credit_card_id?: string | null;
}

interface ExpenseFormModalProps {
  expense: Expense | null;
  onClose: () => void;
}

type DocKind = 'invoice_pdf' | 'invoice_xml' | 'receipt_image';

interface FixedCostOption {
  id: string;
  name: string;
  scope: string;
  periodicity: string;
  amount_mxn: number | null;
}

export const ExpenseFormModal = ({ expense, onClose }: ExpenseFormModalProps) => {
  const [formData, setFormData] = useState<{
    expense_date: string; amount_mxn: number; type: 'FIXED' | 'VARIABLE' | 'OTHER';
    concept_code: ExpenseConceptCode | ''; destination_scope: ManualExpenseDestinationScope | '';
    vendor: string; has_invoice: boolean;
    payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'; notes: string;
    payment_instrument: ExpensePaymentInstrument | '';
    credit_card_id: string | null;
    fixed_cost_id: string | null; is_unbudgeted_fixed: boolean;
    fixed_cost_unbudgeted_reason: string;
  }>({
    expense_date: getInitialExpenseDate(expense?.expense_date),
    amount_mxn: expense?.amount_mxn || 0,
    type: expense?.type || 'VARIABLE' as const,
    concept_code: expense?.concept_code || '',
    destination_scope: expense?.destination_scope === 'AURRERA'
      || expense?.destination_scope === 'CHIPITLAN'
      || expense?.destination_scope === 'SHARED'
      ? expense.destination_scope
      : '',
    vendor: expense?.vendor || '',
    has_invoice: expense?.has_invoice || false,
    payment_method: expense?.payment_method || 'CASH' as const,
    payment_instrument: expense?.payment_instrument || (expense ? '' : 'CASH'),
    credit_card_id: expense?.credit_card_id || null,
    notes: expense?.notes || '',
    fixed_cost_id: expense?.fixed_cost_id || null,
    is_unbudgeted_fixed: expense?.is_unbudgeted_fixed || false,
    fixed_cost_unbudgeted_reason: expense?.fixed_cost_unbudgeted_reason || ''
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fixedCostOptions, setFixedCostOptions] = useState<FixedCostOption[]>([]);
  const [fixedCostsLoading, setFixedCostsLoading] = useState(false);
  const [creditCards, setCreditCards] = useState<FinanceCreditCard[]>([]);
  const [newCreditCardName, setNewCreditCardName] = useState('');
  const selectedFixedCost = fixedCostOptions.find(option => option.id === formData.fixed_cost_id);
  const fixedCostDestination = selectedFixedCost?.scope === 'AURRERA'
    || selectedFixedCost?.scope === 'CHIPITLAN'
    || selectedFixedCost?.scope === 'SHARED'
    ? selectedFixedCost.scope as ManualExpenseDestinationScope
    : null;

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

  useEffect(() => {
    const client = supabase;
    if (formData.type !== 'FIXED' || !client) {
      setFixedCostOptions([]);
      return;
    }
    const loadOptions = async () => {
      setFixedCostsLoading(true);
      const { data, error } = await client
        .from('fixed_costs')
        .select('id,name,scope,periodicity,amount_mxn')
        .lte('effective_from', formData.expense_date)
        .or(`effective_to.is.null,effective_to.gte.${formData.expense_date}`)
        .order('scope')
        .order('name');
      if (error) setDocError(`No se pudo cargar el catálogo de obligaciones: ${error.message}`);
      setFixedCostOptions((data || []) as FixedCostOption[]);
      setFixedCostsLoading(false);
    };
    loadOptions();
  }, [formData.type, formData.expense_date]);

  useEffect(() => {
    if (formData.payment_instrument !== 'CREDIT_CARD') return;
    listFinanceCreditCards()
      .then(setCreditCards)
      .catch(error => setDocError(`No se pudo cargar el catálogo de tarjetas: ${error.message}`));
  }, [formData.payment_instrument]);

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
    setSaveError(null);
    setSaving(true);

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const requiresClassification = formData.type === 'FIXED' && formData.expense_date >= '2026-11-01';
      if (requiresClassification && !formData.fixed_cost_id && !formData.is_unbudgeted_fixed) {
        throw new Error('Selecciona una obligación o marca el gasto fijo como no presupuestado.');
      }
      if (formData.type === 'FIXED' && formData.is_unbudgeted_fixed && !formData.fixed_cost_unbudgeted_reason.trim()) {
        throw new Error('Explica por qué este gasto fijo no estaba presupuestado.');
      }

      const effectiveDestination = formData.type === 'FIXED' && formData.fixed_cost_id && !formData.is_unbudgeted_fixed
        ? fixedCostDestination
        : formData.destination_scope || null;
      const classificationComplete = Boolean(formData.concept_code && effectiveDestination);
      if (!expense && !classificationComplete) {
        throw new Error('Selecciona el concepto y el destino del gasto.');
      }
      if (formData.type === 'FIXED' && formData.fixed_cost_id && !fixedCostDestination) {
        throw new Error('La obligación seleccionada no tiene un destino utilizable. Revisa su configuración.');
      }
      if (!formData.payment_instrument) {
        throw new Error('Indica cómo se pagó el gasto o si fue una compra a crédito.');
      }
      if (formData.payment_instrument === 'CREDIT_CARD' && !formData.credit_card_id && !newCreditCardName.trim()) {
        throw new Error('Selecciona la tarjeta que generó la obligación o registra su nombre.');
      }

      const legacyCategory = getLegacyExpenseCategory(formData.concept_code);
      const liquidityTreatment = getExpenseLiquidityTreatment(formData.payment_instrument);
      let effectiveCreditCardId = formData.credit_card_id;
      if (liquidityTreatment === 'CREDIT' && !effectiveCreditCardId) {
        const createdCard = await createFinanceCreditCard(newCreditCardName);
        effectiveCreditCardId = createdCard.id;
        setCreditCards(previous => [...previous, createdCard]);
      }
      const payload = {
        expense_date: formData.expense_date,
        amount_mxn: formData.amount_mxn,
        type: formData.type,
        vendor: formData.vendor || null,
        has_invoice: formData.has_invoice,
        payment_method: getLegacyPaymentMethod(formData.payment_instrument),
        payment_instrument: formData.payment_instrument,
        liquidity_treatment: liquidityTreatment,
        credit_card_id: liquidityTreatment === 'CREDIT' ? effectiveCreditCardId : null,
        notes: formData.notes || null,
        fixed_cost_id: formData.type === 'FIXED' && !formData.is_unbudgeted_fixed ? formData.fixed_cost_id : null,
        is_unbudgeted_fixed: formData.type === 'FIXED' && formData.is_unbudgeted_fixed,
        fixed_cost_unbudgeted_reason:
          formData.type === 'FIXED' && formData.is_unbudgeted_fixed
            ? formData.fixed_cost_unbudgeted_reason.trim()
            : null,
        concept_code: classificationComplete ? formData.concept_code : null,
        destination_scope: classificationComplete ? effectiveDestination : null,
        classification_status: classificationComplete ? 'CLASSIFIED' : null,
        // The live table still has legacy category NOT NULL. Keep concept_code
        // canonical and mirror its stable identifier only on new rows.
        ...(!expense ? { category: legacyCategory } : {}),
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
      console.error('Error saving expense:', err);
      setSaveError(getExpenseSaveErrorMessage(err));
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
                onChange={(e) => setFormData({
                  ...formData,
                  type: e.target.value as any,
                  fixed_cost_id: e.target.value === 'FIXED' ? formData.fixed_cost_id : null,
                  is_unbudgeted_fixed: e.target.value === 'FIXED' ? formData.is_unbudgeted_fixed : false,
                  fixed_cost_unbudgeted_reason: e.target.value === 'FIXED' ? formData.fixed_cost_unbudgeted_reason : '',
                })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="VARIABLE">Variable</option>
                <option value="FIXED">Fijo</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            {formData.type === 'FIXED' && (
              <div className="md:col-span-2 bg-orange-500/5 border border-orange-500/25 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-orange-300 mb-2">Obligación del presupuesto</label>
                  <select
                    value={formData.fixed_cost_id || ''}
                    disabled={formData.is_unbudgeted_fixed || fixedCostsLoading}
                    onChange={(e) => setFormData({ ...formData, fixed_cost_id: e.target.value || null })}
                    className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main disabled:opacity-50"
                  >
                    <option value="">{fixedCostsLoading ? 'Cargando…' : 'Seleccionar obligación…'}</option>
                    {fixedCostOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.scope} · {option.name} · {option.amount_mxn == null ? 'importe pendiente' : `$${Number(option.amount_mxn).toLocaleString('es-MX')}`}
                      </option>
                    ))}
                  </select>
                </div>
                {formData.expense_date < '2026-11-01' && !formData.fixed_cost_id && !formData.is_unbudgeted_fixed && (
                  <p className="text-xs text-amber-300">
                    Hasta el 31/10/2026 sólo aparecen las obligaciones históricas vigentes. Si ninguna corresponde,
                    deja el gasto sin vincular y clasifica su concepto y destino.
                  </p>
                )}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_unbudgeted_fixed}
                    onChange={(e) => setFormData({
                      ...formData,
                      is_unbudgeted_fixed: e.target.checked,
                      fixed_cost_id: e.target.checked ? null : formData.fixed_cost_id,
                    })}
                    className="mt-1 w-4 h-4 rounded"
                  />
                  <span className="text-sm text-cc-text-muted">Es un gasto fijo no presupuestado</span>
                </label>
                {formData.is_unbudgeted_fixed && (
                  <textarea
                    value={formData.fixed_cost_unbudgeted_reason}
                    onChange={(e) => setFormData({ ...formData, fixed_cost_unbudgeted_reason: e.target.value })}
                    className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main"
                    rows={2}
                    placeholder="Motivo obligatorio"
                    required
                  />
                )}
              </div>
            )}

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Forma de pago y efecto en dinero disponible *
              </label>
              <select
                value={formData.payment_instrument}
                onChange={(e) => {
                  const paymentInstrument = e.target.value as ExpensePaymentInstrument | '';
                  setFormData({
                    ...formData,
                    payment_instrument: paymentInstrument,
                    payment_method: paymentInstrument ? getLegacyPaymentMethod(paymentInstrument) : formData.payment_method,
                    credit_card_id: paymentInstrument === 'CREDIT_CARD' ? formData.credit_card_id : null,
                  });
                }}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="">Seleccionar…</option>
                <option value="CASH">Efectivo</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="DEBIT_CARD">Tarjeta de débito · pago inmediato</option>
                <option value="MERCADO_PAGO">Mercado Pago · disponible/pago inmediato</option>
                <option value="CREDIT_CARD">Tarjeta de crédito · crea obligación</option>
                <option value="OTHER">Otro pago inmediato</option>
              </select>
              {expense && !expense.liquidity_treatment && (
                <p className="mt-1 text-xs text-amber-300">El método histórico no distingue débito, crédito o Mercado Pago; selecciónalo sin inferencias.</p>
              )}
            </div>

            {formData.payment_instrument === 'CREDIT_CARD' && (
              <div className="md:col-span-2 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4">
                <label className="block text-sm font-medium text-blue-200 mb-2">Tarjeta que queda por pagar *</label>
                <select
                  value={formData.credit_card_id || ''}
                  onChange={(e) => setFormData({ ...formData, credit_card_id: e.target.value || null })}
                  className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main"
                  required
                >
                  <option value="">Registrar nueva…</option>
                  {creditCards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
                </select>
                {!formData.credit_card_id && (
                  <input
                    value={newCreditCardName}
                    onChange={(e) => setNewCreditCardName(e.target.value)}
                    className="mt-3 w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main"
                    placeholder="Nombre de la tarjeta"
                    required
                  />
                )}
                <p className="mt-2 text-xs text-cc-text-muted">La compra entra al gasto/P&amp;L, pero no reduce el dinero disponible hasta registrar el pago total o parcial de la tarjeta.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Concepto *
              </label>
              <select
                value={formData.concept_code}
                onChange={(e) => setFormData({ ...formData, concept_code: e.target.value as ExpenseConceptCode | '' })}
                className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required={!expense}
              >
                <option value="">Seleccionar concepto…</option>
                {EXPENSE_CONCEPT_OPTIONS.map(option => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              {expense && !expense.concept_code && (
                <p className="mt-1 text-xs text-amber-300">Registro anterior pendiente de clasificar.</p>
              )}
            </div>

            {formData.type === 'FIXED' && formData.fixed_cost_id && !formData.is_unbudgeted_fixed ? (
              <div>
                <label className="block text-sm font-medium text-cc-text-muted mb-2">Destino</label>
                <div className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main">
                  {fixedCostDestination ? getExpenseDestinationLabel(fixedCostDestination) : 'Pendiente en la obligación'}
                </div>
                <p className="mt-1 text-xs text-cc-text-muted">Se toma de la obligación seleccionada.</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-cc-text-muted mb-2">Destino *</label>
                <select
                  value={formData.destination_scope}
                  onChange={(e) => setFormData({ ...formData, destination_scope: e.target.value as ManualExpenseDestinationScope | '' })}
                  className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                  required={!expense}
                >
                  <option value="">Seleccionar destino…</option>
                  {EXPENSE_DESTINATION_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                {expense && !expense.destination_scope && (
                  <p className="mt-1 text-xs text-amber-300">Registro anterior pendiente de clasificar.</p>
                )}
              </div>
            )}

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

          {saveError && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

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
