import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  HeartHandshake,
  Plus,
  Search,
  X,
  Loader2,
  AlertCircle,
  Store,
  Phone,
  User,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  BarChart3,
  CalendarClock,
  MapPin,
} from 'lucide-react';
import {
  CommercialDirectoryRecord,
  CommercialPartner,
  CommercialProspectDirectoryRecord,
  STATUS_BADGE,
  MODEL_BADGE,
  BUSINESS_TYPES,
} from '../components/commercialPartners/types';
import {
  PROSPECT_STATUS_LABELS,
  ProspectStatus,
} from '../components/commercialProspects/types';
import { CommercialPartnerForm } from '../components/commercialPartners/CommercialPartnerForm';
import { CommercialPartnerDetail } from '../components/commercialPartners/CommercialPartnerDetail';
import { B2BReports } from '../components/commercialPartners/reports/B2BReports';
import { SellerCommissionDashboard } from '../components/commercialPartners/commissions/SellerCommissionDashboard';
import { AdminCommissionDashboard } from '../components/commercialPartners/commissions/AdminCommissionDashboard';
import { PieceSalesModule } from '../components/commercialPartners/pieceSales/PieceSalesModule';
import { PieceSalesErrorBoundary } from '../components/commercialPartners/pieceSales/PieceSalesErrorBoundary';
import { SellerCommercialPartnersView } from '../components/commercialPartners/mobile/SellerCommercialPartnersView';

/* ── Filter types ─────────────────────────────────────────────── */
type FilterKey = 'todos' | 'prospecto' | 'comodato' | 'mayoreo' | 'activos' | 'inactivos';
type SortField = 'business_name' | 'created_at';
type SortDir = 'asc' | 'desc';
type PageTab = 'socios' | 'reportes' | 'comisiones' | 'venta_pieza';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'todos',      label: 'Todos' },
  { key: 'prospecto',  label: 'Prospectos' },
  { key: 'comodato',   label: 'Comodato' },
  { key: 'mayoreo',    label: 'Mayoreo' },
  { key: 'activos',    label: 'Activos' },
  { key: 'inactivos',  label: 'Inactivos' },
];

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/* ── Helpers ─────────────────────────────────────────────────── */
const getBusinessTypeLabel = (p: CommercialPartner) => {
  if (p.business_type === 'otro') return p.business_type_other || 'Otro';
  return BUSINESS_TYPES.find(b => b.value === p.business_type)?.label ?? p.business_type;
};

const getProspectBusinessTypeLabel = (businessType: string) =>
  BUSINESS_TYPES.find(type => type.value === businessType)?.label ?? businessType;

const formatSupabaseError = (fallback: string, error: unknown) => {
  if (!error || typeof error !== 'object') return fallback;
  const source = error as Record<string, unknown>;
  const details = [
    typeof source.message === 'string' ? source.message : null,
    typeof source.details === 'string' && source.details ? `Detalles: ${source.details}` : null,
    typeof source.hint === 'string' && source.hint ? `Sugerencia: ${source.hint}` : null,
    typeof source.code === 'string' && source.code ? `Código: ${source.code}` : null,
  ].filter(Boolean);
  return details.length > 0 ? details.join(' · ') : fallback;
};

const openProspect = (prospectId: string) => {
  window.location.href = `/prospectos-comerciales?prospectId=${encodeURIComponent(prospectId)}`;
};

export const CommercialPartners = () => {
  const { profile, user } = useAuth();
  const [partners, setPartners] = useState<CommercialPartner[]>([]);
  const [prospects, setProspects] = useState<CommercialProspectDirectoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [prospectError, setProspectError] = useState<string | null>(null);
  /* ── Page Tab ──────────────────────────────────────────────── */
  const [pageTab, setPageTab] = useState<PageTab>('socios');
  /* ── Search / filter / sort ────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('todos');
  const [sortField, setSortField] = useState<SortField>('business_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  /* ── Modals ────────────────────────────────────────────────── */
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<CommercialPartner | null>(null);
  const [partnerDetailRefreshKey, setPartnerDetailRefreshKey] = useState(0);

  /* ── Toast ─────────────────────────────────────────────────── */
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  /* ── Load ──────────────────────────────────────────────────── */
  const loadPartners = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setPartnerError(null);
    setProspectError(null);
    try {
      const [partnerResult, prospectResult] = await Promise.all([
        supabase
          .from('commercial_partners')
          .select('*')
          .order('business_name', { ascending: true }),
        supabase
          .from('v_commercial_prospect_details')
          .select('id, business_name, contact_name, phone, address, location_reference, business_type, status, originator_name, assigned_to, assigned_to_name, next_follow_up_at, proposed_visit_at, created_at, commercial_partner_id')
          .is('commercial_partner_id', null)
          .neq('status', 'convertido')
          .neq('status', 'archivado')
          .order('business_name', { ascending: true }),
      ]);

      if (partnerResult.error) {
        console.error('Error completo al cargar socios comerciales:', partnerResult.error);
        setPartnerError(formatSupabaseError('Error al cargar socios comerciales', partnerResult.error));
      } else {
        setPartners((partnerResult.data as CommercialPartner[]) ?? []);
      }

      if (prospectResult.error) {
        console.error('Error completo al cargar prospectos para administración:', prospectResult.error);
        setProspectError(formatSupabaseError('Error al cargar prospectos comerciales', prospectResult.error));
      } else {
        setProspects((prospectResult.data ?? []).map(prospect => ({
          recordKind: 'commercial_prospect' as const,
          id: prospect.id,
          prospectId: prospect.id,
          businessName: prospect.business_name,
          contactName: prospect.contact_name,
          phone: prospect.phone,
          address: prospect.address,
          locationReference: prospect.location_reference,
          businessType: prospect.business_type,
          status: prospect.status,
          originatorAlias: prospect.originator_name,
          assignedTo: prospect.assigned_to,
          assignedToName: prospect.assigned_to_name,
          nextFollowUpAt: prospect.next_follow_up_at,
          proposedVisitAt: prospect.proposed_visit_at,
          createdAt: prospect.created_at,
        })));
      }
    } catch (loadError: unknown) {
      console.error('Error inesperado al cargar el directorio comercial:', loadError);
      const message = formatSupabaseError('Error al cargar el directorio comercial', loadError);
      setPartnerError(message);
      setProspectError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  /* ── Filter + search + sort ────────────────────────────────── */
  const directoryRecords = useMemo<CommercialDirectoryRecord[]>(() => [
    ...partners.map(partner => ({
      recordKind: 'commercial_partner' as const,
      id: partner.id,
      partner,
    })),
    ...prospects,
  ], [partners, prospects]);

  const filtered = directoryRecords
    .filter(record => {
      if (activeFilter === 'prospecto') {
        return record.recordKind === 'commercial_prospect' || record.partner.partner_model === 'prospecto';
      }
      if (record.recordKind === 'commercial_prospect') return activeFilter === 'todos';
      const partner = record.partner;
      if (activeFilter === 'comodato')   return partner.partner_model === 'comodato';
      if (activeFilter === 'mayoreo')    return partner.partner_model === 'mayoreo';
      if (activeFilter === 'activos')    return partner.status === 'activo';
      if (activeFilter === 'inactivos')  return partner.status === 'inactivo' || partner.active === false;
      return true;
    })
    .filter(record => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      if (record.recordKind === 'commercial_partner') {
        const partner = record.partner;
        return (
          (partner.folio ?? '').toLowerCase().includes(q) ||
          partner.id.toLowerCase().includes(q) ||
          partner.business_name.toLowerCase().includes(q) ||
          partner.responsible_name.toLowerCase().includes(q) ||
          (partner.phone ?? '').toLowerCase().includes(q)
        );
      }
      return [
        record.prospectId,
        record.businessName,
        record.contactName,
        record.phone,
        record.address,
        record.locationReference,
        record.originatorAlias,
        record.assignedToName,
      ].some(value => value?.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const aVal = sortField === 'created_at'
        ? (a.recordKind === 'commercial_partner' ? a.partner.created_at ?? '' : a.createdAt ?? '')
        : (a.recordKind === 'commercial_partner' ? a.partner.business_name : a.businessName).toLowerCase();
      const bVal = sortField === 'created_at'
        ? (b.recordKind === 'commercial_partner' ? b.partner.created_at ?? '' : b.createdAt ?? '')
        : (b.recordKind === 'commercial_partner' ? b.partner.business_name : b.businessName).toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const filteredPartnerCount = filtered.filter(record => record.recordKind === 'commercial_partner').length;
  const filteredProspectCount = filtered.length - filteredPartnerCount;

  /* ── Sort toggle ───────────────────────────────────────────── */
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ChevronUp size={13} className="opacity-25" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={13} className="text-cc-primary" />
    ) : (
      <ChevronDown size={13} className="text-cc-primary" />
    );
  };

  /* ── Callbacks ─────────────────────────────────────────────── */
  const handleCreated = (newPartner: CommercialPartner) => {
    setPartners(prev => {
      const next = [...prev, newPartner];
      next.sort((a, b) => a.business_name.localeCompare(b.business_name));
      return next;
    });
    setShowNewForm(false);
    setSelectedPartner(newPartner);
    showToast(`✓ ${newPartner.business_name} creado exitosamente`);
  };

  const handleUpdated = (updated: CommercialPartner) => {
    setPartners(prev =>
      prev.map(p => (p.id === updated.id ? updated : p))
    );
    showToast('✓ Socio actualizado');
  };

  /* ── Render ─────────────────────────────────────────────────– */
  // Check if user is a commercial seller - render mobile view
  const isCommercialSeller = profile?.role === 'socios_comerciales';
  if (isCommercialSeller) {
    return (
      <SellerCommercialPartnersView
        userProfile={profile}
        user={user}
        onLogout={() => {
          // Handle logout - should be implemented via auth context
          window.location.href = '/';
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Main Header ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cc-primary mb-1">
            <HeartHandshake size={22} />
            <h1 className="text-2xl font-bold text-cc-text-main">Socios Comerciales</h1>
          </div>
          <p className="text-sm text-cc-text-muted">
            CRM B2B para comodato, mayoreo y prospectos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadPartners}
            disabled={loading}
            className="p-2 rounded-lg border border-white/10 text-cc-text-muted hover:bg-white/5 hover:text-cc-text-main transition-colors disabled:opacity-50"
            title="Recargar"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {pageTab === 'socios' && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary-dark transition-colors shadow-[0_0_15px_rgba(244,197,66,0.2)]"
            >
              <Plus size={16} />
              Nuevo socio
            </button>
          )}
        </div>
      </div>

      {/* ─── Page Tabs ──────────────────────────────────────── */}
      <div className="flex gap-2 border-b border-white/10">
        <button
          onClick={() => setPageTab('socios')}
          className={`px-4 py-3 font-semibold text-sm transition-colors border-b-2 ${
            pageTab === 'socios'
              ? 'border-cc-primary text-cc-primary'
              : 'border-transparent text-cc-text-muted hover:text-cc-text-main'
          }`}
        >
          Socios
        </button>
        <button
          onClick={() => setPageTab('reportes')}
          className={`px-4 py-3 font-semibold text-sm transition-colors border-b-2 flex items-center gap-2 ${
            pageTab === 'reportes'
              ? 'border-cc-primary text-cc-primary'
              : 'border-transparent text-cc-text-muted hover:text-cc-text-main'
          }`}
        >
          <BarChart3 size={16} />
          Reportes B2B
        </button>
        <button
          onClick={() => setPageTab('comisiones')}
          className={`px-4 py-3 font-semibold text-sm transition-colors border-b-2 flex items-center gap-2 ${
            pageTab === 'comisiones'
              ? 'border-cc-primary text-cc-primary'
              : 'border-transparent text-cc-text-muted hover:text-cc-text-main'
          }`}
        >
          <RefreshCw size={16} />
          Comisiones
        </button>
        <button
          onClick={() => setPageTab('venta_pieza')}
          className={`px-4 py-3 font-semibold text-sm transition-colors border-b-2 flex items-center gap-2 ${
            pageTab === 'venta_pieza'
              ? 'border-cc-primary text-cc-primary'
              : 'border-transparent text-cc-text-muted hover:text-cc-text-main'
          }`}
        >
          📦
          Venta por pieza
        </button>
      </div>

      {/* ─── Page Content ───────────────────────────────────── */}
      {pageTab === 'socios' ? (
        <>
          {/* ─── Search + Filters ───────────────────────────────── */}

      {/* ─── Search + Filters ───────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por folio, UUID, negocio, contacto, vendedor, dirección o teléfono..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-cc-surface border border-white/10 rounded-lg pl-9 pr-8 py-2.5 text-sm text-cc-text-main placeholder:text-cc-text-muted focus:outline-none focus:border-cc-primary/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cc-text-muted hover:text-cc-text-main transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              activeFilter === f.key
                ? 'bg-cc-primary text-cc-bg border-cc-primary'
                : 'bg-transparent border-white/10 text-cc-text-muted hover:border-white/20 hover:text-cc-text-main'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ─── Errors ─────────────────────────────────────────── */}
      {partnerError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-red-300 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span><strong>No se pudieron cargar los socios.</strong> {partnerError}</span>
        </div>
      )}
      {prospectError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-red-300 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span><strong>No se pudieron cargar los prospectos.</strong> {prospectError}</span>
        </div>
      )}

      {/* ─── Loading ────────────────────────────────────────── */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-cc-primary" />
        </div>
      )}

      {/* ─── Empty state ────────────────────────────────────── */}
      {!loading && !partnerError && !prospectError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-cc-text-muted">
          <HeartHandshake size={36} className="opacity-30" />
          <p className="text-base">
            {searchQuery || activeFilter !== 'todos'
              ? 'No se encontraron socios con ese criterio'
              : 'Aún no hay socios comerciales registrados'}
          </p>
          {!searchQuery && activeFilter === 'todos' && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary-dark transition-colors mt-1"
            >
              <Plus size={14} />
              Agregar el primero
            </button>
          )}
        </div>
      )}

      {/* ─── Table ──────────────────────────────────────────── */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-white/10 bg-cc-surface">
          {/* Sort controls + count */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <p className="text-xs text-cc-text-muted">
              {filteredPartnerCount} socio{filteredPartnerCount !== 1 ? 's' : ''}
              {' · '}{filteredProspectCount} prospecto{filteredProspectCount !== 1 ? 's' : ''}
              {(searchQuery || activeFilter !== 'todos') ? ' (filtrado)' : ''}
            </p>
            <div className="flex items-center gap-1">
              <span className="text-xs text-cc-text-muted mr-1">Ordenar:</span>
              <button
                onClick={() => toggleSort('business_name')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  sortField === 'business_name'
                    ? 'border-cc-primary/40 text-cc-primary bg-cc-primary/10'
                    : 'border-white/10 text-cc-text-muted hover:bg-white/5'
                }`}
              >
                Nombre <SortIcon field="business_name" />
              </button>
              <button
                onClick={() => toggleSort('created_at')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  sortField === 'created_at'
                    ? 'border-cc-primary/40 text-cc-primary bg-cc-primary/10'
                    : 'border-white/10 text-cc-text-muted hover:bg-white/5'
                }`}
              >
                Fecha <SortIcon field="created_at" />
              </button>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-cc-text-muted text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Folio</th>
                  <th className="text-left px-4 py-3 font-medium">Negocio</th>
                  <th className="text-left px-4 py-3 font-medium">Responsable</th>
                  <th className="text-left px-4 py-3 font-medium">Teléfono</th>
                  <th className="text-left px-4 py-3 font-medium">Giro</th>
                  <th className="text-left px-4 py-3 font-medium">Modelo</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Visita / seguimiento</th>
                  <th className="text-left px-4 py-3 font-medium">Alta</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(record => {
                  const isProspect = record.recordKind === 'commercial_prospect';
                  const partner = !isProspect ? record.partner : null;
                  const status = isProspect ? record.status : partner!.status;
                  const statusCfg = isProspect
                    ? {
                        label: PROSPECT_STATUS_LABELS[status as ProspectStatus] ?? status,
                        className: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
                      }
                    : STATUS_BADGE[status] ?? {
                        label: status,
                        className: 'bg-white/5 text-cc-text-muted border-white/10',
                      };
                  const modelCfg = isProspect
                    ? MODEL_BADGE.prospecto
                    : MODEL_BADGE[partner!.partner_model] ?? {
                        label: partner!.partner_model,
                        className: 'bg-white/5 text-cc-text-muted border-white/10',
                      };
                  const businessName = isProspect ? record.businessName : partner!.business_name;
                  const visitAt = isProspect ? record.proposedVisitAt ?? record.nextFollowUpAt : null;
                  return (
                    <tr
                      key={`${record.recordKind}-${record.id}`}
                      onClick={() => isProspect ? openProspect(record.prospectId) : setSelectedPartner(partner!)}
                      className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-cc-text-muted">
                          {isProspect ? 'PROSPECTO' : partner!.folio ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-cc-text-main group-hover:text-cc-primary transition-colors">
                          {businessName}
                        </div>
                        {isProspect && (
                          <div className="mt-0.5 text-[11px] font-semibold tracking-wide text-purple-300">
                            PROSPECTO / {(record.originatorAlias ?? 'SIN ORIGEN').toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-cc-text-muted">
                        {isProspect ? record.assignedToName ?? 'Sin asignar' : partner!.responsible_name}
                      </td>
                      <td className="px-4 py-3 text-cc-text-muted">{isProspect ? record.phone ?? '—' : partner!.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-cc-text-muted capitalize">
                        {isProspect ? getProspectBusinessTypeLabel(record.businessType) : getBusinessTypeLabel(partner!)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${modelCfg.className}`}
                        >
                          {modelCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusCfg.className}`}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-cc-text-muted text-xs whitespace-nowrap">
                        {visitAt ? fmtDate(visitAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-cc-text-muted text-xs whitespace-nowrap">
                        {fmtDate(isProspect ? record.createdAt : partner!.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-cc-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {isProspect ? 'Ver prospecto →' : 'Ver detalle →'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-white/5">
            {filtered.map(record => {
              const isProspect = record.recordKind === 'commercial_prospect';
              const partner = !isProspect ? record.partner : null;
              const status = isProspect ? record.status : partner!.status;
              const statusCfg = isProspect
                ? {
                    label: PROSPECT_STATUS_LABELS[status as ProspectStatus] ?? status,
                    className: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
                  }
                : STATUS_BADGE[status] ?? {
                    label: status,
                    className: 'bg-white/5 text-cc-text-muted border-white/10',
                  };
              const modelCfg = isProspect
                ? MODEL_BADGE.prospecto
                : MODEL_BADGE[partner!.partner_model] ?? {
                    label: partner!.partner_model,
                    className: 'bg-white/5 text-cc-text-muted border-white/10',
                  };
              return (
                <div
                  key={`${record.recordKind}-${record.id}`}
                  onClick={() => isProspect ? openProspect(record.prospectId) : setSelectedPartner(partner!)}
                  className="p-4 cursor-pointer hover:bg-white/3 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {!isProspect && partner!.folio && (
                        <p className="text-xs font-mono text-cc-text-muted mb-0.5">{partner!.folio}</p>
                      )}
                      {isProspect && (
                        <p className="text-[11px] font-semibold tracking-wide text-purple-300 mb-0.5">
                          PROSPECTO / {(record.originatorAlias ?? 'SIN ORIGEN').toUpperCase()}
                        </p>
                      )}
                      <p className="font-medium text-cc-text-main truncate">
                        {isProspect ? record.businessName : partner!.business_name}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusCfg.className}`}
                      >
                        {statusCfg.label}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${modelCfg.className}`}
                      >
                        {modelCfg.label}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-cc-text-muted">
                      <User size={11} />
                      {isProspect ? `Asignado a: ${record.assignedToName ?? 'Sin asignar'}` : partner!.responsible_name}
                    </div>
                    {(isProspect ? record.phone : partner!.phone) && (
                      <div className="flex items-center gap-1.5 text-xs text-cc-text-muted">
                        <Phone size={11} />
                        {isProspect ? record.phone : partner!.phone}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-cc-text-muted">
                      <Store size={11} />
                      {isProspect ? getProspectBusinessTypeLabel(record.businessType) : getBusinessTypeLabel(partner!)}
                    </div>
                    {isProspect && record.address && (
                      <div className="flex items-center gap-1.5 text-xs text-cc-text-muted">
                        <MapPin size={11} />
                        <span className="truncate">{record.address}</span>
                      </div>
                    )}
                    {isProspect && (record.proposedVisitAt || record.nextFollowUpAt) && (
                      <div className="flex items-center gap-1.5 text-xs text-cc-text-muted">
                        <CalendarClock size={11} />
                        Próxima visita / seguimiento: {fmtDate(record.proposedVisitAt ?? record.nextFollowUpAt)}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-cc-text-muted mt-1.5">
                    Alta: {fmtDate(isProspect ? record.createdAt : partner!.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </>
      ) : pageTab === 'reportes' ? (
        /* ─── Reports Tab ────────────────────────────────────── */
        <B2BReports onPartnerSelect={(partnerId: string) => {
          const partner = partners.find(p => p.id === partnerId);
          if (partner) {
            setSelectedPartner(partner);
          }
        }} />
      ) : pageTab === 'venta_pieza' ? (
        /* ─── Piece Sales Tab ────────────────────────────────── */
        <PieceSalesErrorBoundary>
          <PieceSalesModule 
            refreshTrigger={Math.random()} 
            isAdmin={profile?.role !== 'socios_comerciales'}
            userId={user?.id || ''}
          />
        </PieceSalesErrorBoundary>
      ) : (
        /* ─── Commissions Tab ────────────────────────────────── */
        profile?.role === 'socios_comerciales' ? (
          <SellerCommissionDashboard sellerId={user?.id || ''} />
        ) : (
          <AdminCommissionDashboard
            onPartnerPaymentChanged={() => {
              setPartnerDetailRefreshKey(key => key + 1);
              void loadPartners();
            }}
          />
        )
      )}

      {/* ─── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-500/20 border border-green-500/40 text-green-300 text-sm px-5 py-2.5 rounded-xl shadow-xl backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* ─── New form modal ──────────────────────────────────── */}
      {showNewForm && (
        <CommercialPartnerForm
          partner={null}
          onClose={() => setShowNewForm(false)}
          onSaved={handleCreated}
          onPhotoWarning={msg => showToast(msg)}
        />
      )}

      {/* ─── Detail side panel ──────────────────────────────── */}
      {selectedPartner && (
        <CommercialPartnerDetail
          key={`${selectedPartner.id}-${partnerDetailRefreshKey}`}
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
};
