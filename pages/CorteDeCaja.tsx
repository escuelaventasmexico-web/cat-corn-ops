import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Eye } from 'lucide-react';
import { fetchSessionsHistory } from '../lib/cashRegister';
import type { CashSessionSummary, CashRegisterStatus } from '../lib/cashRegister';
import { formatDateTimeMX } from '../lib/datetime';
import { CashSessionDetailModal } from '../components/CashSessionDetailModal';
import { CloseCashRegisterModal } from '../components/CloseCashRegisterModal';

export const CorteDeCaja = () => {
  const [sessions, setSessions] = useState<CashSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CashSessionSummary | null>(null);
  const [closeStatus, setCloseStatus] = useState<CashRegisterStatus | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchSessionsHistory();
    setSessions(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  /** Build a CashRegisterStatus from a summary so CloseCashRegisterModal can work */
  const handleCloseRegister = (summary: CashSessionSummary) => {
    setSelectedSession(null); // close detail modal
    setCloseStatus({
      session_id: summary.session_id,
      opening_cash: summary.opening_cash,
      cash_sales_total: summary.cash_sales_total,
      card_sales_total: summary.card_sales_total,
      withdrawals_total: summary.withdrawals_total,
      // current_cash = what's physically in register (for status panel display only)
      current_cash: summary.opening_cash + summary.cash_sales_total - summary.withdrawals_total,
      needs_withdrawal: false,
      opened_at: summary.opened_at,
      opened_by: summary.opened_by,
      notes: summary.notes,
    });
  };

  const handleCloseSuccess = () => {
    setCloseStatus(null);
    load(); // refresh list
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-cc-cream flex items-center gap-3">
          <Wallet size={32} className="text-cc-primary" />
          Corte de Caja
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium text-sm disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center text-cc-text-muted py-20">Cargando historial…</div>
      ) : sessions.length === 0 ? (
        <div className="text-center text-cc-text-muted py-20 bg-cc-surface rounded-xl border border-white/5">
          <Wallet size={64} className="mx-auto mb-4 opacity-30" />
          <p className="text-xl">No hay cortes de caja registrados</p>
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-cc-text-muted border-b border-white/10 bg-black/20">
                  <th className="text-left py-3 px-4 font-medium">Apertura</th>
                  <th className="text-left py-3 px-4 font-medium">Cierre</th>
                  <th className="text-center py-3 px-4 font-medium">Estado</th>
                  <th className="text-right py-3 px-4 font-medium">Fondo</th>
                  <th className="text-right py-3 px-4 font-medium">Efectivo</th>
                  <th className="text-right py-3 px-4 font-medium">Tarjeta</th>
                  <th className="text-right py-3 px-4 font-medium">Retiros</th>
                  <th className="text-right py-3 px-4 font-medium">Esperado</th>
                  <th className="text-right py-3 px-4 font-medium">Contado</th>
                  <th className="text-right py-3 px-4 font-medium">Diferencia</th>
                  <th className="text-center py-3 px-4 font-medium"># Ventas</th>
                  <th className="text-center py-3 px-4 font-medium"># Retiros</th>
                  <th className="text-center py-3 px-4 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const diff = s.difference;
                  const isOpen = s.status === 'open';
                  return (
                    <tr
                      key={s.session_id}
                      onClick={() => setSelectedSession(s)}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${isOpen ? 'bg-green-500/5' : ''}`}
                    >
                      <td className="py-3 px-4 text-cc-text-main text-xs whitespace-nowrap">
                        {formatDateTimeMX(s.opened_at)}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted text-xs whitespace-nowrap">
                        {s.closed_at ? formatDateTimeMX(s.closed_at) : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isOpen ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Abierta
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-cc-text-muted bg-white/5 px-2 py-0.5 rounded-full">
                            Cerrada
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-cream font-medium">
                        ${s.opening_cash.toFixed(0)}
                      </td>
                      <td className="py-3 px-4 text-right text-green-400 font-medium">
                        ${s.cash_sales_total.toFixed(0)}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-400 font-medium">
                        ${s.card_sales_total.toFixed(0)}
                      </td>
                      <td className="py-3 px-4 text-right text-orange-400 font-medium">
                        {s.withdrawals_total > 0 ? `-$${s.withdrawals_total.toFixed(0)}` : '$0'}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-primary font-semibold">
                        ${s.expected_cash.toFixed(0)}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-cream font-medium">
                        {s.counted_cash != null ? `$${s.counted_cash.toFixed(0)}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {diff != null ? (
                          <span className={`font-bold ${
                            Math.abs(diff) < 0.5
                              ? 'text-green-400'
                              : diff > 0
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}>
                            {diff >= 0 ? '+' : ''}${diff.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-cc-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center text-cc-text-main font-medium">
                        {s.sales_count}
                      </td>
                      <td className="py-3 px-4 text-center text-cc-text-muted">
                        {s.withdrawals_count}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedSession(s); }}
                          className="text-[10px] font-bold bg-cc-primary/20 text-cc-primary px-2.5 py-1 rounded hover:bg-cc-primary/30 transition-colors inline-flex items-center gap-1"
                        >
                          <Eye size={11} /> Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedSession && (
        <CashSessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onCloseRegister={
            selectedSession.status === 'open'
              ? () => handleCloseRegister(selectedSession)
              : undefined
          }
        />
      )}

      {/* Close cash register modal (triggered from detail) */}
      {closeStatus && (
        <CloseCashRegisterModal
          status={closeStatus}
          onClose={() => setCloseStatus(null)}
          onSuccess={handleCloseSuccess}
        />
      )}
    </div>
  );
};
