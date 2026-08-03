import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, Loader2, AlertCircle } from 'lucide-react';
import {
  PieceSaleHistory,
  PieceSalePaymentRequest,
} from '../../../types/pieceSales';
import {
  formatCurrency,
  formatDateMx,
  sanitizeFileName,
  validateFileSize,
  validateFileType,
  safeNumber,
} from '../../../lib/pieceSalesHelpers';
import { createPieceSalePaymentRequest } from '../../../lib/pieceSalesRpc';
import { submitPaymentVerificationRequest } from '../../../lib/paymentVerificationRpcs';

interface RejectionRetryModalProps {
  sale: PieceSaleHistory;
  onClose: () => void;
  onSuccess: () => void;
}

export const RejectionRetryModal = ({ sale, onClose, onSuccess }: RejectionRetryModalProps) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('transfer');
  const [reference, setReference] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Auto-select payment method based on original sale method
    if (sale.payment_method === 'cash') {
      setPaymentMethod('cash');
    }
  }, [sale.payment_method]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileType(file.type)) {
      setError('Tipo de archivo no permitido. Use JPG, PNG, WebP o PDF.');
      return;
    }

    if (!validateFileSize(file.size)) {
      setError('El archivo es demasiado grande. Máximo 10 MB.');
      return;
    }

    setProofFile(file);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (paymentMethod === 'cash' && !cashConfirmed) {
      setError('Debe confirmar que recibió el efectivo completo');
      return;
    }

    if (paymentMethod === 'transfer' && !proofFile) {
      setError('Debe adjuntar comprobante de transferencia');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const authResponse = await supabase?.auth.getUser();
      const userData = authResponse?.data?.user;
      if (!userData?.id) throw new Error('Usuario no autenticado');

      // Create new payment request
      const payload: PieceSalePaymentRequest = {
        p_sale_id: sale.sale_id,
        p_payment_date: new Date().toISOString(),
        p_payment_method: paymentMethod,
        p_payment_reference: reference || null,
      };

      const requestResponse = await createPieceSalePaymentRequest(payload);

      // Upload proof if transfer
      if (paymentMethod === 'transfer' && proofFile) {
        setUploading(true);

        const fileName = sanitizeFileName(proofFile.name);
        const filePath = `${userData.id}/${requestResponse.request_id}/${Date.now()}-${fileName}`;

        const { error: uploadError } = await supabase!.storage
          .from('customer-payment-proofs')
          .upload(filePath, proofFile, { upsert: false });

        if (uploadError) throw new Error(`Error uploading proof: ${uploadError.message}`);

        // Submit payment
        await submitPaymentVerificationRequest(
          requestResponse.request_id,
          filePath,
          fileName,
          proofFile.type,
          proofFile.size
        );
      } else if (paymentMethod === 'cash') {
        // Submit payment for cash
        await submitPaymentVerificationRequest(
          requestResponse.request_id,
          null,
          null,
          null,
          null
        );
      }

      setSuccess(true);
    } catch (err: any) {
      console.error('Error retrying payment:', err);
      setError(err?.message || 'Error al reintentar pago');
    } finally {
      setLoading(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-cc-bg rounded-3xl border border-white/10 max-w-md w-full overflow-hidden">
        {/* ── HEADER ──────────────────────────────────── */}
        <div className="sticky top-0 bg-cc-surface border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-cc-text-main">Reintentar pago</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cc-surface/80 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-cc-text-muted" />
          </button>
        </div>

        {success ? (
          // ── SUCCESS STATE ────────────────────────── */}
          <div className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 border border-green-500/30 rounded-full mb-4">
              <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-green-400 mb-2">¡Enviado!</h3>
            <p className="text-sm text-cc-text-muted mb-6">
              Tu nuevo reporte de pago ha sido enviado exitosamente
            </p>
            <button
              onClick={() => {
                onClose();
                onSuccess();
              }}
              className="w-full px-4 py-3 bg-cc-primary hover:bg-cc-primary/90 text-cc-surface rounded-xl font-semibold transition-colors"
            >
              Aceptar
            </button>
          </div>
        ) : (
          // ── FORM STATE ──────────────────────────── */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* ── ERROR ───────────────────────────── */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* ── SALE INFO ───────────────────────── */}
            <div className="bg-cc-surface/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-cc-text-muted">Folio:</span>
                <span className="font-mono text-cc-cream">{sale.sale_folio}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-cc-text-muted">Fecha:</span>
                <span className="text-cc-cream">{formatDateMx(sale.sale_date)}</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-white/10 pt-2">
                <span className="text-cc-text-muted">Total:</span>
                <span className="font-bold text-cc-cream">{formatCurrency(safeNumber(sale.total_amount))}</span>
              </div>
            </div>

            {/* ── PAYMENT METHOD ──────────────────── */}
            <div>
              <label className="block text-sm font-semibold text-cc-text-main mb-2">
                Método de pago
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'transfer')}
                className="w-full bg-cc-surface/50 border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
              >
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
              </select>
            </div>

            {/* ── PAYMENT DETAILS ─────────────────── */}
            {paymentMethod === 'cash' && (
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cashConfirmed}
                    onChange={(e) => setCashConfirmed(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-cc-primary"
                  />
                  <span className="text-sm text-blue-300">
                    Confirmo que recibí el importe completo en efectivo
                  </span>
                </label>
              </div>
            )}

            {paymentMethod === 'transfer' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-cc-text-main mb-2">
                    Comprobante *
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={handleFileChange}
                    required
                    className="w-full bg-cc-surface/50 border border-white/10 rounded-lg px-3 py-2 text-cc-text-muted text-sm focus:outline-none focus:border-cc-primary"
                  />
                  <p className="text-xs text-cc-text-muted mt-1">
                    JPG, PNG, WebP o PDF (máx. 10 MB)
                  </p>
                  {proofFile && (
                    <p className="text-xs text-green-400 mt-1">✓ {proofFile.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-cc-text-main mb-2">
                    Referencia
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Número de transferencia, cheque, etc."
                    className="w-full bg-cc-surface/50 border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
                  />
                </div>
              </div>
            )}

            {/* ── BUTTONS ─────────────────────────── */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-cc-surface hover:bg-cc-surface/80 text-cc-text-main rounded-xl font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || uploading}
                className="flex-1 px-4 py-3 bg-cc-primary hover:bg-cc-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-cc-surface rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {loading || uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {uploading ? 'Subiendo...' : 'Enviando...'}
                  </>
                ) : (
                  'Reintentar'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
