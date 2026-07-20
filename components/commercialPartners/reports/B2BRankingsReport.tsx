import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import { B2BPartnerRanking } from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  formatDate,
  exportToCSV,
} from './b2bReportHelpers';

interface B2BRankingsReportProps {
  refreshTrigger?: number;
  onPartnerSelect?: (partnerId: string) => void;
}

type SortKey = 'b2b_total_generated' | 'comodato_generated' | 'wholesale_purchased' | 'b2b_pending_balance';

export const B2BRankingsReport = ({
  refreshTrigger = 0,
  onPartnerSelect,
}: B2BRankingsReportProps) => {
  const [rankings, setRankings] = useState<B2BPartnerRanking[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('b2b_total_generated');
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

      const { data, error: dbErr } = await supabase
        .from('v_b2b_partner_ranking')
        .select('*');

      if (dbErr) throw dbErr;
      setRankings((data as B2BPartnerRanking[]) ?? []);
    } catch (err: any) {
      console.error('Error loading rankings:', err);
      setError(err?.message || 'Error al cargar rankings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (rankings.length > 0) {
      console.log('B2B rankings data:', rankings);
    }
  }, [rankings]);

  const sortedRankings = [...rankings].sort((a, b) => {
    const aVal = a[sortBy] ?? 0;
    const bVal = b[sortBy] ?? 0;
    return Number(bVal) - Number(aVal);
  });

  const handleExport = () => {
    const data = sortedRankings.map((r, idx) => ({
      rank: idx + 1,
      folio: r.folio || '—',
      socio: r.business_name,
      responsable: r.responsible_name,
      modelo: r.partner_model,
      generado: Number(r.b2b_total_generated || 0),
      comodato: Number(r.comodato_generated || 0),
      mayoreo: Number(r.wholesale_purchased || 0),
      pagado: Number(r.b2b_total_paid || 0),
      pendiente: Number(r.b2b_pending_balance || 0),
      unidades: Number(r.b2b_total_units || 0),
      ultima_compra: r.last_purchase_date ? formatDate(r.last_purchase_date) : '—',
    }));

    exportToCSV('rankings_b2b', data, [
      { key: 'rank', label: 'Rank' },
      { key: 'folio', label: 'Folio' },
      { key: 'socio', label: 'Socio' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'generado', label: 'Generado' },
      { key: 'comodato', label: 'Comodato' },
      { key: 'mayoreo', label: 'Mayoreo' },
      { key: 'pagado', label: 'Pagado' },
      { key: 'pendiente', label: 'Pendiente' },
      { key: 'unidades', label: 'Unidades' },
      { key: 'ultima_compra', label: 'Última Compra' },
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
      {/* ── Sort Buttons ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSortBy('b2b_total_generated')}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            sortBy === 'b2b_total_generated'
              ? 'bg-cc-primary text-cc-bg'
              : 'bg-white/10 text-cc-text-main hover:bg-white/15'
          }`}
        >
          B2B Total
        </button>
        <button
          onClick={() => setSortBy('comodato_generated')}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            sortBy === 'comodato_generated'
              ? 'bg-cc-primary text-cc-bg'
              : 'bg-white/10 text-cc-text-main hover:bg-white/15'
          }`}
        >
          Comodato
        </button>
        <button
          onClick={() => setSortBy('wholesale_purchased')}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            sortBy === 'wholesale_purchased'
              ? 'bg-cc-primary text-cc-bg'
              : 'bg-white/10 text-cc-text-main hover:bg-white/15'
          }`}
        >
          Mayoreo
        </button>
        <button
          onClick={() => setSortBy('b2b_pending_balance')}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            sortBy === 'b2b_pending_balance'
              ? 'bg-cc-primary text-cc-bg'
              : 'bg-white/10 text-cc-text-main hover:bg-white/15'
          }`}
        >
          Pendiente
        </button>
      </div>

      {/* ── Export Button ──────────────────────────────────────– */}
      {sortedRankings.length > 0 && (
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

      {/* ── Rankings Table ─────────────────────────────────────── */}
      {sortedRankings.length === 0 ? (
        <div className="text-center py-12 text-cc-text-muted">
          No hay datos de rankings todavía.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase w-12">
                  Rank
                </th>
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
                  Modelo
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Generado
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Comodato
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Mayoreo
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Pagado
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Pendiente
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Unidades
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Última compra
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRankings.map((ranking, idx) => (
                <tr
                  key={ranking.partner_id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3 px-4 text-cc-cream font-bold text-center">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-4 text-cc-cream font-mono text-xs">
                    {ranking.folio || '—'}
                  </td>
                  <td className="py-3 px-4 text-cc-cream font-medium">
                    {ranking.business_name}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main">
                    {ranking.responsible_name}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main capitalize">
                    {ranking.partner_model}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-cc-cream">
                    {formatCurrency(Number(ranking.b2b_total_generated || 0))}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatCurrency(Number(ranking.comodato_generated || 0))}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatCurrency(Number(ranking.wholesale_purchased || 0))}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatCurrency(Number(ranking.b2b_total_paid || 0))}
                  </td>
                  <td className="py-3 px-4 text-right text-red-400 font-semibold">
                    {formatCurrency(Number(ranking.b2b_pending_balance || 0))}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatNumber(Number(ranking.b2b_total_units || 0))}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main">
                    {formatDate(ranking.last_purchase_date)}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => onPartnerSelect?.(ranking.partner_id)}
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
