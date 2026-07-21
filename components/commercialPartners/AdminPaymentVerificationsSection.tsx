import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Clock } from 'lucide-react';
import { getPendingPaymentVerifications } from '../../lib/paymentVerificationRpcs';
import type { PendingPaymentVerification } from '../../lib/paymentVerificationRpcs';
import PaymentVerificationReviewModal from './PaymentVerificationReviewModal';

interface Props {
  onRefresh?: () => void;
}

const AdminPaymentVerificationsSection: React.FC<Props> = () => {
  const [verifications, setVerifications] = useState<PendingPaymentVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVerification, setSelectedVerification] =
    useState<PendingPaymentVerification | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  useEffect(() => {
    loadVerifications();
  }, []);

  const loadVerifications = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getPendingPaymentVerifications();
      setVerifications(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar cobros pendientes');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewClick = (verification: PendingPaymentVerification) => {
    setSelectedVerification(verification);
    setShowReviewModal(true);
  };

  const handleReviewSuccess = () => {
    setShowReviewModal(false);
    setSelectedVerification(null);
    loadVerifications();
  };;

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const formatDate = (date: string) => new Date(date).toLocaleDateString('es-MX');

  const getWaitTime = (submittedAt: string) => {
    const submitted = new Date(submittedAt).getTime();
    const now = new Date().getTime();
    const minutes = Math.floor((now - submitted) / (1000 * 60));

    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

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
          <p className="font-medium text-red-900">Error</p>
          <p className="text-sm text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Cobros reportados por vendedores</h3>
          <p className="text-sm text-gray-600">
            {verifications.length}{' '}
            {verifications.length === 1 ? 'cobro' : 'cobros'} en revisión
          </p>
        </div>
        {verifications.length > 0 && (
          <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-900 px-3 py-1 rounded-full text-sm font-medium">
            <Clock size={16} />
            {verifications.length} pendientes
          </div>
        )}
      </div>

      {verifications.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No hay cobros pendientes de revisión</p>
        </div>
      ) : (
        <div className="space-y-3">
          {verifications.map(verification => (
            <div
              key={verification.request_id}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-sm text-gray-600">{verification.folio}</span>
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900">
                      {verification.scheme.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-600 ml-auto">
                      Espera: {getWaitTime(verification.submitted_at)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                    <div>
                      <span className="text-gray-500 block text-xs">Vendedor</span>
                      <p className="font-medium text-gray-900">{verification.seller_name}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Socio</span>
                      <p className="font-medium text-gray-900">{verification.business_name}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Monto</span>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(verification.amount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Método</span>
                      <p className="font-medium text-gray-900">
                        {verification.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-gray-600">
                    Operación: {verification.source_folio} • Fecha:{' '}
                    {formatDate(verification.payment_date)}
                  </div>
                </div>

                <button
                  onClick={() => handleReviewClick(verification)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap"
                >
                  Revisar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReviewModal && selectedVerification && (
        <PaymentVerificationReviewModal
          verification={selectedVerification}
          onClose={() => setShowReviewModal(false)}
          onSuccess={handleReviewSuccess}
        />
      )}
    </div>
  );
};

export default AdminPaymentVerificationsSection;
