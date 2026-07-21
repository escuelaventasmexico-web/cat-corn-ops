import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle, Clock, X } from 'lucide-react';
import { getPaymentVerificationHistory } from '../../lib/paymentVerificationRpcs';
import type { PaymentVerificationHistory as PaymentVerificationHistoryType } from '../../lib/paymentVerificationRpcs';

interface Props {
  partnerId: string;
  vendorId?: string; // If set, filter by vendor
}

const PaymentVerificationHistory: React.FC<Props> = ({ partnerId, vendorId }) => {
  const [history, setHistory] = useState<PaymentVerificationHistoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [partnerId, vendorId]);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getPaymentVerificationHistory(partnerId);

      // Filter by vendor if provided
      const filtered = vendorId ? data.filter(h => h.submitted_by === vendorId) : data;

      setHistory(filtered);
    } catch (err: any) {
      setError(err.message || 'Error al cargar historial');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return <Clock size={16} className="text-gray-500" />;
      case 'pending_review':
        return <Clock size={16} className="text-amber-600" />;
      case 'approved':
        return <CheckCircle size={16} className="text-green-600" />;
      case 'rejected':
        return <X size={16} className="text-red-600" />;
      case 'cancelled':
        return <X size={16} className="text-gray-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-50 border-gray-200';
      case 'pending_review':
        return 'bg-amber-50 border-amber-200';
      case 'approved':
        return 'bg-green-50 border-green-200';
      case 'rejected':
        return 'bg-red-50 border-red-200';
      case 'cancelled':
        return 'bg-gray-50 border-gray-200';
      default:
        return 'bg-white border-gray-200';
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const formatDate = (date: string) => new Date(date).toLocaleDateString('es-MX');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={24} className="text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
        <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-red-900">Error al cargar historial</p>
          <p className="text-sm text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Sin cobros reportados</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map(item => (
        <div
          key={item.request_id}
          className={`border rounded-lg p-4 transition-colors ${getStatusColor(item.status)}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {getStatusIcon(item.status)}
                <span className="font-mono text-sm text-gray-600">{item.folio}</span>
                <span className="text-xs px-2 py-1 rounded bg-white bg-opacity-50">
                  {item.scheme.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <span className="text-gray-500">Monto:</span>
                  <p className="font-semibold text-gray-900">{formatCurrency(item.amount)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Método:</span>
                  <p className="font-semibold text-gray-900">
                    {item.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Fecha:</span>
                  <p className="font-semibold text-gray-900">{formatDate(item.payment_date)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Estado:</span>
                  <p className="font-semibold text-gray-900">{item.status_label}</p>
                </div>
              </div>

              {item.notes && (
                <div className="bg-white bg-opacity-50 rounded p-2 mb-2">
                  <span className="text-xs text-gray-600">Notas: {item.notes}</span>
                </div>
              )}

              {item.rejection_reason && (
                <div className="bg-red-100 bg-opacity-50 rounded p-2 mb-2">
                  <span className="text-xs text-red-700">
                    <span className="font-medium">Motivo de rechazo:</span> {item.rejection_reason}
                  </span>
                </div>
              )}

              {item.reviewed_at && (
                <div className="text-xs text-gray-500">
                  Revisado por {item.reviewed_by_name} el {formatDate(item.reviewed_at)}
                </div>
              )}
            </div>

            {item.proof_path && (
              <button
                onClick={() =>
                  setExpandedId(expandedId === item.request_id ? null : item.request_id)
                }
                className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
              >
                {expandedId === item.request_id ? 'Ocultar' : 'Ver comprobante'}
              </button>
            )}
          </div>

          {expandedId === item.request_id && item.proof_path && (
            <div className="mt-4 pt-4 border-t border-current border-opacity-20">
              <ProofViewer proofPath={item.proof_path} fileName={item.proof_file_name} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Sub-component to display proof
const ProofViewer: React.FC<{ proofPath: string; fileName: string | null }> = ({
  proofPath,
  fileName,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadProof = async () => {
      try {
        // Get signed URL from RPC
        const response = await fetch('/api/get-signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proofPath }),
        });

        if (!response.ok) {
          throw new Error('No se pudo cargar el comprobante');
        }

        const { signedUrl: url } = await response.json();
        setSignedUrl(url);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadProof();
  }, [proofPath]);

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando comprobante...</div>;
  }

  if (error) {
    return <div className="text-sm text-red-600">Error: {error}</div>;
  }

  if (!signedUrl) {
    return <div className="text-sm text-gray-500">No se pudo obtener el comprobante</div>;
  }

  const isPdf = proofPath.toLowerCase().endsWith('.pdf');

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Archivo: <span className="font-mono">{fileName}</span>
      </p>

      {isPdf ? (
        <div className="bg-gray-100 rounded p-2 text-center">
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Abrir PDF
          </a>
        </div>
      ) : (
        <img
          src={signedUrl}
          alt="Comprobante"
          className="max-w-xs max-h-64 rounded border border-gray-300"
        />
      )}
    </div>
  );
};

export default PaymentVerificationHistory;
