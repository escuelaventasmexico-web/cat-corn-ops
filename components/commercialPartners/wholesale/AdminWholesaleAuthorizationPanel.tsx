import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader2, FileText } from 'lucide-react';
import { supabase } from '../../../supabase';
import { WholesaleDebtAuthorizationRequest } from './debtAuthorization/types';
import {
  formatCurrency,
  formatDate,
  getAuthStatusLabel,
  getAuthStatusColors,
} from './debtAuthorization/helpers';

interface Props {
  partnerId: string;
}

const AdminWholesaleAuthorizationPanel: React.FC<Props> = ({ partnerId }) => {
  const [requests, setRequests] = useState<WholesaleDebtAuthorizationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<WholesaleDebtAuthorizationRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
  }, [partnerId]);

  const loadRequests = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error: dbErr } = await supabase
        .from('v_wholesale_debt_authorization_requests')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (dbErr) throw dbErr;
      setRequests((data as WholesaleDebtAuthorizationRequest[]) ?? []);
    } catch (err: any) {
      console.error('Error loading authorizations:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedRequest || !supabase) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: rpcErr } = await supabase.rpc(
        'approve_wholesale_debt_authorization',
        {
          p_request_id: selectedRequest.id,
          p_review_notes: reviewNotes.trim() || null,
        }
      );

      if (rpcErr) throw rpcErr;

      setShowApprovalModal(false);
      setReviewNotes('');
      setSelectedRequest(null);
      await loadRequests();
    } catch (err: any) {
      console.error('Error approving:', err);
      setError(err.message || 'Error al autorizar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest || !supabase || !rejectionReason.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: rpcErr } = await supabase.rpc(
        'reject_wholesale_debt_authorization',
        {
          p_request_id: selectedRequest.id,
          p_rejection_reason: rejectionReason.trim(),
        }
      );

      if (rpcErr) throw rpcErr;

      setShowRejectionModal(false);
      setRejectionReason('');
      setSelectedRequest(null);
      await loadRequests();
    } catch (err: any) {
      console.error('Error rejecting:', err);
      setError(err.message || 'Error al rechazar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 size={20} className="animate-spin text-[#D6A23A]" />
      </div>
    );
  }

  if (!requests.length) {
    return null; // No authorizations, don't show section
  }

  return (
    <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 space-y-4">
      <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider flex items-center gap-1.5">
        <FileText size={12} />
        Autorización Comodato + Mayoreo
      </p>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex gap-2">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Current Pending Request */}
      {requests.find(r => r.status === 'pending') && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 space-y-3">
          {(() => {
            const pending = requests.find(r => r.status === 'pending')!;
            return (
              <>
                <div className="flex items-start gap-3">
                  <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900 text-sm">
                      Solicitud pendiente de autorización
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-amber-700 font-semibold mb-1">Motivo de la solicitud:</p>
                    <p className="text-amber-600 bg-white/50 rounded px-2 py-1">
                      {pending.request_reason}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-amber-700 opacity-75">Saldo al solicitar:</p>
                      <p className="font-semibold text-amber-900">
                        {formatCurrency(pending.comodato_pending_balance_snapshot)}
                      </p>
                    </div>
                    <div>
                      <p className="text-amber-700 opacity-75">Saldo actual:</p>
                      <p className="font-semibold text-amber-900">
                        {formatCurrency(pending.current_comodato_pending_balance || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-amber-700 opacity-75">Piezas al solicitar:</p>
                      <p className="font-semibold text-amber-900">
                        {pending.comodato_stock_units_snapshot} piezas
                      </p>
                    </div>
                    <div>
                      <p className="text-amber-700 opacity-75">Piezas actuales:</p>
                      <p className="font-semibold text-amber-900">
                        {pending.current_comodato_stock_units} piezas
                      </p>
                    </div>
                  </div>

                  {pending.comodato_pending_balance_snapshot !==
                    pending.current_comodato_pending_balance ||
                  (pending.comodato_stock_units_snapshot !==
                    pending.current_comodato_stock_units && (
                      <div className="rounded bg-amber-100 px-2 py-1">
                        <p className="text-amber-700 text-xs">
                          ℹ️ La situación de comodato cambió desde que se realizó la
                          solicitud.
                        </p>
                      </div>
                    ))}

                  <div className="text-amber-600 opacity-75 pt-1">
                    Solicitado: {formatDate(pending.requested_at)}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => {
                      setSelectedRequest(pending);
                      setShowApprovalModal(true);
                    }}
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={14} />
                    Autorizar
                  </button>
                  <button
                    onClick={() => {
                      setSelectedRequest(pending);
                      setShowRejectionModal(true);
                    }}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <XCircle size={14} />
                    Rechazar
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Historical Requests */}
      {requests.filter(r => r.status !== 'pending').length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
            Historial
          </p>
          {requests
            .filter(r => r.status !== 'pending')
            .map(req => {
              const colors = getAuthStatusColors(req.status);
              return (
                <div
                  key={req.id}
                  className={`rounded px-3 py-2 text-xs border ${colors.bg} ${colors.border}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={`font-semibold ${colors.text}`}>
                        {getAuthStatusLabel(req.status)}
                      </p>
                      <p className={`${colors.text} opacity-75 text-xs mt-0.5`}>
                        {formatDate(
                          req.status === 'used'
                            ? req.used_at
                            : req.status === 'approved'
                              ? req.approved_at
                              : req.status === 'rejected'
                                ? req.reviewed_at
                                : req.created_at
                        )}
                      </p>
                    </div>
                  </div>
                  {req.rejection_reason && (
                    <p className={`${colors.text} opacity-80 mt-1 italic`}>
                      Motivo: {req.rejection_reason}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Approval Modal */}
      {showApprovalModal && selectedRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-4 px-4 pb-4 overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/60 transition-opacity"
            onClick={() => !submitting && setShowApprovalModal(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-[#0b0b0b] shadow-2xl flex flex-col max-h-[95vh] border border-white/10">
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-5 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Autorizar Solicitud</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                <p className="text-xs text-green-200 mb-2">
                  Esta autorización permitirá que el socio habilite Mayoreo sin
                  liquidar previamente su operación de Comodato.
                </p>
                <p className="text-xs text-green-100">
                  El saldo y las piezas de Comodato NO serán modificados.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 block">
                  Notas del administrador (opcional)
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Registra el motivo de esta autorización..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#D6A23A]/50 transition-colors resize-none"
                  rows={4}
                  disabled={submitting}
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex gap-2">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-200">{error}</p>
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-white/10">
              <button
                onClick={() => !submitting && setShowApprovalModal(false)}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-gray-300 font-medium text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Autorizando...' : 'Autorizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectionModal && selectedRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-4 px-4 pb-4 overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/60 transition-opacity"
            onClick={() => !submitting && setShowRejectionModal(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-[#0b0b0b] shadow-2xl flex flex-col max-h-[95vh] border border-white/10">
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-5 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Rechazar Solicitud</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 block">
                  Motivo del rechazo *
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Explica brevemente por qué se rechaza esta solicitud..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#D6A23A]/50 transition-colors resize-none"
                  rows={4}
                  disabled={submitting}
                />
                <p className={`text-xs mt-1 ${rejectionReason.trim().length >= 5 ? 'text-green-500' : 'text-gray-500'}`}>
                  {rejectionReason.trim().length} / 5 caracteres mínimo
                </p>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex gap-2">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-200">{error}</p>
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-white/10">
              <button
                onClick={() => !submitting && setShowRejectionModal(false)}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-gray-300 font-medium text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={submitting || rejectionReason.trim().length < 5}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Rechazando...' : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWholesaleAuthorizationPanel;
