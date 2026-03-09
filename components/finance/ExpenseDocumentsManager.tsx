import { useState, useEffect } from 'react';
import { X, Upload, FileText, Eye, Trash2, AlertCircle, CheckCircle, FileUp } from 'lucide-react';
import {
  uploadFinanceDoc,
  listFinanceDocs,
  deleteFinanceDoc,
  downloadFinanceDoc,
  validateFinanceDocsBucket,
  FINANCE_DOCS_BUCKET,
  type FinanceDocument,
  type DocType
} from '../../lib/financeDocuments';

interface ExpenseDocumentsManagerProps {
  onClose: () => void;
}

export const ExpenseDocumentsManager = ({ onClose }: ExpenseDocumentsManagerProps) => {
  const [documents, setDocuments] = useState<FinanceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [bucketError, setBucketError] = useState<string | null>(null);

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocType>('factura');
  const [docDate, setDocDate] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [amountMxn, setAmountMxn] = useState('');
  const [notes, setNotes] = useState('');

  // Format currency
  const formatMXN = (value: number | null) => {
    if (!value) return '$0.00';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(value);
  };

  // Format file size
  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  // Show toast notification
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Load documents
  const loadDocuments = async () => {
    setLoading(true);
    const { data, error } = await listFinanceDocs();
    if (error) {
      showToast('error', error.message);
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
    // Log bucket name on mount
    console.log(`📦 Storage bucket configurado: "${FINANCE_DOCS_BUCKET}"`);
  }, []);

  // Handle opening upload modal with bucket validation
  const handleOpenUploadModal = async () => {
    setBucketError(null);
    
    // Validate bucket exists
    const { exists, error } = await validateFinanceDocsBucket();
    
    if (!exists || error) {
      setBucketError(error?.message || 'Error al validar bucket');
      showToast('error', error?.message || 'Error al validar bucket de almacenamiento');
      return;
    }
    
    setShowUploadModal(true);
  };

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) {
      showToast('error', 'Por favor selecciona un archivo');
      return;
    }

    setUploadLoading(true);

    const { error } = await uploadFinanceDoc({
      file: selectedFile,
      doc_type: docType,
      doc_date: docDate || null,
      vendor: vendor || null,
      description: description || null,
      amount_mxn: amountMxn ? parseFloat(amountMxn) : null,
      notes: notes || null
    });

    setUploadLoading(false);

    if (error) {
      console.error('❌ Error al subir documento:', error.message);
      console.error('📦 Bucket utilizado:', FINANCE_DOCS_BUCKET);
      showToast('error', error.message);
    } else {
      console.log('✅ Documento subido exitosamente');
      showToast('success', 'Documento subido exitosamente');
      setShowUploadModal(false);
      resetForm();
      loadDocuments();
    }
  };

  // Reset form
  const resetForm = () => {
    setSelectedFile(null);
    setDocType('factura');
    setDocDate('');
    setVendor('');
    setDescription('');
    setAmountMxn('');
    setNotes('');
  };

  // Handle delete
  const handleDelete = async (doc: FinanceDocument) => {
    if (!confirm(`¿Eliminar el documento "${doc.file_name}"?`)) return;

    const { error } = await deleteFinanceDoc(doc.id);
    if (error) {
      showToast('error', error.message);
    } else {
      showToast('success', 'Documento eliminado');
      loadDocuments();
    }
  };

  // Handle view/download
  const handleView = async (doc: FinanceDocument) => {
    const { error } = await downloadFinanceDoc(doc.storage_path);
    if (error) {
      showToast('error', error.message);
    }
  };

  // Get doc type badge color
  const getDocTypeBadge = (type: DocType) => {
    const colors = {
      factura: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      recibo: 'bg-green-500/20 text-green-400 border-green-500/30',
      contrato: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      otro: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    };
    return colors[type] || colors.otro;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={32} className="text-cc-primary" />
          <h2 className="text-3xl font-bold text-cc-cream">Documentos y Facturas</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-cc-text-muted" />
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg border flex items-center gap-2 animate-slide-in ${
          toast.type === 'success' 
            ? 'bg-green-950/90 border-green-500/50 text-green-400' 
            : 'bg-red-950/90 border-red-500/50 text-red-400'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Bucket Error Banner */}
      {bucketError && (
        <div className="bg-red-950/30 border border-red-500/50 p-4 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle size={24} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-red-400 font-bold mb-1">Error de Configuración de Storage</h3>
              <p className="text-red-300 text-sm mb-2">{bucketError}</p>
              <div className="bg-red-950/50 border border-red-500/30 rounded p-3 text-xs text-red-200 font-mono">
                <p className="mb-1">Bucket requerido: <strong className="text-red-100">{FINANCE_DOCS_BUCKET}</strong></p>
                <p className="mt-2">Pasos para crear el bucket:</p>
                <ol className="list-decimal list-inside mt-1 space-y-1 ml-2">
                  <li>Ve a Supabase Dashboard → Storage</li>
                  <li>Click "Create Bucket"</li>
                  <li>Nombre: <strong>{FINANCE_DOCS_BUCKET}</strong></li>
                  <li>Public: <strong>NO</strong> (privado)</li>
                  <li>Configura las policies desde el SQL proporcionado</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Button */}
      <div className="flex justify-end">
        <button
          onClick={handleOpenUploadModal}
          className="flex items-center gap-2 px-6 py-3 bg-cc-primary text-cc-bg font-semibold rounded-lg hover:bg-cc-primary/90 transition-colors"
        >
          <Upload size={20} />
          Subir Documento
        </button>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-surface border border-cc-primary/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-cc-cream">Subir Documento</h3>
              <button
                onClick={() => { setShowUploadModal(false); resetForm(); }}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={24} className="text-cc-text-muted" />
              </button>
            </div>

            <div className="space-y-4">
              {/* File Input */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Archivo *
                </label>
                <div className="border-2 border-dashed border-cc-primary/30 rounded-lg p-6 text-center hover:border-cc-primary/60 transition-colors">
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <FileUp size={48} className="mx-auto mb-2 text-cc-primary" />
                    <p className="text-cc-cream font-semibold">
                      {selectedFile ? selectedFile.name : 'Haz clic para seleccionar'}
                    </p>
                    <p className="text-xs text-cc-text-muted mt-1">
                      PDF, JPG, PNG, WEBP (max 10MB)
                    </p>
                  </label>
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Tipo de Documento *
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType)}
                  className="w-full bg-white text-black border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                >
                  <option value="factura">Factura</option>
                  <option value="recibo">Recibo</option>
                  <option value="contrato">Contrato</option>
                  <option value="otro">Otro</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Fecha del Documento
                </label>
                <input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  className="w-full bg-white text-black border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>

              {/* Vendor */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Proveedor / Emisor
                </label>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Ej: Amazon, CFE, etc."
                  className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Monto (MXN)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amountMxn}
                  onChange={(e) => setAmountMxn(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Descripción
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descripción del documento"
                  className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-cc-cream mb-2">
                  Notas
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionales..."
                  rows={3}
                  className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpload}
                  disabled={uploadLoading || !selectedFile}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-cc-primary text-cc-bg font-semibold rounded-lg hover:bg-cc-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-cc-bg border-t-transparent rounded-full animate-spin" />
                      Subiendo...
                    </>
                  ) : (
                    <>
                      <Upload size={20} />
                      Subir
                    </>
                  )}
                </button>
                <button
                  onClick={() => { setShowUploadModal(false); resetForm(); }}
                  className="px-6 py-3 bg-cc-bg border border-cc-primary/30 text-cc-cream rounded-lg hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Documents List */}
      {loading ? (
        <div className="bg-cc-surface p-12 rounded-xl border border-white/5 text-center">
          <div className="w-12 h-12 border-4 border-cc-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cc-cream">Cargando documentos...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="bg-cc-surface p-12 rounded-xl border border-white/5 text-center">
          <FileText size={64} className="mx-auto mb-4 text-cc-text-muted" />
          <h3 className="text-xl font-bold text-cc-cream mb-2">No hay documentos</h3>
          <p className="text-cc-text-muted mb-6">Sube tu primer documento para empezar</p>
          <button
            onClick={handleOpenUploadModal}
            className="inline-flex items-center gap-2 px-6 py-3 bg-cc-primary text-cc-bg font-semibold rounded-lg hover:bg-cc-primary/90 transition-colors"
          >
            <Upload size={20} />
            Subir Documento
          </button>
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-cc-bg border-b border-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Fecha</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Tipo</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Proveedor</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Archivo</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Monto</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Tamaño</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold text-cc-cream">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-sm text-cc-text-muted">
                      {doc.doc_date ? new Date(doc.doc_date).toLocaleDateString('es-MX') : 
                       new Date(doc.created_at).toLocaleDateString('es-MX')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-1 text-xs font-semibold rounded border ${getDocTypeBadge(doc.doc_type)}`}>
                        {doc.doc_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-cc-cream">
                      {doc.vendor || <span className="text-cc-text-muted/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-cc-cream">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-cc-primary" />
                        <span className="truncate max-w-[200px]" title={doc.file_name}>
                          {doc.file_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-cc-cream">
                      {doc.amount_mxn ? formatMXN(doc.amount_mxn) : <span className="text-cc-text-muted/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-cc-text-muted">
                      {formatFileSize(doc.file_size_bytes)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleView(doc)}
                          className="p-2 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors"
                          title="Ver documento"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(doc)}
                          className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Summary */}
          <div className="px-4 py-3 bg-cc-bg border-t border-white/5 text-sm text-cc-text-muted">
            Total: <span className="font-semibold text-cc-cream">{documents.length}</span> documento{documents.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
};
