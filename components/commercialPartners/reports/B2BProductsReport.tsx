import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import { B2BTopProduct } from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  exportToCSV,
} from './b2bReportHelpers';

interface B2BProductsReportProps {
  refreshTrigger?: number;
}

export const B2BProductsReport = ({ refreshTrigger = 0 }: B2BProductsReportProps) => {
  const [products, setProducts] = useState<B2BTopProduct[]>([]);
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
        .from('v_b2b_top_products')
        .select('*');

      if (dbErr) throw dbErr;
      setProducts((data as B2BTopProduct[]) ?? []);
    } catch (err: any) {
      console.error('Error loading products:', err);
      setError(err?.message || 'Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const topByTotal = [...products].sort((a, b) => 
    (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0)
  ).slice(0, 1)[0];

  const topByWholesale = [...products].sort((a, b) => 
    (Number(b.wholesale_amount) || 0) - (Number(a.wholesale_amount) || 0)
  ).slice(0, 1)[0];

  const topByComodato = [...products].sort((a, b) => 
    (Number(b.comodato_amount) || 0) - (Number(a.comodato_amount) || 0)
  ).slice(0, 1)[0];

  const totalUnits = products.reduce((sum, p) => sum + (Number(p.total_units) || 0), 0);
  const totalAmount = products.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);

  const handleExport = () => {
    const data = products.map((p, idx) => ({
      rank: idx + 1,
      producto: p.product_name,
      variante: p.variant_name || '—',
      tamaño: p.size || '—',
      unidades_totales: p.total_units || 0,
      monto_total: p.total_amount || 0,
      unidades_comodato: p.comodato_units || 0,
      unidades_mayoreo: p.wholesale_units || 0,
      monto_comodato: p.comodato_amount || 0,
      monto_mayoreo: p.wholesale_amount || 0,
      socios: p.partner_count || 0,
    }));

    exportToCSV('productos_b2b', data, [
      { key: 'rank', label: 'Rank' },
      { key: 'producto', label: 'Producto' },
      { key: 'variante', label: 'Variante' },
      { key: 'tamaño', label: 'Tamaño' },
      { key: 'unidades_totales', label: 'Unidades Totales' },
      { key: 'monto_total', label: 'Monto Total' },
      { key: 'unidades_comodato', label: 'Unidades Comodato' },
      { key: 'unidades_mayoreo', label: 'Unidades Mayoreo' },
      { key: 'monto_comodato', label: 'Monto Comodato' },
      { key: 'monto_mayoreo', label: 'Monto Mayoreo' },
      { key: 'socios', label: 'Socios' },
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
    <div className="space-y-8">
      {/* ── Top Stats Cards ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Productos Destacados</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">
              Total Piezas B2B
            </p>
            <p className="text-3xl font-bold text-cc-cream">
              {formatNumber(totalUnits)}
            </p>
            <p className="text-xs text-cc-text-muted mt-2">
              entre {formatNumber(products.length)} productos
            </p>
          </div>

          <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
            <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">
              Total Monto Productos
            </p>
            <p className="text-3xl font-bold text-cc-cream">
              {formatCurrency(totalAmount)}
            </p>
          </div>

          {topByTotal && (
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">
                Más Vendido
              </p>
              <p className="text-sm font-semibold text-cc-cream mb-2">
                {topByTotal.product_name}
              </p>
              <p className="text-lg font-bold text-cc-primary">
                {formatCurrency(topByTotal.total_amount)}
              </p>
              <p className="text-xs text-cc-text-muted mt-2">
                {formatNumber(topByTotal.total_units)} piezas
              </p>
            </div>
          )}

          {topByWholesale && (
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">
                Fuerte en Mayoreo
              </p>
              <p className="text-sm font-semibold text-cc-cream mb-2">
                {topByWholesale.product_name}
              </p>
              <p className="text-lg font-bold text-blue-400">
                {formatCurrency(topByWholesale.wholesale_amount)}
              </p>
              <p className="text-xs text-cc-text-muted mt-2">
                {formatNumber(topByWholesale.wholesale_units)} piezas
              </p>
            </div>
          )}

          {topByComodato && (
            <div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-3">
                Fuerte en Comodato
              </p>
              <p className="text-sm font-semibold text-cc-cream mb-2">
                {topByComodato.product_name}
              </p>
              <p className="text-lg font-bold text-purple-400">
                {formatCurrency(topByComodato.comodato_amount)}
              </p>
              <p className="text-xs text-cc-text-muted mt-2">
                {formatNumber(topByComodato.comodato_units)} piezas
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Export Button ──────────────────────────────────────── */}
      {products.length > 0 && (
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

      {/* ── Products Table ────────────────────────────────────── */}
      {products.length === 0 ? (
        <div className="text-center py-12 text-cc-text-muted">
          No hay datos de productos todavía.
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
                  Producto
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Variante
                </th>
                <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Tamaño
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Unidades
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Monto Total
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Comodato unid.
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Mayoreo unid.
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Comodato $
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Mayoreo $
                </th>
                <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                  Socios
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, idx) => (
                <tr
                  key={idx}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3 px-4 text-cc-cream font-bold text-center">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-4 text-cc-cream font-medium">
                    {product.product_name}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main text-xs">
                    {product.variant_name || '—'}
                  </td>
                  <td className="py-3 px-4 text-cc-text-main text-xs">
                    {product.size || '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-cc-cream">
                    {formatNumber(product.total_units)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-cc-cream">
                    {formatCurrency(product.total_amount)}
                  </td>
                  <td className="py-3 px-4 text-right text-purple-300">
                    {formatNumber(product.comodato_units)}
                  </td>
                  <td className="py-3 px-4 text-right text-blue-300">
                    {formatNumber(product.wholesale_units)}
                  </td>
                  <td className="py-3 px-4 text-right text-purple-300">
                    {formatCurrency(product.comodato_amount)}
                  </td>
                  <td className="py-3 px-4 text-right text-blue-300">
                    {formatCurrency(product.wholesale_amount)}
                  </td>
                  <td className="py-3 px-4 text-right text-cc-text-main">
                    {formatNumber(product.partner_count)}
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
