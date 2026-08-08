import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Loader2, CheckCircle, Eye } from 'lucide-react';
import {
  approvePaymentVerificationRequest,
  rejectPaymentVerificationRequest,
  getPaymentProofSignedUrl,
} from '../../lib/paymentVerificationRpcs';
import type { PendingPaymentVerification } from '../../lib/paymentVerificationRpcs';

interface Props {
  verification: PendingPaymentVerification;
  onClose: () => void;
  onSuccess: () => void;
}

const PaymentVerificationReviewModal: React.FC<Props> = ({
  verification,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'review' | 'reject'>('review');
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [showProof, setShowProof] = useState(false);

  useEffect(() => {
    // Load proof if available
    if (verification.proof_path) {
      loadProof();
    }
  }, [verification.proof_path]);

  const loadProof = async () => {
    setLoadingProof(true);
    try {
      const url = await getPaymentProofSignedUrl(verification.proof_path!, 300);
      setProofUrl(url);
    } catch (err: any) {
      console.error('Error loading proof:', err);
      setError('No se pudo cargar el comprobante');
    } finally {
      setLoadingProof(false);
    }
  };

  const handleApprove = async () => {
    // Guard against double execution
    if (approving) return;

    setApproving(true);
    setError(null);

    console.log('[APPROVE 1] handler started', {
      requestId: verification.request_id,
    });

    try {
      console.log('[APPROVE 2] calling RPC...');
      const result = await approvePaymentVerificationRequest(verification.request_id, '');
      console.log('[APPROVE 3] RPC success', result);

      // RPC was successful - close modal immediately
      console.log('[APPROVE 4] closing modal');
      onClose();

      // Notify parent (best-effort, non-blocking)
      console.log('[APPROVE 5] calling onSuccess');
      try {
        onSuccess();
      } catch (cbErr: any) {
        console.error('[APPROVE] onSuccess callback error (non-blocking):', cbErr);
      }
    } catch (err: any) {
      console.error('[APPROVE ERROR]', err);
      setError(err.message || 'Error al aprobar cobro');
    } finally {
      console.log('[APPROVE 6] finally - setting approving to false');
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('El motivo de rechazo es obligatorio');
      return;
    }

    // Guard against double execution
    if (rejecting) return;

    setRejecting(true);
    setError(null);

    console.log('[REJECT 1] handler started', {
      requestId: verification.request_id,
      rejectReason: rejectReason.trim(),
    });

    try {
      console.log('[REJECT 2] calling RPC...');
      const result = await rejectPaymentVerificationRequest(
        verification.request_id,
        rejectReason.trim()
      );
      console.log('[REJECT 3] RPC success', result);

      // RPC was successful - show success message
      alert('Cobro rechazado. El vendedor podrá corregir la venta y volver a enviarla.');

      // Close modal immediately
      console.log('[REJECT 4] closing modal');
      onClose();

      // Notify parent (best-effort, non-blocking)
      console.log('[REJECT 5] calling onSuccess');
      try {
        onSuccess();
      } catch (cbErr: any) {
        console.error('[REJECT] onSuccess callback error (non-blocking):', cbErr);
      }
    } catch (err: any) {
      console.error('[REJECT ERROR]', err);
      setError(err.message || 'Error al rechazar cobro');
    } finally {
      console.log('[REJECT 6] finally - setting rejecting to false');
      setRejecting(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const formatDate = (date: string) => new Date(date).toLocaleDateString('es-MX');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Revisar cobro reportado</h2>
            <p className="text-sm text-gray-600 mt-1">Folio: {verification.folio}</p>
          </div>
          <button
            onClick={onClose}
            disabled={approving || rejecting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          {/* Verification Details */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-600 uppercase">Vendedor</span>
                <p className="font-medium text-gray-900">{verification.seller_name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Socio</span>
                <p className="font-medium text-gray-900">{verification.business_name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Esquema</span>
                <p className="font-medium text-gray-900">{verification.scheme.toUpperCase()}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Operación</span>
                <p className="font-medium text-gray-900">{verification.source_folio}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Monto reportado</span>
                <p className="font-medium text-gray-900">{formatCurrency(verification.amount)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Método</span>
                <p className="font-medium text-gray-900">
                  {verification.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Fecha de pago</span>
                <p className="font-medium text-gray-900">{formatDate(verification.payment_date)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-600 uppercase">Saldo actual</span>
                <p className="font-medium text-gray-900">
                  {formatCurrency(verification.current_source_balance)}
                </p>
              </div>
            </div>

            {verification.payment_reference && (
              <div className="border-t border-gray-200 pt-3">
                <span className="text-xs text-gray-600 uppercase">Referencia</span>
                <p className="font-mono text-sm text-gray-900">{verification.payment_reference}</p>
              </div>
            )}
          </div>

          {/* Proof */}
          {verification.proof_path && (
            <div className="border rounded-lg p-4">
              <button
                type="button"
                onClick={() => setShowProof(!showProof)}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
              >
                <Eye size={16} />
                {showProof ? 'Ocultar comprobante' : 'Ver comprobante'}
              </button>

              {showProof && (
                <div className="mt-4">
                  {loadingProof ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={20} className="text-gray-400 animate-spin" />
                    </div>
                  ) : proofUrl ? (
                    <div className="bg-gray-100 rounded p-2">
                      {verification.proof_path.toLowerCase().endsWith('.pdf') ? (
                        <a
                          href={proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                        >
                          Abrir PDF
                        </a>
                      ) : (
                        <img
                          src={proofUrl}
                          alt="Comprobante"
                          className="max-w-xs max-h-48 rounded"
                        />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-red-600">No se pudo cargar el comprobante</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Warning Message */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-900">
              <span className="font-semibold">Advertencia:</span> Al confirmar este cobro se
              registrará el pago, se reducirá el saldo del socio y se liberarán las comisiones
              pendientes si la operación está totalmente pagada.
            </p>
          </div>

          {/* Action Buttons */}
          {step === 'review' ? (
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={approving || rejecting}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
              >
                {approving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Confirmando...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Confirmar ingreso
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setStep('reject');
                }}
                disabled={approving || rejecting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Rechazar reporte
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Motivo de rechazo *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  disabled={rejecting}
                  placeholder="Explica por qué se rechaza este cobro..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100"
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setError(null);
                    setRejectReason('');
                    setStep('review');
                  }}
                  disabled={rejecting}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting || !rejectReason.trim()}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {rejecting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Rechazando...
                    </>
                  ) : (
                    'Rechazar'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentVerificationReviewModal;
