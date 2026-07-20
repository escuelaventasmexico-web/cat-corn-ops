import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import {
  B2BSalesByZone,
  B2BPipelineByStatus,
} from './b2bReportTypes';
import {
  formatCurrency,
  formatNumber,
  exportToCSV,
} from './b2bReportHelpers';

interface B2BZoneReportProps {
  refreshTrigger?: number;
}

export const B2BZoneReport = ({ refreshTrigger = 0 }: B2BZoneReportProps) => {
  const [zones, setZones] = useState<B2BSalesByZone[]>([]);
  const [pipeline, setPipeline] = useState<B2BPipelineByStatus[]>([]);
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

      const [zonesRes, pipelineRes] = await Promise.all([
        supabase.from('v_b2b_sales_by_zone').select('*'),
        supabase.from('v_b2b_pipeline_by_status').select('*'),
      ]);

      if (zonesRes.error) throw zonesRes.error;
      if (pipelineRes.error) throw pipelineRes.error;

      setZones((zonesRes.data as B2BSalesByZone[]) ?? []);
      setPipeline((pipelineRes.data as B2BPipelineByStatus[]) ?? []);
    } catch (err: any) {
      console.error('Error loading zones:', err);
      setError(err?.message || 'Error al cargar zonas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (zones.length > 0 || pipeline.length > 0) {
      console.log('B2B zones data:', zones);
      console.log('B2B pipeline data:', pipeline);
    }
  }, [zones, pipeline]);

  const handleExportZones = () => {
    const data = zones.map(z => ({
      estado: z.state_name || '—',
      ciudad: z.city_name || '—',
      colonia: z.neighborhood || '—',
      socios_totales: Number(z.partners_count || 0),
      socios_comodato: Number(z.comodato_partners || 0),
      socios_mayoreo: Number(z.wholesale_partners || 0),
      socios_activos: Number(z.active_partners || 0),
      generado: Number(z.b2b_total_generated || 0),
      pagado: Number(z.b2b_total_paid || 0),
      pendiente: Number(z.b2b_pending_balance || 0),
    }));

    exportToCSV('zonas_b2b', data, [
      { key: 'estado', label: 'Estado' },
      { key: 'ciudad', label: 'Ciudad' },
      { key: 'colonia', label: 'Colonia' },
      { key: 'socios_totales', label: 'Socios Totales' },
      { key: 'socios_comodato', label: 'Socios Comodato' },
      { key: 'socios_mayoreo', label: 'Socios Mayoreo' },
      { key: 'socios_activos', label: 'Socios Activos' },
      { key: 'generado', label: 'Generado' },
      { key: 'pagado', label: 'Pagado' },
      { key: 'pendiente', label: 'Pendiente' },
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
      {/* ── PIPELINE SECTION ────────────────────────────────────– */}
      {pipeline.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">Pipeline por Estado</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            {pipeline.map((item, idx) => (
              <div key={idx} className="bg-cc-surface rounded-2xl border border-white/5 p-6">
                <h3 className="text-sm font-bold text-cc-cream mb-4 capitalize">
                  {item.status}
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-cc-text-muted mb-1">Socios</p>
                    <p className="text-2xl font-bold text-cc-primary">
                      {formatNumber(item.partner_count)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-cc-text-muted mb-1">Generado</p>
                    <p className="text-sm font-semibold text-cc-cream">
                      {formatCurrency(item.total_generated)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-cc-text-muted mb-1">Pendiente</p>
                    <p className="text-sm font-semibold text-red-400">
                      {formatCurrency(item.total_pending)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONES SECTION ──────────────────────────────────────– */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-cc-text-main">Socios por Zona</h2>
          {zones.length > 0 && (
            <button
              onClick={handleExportZones}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cc-primary/20 hover:bg-cc-primary/30 text-cc-primary font-semibold text-sm transition-colors border border-cc-primary/30"
            >
              <Download size={16} />
              Exportar CSV
            </button>
          )}
        </div>

        {zones.length === 0 ? (
          <div className="text-center py-12 text-cc-text-muted">
            No hay datos de zonas todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Estado
                  </th>
                  <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Ciudad
                  </th>
                  <th className="text-left py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Colonia
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Socios
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Comodato
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Mayoreo
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Activos
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Generado
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Pagado
                  </th>
                  <th className="text-right py-3 px-4 text-cc-text-muted font-semibold text-xs uppercase">
                    Pendiente
                  </th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="py-3 px-4 text-cc-cream font-medium">
                      {zone.state_name || '—'}
                    </td>
                    <td className="py-3 px-4 text-cc-text-main">
                      {zone.city_name || '—'}
                    </td>
                    <td className="py-3 px-4 text-cc-text-main text-xs">
                      {zone.neighborhood || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-cc-cream">
                      {formatNumber(Number(zone.partners_count || 0))}
                    </td>
                    <td className="py-3 px-4 text-right text-purple-300">
                      {formatNumber(Number(zone.comodato_partners || 0))}
                    </td>
                    <td className="py-3 px-4 text-right text-blue-300">
                      {formatNumber(Number(zone.wholesale_partners || 0))}
                    </td>
                    <td className="py-3 px-4 text-right text-green-300">
                      {formatNumber(Number(zone.active_partners || 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-cc-cream">
                      {formatCurrency(Number(zone.b2b_total_generated || 0))}
                    </td>
                    <td className="py-3 px-4 text-right text-cc-text-main">
                      {formatCurrency(Number(zone.b2b_total_paid || 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-red-400">
                      {formatCurrency(Number(zone.b2b_pending_balance || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
