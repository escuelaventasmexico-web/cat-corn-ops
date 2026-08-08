import React, { useState } from 'react';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../../../supabase';
import { formatCurrency } from './helpers';

interface DebtAuthorizationRequestModalProps {
  partnerId: string;
  pendingBalance: number;
  onClose: () => void;
  onSubmitted: () => void;
}

const DebtAuthorizationRequestModal: React.FC<
  DebtAuthorizationRequestModalProps
> = ({ partnerId, pendingBalance, onClose, onSubmitted }) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReasonValid = reason.trim().length >= 10;

  const handleSubmit = async () => {
    if (!isReasonValid) return;

    setLoading(true);
    setError(null);

    try {
      if (!supabase) throw new Error('Supabase not initialized');

      const { data, error: rpcError } = await supabase.rpc(
        'request_wholesale_debt_authorization',
        {
          p_partner_id: partnerId,
          p_reason: reason.trim(),
        }
      );

      if (rpcError) throw rpcError;

      console.log('✅ Authorization request created:', data);
      onSubmitted();
      onClose();
    } catch (err: any) {
      console.error('Error requesting authorization:', err);
      setError(
        err.message || 'Error al solicitar autorización. Intenta nuevamente.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center pt-4 px-4 pb-4 overflow-y-auto">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl bg-[#0b0b0b] shadow-2xl flex flex-col max-h-[95vh] border border-white/10">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">
            Solicitar Autorización
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {/* Info card */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4">
            <div className="flex gap-3">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200">
                <p className="font-semibold mb-1">Saldo pendiente de comodato</p>
                <p>{formatCurrency(pendingBalance)}</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Explicación
            </p>
            <p className="text-xs text-gray-400">
              Explica brevemente por qué este socio necesita operar
              simultáneamente en Comodato y Mayoreo.
            </p>
          </div>

          {/* Reason textarea */}
          <div>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Escribe tu solicitud aquí (mínimo 10 caracteres)..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#D6A23A]/50 transition-colors resize-none"
              rows={5}
              disabled={loading}
            />
            <p
              className={`text-xs mt-1 ${
                isReasonValid ? 'text-green-500' : 'text-gray-500'
              }`}
            >
              {reason.trim().length} / 10 caracteres mínimo
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex gap-2">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-gray-300 font-medium text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isReasonValid || loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#D6A23A] text-[#111111] font-semibold text-sm hover:bg-[#c49330] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Enviando...' : 'Enviar Solicitud'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DebtAuthorizationRequestModal;
