import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency } from './commissionUtils';

interface PendingVerification {
  request_id: string;
  folio: string;
  scheme: string;
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  payment_reference?: string;
  proof_path?: string;
  proof_file_name?: string;
  submitted_by: string;
  seller_name: string;
  submitted_at: string;
  movement_id?: string;
  wholesale_order_id?: string;
  source_folio?: string;
  current_source_balance: number;
  minutes_since_submission: number;
}

interface Props {
  refreshTrigger?: number;
  onVerificationApproved?: () => void;
}

export const PendingPaymentVerifications: React.FC<Props> = ({
  refreshTrigger = 0,
  onVerificationApproved
}) => {
  const [verifications, setVerifications] = useState<PendingVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVerification, setSelectedVerification] = useState<PendingVerification | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  const loadPendingVerifications = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('v_pending_payment_verifications')
        .select('*')
        .order('submitted_at', { ascending: false });

      console.log('ADMIN PENDING PAYMENT VERIFICATIONS DATA', data);

      if (err) {
        console.error('ADMIN PENDING PAYMENT VERIFICATIONS ERROR', err);
        throw err;
      }

      setVerifications((data as PendingVerification[]) || []);
    } catch (err: any) {
      console.error('Error loading pending verifications:', err);
      setError('No se pudieron cargar los cobros pendientes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPendingVerifications();
  }, [refreshTrigger]);

  const handleApprove = async () => {
    if (!selectedVerification) return;

    setApproving(true);
    try {
      const { data, error: err } = await supabase!.rpc(
        'approve_partner_payment_verification_request',
        {
          p_request_id: selectedVerification.request_id,
          p_review_notes: reviewNotes || null,
        }
      );

      if (err) throw err;

      console.log('Approval successful:', data);

      // Reload pending verifications
      await loadPendingVerifications();

      // Notify parent to refresh commission data
      onVerificationApproved?.();

      setShowReviewModal(false);
      setSelectedVerification(null);
      setReviewNotes('');
    } catch (err: any) {
      console.error('Error approving verification:', err);
      alert('Error al confirmar el ingreso: ' + (err.message || 'Unknown error'));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedVerification || !rejectionReason.trim()) {
      alert('Debes especificar un motivo de rechazo');
      return;
    }

    setRejecting(true);
    try {
      const { data, error: err } = await supabase!.rpc(
        'reject_partner_payment_verification_request',
        {
          p_request_id: selectedVerification.request_id,
          p_rejection_reason: rejectionReason,
        }
      );

      if (err) throw err;

      console.log('Rejection successful:', data);

      // Reload pending verifications
      await loadPendingVerifications();

      setShowReviewModal(false);
      setSelectedVerification(null);
      setRejectionReason('');
    } catch (err: any) {
      console.error('Error rejecting verification:', err);
      alert('Error al rechazar el reporte: ' + (err.message || 'Unknown error'));
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 text-cc-primary animate-spin" />
      </div>
    );
  }

  if (verifications.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-cc-cream">Cobros pendientes de revisión</h3>
          <p className="text-sm text-cc-text-muted">
            {verifications.length} {verifications.length === 1 ? 'cobro' : 'cobros'} a revisar
          </p>
        </div>
        <div className="px-3 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded-full">
          <span className="text-sm font-semibold text-yellow-300">{verifications.length} pendientes</span>
        </div>
      </div>

      <div className="space-y-3">
        {verifications.map(verification => (
          <div
            key={verification.request_id}
            className="bg-cc-surface rounded-xl border border-white/5 p-4 hover:border-white/10 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-semibold text-cc-cream">
                    {verification.seller_name} reportó {formatCurrency(verification.amount)} de {verification.business_name}
                  </h4>
                  <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded">
                    {verification.folio}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-cc-text-muted">Cliente:</span>
                    <p className="text-cc-cream">{verification.partner_folio}</p>
                  </div>
                  <div>
                    <span className="text-cc-text-muted">Operación:</span>
                    <p className="text-cc-cream capitalize">{verification.scheme}</p>
                  </div>
                  <div>
                    <span className="text-cc-text-muted">Método:</span>
                    <p className="text-cc-cream capitalize">{verification.payment_method}</p>
                  </div>
                  <div>
                    <span className="text-cc-text-muted">Saldo actual:</span>
                    <p className="text-cc-cream">{formatCurrency(verification.current_source_balance)}</p>
                  </div>
                </div>

                <p className="text-xs text-cc-text-muted">
                  Reportado hace {Math.round(verification.minutes_since_submission / 60)} horas
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedVerification(verification);
                  setShowReviewModal(true);
                }}
                className="px-4 py-2 bg-cc-primary hover:bg-cc-primary/90 text-white rounded-lg font-semibold text-sm whitespace-nowrap transition-colors"
              >
                Revisar cobro
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Review Modal */}
      {showReviewModal && selectedVerification && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#171717] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl">
            <div className="p-6 border-b border-white/10 sticky top-0 bg-[#171717]">
              <h2 className="text-2xl font-bold text-cc-cream">Revisar cobro</h2>
              <p className="text-sm text-cc-text-muted mt-1">Folio {selectedVerification.folio}</p>
            </div>

            <div className="p-6 space-y-6">
              {/* Verification Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Vendedor</label>
                    <p className="text-cc-cream mt-1">{selectedVerification.seller_name}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Cliente</label>
                    <p className="text-cc-cream mt-1">{selectedVerification.business_name}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Folio cliente</label>
                    <p className="text-cc-cream mt-1">{selectedVerification.partner_folio}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Tipo operación</label>
                    <p className="text-cc-cream mt-1 capitalize">{selectedVerification.scheme}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Liquidación/Orden</label>
                    <p className="text-cc-cream mt-1 font-mono text-sm">{selectedVerification.source_folio}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Monto reportado</label>
                    <p className="text-lg font-bold text-green-400 mt-1">{formatCurrency(selectedVerification.amount)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Saldo actual</label>
                    <p className="text-cc-cream mt-1">{formatCurrency(selectedVerification.current_source_balance)}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Método pago</label>
                    <p className="text-cc-cream mt-1 capitalize">{selectedVerification.payment_method}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-cc-text-muted">Referencia</label>
                  <p className="text-cc-cream mt-1">{selectedVerification.payment_reference || '—'}</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-cc-text-muted">Fecha de pago reportado</label>
                  <p className="text-cc-cream mt-1">
                    {new Date(selectedVerification.payment_date).toLocaleDateString('es-MX')}
                  </p>
                </div>

                {selectedVerification.proof_file_name && (
                  <div>
                    <label className="text-xs font-semibold text-cc-text-muted">Comprobante adjunto</label>
                    <p className="text-cc-cream mt-1 text-sm">{selectedVerification.proof_file_name}</p>
                  </div>
                )}
              </div>

              {/* Review Notes */}
              <div>
                <label className="text-xs font-semibold text-cc-text-muted mb-2 block">
                  Notas de revisión (opcional)
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Ej: Verificado en banco, ingreso confirmado..."
                  className="w-full bg-cc-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-cc-text-muted focus:outline-none focus:border-cc-primary/50 resize-none"
                  rows={3}
                />
              </div>

              {/* Rejection Reason */}
              {rejecting && (
                <div>
                  <label className="text-xs font-semibold text-cc-text-muted mb-2 block">
                    Motivo del rechazo *
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="Especifica el motivo por el cual rechazas este cobro..."
                    className="w-full bg-cc-surface border border-red-500/30 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-cc-text-muted focus:outline-none focus:border-red-500/50 resize-none"
                    rows={3}
                  />
                </div>
              )}

              {/* Confirmation Message */}
              {!rejecting && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <p className="text-sm text-blue-200">
                    ¿Confirmas que Cat Corn ya recibió este dinero? Al continuar se registrará oficialmente el pago y se actualizarán el saldo y las comisiones.
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-white/10 bg-[#171717] flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowReviewModal(false);
                  setSelectedVerification(null);
                  setRejectionReason('');
                  setReviewNotes('');
                }}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-cc-cream rounded-lg font-semibold text-sm transition-colors"
                disabled={approving || rejecting}
              >
                Cancelar
              </button>

              {!rejecting ? (
                <>
                  <button
                    onClick={() => setRejecting(true)}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                    disabled={approving}
                  >
                    <XCircle className="w-4 h-4" />
                    Rechazar
                  </button>

                  <button
                    onClick={handleApprove}
                    className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 text-green-300 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    disabled={approving}
                  >
                    {approving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Confirmando...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Confirmar ingreso
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setRejecting(false)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-cc-cream rounded-lg font-semibold text-sm transition-colors"
                    disabled={rejecting}
                  >
                    Volver
                  </button>

                  <button
                    onClick={handleReject}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    disabled={!rejectionReason.trim() || rejecting}
                  >
                    {rejecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Rechazando...
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        Confirmar rechazo
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
