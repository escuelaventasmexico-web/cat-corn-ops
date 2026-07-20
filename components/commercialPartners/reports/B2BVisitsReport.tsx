import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import {
  B2BUpcomingVisit,
  B2BComodatoExpired,
} from './b2bReportTypes';
import {
  formatCurrency,
  formatDate,
  daysUntil,
  getDayLabel,
  getVisitStatusColor,
  exportToCSV,
} from './b2bReportHelpers';

interface B2BVisitsReportProps {
  refreshTrigger?: number;
  onPartnerSelect?: (partnerId: string) => void;
}

export const B2BVisitsReport = ({
  refreshTrigger = 0,
  onPartnerSelect,
}: B2BVisitsReportProps) => {
  const [upcomingVisits, setUpcomingVisits] = useState<B2BUpcomingVisit[]>([]);
  const [expiredComodatos, setExpiredComodatos] = useState<B2BComodatoExpired[]>([]);
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

      const [visitsRes, expiredRes] = await Promise.all([
        supabase.from('v_b2b_upcoming_visits').select('*'),
        supabase.from('v_b2b_comodato_expired').select('*'),
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (expiredRes.error) throw expiredRes.error;

      setUpcomingVisits((visitsRes.data as B2BUpcomingVisit[]) ?? []);
      setExpiredComodatos((expiredRes.data as B2BComodatoExpired[]) ?? []);
    } catch (err: any) {
      console.error('Error loading visits:', err);
      setError(err?.message || 'Error al cargar visitas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const categorizeVisits = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const categories: Record<string, B2BUpcomingVisit[]> = {
      vencidas: [],
      hoy: [],
      semana: [],
      mes: [],
      futuras: [],
    };

    upcomingVisits.forEach(visit => {
      const days = daysUntil(visit.next_visit_date);
      if (days === null) {
        categories.futuras.push(visit);
      } else if (days < 0) {
        categories.vencidas.push(visit);
      } else if (days === 0) {
        categories.hoy.push(visit);
      } else if (days <= 7) {
        categories.semana.push(visit);
      } else if (days <= 30) {
        categories.mes.push(visit);
      } else {
        categories.futuras.push(visit);
      }
    });

    return categories;
  };

  const handleExport = () => {
    const data = upcomingVisits.map(v => ({
      folio: v.folio || '—',
      socio: v.business_name,
      responsable: v.responsible_name,
      telefono: v.phone || '—',
      modelo: v.partner_model,
      direccion: v.address || '—',
      ciudad: v.city || '—',
      proxima_visita: v.next_visit_date ? formatDate(v.next_visit_date) : '—',
      motivo: v.visit_reason || '—',
      dias: v.days_until_visit || 0,
      pendiente: v.total_pending || 0,
    }));

    exportToCSV('visitas_b2b', data, [
      { key: 'folio', label: 'Folio' },
      { key: 'socio', label: 'Socio' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'direccion', label: 'Dirección' },
      { key: 'ciudad', label: 'Ciudad' },
      { key: 'proxima_visita', label: 'Próxima Visita' },
      { key: 'motivo', label: 'Motivo' },
      { key: 'dias', label: 'Días' },
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

  const categories = categorizeVisits();

  const VisitsSection = ({
    title,
    visits,
    isEmpty,
  }: {
    title: string;
    visits: B2BUpcomingVisit[];
    isEmpty?: boolean;
  }) => (
    <div>
      <h3 className="text-base font-bold text-cc-text-main mb-3">{title}</h3>
      {isEmpty || visits.length === 0 ? (
        <p className="text-sm text-cc-text-muted py-4">Sin registros</p>
      ) : (
        <div className="space-y-3">
          {visits.map(visit => (
            <div
              key={visit.id}
              className="bg-cc-surface rounded-xl border border-white/5 p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex items-start gap-2">
                    <div>
                      <p className="font-semibold text-cc-cream">
                        {visit.business_name}
                      </p>
                      <p className="text-xs text-cc-text-muted">
                        Folio: {visit.folio || '—'} • {visit.responsible_name}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-cc-text-muted mb-1">Teléfono</p>
                      <p className="font-mono text-cc-text-main">
                        {visit.phone || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-muted mb-1">Modelo</p>
                      <p className="text-cc-text-main capitalize">
                        {visit.partner_model}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-muted mb-1">Próxima visita</p>
                      <p className="text-cc-text-main">
                        {formatDate(visit.next_visit_date)}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-muted mb-1">Pendiente</p>
                      <p className="text-red-400 font-semibold">
                        ${visit.total_pending?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-cc-text-muted mt-2">
                    <span className="font-semibold">Motivo:</span> {visit.visit_reason || '—'}
                  </p>
                  <p className="text-xs text-cc-text-muted">
                    <span className="font-semibold">Ubicación:</span> {visit.address} {visit.city ? ` (${visit.city})` : ''}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <div className={`text-center px-3 py-2 rounded-lg ${getVisitStatusColor(daysUntil(visit.next_visit_date))}`}>
                    <p className="font-bold text-sm">
                      {getDayLabel(daysUntil(visit.next_visit_date))}
                    </p>
                  </div>
                  <button
                    onClick={() => onPartnerSelect?.(visit.id)}
                    className="text-cc-primary hover:text-cc-primary-dark text-xs font-semibold transition-colors"
                  >
                    Ver socio
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ── Export Button ──────────────────────────────────────– */}
      {upcomingVisits.length > 0 && (
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

      {/* ── Upcoming Visits ────────────────────────────────────– */}
      {upcomingVisits.length === 0 && expiredComodatos.length === 0 ? (
        <div className="text-center py-12 text-cc-text-muted">
          No hay visitas próximas registradas.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Vencidas */}
          {categories.vencidas.length > 0 && (
            <VisitsSection
              title="⚠️ Visitas Vencidas"
              visits={categories.vencidas}
            />
          )}

          {/* Hoy */}
          {categories.hoy.length > 0 && (
            <VisitsSection
              title="📍 Visitas de Hoy"
              visits={categories.hoy}
            />
          )}

          {/* Esta semana */}
          {categories.semana.length > 0 && (
            <VisitsSection
              title="📅 Esta Semana"
              visits={categories.semana}
            />
          )}

          {/* Este mes */}
          {categories.mes.length > 0 && (
            <VisitsSection
              title="📆 Este Mes"
              visits={categories.mes}
            />
          )}

          {/* Futuras */}
          {categories.futuras.length > 0 && (
            <VisitsSection
              title="🔮 Visitas Futuras"
              visits={categories.futuras}
            />
          )}
        </div>
      )}

      {/* ── Expired Comodatos ─────────────────────────────────– */}
      {expiredComodatos.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">
            ⏰ Contratos de Comodato Vencidos
          </h2>
          <div className="space-y-3">
            {expiredComodatos.map(comodato => (
              <div
                key={comodato.id}
                className="bg-red-500/10 border border-red-500/30 rounded-xl p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-2">
                    <p className="font-semibold text-cc-cream">
                      {comodato.business_name}
                    </p>
                    <p className="text-xs text-cc-text-muted">
                      Folio: {comodato.folio || '—'} • {comodato.responsible_name}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-2">
                      <div>
                        <p className="text-cc-text-muted mb-1">Vencida desde</p>
                        <p className="text-red-300 font-semibold">
                          {Math.abs(comodato.days_expired || 0)} días
                        </p>
                      </div>
                      <div>
                        <p className="text-cc-text-muted mb-1">Unidades</p>
                        <p className="text-cc-text-main font-semibold">
                          {comodato.units_in_possession || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-cc-text-muted mb-1">Pendiente</p>
                        <p className="text-red-400 font-semibold">
                          {formatCurrency(comodato.pending_balance)}
                        </p>
                      </div>
                      <div>
                        <p className="text-cc-text-muted mb-1">Teléfono</p>
                        <p className="font-mono text-cc-text-main">
                          {comodato.phone || '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onPartnerSelect?.(comodato.id)}
                    className="text-cc-primary hover:text-cc-primary-dark text-sm font-semibold transition-colors"
                  >
                    Ver socio
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
