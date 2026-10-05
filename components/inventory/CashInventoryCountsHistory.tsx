import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, History, Loader2, RefreshCw, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { fetchCashInventoryHistoryAdmin } from '../../lib/cashRegister';
import type { CashInventoryHistoryRow } from '../../lib/cashRegister';
import { formatDateTimeMX } from '../../lib/datetime';
import { getBusinessDateString } from '../../lib/dateUtils';
import { useAuth } from '../../contexts/AuthContext';

const displayValue = (value: unknown): string => {
  if (value == null) return '—';
  if (typeof value === 'number') return value.toFixed(3).replace(/\.000$/, '');
  return String(value);
};

export const CashInventoryCountsHistory = () => {
  const { role } = useAuth();
  const [rows, setRows] = useState<CashInventoryHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [branchId, setBranchId] = useState('all');
  const [userId, setUserId] = useState('all');
  const [phase, setPhase] = useState<'all' | 'opening' | 'closing'>('all');
  const [selected, setSelected] = useState<CashInventoryHistoryRow | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchCashInventoryHistoryAdmin());
    } catch (err: unknown) {
      console.error('[INVENTORY COUNTS] Error loading history:', err);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial de conteos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'admin') void load();
    else setLoading(false);
  }, [role]);

  const branches = useMemo(() => Array.from(new Map(rows.map((row) => [row.branch_id, row.branch_name])).entries()), [rows]);
  const users = useMemo(() => Array.from(new Map(rows.map((row) => [row.counted_by, row.counted_by_name])).entries()), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const date = getBusinessDateString(row.counted_at);
    return (branchId === 'all' || row.branch_id === branchId)
      && (userId === 'all' || row.counted_by === userId)
      && (phase === 'all' || row.phase === phase)
      && (!fromDate || date >= fromDate)
      && (!toDate || date <= toDate);
  }), [rows, branchId, userId, phase, fromDate, toDate]);

  const exportExcel = () => {
    const countRows = filtered.map((row) => ({
      'Fecha y hora': formatDateTimeMX(row.counted_at),
      Sucursal: row.branch_name,
      'ID sesión': row.cash_session_id,
      Usuario: row.counted_by_name,
      Fase: row.phase === 'opening' ? 'Apertura' : 'Cierre',
      'Maíz (kg)': row.corn_kg,
      'Maíz (g)': row.corn_g,
      'Aceite (L)': row.oil_liters,
      'Aceite (ml)': row.oil_ml,
      'Estado sesión': row.session_status,
    }));
    const uniqueSessions = new Map<string, CashInventoryHistoryRow>();
    filtered.forEach((row) => {
      if (row.close_summary) uniqueSessions.set(row.cash_session_id, row);
    });
    const summaryRows = Array.from(uniqueSessions.values()).map((row) => ({
      'ID sesión': row.cash_session_id,
      Sucursal: row.branch_name,
      Apertura: formatDateTimeMX(row.opened_at),
      Cierre: row.closed_at ? formatDateTimeMX(row.closed_at) : '',
      'Fondo inicial': row.opening_cash,
      'Efectivo esperado': row.expected_cash ?? '',
      'Efectivo contado': row.counted_cash ?? '',
      'Diferencia efectivo': row.cash_difference ?? '',
      'Maíz inicial (kg)': row.close_summary?.opening_corn_kg ?? '',
      'Maíz final (kg)': row.close_summary?.closing_corn_kg ?? '',
      'Diferencia maíz (kg)': row.close_summary?.corn_difference_kg ?? '',
      'Aceite inicial (L)': row.close_summary?.opening_oil_liters ?? '',
      'Aceite final (L)': row.close_summary?.closing_oil_liters ?? '',
      'Diferencia aceite (L)': row.close_summary?.oil_difference_liters ?? '',
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(countRows), 'Conteos');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resúmenes cierre');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `CATCORN_ConteosCaja_${getBusinessDateString()}.xlsx`);
  };

  if (role !== 'admin') {
    return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Sólo los administradores activos pueden consultar este historial.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-cc-cream"><History className="text-cc-primary" /> Conteos de insumos de caja</h2>
          <p className="mt-1 text-xs text-cc-text-muted">Registro inmutable de maíz y aceite; no modifica el stock de inventario.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-cc-cream disabled:opacity-40">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button type="button" onClick={exportExcel} disabled={loading || filtered.length === 0} className="flex items-center gap-2 rounded-lg bg-cc-accent px-3 py-2 text-sm font-semibold text-cc-bg disabled:opacity-40">
            <Download size={15} /> Exportar Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/5 bg-cc-surface p-4 md:grid-cols-5">
        <label className="text-xs text-cc-text-muted">Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-cc-cream" /></label>
        <label className="text-xs text-cc-text-muted">Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-cc-cream" /></label>
        <label className="text-xs text-cc-text-muted">Sucursal<select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-cc-cream"><option value="all">Todas</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-cc-text-muted">Usuario<select value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-cc-cream"><option value="all">Todos</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-cc-text-muted">Fase<select value={phase} onChange={(event) => setPhase(event.target.value as typeof phase)} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-cc-cream"><option value="all">Todas</option><option value="opening">Apertura</option><option value="closing">Cierre</option></select></label>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {loading ? (
        <div className="flex justify-center py-16 text-cc-text-muted"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-cc-surface py-16 text-center text-cc-text-muted">No hay conteos para los filtros seleccionados.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-cc-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-black/20 text-cc-text-muted"><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Sucursal</th><th className="p-3 text-left">Usuario</th><th className="p-3 text-center">Fase</th><th className="p-3 text-right">Maíz</th><th className="p-3 text-right">Aceite</th><th className="p-3 text-center">Detalle</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={`${row.cash_session_id}-${row.phase}`} className="border-b border-white/5"><td className="whitespace-nowrap p-3 text-xs text-cc-text-muted">{formatDateTimeMX(row.counted_at)}</td><td className="p-3 text-cc-cream">{row.branch_name}</td><td className="p-3 text-cc-text-main">{row.counted_by_name}</td><td className="p-3 text-center"><span className="rounded-full bg-white/10 px-2 py-1 text-xs">{row.phase === 'opening' ? 'Apertura' : 'Cierre'}</span></td><td className="p-3 text-right font-semibold text-amber-200">{row.corn_kg.toFixed(3)} kg</td><td className="p-3 text-right font-semibold text-sky-200">{row.oil_liters.toFixed(3)} L</td><td className="p-3 text-center"><button type="button" onClick={() => setSelected(row)} className="inline-flex items-center gap-1 rounded bg-cc-primary/15 px-2 py-1 text-xs text-cc-primary"><Eye size={12} /> Ver sesión</button></td></tr>)}</tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-cc-surface p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between"><div><h3 className="text-lg font-bold text-cc-cream">Sesión de caja</h3><p className="font-mono text-xs text-cc-text-muted">{selected.cash_session_id}</p></div><button type="button" onClick={() => setSelected(null)}><X className="text-cc-text-muted" /></button></div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div className="rounded bg-black/25 p-3"><p className="text-xs text-cc-text-muted">Fase seleccionada</p><p className="font-semibold">{selected.phase === 'opening' ? 'Apertura' : 'Cierre'}</p></div><div className="rounded bg-black/25 p-3"><p className="text-xs text-cc-text-muted">Maíz</p><p className="font-semibold">{selected.corn_kg.toFixed(3)} kg</p></div><div className="rounded bg-black/25 p-3"><p className="text-xs text-cc-text-muted">Aceite</p><p className="font-semibold">{selected.oil_liters.toFixed(3)} L</p></div><div className="rounded bg-black/25 p-3"><p className="text-xs text-cc-text-muted">Estado</p><p className="font-semibold">{selected.session_status}</p></div></div>
            {selected.close_summary && <div className="mt-4"><h4 className="mb-2 text-xs font-bold uppercase text-cc-text-muted">Resumen inmutable de cierre</h4><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{Object.entries(selected.close_summary).map(([key, value]) => <div key={key} className="flex justify-between gap-3 rounded bg-black/20 px-3 py-2 text-xs"><span className="text-cc-text-muted">{key.replace(/_/g, ' ')}</span><span className="text-right text-cc-cream">{displayValue(value)}</span></div>)}</div></div>}
          </div>
        </div>
      )}
    </div>
  );
};
