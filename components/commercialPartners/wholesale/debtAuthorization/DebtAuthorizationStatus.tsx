import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../../../supabase';
import {
  WholesaleDebtAuthorizationRequest,
} from './types';
import {
  formatCurrency,
  formatDate,
  getAuthStatusLabel,
  getAuthStatusColors,
} from './helpers';

interface DebtAuthorizationStatusProps {
  partnerId: string;
  pendingBalance: number;
  onRequestClick: () => void;
  onAuthorizationLoaded?: (auth: WholesaleDebtAuthorizationRequest | null) => void;
}

const DebtAuthorizationStatus: React.FC<DebtAuthorizationStatusProps> = ({
  partnerId,
  pendingBalance,
  onRequestClick,
  onAuthorizationLoaded,
}) => {
  const [authorization, setAuthorization] = useState<WholesaleDebtAuthorizationRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuthorization();
  }, [partnerId]);

  const loadAuthorization = async () => {
    if (!supabase) return;

    setLoading(true);

    try {
      const { data, error: dbErr } = await supabase
        .from('v_wholesale_debt_authorization_requests')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (dbErr && dbErr.code !== 'PGRST116') {
        throw dbErr;
      }

      setAuthorization(data as WholesaleDebtAuthorizationRequest | null);
      onAuthorizationLoaded?.(data as WholesaleDebtAuthorizationRequest | null);
    } catch (err: any) {
      console.error('Error loading authorization:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={20} className="animate-spin text-[#D6A23A]" />
      </div>
    );
  }

  // CASO A: Sin adeudo
  if (pendingBalance <= 0.005) {
    return null; // No mostrar nada, permitir flujo normal
  }

  // CASO B: Adeudo pero sin solicitud
  if (!authorization) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-900 text-sm">
              Adeudo pendiente de comodato
            </p>
            <p className="text-xs text-red-700 mt-1">
              El socio debe liquidar su adeudo de comodato antes de activar mayoreo.
            </p>
            <p className="text-sm font-bold text-red-800 mt-2">
              {formatCurrency(pendingBalance)}
            </p>
            <p className="text-xs text-red-700 mt-2">
              Si el cliente necesita operar simultáneamente en Comodato y Mayoreo,
              puedes solicitar una autorización excepcional al administrador.
            </p>
          </div>
        </div>
        <button
          onClick={onRequestClick}
          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          Solicitar autorización al administrador
        </button>
      </div>
    );
  }

  // CASO C: Solicitud pendiente
  if (authorization.status === 'pending') {
    const colors = getAuthStatusColors('pending');
    return (
      <div className={`rounded-lg border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
        <div className="flex items-start gap-3">
          <Clock size={16} className={`${colors.text} flex-shrink-0 mt-0.5`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${colors.text}`}>Solicitud enviada</p>
            <p className={`text-xs ${colors.text} opacity-80 mt-1`}>
              Un administrador debe autorizar que este socio opere simultáneamente
              en Comodato y Mayoreo.
            </p>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className={`${colors.text} opacity-80`}>Saldo al solicitar:</span>
            <span className={`font-semibold ${colors.text}`}>
              {formatCurrency(authorization.comodato_pending_balance_snapshot)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={`${colors.text} opacity-80`}>Piezas en posesión:</span>
            <span className={`font-semibold ${colors.text}`}>
              {authorization.comodato_stock_units_snapshot} piezas
            </span>
          </div>
          <div className="flex justify-between">
            <span className={`${colors.text} opacity-80`}>Fecha de solicitud:</span>
            <span className={`font-semibold ${colors.text}`}>
              {formatDate(authorization.requested_at)}
            </span>
          </div>
        </div>

        {authorization.request_reason && (
          <div className={`rounded px-3 py-2 bg-white/20 ${colors.text} text-xs`}>
            <p className="font-semibold mb-1">Motivo:</p>
            <p className="opacity-90">{authorization.request_reason}</p>
          </div>
        )}

        <div
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {getAuthStatusLabel(authorization.status)}
        </div>
      </div>
    );
  }

  // CASO D: Solicitud aprobada
  if (authorization.status === 'approved') {
    const colors = getAuthStatusColors('approved');
    return (
      <div className={`rounded-lg border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
        <div className="flex items-start gap-3">
          <CheckCircle size={16} className={`${colors.text} flex-shrink-0 mt-0.5`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${colors.text}`}>Autorización aprobada</p>
            <p className={`text-xs ${colors.text} opacity-80 mt-1`}>
              Puedes continuar con la activación de Mayoreo. El socio conservará
              también su modalidad de Comodato.
            </p>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          {authorization.reviewed_by_name && (
            <div className="flex justify-between">
              <span className={`${colors.text} opacity-80`}>Autorizado por:</span>
              <span className={`font-semibold ${colors.text}`}>
                {authorization.reviewed_by_name}
              </span>
            </div>
          )}
          {authorization.approved_at && (
            <div className="flex justify-between">
              <span className={`${colors.text} opacity-80`}>Fecha:</span>
              <span className={`font-semibold ${colors.text}`}>
                {formatDate(authorization.approved_at)}
              </span>
            </div>
          )}
        </div>

        {authorization.review_notes && (
          <div className={`rounded px-3 py-2 bg-white/20 ${colors.text} text-xs`}>
            <p className="font-semibold mb-1">Notas:</p>
            <p className="opacity-90">{authorization.review_notes}</p>
          </div>
        )}

        <div
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {getAuthStatusLabel(authorization.status)}
        </div>
      </div>
    );
  }

  // CASO E: Solicitud rechazada
  if (authorization.status === 'rejected') {
    const colors = getAuthStatusColors('rejected');
    return (
      <div className={`rounded-lg border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
        <div className="flex items-start gap-3">
          <XCircle size={16} className={`${colors.text} flex-shrink-0 mt-0.5`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${colors.text}`}>Solicitud rechazada</p>
          </div>
        </div>

        {authorization.rejection_reason && (
          <div className={`rounded px-3 py-2 bg-white/20 ${colors.text} text-xs`}>
            <p className="font-semibold mb-1">Motivo del rechazo:</p>
            <p className="opacity-90">{authorization.rejection_reason}</p>
          </div>
        )}

        <button
          onClick={onRequestClick}
          className={`w-full px-4 py-2 bg-${colors.text.split('-')[1]}-600 hover:bg-${
            colors.text.split('-')[1]
          }-700 text-white font-semibold text-sm rounded-lg transition-colors`}
        >
          Enviar nueva solicitud
        </button>
      </div>
    );
  }

  // CASO F: Autorización utilizada
  if (authorization.status === 'used') {
    const colors = getAuthStatusColors('used');
    return (
      <div className={`rounded-lg border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
        <div className="flex items-start gap-3">
          <CheckCircle size={16} className={`${colors.text} flex-shrink-0 mt-0.5`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${colors.text}`}>Autorización utilizada</p>
            <p className={`text-xs ${colors.text} opacity-80 mt-1`}>
              Este socio opera actualmente en Comodato y Mayoreo.
            </p>
          </div>
        </div>

        <div
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {getAuthStatusLabel(authorization.status)}
        </div>
      </div>
    );
  }

  return null;
};

export default DebtAuthorizationStatus;
