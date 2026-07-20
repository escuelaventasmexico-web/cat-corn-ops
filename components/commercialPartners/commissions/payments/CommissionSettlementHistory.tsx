/* ── Commission Settlement History ───────────────────────────────────── */

import React, { useState, useEffect } from 'react';
import { Download, Eye, AlertCircle, Loader } from 'lucide-react';
import { CommissionSettlementDetailModal } from './CommissionSettlementDetailModal';
import { loadSettlementHistory, createSignedProofUrl } from './paymentUtils';
import { formatCurrency, formatDate } from '../commissionUtils';
import { CommissionSettlementHistory as SettlementRecord } from '../commissionTypes';

interface CommissionSettlementHistoryProps {
  sellerId: string;
}

type FilterStatus = 'todos' | 'draft' | 'paid' | 'cancelled';

export const CommissionSettlementHistory: React.FC<CommissionSettlementHistoryProps> = ({
  sellerId,
}) => {
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementRecord | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [downloadingProof, setDownloadingProof] = useState<string>('');

  useEffect(() => {
    loadData();
  }, [sellerId]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await loadSettlementHistory(sellerId);
      console.log('SETTLEMENTS LOADED', data);
      setSettlements(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar historial';
      console.error('LOAD HISTORY ERROR', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadProof = async (settlement: SettlementRecord) => {
    if (!settlement.payment_proof_path) {
      alert('No hay comprobante disponible');
      return;
    }

    setDownloadingProof(settlement.settlement_id);

    try {
      const url = await createSignedProofUrl(settlement.payment_proof_path);
      window.open(url, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al descargar';
      console.error('DOWNLOAD ERROR', err);
      alert(message);
    } finally {
      setDownloadingProof('');
    }
  };

  const handleViewDetail = (settlement: SettlementRecord) => {
    setSelectedSettlement(settlement);
    setShowDetailModal(true);
  };

  const filteredSettlements = settlements.filter((s) => {
    if (filter === 'todos') return true;
    return s.status === filter;
  });

  if (loading) {
    return (
      <div className="text-center py-6">
        <Loader size={20} className="mx-auto text-yellow-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-3">
        <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-red-300 font-medium">Error al cargar</p>
          <p className="text-xs text-red-300 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (settlements.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-neutral-400">No hay registros de liquidaciones</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {(['todos', 'draft', 'paid', 'cancelled'] as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${
                  filter === status
                    ? 'bg-yellow-500 text-black'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }
              `}
            >
              {status === 'todos' && `Todos (${settlements.length})`}
              {status === 'draft' && `Borradores (${settlements.filter((s) => s.status === 'draft').length})`}
              {status === 'paid' && `Pagadas (${settlements.filter((s) => s.status === 'paid').length})`}
              {status === 'cancelled' && `Canceladas (${settlements.filter((s) => s.status === 'cancelled').length})`}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full">
            <thead>
              <tr className="bg-neutral-900 border-b border-neutral-800">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Folio
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Período
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Movimientos
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSettlements.map((settlement) => (
                <tr
                  key={settlement.settlement_id}
                  className="border-b border-neutral-800 hover:bg-neutral-900/50 transition-colors"
                >
                  {/* Folio */}
                  <td className="px-4 py-3">
                    <p className="text-sm font-mono font-semibold text-yellow-400">
                      {settlement.folio}
                    </p>
                  </td>

                  {/* Period */}
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm text-neutral-200">{settlement.period_label}</p>
                      <p className="text-xs text-neutral-500">
                        {formatDate(settlement.month_start)} - {formatDate(settlement.month_end)}
                      </p>
                    </div>
                  </td>

                  {/* Movement Count */}
                  <td className="px-4 py-3 text-right">
                    <p className="text-sm font-medium text-neutral-300">
                      {settlement.event_count}
                    </p>
                  </td>

                  {/* Total Amount */}
                  <td className="px-4 py-3 text-right">
                    <p className="text-sm font-semibold text-neutral-200">
                      {formatCurrency(Number(settlement.total_amount))}
                    </p>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span
                      className={`
                        inline-flex px-2 py-1 rounded-full text-xs font-medium
                        ${
                          settlement.status === 'draft'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : settlement.status === 'paid'
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-neutral-700/50 text-neutral-400 border border-neutral-700'
                        }
                      `}
                    >
                      {settlement.status === 'draft' && 'En preparación'}
                      {settlement.status === 'paid' && 'Pagada'}
                      {settlement.status === 'cancelled' && 'Cancelada'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => handleViewDetail(settlement)}
                        className="
                          p-1.5 rounded hover:bg-neutral-700 transition-colors
                          text-neutral-400 hover:text-neutral-200
                        "
                        title="Ver detalles"
                      >
                        <Eye size={16} />
                      </button>

                      {settlement.status === 'paid' && settlement.has_payment_proof && (
                        <button
                          onClick={() => handleDownloadProof(settlement)}
                          disabled={downloadingProof === settlement.settlement_id}
                          className="
                            p-1.5 rounded hover:bg-neutral-700 transition-colors
                            text-neutral-400 hover:text-blue-300
                            disabled:opacity-50 disabled:cursor-not-allowed
                          "
                          title="Descargar comprobante"
                        >
                          <Download size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredSettlements.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-neutral-400">
              No hay liquidaciones con estado: {filter}
            </p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedSettlement && (
        <CommissionSettlementDetailModal
          isOpen={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedSettlement(null);
          }}
          settlementId={selectedSettlement.settlement_id}
          settlement={selectedSettlement}
        />
      )}
    </>
  );
};
