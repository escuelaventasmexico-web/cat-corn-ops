import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import {
  B2BPendingBalance,
  B2BCollectionReport,
} from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  getPriorityColor,
  getPriorityLabel,
  getCollectionPriority,
  exportToCSV,
} from './b2bReportHelpers';

interface B2BCollectionsReportProps {
  refreshTrigger?: number;
  onPartnerSelect?: (partnerId: string) => void;
}

export const B2BCollectionsReport = ({
  refreshTrigger = 0,
  onPartnerSelect,
}: B2BCollectionsReportProps) => {
  const [summary, setSummary] = useState<B2BCollectionReport | null>(null);
  const [balances, setBalances] = useState<B2BPendingBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [summaryRes, balancesRes] = await Promise.all([
        supabase.from('v_b2b_collection_report').select('*').limit(1),
        supabase.from('v_b2b_pending_balances').select('*'),
      ]);

      if (summaryRes.error) throw summaryRes.error;
      if (balancesRes.error) throw balancesRes.error;

      setSummary((summaryRes.data?.[0] as B2BCollectionReport) ?? null);
      setBalances((balancesRes.data as B2BPendingBalance[]) ?? []);
    } catch (err: any) {
      console.error('Error loading collections:', err);
      setError(err?.message || 'Error al cargar cobranza');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (balances.length > 0) {
      console.log('B2B collection rows:', balances);
    }
  }, [balances]);

  const handleExport = () => {
    const data = balances.map(b => {
      const pendingAmount = Number(b.b2b_pending_balance || 0);
      return {
        folio: b.folio || '—',
        socio: b.business_name,
        responsable: b.responsible_name,
        telefono: b.phone || '—',
        modelo: b.partner_model,
        pendiente_comodato: Number(b.comodato_pending || 0),
        pendiente_mayoreo: Number(b.wholesale_pending || 0),
        pendiente_total: pendingAmount,
        prioridad: getPriorityLabel(getCollectionPriority(pendingAmount)),
      };
    });

    exportToCSV('cobranza_b2b', data, [
      { key: 'folio', label: 'Folio' },
      { key: 'socio', label: 'Socio' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'pendiente_comodato', label: 'Pendiente Comodato' },
      { key: 'pendiente_mayoreo', label: 'Pendiente Mayoreo' },
      { key: 'pendiente_total', label: 'Total Pendiente' },
      { key: 'prioridad', label: 'Prioridad' },
    ]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cc-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-300">Error al cargar datos</h3>
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ──────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">
              Saldo Total Pendiente
            </p>
            <p className="text-3xl font-bold text-red-400">
              {formatCurrency(summary.total_pending)}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">
              Socios con Pendiente
            </p>
            <p className="text-3xl font-bold text-cc-cream">
              {formatNumber(summary.partners_with_pending)}
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">
              Mayor Deudor
            </p>
            <p className="text-sm text-cc-text-main font-semibold">
              {summary.largest_debtor_name || '—'}
            </p>
            <p className="text-lg font-bold text-red-400 mt-2">
              {formatCurrency(summary.largest_debtor_amount)}
            </p>
          </div>
        </div>
      )}

      {/* ── Export Button ──────────────────────────────────────── */}
      {balances.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cc-primary/20 hover:bg-cc-primary/30 text-cc-primary font-semibold text-sm transition-colors border border-cc-primary/30"
          >
            <Download size={16} />
            Exportar CSV
          </button>
        </div>
      )}

      {/* ── Collections Table ──────────────────────────────────– */}
      {balances.length === 0 ? (
        <div className="text-center py-12 text-cc-text-muted">
          No hay pendientes de cobranza en este momento.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Folio
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Socio
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Responsable
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Teléfono
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Modelo
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Comodato
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Mayoreo
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Total
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Prioridad
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody>
              {balances.map((balance, idx) => (
                <tr
                  key={idx}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3 px-4 text-cc-cream font-mono text-xs">
                    {balance.folio || '—'}
                  </td>
                  <td className="py-3 px-4 text-cc-cream font-medium">
                    {balance.business_name}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main">
                    {balance.responsible_name}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main">
                    {balance.phone || '—'}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main capitalize">
                    {balance.partner_model}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatCurrency(balance.comodato_pending)}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatCurrency(balance.wholesale_pending)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-red-400">
                    {formatCurrency(Number(balance.b2b_pending_balance || 0))}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${getPriorityColor(
                        getCollectionPriority(Number(balance.b2b_pending_balance || 0))
                      )}`}
                    >
                      {getPriorityLabel(getCollectionPriority(Number(balance.b2b_pending_balance || 0)))}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => onPartnerSelect?.(balance.partner_id)}
                      className="text-cc-primary hover:text-cc-primary-dark text-sm font-semibold transition-colors"
                    >
                      Ver socio
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
