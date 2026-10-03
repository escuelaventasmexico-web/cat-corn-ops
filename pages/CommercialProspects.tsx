import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  History,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Search,
  Store,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { exportCommercialProspects } from '../lib/exportCommercialProspects';
import {
  CommercialProspect,
  DuplicateWarning,
  PROSPECT_BUSINESS_TYPES,
  PROSPECT_RESULT_LABELS,
  PROSPECT_STATUS_LABELS,
  ProspectInteraction,
  ProspectResult,
  ProspectStatus,
} from '../components/commercialProspects/types';

type PageTab = 'prospectos' | 'comisiones';
type FollowUpFilter = 'todos' | 'vencidos' | 'hoy' | 'proximos' | 'sin_fecha';

interface SellerOption {
  id: string;
  full_name: string | null;
  commercial_alias?: string | null;
  role: string;
}

interface CommissionBonusRow {
  commission_event_id: string;
  seller_id: string;
  partner_folio: string | null;
  business_name: string | null;
  commercial_partner_id: string;
  conversion_id: string;
  converted_at: string;
  qualifying_settlement_id: string | null;
  commission_amount: number | string;
  status: 'pending' | 'available' | 'paid' | 'cancelled';
  payment_status: string;
  earned_at: string;
  available_at: string | null;
  paid_at: string | null;
}

const emptyProspectForm = {
  business_name: '',
  business_type: 'tienda',
  phone: '',
  location_reference: '',
  address: '',
  contact_name: '',
  sells_snacks: 'unknown',
  general_notes: '',
};

const statusClasses: Record<ProspectStatus, string> = {
  nuevo: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  seguimiento: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  visita_programada: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  convertido: 'bg-green-500/15 text-green-300 border-green-500/30',
  no_interesado: 'bg-red-500/15 text-red-300 border-red-500/30',
  archivado: 'bg-white/5 text-cc-text-muted border-white/10',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

const toInputDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

const ProspectBonusPanel = ({ userId, isAdmin }: { userId?: string; isAdmin: boolean }) => {
  const [rows, setRows] = useState<CommissionBonusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      setError(null);
      let query = supabase
        .from('v_commercial_prospect_bonus_movements')
        .select('*')
        .order('earned_at', { ascending: false });
      if (!isAdmin && userId) query = query.eq('seller_id', userId);
      const { data, error: queryError } = await query;
      if (queryError) setError(queryError.message);
      else setRows((data as CommissionBonusRow[]) ?? []);
      setLoading(false);
    };
    load();
  }, [isAdmin, userId]);

  const totals = rows.reduce(
    (sum, row) => {
      const amount = Number(row.commission_amount) || 0;
      if (row.status !== 'cancelled') sum.total += amount;
      if (row.status === 'pending') sum.pending += amount;
      if (row.status === 'available') sum.available += amount;
      if (row.payment_status === 'paid') sum.paid += amount;
      return sum;
    },
    { total: 0, pending: 0, available: 0, paid: 0 }
  );

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-cc-primary" /></div>;
  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Generado', totals.total],
          ['Pendiente', totals.pending],
          ['Disponible', totals.available],
          ['Pagado', totals.paid],
        ].map(([label, amount]) => (
          <div key={String(label)} className="rounded-xl border border-white/5 bg-cc-surface p-4">
            <p className="text-xs text-cc-text-muted">{label}</p>
            <p className="mt-1 text-xl font-bold text-cc-cream">
              {Number(amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/5 bg-cc-surface overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h2 className="font-semibold text-cc-cream">Bonos por conversión</h2>
          <p className="text-xs text-cc-text-muted mt-1">
            $50 al liquidarse por completo el primer corte válido de Comodato.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-cc-text-muted">Aún no hay bonos generados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs text-cc-text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Negocio / socio</th>
                  <th className="px-4 py-3 text-left">Conversión</th>
                  <th className="px-4 py-3 text-left">Corte calificable</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Bono</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map(row => (
                  <tr key={row.commission_event_id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-cc-text-main">{row.business_name || 'Socio convertido'}</p>
                      <p className="text-xs text-cc-text-muted">{row.partner_folio || 'Sin folio'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-cc-text-muted">
                      {formatDateTime(row.converted_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-cc-text-muted">
                      {row.qualifying_settlement_id ? `${row.qualifying_settlement_id.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-cc-text-muted">
                        {row.payment_status === 'partially_paid' ? 'Pago parcial' : row.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-cc-primary">$50.00</td>
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

export const CommercialProspects = () => {
  const { profile, user, role } = useAuth();
  const [tab, setTab] = useState<PageTab>('prospectos');
  const [prospects, setProspects] = useState<CommercialProspect[]>([]);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ProspectStatus>('todos');
  const [resultFilter, setResultFilter] = useState<'todos' | ProspectResult>('todos');
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>('todos');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<CommercialProspect | null>(null);
  const [form, setForm] = useState(emptyProspectForm);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [interactions, setInteractions] = useState<ProspectInteraction[]>([]);
  const [interactionForm, setInteractionForm] = useState({
    result: 'no_contesto' as ProspectResult,
    notes: '',
    occurred_at: toInputDateTime(new Date().toISOString()),
    next_follow_up_at: '',
    proposed_visit_at: '',
  });
  const [detailForm, setDetailForm] = useState({ address: '', location_reference: '', contact_name: '', general_notes: '' });
  const [assignedToId, setAssignedToId] = useState('');
  const [responsibleSellerId, setResponsibleSellerId] = useState('');

  const isAdmin = role === 'admin';
  const canConvert = role === 'admin' || role === 'socios_comerciales';

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  };

  const loadProspects = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('v_commercial_prospect_details')
      .select('*')
      .order('created_at', { ascending: false });
    if (queryError) setError(queryError.message);
    else setProspects((data as CommercialProspect[]) ?? []);
    setLoading(false);
  }, []);

  const loadSellers = useCallback(async () => {
    if (!supabase || (!canConvert && !isAdmin)) return;
    const { data } = await supabase
      .from('user_profiles')
      .select('id, full_name, commercial_alias, role')
      .in('role', isAdmin ? ['socios_comerciales', 'vendedora'] : ['socios_comerciales'])
      .eq('is_active', true)
      .order('full_name');
    const options = (data as SellerOption[]) ?? [];
    setSellers(options);
    const firstCommercialSeller = options.find(option => option.role === 'socios_comerciales');
    if (firstCommercialSeller) setResponsibleSellerId(firstCommercialSeller.id);
  }, [canConvert, isAdmin]);

  useEffect(() => {
    loadProspects();
    loadSellers();
  }, [loadProspects, loadSellers]);

  useEffect(() => {
    if (!selected) return;
    setDetailForm({
      address: selected.address || '',
      location_reference: selected.location_reference || '',
      contact_name: selected.contact_name || '',
      general_notes: selected.general_notes || '',
    });
    setAssignedToId(selected.assigned_to || '');
    const loadInteractions = async () => {
      if (!supabase) return;
      const { data, error: historyError } = await supabase
        .from('commercial_prospect_interactions')
        .select('*')
        .eq('prospect_id', selected.id)
        .order('occurred_at', { ascending: false });
      if (historyError) notify(historyError.message);
      else setInteractions((data as ProspectInteraction[]) ?? []);
    };
    loadInteractions();
  }, [selected?.id]);

  const filtered = useMemo(() => {
    const now = new Date();
    return prospects.filter(prospect => {
      const text = `${prospect.business_name} ${prospect.phone} ${prospect.contact_name || ''} ${prospect.location_reference || ''}`.toLowerCase();
      if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
      if (statusFilter !== 'todos' && prospect.status !== statusFilter) return false;
      if (resultFilter !== 'todos' && prospect.latest_result !== resultFilter) return false;
      const followUp = prospect.next_follow_up_at ? new Date(prospect.next_follow_up_at) : null;
      if (followUpFilter === 'sin_fecha') return !followUp;
      if (followUpFilter === 'vencidos') return Boolean(followUp && followUp < now && !isSameLocalDay(followUp, now));
      if (followUpFilter === 'hoy') return Boolean(followUp && isSameLocalDay(followUp, now));
      if (followUpFilter === 'proximos') return Boolean(followUp && followUp > now && !isSameLocalDay(followUp, now));
      return true;
    });
  }, [prospects, search, statusFilter, resultFilter, followUpFilter]);

  const summary = useMemo(() => ({
    total: prospects.length,
    followUp: prospects.filter(item => item.status === 'seguimiento').length,
    visits: prospects.filter(item => item.status === 'visita_programada').length,
    converted: prospects.filter(item => item.status === 'convertido').length,
  }), [prospects]);

  const checkDuplicates = async () => {
    if (!supabase || !form.business_name.trim() || !form.phone.trim()) return [];
    const { data, error: duplicateError } = await supabase.rpc('commercial_prospect_duplicate_warnings', {
      p_business_name: form.business_name,
      p_phone: form.phone,
      p_location_reference: form.location_reference || null,
    });
    if (duplicateError) throw duplicateError;
    const warnings = (data as DuplicateWarning[]) ?? [];
    setDuplicates(warnings);
    return warnings;
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    try {
      await checkDuplicates();
      const { error: createError } = await supabase.rpc('create_commercial_prospect', {
        p_business_name: form.business_name,
        p_business_type: form.business_type,
        p_phone: form.phone,
        p_location_reference: form.location_reference || null,
        p_contact_name: form.contact_name || null,
        p_sells_snacks: form.sells_snacks,
        p_general_notes: form.general_notes || null,
        p_address: form.address || null,
        p_origin_channel: 'captura_directa',
      });
      if (createError) throw createError;
      setShowCreate(false);
      setForm(emptyProspectForm);
      setDuplicates([]);
      notify('Prospecto creado correctamente.');
      await loadProspects();
    } catch (createError: any) {
      notify(createError?.message || 'No se pudo crear el prospecto.');
    } finally {
      setSaving(false);
    }
  };

  const saveDetail = async () => {
    if (!supabase || !selected) return;
    setSaving(true);
    const { data, error: updateError } = await supabase.rpc('update_commercial_prospect', {
      p_prospect_id: selected.id,
      p_changes: isAdmin ? { ...detailForm, assigned_to: assignedToId || null } : detailForm,
    });
    if (updateError) notify(updateError.message);
    else {
      notify('Datos del prospecto actualizados.');
      setSelected({ ...selected, ...(data as CommercialProspect) });
      await loadProspects();
    }
    setSaving(false);
  };

  const appendInteraction = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !selected) return;
    setSaving(true);
    const { data, error: interactionError } = await supabase.rpc('append_commercial_prospect_interaction', {
      p_prospect_id: selected.id,
      p_result: interactionForm.result,
      p_notes: interactionForm.notes || null,
      p_occurred_at: interactionForm.occurred_at ? new Date(interactionForm.occurred_at).toISOString() : new Date().toISOString(),
      p_next_follow_up_at: interactionForm.next_follow_up_at ? new Date(interactionForm.next_follow_up_at).toISOString() : null,
      p_proposed_visit_at: interactionForm.proposed_visit_at ? new Date(interactionForm.proposed_visit_at).toISOString() : null,
    });
    if (interactionError) notify(interactionError.message);
    else {
      setInteractions(previous => [data as ProspectInteraction, ...previous]);
      setInteractionForm({
        result: 'no_contesto', notes: '',
        occurred_at: toInputDateTime(new Date().toISOString()),
        next_follow_up_at: '', proposed_visit_at: '',
      });
      notify('Contacto agregado al historial.');
      await loadProspects();
      const refreshed = prospects.find(item => item.id === selected.id);
      if (refreshed) setSelected(refreshed);
    }
    setSaving(false);
  };

  const convertProspect = async () => {
    if (!supabase || !selected || !responsibleSellerId) return;
    if (!window.confirm(`¿Convertir ${selected.business_name} en socio Comodato activo?`)) return;
    setSaving(true);
    const { data, error: conversionError } = await supabase.rpc('convert_commercial_prospect', {
      p_prospect_id: selected.id,
      p_responsible_seller_id: responsibleSellerId,
      p_notes: null,
    });
    if (conversionError) notify(conversionError.message);
    else {
      const result = data as { partner_folio?: string };
      notify(`Prospecto convertido${result.partner_folio ? ` como ${result.partner_folio}` : ''}.`);
      setSelected(null);
      await loadProspects();
    }
    setSaving(false);
  };

  const archiveProspect = async () => {
    if (!supabase || !selected || !isAdmin) return;
    if (!window.confirm(`¿Archivar ${selected.business_name}?`)) return;
    const { error: archiveError } = await supabase.rpc('update_commercial_prospect', {
      p_prospect_id: selected.id,
      p_changes: { status: 'archivado' },
    });
    if (archiveError) notify(archiveError.message);
    else {
      setSelected(null);
      notify('Prospecto archivado.');
      await loadProspects();
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportCommercialProspects();
      notify('Excel generado con los registros autorizados.');
    } catch (exportError: any) {
      notify(exportError?.message || 'No se pudo exportar.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cc-primary">
            <Users size={22} />
            <h1 className="text-2xl font-bold text-cc-text-main">Prospectos Comerciales</h1>
          </div>
          <p className="mt-1 text-sm text-cc-text-muted">
            Captación, seguimiento y conversión con atribución de origen.
          </p>
        </div>
        {tab === 'prospectos' && (
          <div className="flex gap-2">
            <button onClick={handleExport} disabled={exporting} className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-cc-text-main hover:bg-white/5 disabled:opacity-50">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-cc-primary px-4 py-2 text-sm font-semibold text-cc-bg hover:bg-cc-primary-dark">
              <Plus size={16} /> Nuevo prospecto
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-white/10">
        <button onClick={() => setTab('prospectos')} className={`px-4 py-3 text-sm font-semibold border-b-2 ${tab === 'prospectos' ? 'border-cc-primary text-cc-primary' : 'border-transparent text-cc-text-muted'}`}>
          Prospectos
        </button>
        <button onClick={() => setTab('comisiones')} className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 ${tab === 'comisiones' ? 'border-cc-primary text-cc-primary' : 'border-transparent text-cc-text-muted'}`}>
          <WalletCards size={16} /> Comisiones
        </button>
      </div>

      {tab === 'comisiones' ? (
        <ProspectBonusPanel userId={user?.id} isAdmin={isAdmin} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Total', summary.total],
              ['En seguimiento', summary.followUp],
              ['Visitas', summary.visits],
              ['Convertidos', summary.converted],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/5 bg-cc-surface p-4">
                <p className="text-xs text-cc-text-muted">{label}</p>
                <p className="mt-1 text-2xl font-bold text-cc-cream">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-xl border border-white/5 bg-cc-surface p-4">
            <label className="relative md:col-span-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar negocio, teléfono…" className="w-full rounded-lg border border-white/10 bg-cc-bg py-2.5 pl-9 pr-3 text-sm text-cc-text-main outline-none focus:border-cc-primary/50" />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main">
              <option value="todos">Todos los estados</option>
              {Object.entries(PROSPECT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={resultFilter} onChange={event => setResultFilter(event.target.value as typeof resultFilter)} className="rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main">
              <option value="todos">Todos los resultados</option>
              {Object.entries(PROSPECT_RESULT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={followUpFilter} onChange={event => setFollowUpFilter(event.target.value as FollowUpFilter)} className="rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main">
              <option value="todos">Cualquier seguimiento</option>
              <option value="vencidos">Vencidos</option>
              <option value="hoy">Para hoy</option>
              <option value="proximos">Próximos</option>
              <option value="sin_fecha">Sin fecha</option>
            </select>
          </div>

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
          {loading ? (
            <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-cc-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-cc-surface py-16 text-center text-sm text-cc-text-muted">No hay prospectos con estos filtros.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {filtered.map(prospect => (
                <button key={prospect.id} onClick={() => setSelected(prospect)} className="rounded-xl border border-white/5 bg-cc-surface p-4 text-left hover:border-cc-primary/30 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-cc-text-main truncate">{prospect.business_name}</p>
                      <p className="text-xs text-cc-primary mt-0.5">PROSPECTO / {prospect.originator_name || 'SIN ALIAS'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${statusClasses[prospect.status]}`}>
                      {PROSPECT_STATUS_LABELS[prospect.status]}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-cc-text-muted">
                    <span className="flex items-center gap-2"><Phone size={13} />{prospect.phone}</span>
                    <span className="flex items-center gap-2"><Store size={13} />{prospect.business_type}</span>
                    <span className="flex items-center gap-2"><CalendarClock size={13} />{formatDateTime(prospect.next_follow_up_at)}</span>
                    <span className="flex items-center gap-2"><History size={13} />{prospect.interaction_count || 0} contacto(s)</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={handleCreate} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-cc-surface p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div><h2 className="text-xl font-bold text-cc-cream">Nuevo prospecto</h2><p className="text-xs text-cc-text-muted">Registro comercial simplificado.</p></div>
              <button type="button" onClick={() => setShowCreate(false)} className="text-cc-text-muted hover:text-white"><X /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-cc-text-muted">Negocio *<input required value={form.business_name} onChange={event => setForm({ ...form, business_name: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
              <label className="text-xs text-cc-text-muted">Teléfono *<input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} onBlur={() => checkDuplicates().catch(() => undefined)} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
              <label className="text-xs text-cc-text-muted">Tipo<select value={form.business_type} onChange={event => setForm({ ...form, business_type: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main">{PROSPECT_BUSINESS_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
              <label className="text-xs text-cc-text-muted">Contacto<input value={form.contact_name} onChange={event => setForm({ ...form, contact_name: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
              <label className="text-xs text-cc-text-muted">Referencia de ubicación<input value={form.location_reference} onChange={event => setForm({ ...form, location_reference: event.target.value })} onBlur={() => checkDuplicates().catch(() => undefined)} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
              <label className="text-xs text-cc-text-muted">¿Vende botanas?<select value={form.sells_snacks} onChange={event => setForm({ ...form, sells_snacks: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main"><option value="unknown">No se sabe</option><option value="yes">Sí</option><option value="no">No</option></select></label>
              <label className="md:col-span-2 text-xs text-cc-text-muted">Dirección<input value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} placeholder="Obligatoria antes de solicitar/programar visita" className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
              <label className="md:col-span-2 text-xs text-cc-text-muted">Notas<textarea value={form.general_notes} onChange={event => setForm({ ...form, general_notes: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2.5 text-sm text-cc-text-main" /></label>
            </div>
            {duplicates.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><p className="font-semibold flex items-center gap-2"><AlertTriangle size={14} />Coincidencias detectadas</p>{duplicates.map((warning, index) => <p key={`${warning.source}-${warning.id}-${index}`} className="mt-1">{warning.label} · {warning.match_type}{warning.phone_hint ? ` · termina en ${warning.phone_hint}` : ''}</p>)}</div>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-cc-text-main">Cancelar</button><button disabled={saving} className="rounded-lg bg-cc-primary px-4 py-2 text-sm font-semibold text-cc-bg disabled:opacity-50">{saving ? 'Guardando…' : 'Crear prospecto'}</button></div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-cc-bg p-5 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs text-cc-primary">PROSPECTO / {selected.originator_name || 'SIN ALIAS'}</p><h2 className="text-xl font-bold text-cc-cream">{selected.business_name}</h2><p className="text-sm text-cc-text-muted">{selected.phone} · {selected.contact_name || 'Sin contacto'}</p></div>
              <button onClick={() => setSelected(null)} className="text-cc-text-muted hover:text-white"><X /></button>
            </div>

            <section className="rounded-xl border border-white/5 bg-cc-surface p-4 space-y-3">
              <div className="flex items-center justify-between"><h3 className="font-semibold text-cc-cream">Datos comerciales</h3><span className={`rounded-full border px-2 py-1 text-xs ${statusClasses[selected.status]}`}>{PROSPECT_STATUS_LABELS[selected.status]}</span></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-cc-text-muted">Contacto<input value={detailForm.contact_name} onChange={event => setDetailForm({ ...detailForm, contact_name: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                <label className="text-xs text-cc-text-muted">Referencia<input value={detailForm.location_reference} onChange={event => setDetailForm({ ...detailForm, location_reference: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                <label className="md:col-span-2 text-xs text-cc-text-muted">Dirección<input value={detailForm.address} onChange={event => setDetailForm({ ...detailForm, address: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                <label className="md:col-span-2 text-xs text-cc-text-muted">Notas<textarea value={detailForm.general_notes} onChange={event => setDetailForm({ ...detailForm, general_notes: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                {isAdmin && <label className="md:col-span-2 text-xs text-cc-text-muted">Asignado a<select value={assignedToId} onChange={event => setAssignedToId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main"><option value="">Sin asignar</option>{sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.commercial_alias || seller.full_name}</option>)}</select></label>}
              </div>
              <button onClick={saveDetail} disabled={saving || selected.status === 'convertido'} className="rounded-lg border border-cc-primary/40 px-3 py-2 text-xs font-semibold text-cc-primary disabled:opacity-40">Guardar datos</button>
            </section>

            {selected.status !== 'convertido' && selected.status !== 'archivado' && (
              <form onSubmit={appendInteraction} className="rounded-xl border border-white/5 bg-cc-surface p-4 space-y-3">
                <h3 className="font-semibold text-cc-cream">Registrar contacto</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-cc-text-muted">Resultado<select value={interactionForm.result} onChange={event => setInteractionForm({ ...interactionForm, result: event.target.value as ProspectResult })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main">{Object.entries(PROSPECT_RESULT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="text-xs text-cc-text-muted">Fecha del contacto<input type="datetime-local" value={interactionForm.occurred_at} onChange={event => setInteractionForm({ ...interactionForm, occurred_at: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                  <label className="text-xs text-cc-text-muted">Próxima llamada<input type="datetime-local" value={interactionForm.next_follow_up_at} onChange={event => setInteractionForm({ ...interactionForm, next_follow_up_at: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                  <label className="text-xs text-cc-text-muted">Visita propuesta<input type="datetime-local" value={interactionForm.proposed_visit_at} onChange={event => setInteractionForm({ ...interactionForm, proposed_visit_at: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                  <label className="md:col-span-2 text-xs text-cc-text-muted">Notas<textarea value={interactionForm.notes} onChange={event => setInteractionForm({ ...interactionForm, notes: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main" /></label>
                </div>
                <button disabled={saving} className="rounded-lg bg-cc-primary px-4 py-2 text-sm font-semibold text-cc-bg disabled:opacity-50">Agregar al historial</button>
              </form>
            )}

            {canConvert && selected.status !== 'convertido' && selected.status !== 'archivado' && (
              <section className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 space-y-3">
                <div><h3 className="font-semibold text-green-300">Convertir a Comodato</h3><p className="text-xs text-cc-text-muted">Crea un socio activo y conserva quién originó el prospecto. El bono no se genera hasta liquidar el primer corte válido.</p></div>
                <select value={responsibleSellerId} onChange={event => setResponsibleSellerId(event.target.value)} className="w-full rounded-lg border border-white/10 bg-cc-bg px-3 py-2 text-sm text-cc-text-main"><option value="">Responsable comercial…</option>{sellers.filter(seller => seller.role === 'socios_comerciales').map(seller => <option key={seller.id} value={seller.id}>{seller.commercial_alias || seller.full_name}</option>)}</select>
                <button onClick={convertProspect} disabled={saving || !responsibleSellerId || !detailForm.address.trim()} className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"><CheckCircle2 size={16} /> Convertir</button>
                {!detailForm.address.trim() && <p className="text-xs text-amber-300 flex items-center gap-1"><MapPin size={13} />Guarda una dirección antes de convertir.</p>}
              </section>
            )}

            <section className="rounded-xl border border-white/5 bg-cc-surface p-4">
              <h3 className="font-semibold text-cc-cream mb-3">Historial de contactos</h3>
              {interactions.length === 0 ? <p className="text-sm text-cc-text-muted">Sin contactos todavía.</p> : <div className="space-y-3">{interactions.map(interaction => <div key={interaction.id} className="border-l-2 border-cc-primary/40 pl-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-cc-text-main">{PROSPECT_RESULT_LABELS[interaction.result]}</p><p className="text-xs text-cc-text-muted">{formatDateTime(interaction.occurred_at)}</p></div>{interaction.notes && <p className="mt-1 text-xs text-cc-text-muted">{interaction.notes}</p>}{interaction.next_follow_up_at && <p className="mt-1 text-xs text-amber-300">Próximo: {formatDateTime(interaction.next_follow_up_at)}</p>}</div>)}</div>}
            </section>

            {isAdmin && selected.status !== 'convertido' && <button onClick={archiveProspect} className="text-xs text-red-300 hover:text-red-200">Archivar prospecto</button>}
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-white/10 bg-cc-surface px-5 py-3 text-sm text-cc-text-main shadow-2xl">{toast}</div>}
      <span className="sr-only">Usuario actual: {profile?.full_name || ''}</span>
    </div>
  );
};
