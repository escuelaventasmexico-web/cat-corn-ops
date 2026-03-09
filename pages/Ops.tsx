import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Calendar, User, CheckCircle, AlertCircle, Loader,
  Download, Lock, Wrench, Plus, Bell, Power, Settings, Bug, Sparkles, Eye
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  getOrCreateDailyChecklist,
  getDailyChecklistItems,
  updateChecklistItem,
  getTodayDate,
  getChecklistStats,
  type DailyChecklist,
  type DailyChecklistItem,
  type ChecklistItemStatus
} from '../lib/opsChecklist';
import {
  fetchMachines,
  insertMachine,
  toggleMachineActive,
  insertMaintenance,
  fetchUpcomingMaintenance,
  fetchMaintenanceHistory,
  type OpsMachine,
  type OpsMaintenance,
  type MaintenanceType,
  type NewMachinePayload,
  type NewMaintenancePayload
} from '../lib/opsMaintenance';
import {
  fetchFumigationRecords,
  insertFumigationRecord,
  computeFumigationStatus,
  fetchDeepCleaningRecords,
  insertDeepCleaningRecord,
  computeCleaningStatus,
  DEEP_CLEANING_AREAS,
  type OpsFumigation,
  type NewFumigationPayload,
  type OpsDeepCleaning,
  type NewDeepCleaningPayload,
  type DeepCleaningArea
} from '../lib/opsCompliance';

type OpsTab = 'checklist' | 'maintenance';

const Ops = () => {
  // ─── Tab State ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<OpsTab>('checklist');

  // ─── Checklist State (unchanged) ───────────────────────────
  const [checklistDate, setChecklistDate] = useState<string>(getTodayDate());
  const [responsibleName, setResponsibleName] = useState<string>('');
  const [checklist, setChecklist] = useState<DailyChecklist | null>(null);
  const [items, setItems] = useState<DailyChecklistItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState<boolean>(false);

  // ─── Maintenance State ─────────────────────────────────────
  const [machines, setMachines] = useState<OpsMachine[]>([]);
  const [upcoming, setUpcoming] = useState<OpsMaintenance[]>([]);
  const [history, setHistory] = useState<OpsMaintenance[]>([]);
  const [mtLoading, setMtLoading] = useState(false);
  const [mtError, setMtError] = useState<string | null>(null);

  // New machine form
  const [showNewMachine, setShowNewMachine] = useState(false);
  const [newMachine, setNewMachine] = useState<NewMachinePayload>({ name: '', machine_type: '', serial_number: '' });

  // New maintenance form
  const [mtForm, setMtForm] = useState<NewMaintenancePayload>({
    machine_id: '',
    maintenance_date: getTodayDate(),
    maintenance_type: 'PREVENTIVO',
    technician: '',
    cost_mxn: 0,
    next_due_date: '',
    notes: ''
  });

  // ─── Fumigación State ──────────────────────────────────────
  const [fumRecords, setFumRecords] = useState<OpsFumigation[]>([]);
  const [showFumForm, setShowFumForm] = useState(false);
  const [fumForm, setFumForm] = useState<NewFumigationPayload>({
    fumigation_date: getTodayDate(),
    provider: '',
    next_fumigation_date: null,
    document_id: null,
    status: 'VIGENTE',
    notes: null
  });

  // ─── Limpieza Profunda State ───────────────────────────────
  const [dcRecords, setDcRecords] = useState<OpsDeepCleaning[]>([]);
  const [showDcForm, setShowDcForm] = useState(false);
  const [dcAreaFilter, setDcAreaFilter] = useState<string>('');
  const [dcForm, setDcForm] = useState<NewDeepCleaningPayload>({
    area: 'PISOS',
    cleaning_date: getTodayDate(),
    responsible: '',
    evidence_url: null,
    next_suggested_date: null,
    notes: null
  });

  // ─── Load maintenance data when tab activates ─────────────
  const loadMaintenanceData = useCallback(async () => {
    setMtLoading(true);
    setMtError(null);
    try {
      const [machinesData, upcomingData, historyData, fumData, dcData] = await Promise.all([
        fetchMachines(),
        fetchUpcomingMaintenance(5),
        fetchMaintenanceHistory(),
        fetchFumigationRecords(),
        fetchDeepCleaningRecords()
      ]);
      setMachines(machinesData);
      setUpcoming(upcomingData);
      setHistory(historyData);
      setFumRecords(fumData);
      setDcRecords(dcData);
    } catch (err) {
      console.error('[mt load error]', err);
      setMtError(err instanceof Error ? err.message : String(err));
    } finally {
      setMtLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'maintenance') {
      loadMaintenanceData();
    }
  }, [activeTab, loadMaintenanceData]);

  // ─── Checklist Handlers (unchanged) ────────────────────────
  const handleLoadChecklist = async () => {
    console.log('[ops click] date=', checklistDate, 'responsable=', responsibleName);
    if (!responsibleName?.trim()) { setError('Por favor ingresa el nombre del responsable'); return; }
    setLoading(true); setError(null);
    try {
      const checklistData = await getOrCreateDailyChecklist(checklistDate, responsibleName.trim());
      console.log('[ops checklist]', checklistData);
      setChecklist(checklistData);
      const itemsData = await getDailyChecklistItems(checklistData.id);
      console.log('[ops items]', itemsData);
      setItems(itemsData);
      setError(null); setIsClosed(false);
    } catch (err) {
      console.error('[ops error]', err);
      setError(String((err as any)?.message ?? err));
    } finally { setLoading(false); }
  };

  const handleStatusChange = async (itemId: string, newStatus: ChecklistItemStatus) => {
    const currentItem = items.find(item => item.id === itemId);
    if (!currentItem) return;
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: newStatus } : i));
    setUpdatingItemId(itemId);
    try {
      await updateChecklistItem(itemId, newStatus, currentItem.notes);
      setError(null);
    } catch (err) {
      console.error('Error updating item status:', err);
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: currentItem.status } : i));
      setError(err instanceof Error ? err.message : 'Error al actualizar estado');
    } finally { setUpdatingItemId(null); }
  };

  const handleNotesChange = async (itemId: string, newNotes: string) => {
    const currentItem = items.find(item => item.id === itemId);
    if (!currentItem) return;
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, notes: newNotes || null } : i));
  };

  const handleNotesBlur = async (itemId: string) => {
    setUpdatingItemId(itemId);
    try {
      const currentItem = items.find(item => item.id === itemId);
      if (!currentItem) return;
      await updateChecklistItem(itemId, currentItem.status, currentItem.notes);
    } catch (err) {
      console.error('Error updating item notes:', err);
      setError(err instanceof Error ? err.message : 'Error al guardar notas');
    } finally { setUpdatingItemId(null); }
  };

  const handleCloseChecklist = async () => {
    if (!checklist?.id) return;
    if (!confirm('¿Finalizar checklist? Ya no podrás editarlo.')) return;
    try {
      const { supabase } = await import('../supabase');
      const { error } = await supabase!.rpc('ops_close_daily_checklist', {
        p_checklist_id: checklist.id, p_closed_by: responsibleName || 'Sistema'
      });
      if (error) throw new Error(error.message);
      alert('Checklist finalizado ✅');
      const tomorrow = new Date(checklistDate + 'T00:00:00');
      tomorrow.setDate(tomorrow.getDate() + 1);
      setChecklistDate(tomorrow.toISOString().split('T')[0]);
      setChecklist(null); setItems([]); setResponsibleName('');
      setError(null); setLoading(false); setIsClosed(false);
    } catch (err) {
      console.error('[ops close error]', err);
      alert('No se pudo finalizar el checklist. Revisa consola.');
    }
  };

  const downloadChecklistExcel = async () => {
    if (!checklist?.id) return;
    try {
      const { supabase } = await import('../supabase');
      const { data, error } = await supabase!
        .from('daily_checklist_items')
        .select(`status, notes, created_at, operational_tasks_master(category, label)`)
        .eq('checklist_id', checklist.id);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) { alert('No hay datos para exportar.'); return; }
      const rows = data.map((item: any) => ({
        Fecha: checklistDate,
        Categoria: item.operational_tasks_master?.category ?? '',
        Tarea: item.operational_tasks_master?.label ?? '',
        Estado: item.status ?? '', Notas: item.notes ?? '',
        Actualizado: item.created_at ?? ''
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([wbOut], { type: 'application/octet-stream' }), `CatCorn_Checklist_${checklistDate}.xlsx`);
    } catch (err) {
      console.error('[ops excel error]', err);
      alert('Error al generar el Excel: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ─── Maintenance Handlers ──────────────────────────────────
  const handleAddMachine = async () => {
    if (!newMachine.name.trim() || !newMachine.machine_type.trim()) {
      alert('Ingresa nombre y tipo de máquina'); return;
    }
    try {
      const created = await insertMachine(newMachine);
      setMachines(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewMachine({ name: '', machine_type: '', serial_number: '' });
      setShowNewMachine(false);
    } catch (err) {
      console.error('[mt add machine]', err);
      alert('Error al agregar máquina: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleToggleActive = async (machine: OpsMachine) => {
    try {
      await toggleMachineActive(machine.id, !machine.active);
      setMachines(prev => prev.map(m => m.id === machine.id ? { ...m, active: !m.active } : m));
    } catch (err) {
      console.error('[mt toggle]', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleAddMaintenance = async () => {
    if (!mtForm.machine_id || !mtForm.technician.trim()) {
      alert('Selecciona máquina e ingresa técnico'); return;
    }
    try {
      await insertMaintenance({
        ...mtForm,
        next_due_date: mtForm.next_due_date || null,
        notes: mtForm.notes || null
      });
      alert('Mantenimiento registrado ✅');
      setMtForm({ machine_id: '', maintenance_date: getTodayDate(), maintenance_type: 'PREVENTIVO', technician: '', cost_mxn: 0, next_due_date: '', notes: '' });
      await loadMaintenanceData();
    } catch (err) {
      console.error('[mt add maint]', err);
      alert('Error al registrar: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ─── Fumigación Handlers ───────────────────────────────────
  const handleAddFumigation = async () => {
    if (!fumForm.provider.trim()) { alert('Ingresa la empresa proveedora'); return; }
    // Compute status from dates
    const { label } = computeFumigationStatus(fumForm.next_fumigation_date);
    const computedStatus = (label === 'Vencido') ? 'VENCIDO' as const : 'VIGENTE' as const;
    try {
      const created = await insertFumigationRecord({ ...fumForm, status: computedStatus });
      setFumRecords(prev => [created, ...prev].slice(0, 20));
      setFumForm({ fumigation_date: getTodayDate(), provider: '', next_fumigation_date: null, document_id: null, status: 'VIGENTE', notes: null });
      setShowFumForm(false);
      alert('Fumigación registrada ✅');
    } catch (err) {
      console.error('[fum add]', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ─── Limpieza Profunda Handlers ────────────────────────────
  const handleAddDeepCleaning = async () => {
    if (!dcForm.responsible.trim()) { alert('Ingresa el responsable'); return; }
    try {
      const created = await insertDeepCleaningRecord(dcForm);
      setDcRecords(prev => [created, ...prev].slice(0, 50));
      setDcForm({ area: 'PISOS', cleaning_date: getTodayDate(), responsible: '', evidence_url: null, next_suggested_date: null, notes: null });
      setShowDcForm(false);
      alert('Limpieza registrada ✅');
    } catch (err) {
      console.error('[dc add]', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ─── Derived data ──────────────────────────────────────────
  const stats = items.length > 0 ? getChecklistStats(items) : null;
  const itemsByCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, DailyChecklistItem[]>);
  const activeMachines = machines.filter(m => m.active);
  const filteredDcRecords = dcAreaFilter
    ? dcRecords.filter(r => r.area === dcAreaFilter)
    : dcRecords;

  // Count compliance alerts for the tab badge
  const fumAlertCount = fumRecords.filter(r => {
    const s = computeFumigationStatus(r.next_fumigation_date);
    return s.label === 'Vencido' || s.label === 'Vence pronto';
  }).length;
  const dcAlertCount = dcRecords.filter(r => {
    const s = computeCleaningStatus(r.next_suggested_date);
    return s.label === 'Pendiente';
  }).length;
  const totalMtAlerts = upcoming.length + fumAlertCount + dcAlertCount;

  // ═════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-cc-bg p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <ClipboardCheck size={40} className="text-cc-primary" />
          <h1 className="text-4xl font-bold text-cc-cream">Logística y Operación</h1>
        </div>

        {/* ──── Tabs ──── */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('checklist')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold transition-all ${
              activeTab === 'checklist'
                ? 'bg-cc-primary text-cc-bg shadow-[0_0_15px_rgba(244,197,66,0.3)]'
                : 'bg-cc-surface text-cc-text-muted hover:bg-white/10'
            }`}
          >
            <ClipboardCheck size={18} />
            Checklist Diario
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('maintenance')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold transition-all ${
              activeTab === 'maintenance'
                ? 'bg-cc-primary text-cc-bg shadow-[0_0_15px_rgba(244,197,66,0.3)]'
                : 'bg-cc-surface text-cc-text-muted hover:bg-white/10'
            }`}
          >
            <Wrench size={18} />
            Mantenimiento
            {totalMtAlerts > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-red-500 text-white">{totalMtAlerts}</span>
            )}
          </button>
        </div>

        {/* ════════════════════════════════════════════════════════
            TAB: CHECKLIST DIARIO (original, unchanged)
            ════════════════════════════════════════════════════════ */}
        {activeTab === 'checklist' && (
          <>
            {/* Form Card */}
            <div className="bg-cc-surface rounded-xl border border-cc-primary/20 p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-cc-cream mb-2">
                    <Calendar size={16} className="inline mr-1" />Fecha
                  </label>
                  <input type="date" value={checklistDate} onChange={(e) => setChecklistDate(e.target.value)}
                    className="w-full bg-white text-black border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-cc-cream mb-2">
                    <User size={16} className="inline mr-1" />Responsable
                  </label>
                  <input type="text" value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)}
                    placeholder="Nombre del responsable"
                    className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={handleLoadChecklist} disabled={loading}
                    className="w-full bg-cc-primary text-cc-bg font-semibold rounded-lg px-6 py-2 hover:bg-cc-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {loading ? (<><Loader size={20} className="animate-spin" />Cargando...</>) : 'Cargar Checklist'}
                  </button>
                </div>
                {checklist?.id && (
                  <div className="flex items-end gap-2">
                    <button type="button" onClick={downloadChecklistExcel}
                      className="flex-1 bg-green-600 text-white font-semibold rounded-lg px-4 py-2 hover:bg-green-500 transition-colors flex items-center justify-center gap-2">
                      <Download size={18} />Excel
                    </button>
                    {!isClosed && (
                      <button type="button" onClick={handleCloseChecklist}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-2 transition-colors flex items-center justify-center gap-2">
                        <Lock size={18} />Finalizar
                      </button>
                    )}
                  </div>
                )}
              </div>
              {error && (
                <div className="mt-4 bg-red-950/30 border border-red-500/50 rounded-lg p-3 flex items-center gap-2 text-red-400">
                  <AlertCircle size={20} /><span className="text-sm">{error}</span>
                </div>
              )}
            </div>

            {/* Closed Badge */}
            {isClosed && (
              <div className="bg-red-950/40 border border-red-500/60 rounded-xl p-4 flex items-center gap-3">
                <Lock size={20} className="text-red-400" />
                <span className="text-red-300 font-semibold">Checklist Cerrado — solo lectura</span>
              </div>
            )}

            {/* Stats Card */}
            {checklist && stats && (
              <div className="bg-cc-surface rounded-xl border border-cc-primary/20 p-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div><p className="text-sm text-cc-text-muted">Total de Tareas</p><p className="text-3xl font-bold text-cc-cream">{stats.total}</p></div>
                  <div><p className="text-sm text-cc-text-muted">Completadas (OK)</p><p className="text-3xl font-bold text-green-400">{stats.okCount}</p></div>
                  <div><p className="text-sm text-cc-text-muted">Con Problemas</p><p className="text-3xl font-bold text-red-400">{stats.issueCount}</p></div>
                  <div><p className="text-sm text-cc-text-muted">Pendientes</p><p className="text-3xl font-bold text-yellow-400">{stats.pendingCount}</p></div>
                  <div>
                    <p className="text-sm text-cc-text-muted">Progreso</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-bold text-cc-primary">{stats.completionPercent}%</p>
                      {stats.completionPercent === 100 && <CheckCircle size={24} className="text-green-400" />}
                    </div>
                    <div className="mt-2 w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-500"
                        style={{ width: `${stats.completionPercent}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Checklist Items */}
            {checklist && items.length > 0 && (
              <div className="space-y-4">
                {Object.entries(itemsByCategory).map(([category, categoryItems]) => (
                  <div key={category} className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                    <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3">
                      <h2 className="text-xl font-bold text-cc-primary">{category}</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-cc-bg border-b border-white/5">
                          <tr>
                            <th className="text-left px-6 py-3 text-sm font-semibold text-cc-cream">Tarea</th>
                            <th className="text-center px-6 py-3 text-sm font-semibold text-cc-cream w-32">Estado</th>
                            <th className="text-left px-6 py-3 text-sm font-semibold text-cc-cream">Notas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryItems.map((item) => (
                            <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                              <td className="px-6 py-4"><span className="text-cc-cream">{item.label}</span></td>
                              <td className="px-6 py-4">
                                <div className="flex items-center justify-center gap-2">
                                  <button type="button" onClick={() => handleStatusChange(item.id, 'OK')}
                                    disabled={updatingItemId === item.id || isClosed}
                                    className={`px-4 py-2 rounded-lg font-semibold transition-all ${item.status === 'OK' ? 'bg-green-500 text-white' : 'bg-white/10 text-cc-text-muted hover:bg-white/20'} ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}>OK</button>
                                  <button type="button" onClick={() => handleStatusChange(item.id, 'ISSUE')}
                                    disabled={updatingItemId === item.id || isClosed}
                                    className={`px-4 py-2 rounded-lg font-semibold transition-all ${item.status === 'ISSUE' ? 'bg-red-500 text-white' : 'bg-white/10 text-cc-text-muted hover:bg-white/20'} ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}>ISSUE</button>
                                  {updatingItemId === item.id && <Loader size={16} className="animate-spin text-cc-primary" />}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <input type="text" value={item.notes || ''} onChange={(e) => handleNotesChange(item.id, e.target.value)}
                                  onBlur={() => handleNotesBlur(item.id)} placeholder="Agregar notas..." disabled={isClosed}
                                  className={`w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {checklist && items.length === 0 && (
              <div className="bg-cc-surface rounded-xl border border-cc-primary/20 p-12 text-center">
                <ClipboardCheck size={64} className="mx-auto mb-4 text-cc-text-muted" />
                <h3 className="text-xl font-bold text-cc-cream mb-2">No hay tareas en este checklist</h3>
                <p className="text-cc-text-muted">El checklist para esta fecha no tiene tareas configuradas.</p>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB: MANTENIMIENTO
            ════════════════════════════════════════════════════════ */}
        {activeTab === 'maintenance' && (
          <>
            {mtLoading && (
              <div className="flex items-center justify-center py-12 gap-3 text-cc-primary">
                <Loader size={24} className="animate-spin" /><span className="text-cc-cream">Cargando datos de mantenimiento...</span>
              </div>
            )}
            {mtError && (
              <div className="bg-red-950/30 border border-red-500/50 rounded-lg p-3 flex items-center gap-2 text-red-400">
                <AlertCircle size={20} /><span className="text-sm">{mtError}</span>
              </div>
            )}

            {!mtLoading && (
              <div className="space-y-6">

                {/* ── Alertas de Próximos Mantenimientos ── */}
                {upcoming.length > 0 && (
                  <div className="bg-red-950/30 border border-red-500/50 rounded-xl p-5 space-y-3">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-red-400">
                      <Bell size={20} />Próximos Mantenimientos (5 días)
                    </h2>
                    {upcoming.map(m => (
                      <div key={m.id} className="flex items-start gap-3 bg-red-950/30 rounded-lg p-3">
                        <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-red-300 font-semibold">{m.machine_name} ({m.machine_type})</p>
                          <p className="text-sm text-red-400/80">
                            Requiere mantenimiento: <span className="font-mono">{m.next_due_date}</span>
                            {' · '}Último: {m.maintenance_type} por {m.technician}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Sección: Máquinas ── */}
                <div className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                  <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-cc-primary flex items-center gap-2"><Settings size={20} />Máquinas</h2>
                    <button type="button" onClick={() => setShowNewMachine(!showNewMachine)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary/90 transition-colors">
                      <Plus size={16} />{showNewMachine ? 'Cancelar' : 'Agregar'}
                    </button>
                  </div>

                  {/* Inline form for new machine */}
                  {showNewMachine && (
                    <div className="border-b border-white/5 p-4 bg-cc-bg/50">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <input type="text" placeholder="Nombre *" value={newMachine.name}
                          onChange={e => setNewMachine({ ...newMachine, name: e.target.value })}
                          className="bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        <input type="text" placeholder="Tipo (ej. Horno, Batidora) *" value={newMachine.machine_type}
                          onChange={e => setNewMachine({ ...newMachine, machine_type: e.target.value })}
                          className="bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        <input type="text" placeholder="No. Serie (opcional)" value={newMachine.serial_number || ''}
                          onChange={e => setNewMachine({ ...newMachine, serial_number: e.target.value })}
                          className="bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        <button type="button" onClick={handleAddMachine}
                          className="bg-green-600 text-white font-semibold rounded-lg px-4 py-2 text-sm hover:bg-green-500 transition-colors">
                          Guardar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Machines table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-cc-bg border-b border-white/5">
                        <tr>
                          <th className="text-left px-6 py-3 text-sm font-semibold text-cc-cream">Nombre</th>
                          <th className="text-left px-6 py-3 text-sm font-semibold text-cc-cream">Tipo</th>
                          <th className="text-left px-6 py-3 text-sm font-semibold text-cc-cream">No. Serie</th>
                          <th className="text-center px-6 py-3 text-sm font-semibold text-cc-cream w-24">Activa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machines.length === 0 ? (
                          <tr><td colSpan={4} className="px-6 py-8 text-center text-cc-text-muted">No hay máquinas registradas</td></tr>
                        ) : machines.map(m => (
                          <tr key={m.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="px-6 py-3 text-cc-cream">{m.name}</td>
                            <td className="px-6 py-3 text-cc-text-muted">{m.machine_type}</td>
                            <td className="px-6 py-3 text-cc-text-muted font-mono text-sm">{m.serial_number || '—'}</td>
                            <td className="px-6 py-3 text-center">
                              <button type="button" onClick={() => handleToggleActive(m)}
                                className={`p-1.5 rounded-lg transition-colors ${m.active ? 'text-green-400 hover:bg-green-500/20' : 'text-red-400 hover:bg-red-500/20'}`}>
                                <Power size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Sección: Registrar Mantenimiento ── */}
                <div className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                  <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3">
                    <h2 className="text-xl font-bold text-cc-primary flex items-center gap-2"><Wrench size={20} />Registrar Mantenimiento</h2>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Machine select */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Máquina *</label>
                        <select value={mtForm.machine_id} onChange={e => setMtForm({ ...mtForm, machine_id: e.target.value })}
                          className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                          <option value="">Seleccionar...</option>
                          {activeMachines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.machine_type})</option>)}
                        </select>
                      </div>
                      {/* Date */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Fecha *</label>
                        <input type="date" value={mtForm.maintenance_date}
                          onChange={e => setMtForm({ ...mtForm, maintenance_date: e.target.value })}
                          className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      </div>
                      {/* Type */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Tipo *</label>
                        <select value={mtForm.maintenance_type}
                          onChange={e => setMtForm({ ...mtForm, maintenance_type: e.target.value as MaintenanceType })}
                          className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                          <option value="PREVENTIVO">Preventivo</option>
                          <option value="CORRECTIVO">Correctivo</option>
                        </select>
                      </div>
                      {/* Technician */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Técnico *</label>
                        <input type="text" value={mtForm.technician} placeholder="Nombre del técnico"
                          onChange={e => setMtForm({ ...mtForm, technician: e.target.value })}
                          className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      </div>
                      {/* Cost */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Costo (MXN)</label>
                        <input type="number" value={mtForm.cost_mxn} min={0} step={0.01}
                          onChange={e => setMtForm({ ...mtForm, cost_mxn: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      </div>
                      {/* Next due date */}
                      <div>
                        <label className="block text-sm font-semibold text-cc-cream mb-2">Próximo mantenimiento</label>
                        <input type="date" value={mtForm.next_due_date || ''}
                          onChange={e => setMtForm({ ...mtForm, next_due_date: e.target.value })}
                          className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                      </div>
                    </div>
                    {/* Notes */}
                    <div className="mt-4">
                      <label className="block text-sm font-semibold text-cc-cream mb-2">Notas</label>
                      <textarea value={mtForm.notes || ''} onChange={e => setMtForm({ ...mtForm, notes: e.target.value })}
                        placeholder="Descripción del trabajo realizado..." rows={3}
                        className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button type="button" onClick={handleAddMaintenance}
                        className="bg-cc-primary text-cc-bg font-semibold rounded-lg px-8 py-2 hover:bg-cc-primary/90 transition-colors flex items-center gap-2">
                        <Plus size={18} />Registrar
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Sección: Historial Reciente ── */}
                <div className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                  <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3">
                    <h2 className="text-xl font-bold text-cc-primary flex items-center gap-2"><Calendar size={20} />Historial Reciente</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-cc-bg border-b border-white/5">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Fecha</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Máquina</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Tipo</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Técnico</th>
                          <th className="text-right px-4 py-3 text-sm font-semibold text-cc-cream">Costo</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Próximo</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-cc-text-muted">Sin registros de mantenimiento</td></tr>
                        ) : history.map(h => (
                          <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="px-4 py-3 font-mono text-sm text-cc-cream">{h.maintenance_date}</td>
                            <td className="px-4 py-3 text-cc-cream">{h.machine_name}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${h.maintenance_type === 'PREVENTIVO' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                {h.maintenance_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-cc-text-muted">{h.technician}</td>
                            <td className="px-4 py-3 text-right text-cc-cream font-mono">${h.cost_mxn.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                            <td className="px-4 py-3 font-mono text-sm text-cc-text-muted">{h.next_due_date || '—'}</td>
                            <td className="px-4 py-3 text-cc-text-muted text-sm max-w-xs truncate">{h.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════
                    SECCIÓN: FUMIGACIÓN
                    ════════════════════════════════════════════════ */}
                <div className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                  <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-cc-primary flex items-center gap-2"><Bug size={20} />Fumigación</h2>
                    <button type="button" onClick={() => setShowFumForm(!showFumForm)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary/90 transition-colors">
                      <Plus size={16} />{showFumForm ? 'Cancelar' : 'Registrar'}
                    </button>
                  </div>

                  {/* Inline form */}
                  {showFumForm && (
                    <div className="border-b border-white/5 p-5 bg-cc-bg/50 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Fecha fumigación *</label>
                          <input type="date" value={fumForm.fumigation_date}
                            onChange={e => setFumForm({ ...fumForm, fumigation_date: e.target.value })}
                            className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Empresa proveedora *</label>
                          <input type="text" placeholder="Nombre de la empresa" value={fumForm.provider}
                            onChange={e => setFumForm({ ...fumForm, provider: e.target.value })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Próxima fecha programada</label>
                          <input type="date" value={fumForm.next_fumigation_date || ''}
                            onChange={e => setFumForm({ ...fumForm, next_fumigation_date: e.target.value || null })}
                            className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Documento ID (opcional)</label>
                          <input type="text" placeholder="UUID del documento" value={fumForm.document_id || ''}
                            onChange={e => setFumForm({ ...fumForm, document_id: e.target.value || null })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Notas</label>
                          <input type="text" placeholder="Observaciones..." value={fumForm.notes || ''}
                            onChange={e => setFumForm({ ...fumForm, notes: e.target.value || null })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button type="button" onClick={handleAddFumigation}
                          className="bg-green-600 text-white font-semibold rounded-lg px-6 py-2 text-sm hover:bg-green-500 transition-colors flex items-center gap-2">
                          <Plus size={16} />Guardar Fumigación
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Fumigation table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-cc-bg border-b border-white/5">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Fecha</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Empresa</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Próxima</th>
                          <th className="text-center px-4 py-3 text-sm font-semibold text-cc-cream">Estado</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fumRecords.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-cc-text-muted">Sin registros de fumigación</td></tr>
                        ) : fumRecords.map(f => {
                          const badge = computeFumigationStatus(f.next_fumigation_date);
                          return (
                            <tr key={f.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                              <td className="px-4 py-3 font-mono text-sm text-cc-cream">{f.fumigation_date}</td>
                              <td className="px-4 py-3 text-cc-cream">{f.provider}</td>
                              <td className="px-4 py-3 font-mono text-sm text-cc-text-muted">{f.next_fumigation_date || '—'}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${badge.color}`}>{badge.label}</span>
                              </td>
                              <td className="px-4 py-3 text-cc-text-muted text-sm max-w-xs truncate">{f.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════
                    SECCIÓN: LIMPIEZA PROFUNDA
                    ════════════════════════════════════════════════ */}
                <div className="bg-cc-surface rounded-xl border border-cc-primary/20 overflow-hidden">
                  <div className="bg-cc-bg border-b border-cc-primary/20 px-6 py-3 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-cc-primary flex items-center gap-2"><Sparkles size={20} />Limpieza Profunda</h2>
                    <div className="flex items-center gap-2">
                      <select value={dcAreaFilter} onChange={e => setDcAreaFilter(e.target.value)}
                        className="bg-white text-black border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                        <option value="">Todas las áreas</option>
                        {DEEP_CLEANING_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <button type="button" onClick={() => setShowDcForm(!showDcForm)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cc-primary text-cc-bg font-semibold text-sm hover:bg-cc-primary/90 transition-colors">
                        <Plus size={16} />{showDcForm ? 'Cancelar' : 'Registrar'}
                      </button>
                    </div>
                  </div>

                  {/* Inline form */}
                  {showDcForm && (
                    <div className="border-b border-white/5 p-5 bg-cc-bg/50 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Área *</label>
                          <select value={dcForm.area} onChange={e => setDcForm({ ...dcForm, area: e.target.value as DeepCleaningArea })}
                            className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500">
                            {DEEP_CLEANING_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Fecha realizada *</label>
                          <input type="date" value={dcForm.cleaning_date}
                            onChange={e => setDcForm({ ...dcForm, cleaning_date: e.target.value })}
                            className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Responsable *</label>
                          <input type="text" placeholder="Nombre" value={dcForm.responsible}
                            onChange={e => setDcForm({ ...dcForm, responsible: e.target.value })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Evidencia URL (opcional)</label>
                          <input type="text" placeholder="https://..." value={dcForm.evidence_url || ''}
                            onChange={e => setDcForm({ ...dcForm, evidence_url: e.target.value || null })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Próxima fecha sugerida</label>
                          <input type="date" value={dcForm.next_suggested_date || ''}
                            onChange={e => setDcForm({ ...dcForm, next_suggested_date: e.target.value || null })}
                            className="w-full bg-white text-black border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-cc-cream mb-1">Observaciones</label>
                          <input type="text" placeholder="Notas..." value={dcForm.notes || ''}
                            onChange={e => setDcForm({ ...dcForm, notes: e.target.value || null })}
                            className="w-full bg-white text-black placeholder:text-slate-500 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button type="button" onClick={handleAddDeepCleaning}
                          className="bg-green-600 text-white font-semibold rounded-lg px-6 py-2 text-sm hover:bg-green-500 transition-colors flex items-center gap-2">
                          <Plus size={16} />Guardar Limpieza
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Deep cleaning table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-cc-bg border-b border-white/5">
                        <tr>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Área</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Fecha</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Responsable</th>
                          <th className="text-center px-4 py-3 text-sm font-semibold text-cc-cream">Estado</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Próxima</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Evidencia</th>
                          <th className="text-left px-4 py-3 text-sm font-semibold text-cc-cream">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDcRecords.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-cc-text-muted">Sin registros de limpieza profunda</td></tr>
                        ) : filteredDcRecords.map(d => {
                          const badge = computeCleaningStatus(d.next_suggested_date);
                          return (
                            <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded text-xs font-semibold bg-purple-500/20 text-purple-400">{d.area}</span>
                              </td>
                              <td className="px-4 py-3 font-mono text-sm text-cc-cream">{d.cleaning_date}</td>
                              <td className="px-4 py-3 text-cc-text-muted">{d.responsible}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${badge.color}`}>{badge.label}</span>
                              </td>
                              <td className="px-4 py-3 font-mono text-sm text-cc-text-muted">{d.next_suggested_date || '—'}</td>
                              <td className="px-4 py-3">
                                {d.evidence_url ? (
                                  <a href={d.evidence_url} target="_blank" rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm">
                                    <Eye size={14} />Ver
                                  </a>
                                ) : <span className="text-cc-text-muted text-sm">—</span>}
                              </td>
                              <td className="px-4 py-3 text-cc-text-muted text-sm max-w-xs truncate">{d.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default Ops;
