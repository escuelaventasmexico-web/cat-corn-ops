import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Save, Sparkles, X } from 'lucide-react';
import {
  getCleaningBudgetSnapshot,
  saveCleaningBudgetLimit,
  type CleaningBudgetSnapshot,
} from '../../services/cleaningBudgetService';

interface Props { monthStartISO: string }

const formatMXN = (amount: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN',
}).format(amount);

const monthLabel = (monthStartISO: string) => {
  const [year, month] = monthStartISO.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
};

export const CleaningBudgetPanel = ({ monthStartISO }: Props) => {
  const [snapshot, setSnapshot] = useState<CleaningBudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getCleaningBudgetSnapshot(monthStartISO);
      setSnapshot(next);
      setLimitInput(next.limit_mxn === null ? '' : String(next.limit_mxn));
    } catch (loadError: any) {
      setSnapshot(null);
      setError(loadError?.message || 'No se pudo cargar el presupuesto de limpieza.');
    } finally {
      setLoading(false);
    }
  }, [monthStartISO]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const limit = Number(limitInput);
    if (!Number.isFinite(limit) || limit < 0) {
      setError('El límite debe ser un importe igual o mayor a cero.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveCleaningBudgetLimit(monthStartISO, limit);
      setEditing(false);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'No se pudo guardar el presupuesto de limpieza.');
    } finally {
      setSaving(false);
    }
  };

  const isAtWarning = Boolean(snapshot?.limit_mxn
    && snapshot.used_mxn >= snapshot.limit_mxn * 0.8
    && snapshot.used_mxn <= snapshot.limit_mxn);

  return (
    <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={22} className="text-cyan-300" />
            <h3 className="text-lg font-bold text-cc-cream">Presupuesto mensual de limpieza</h3>
          </div>
          <p className="mt-1 text-xs capitalize text-cc-text-muted">{monthLabel(monthStartISO)}</p>
        </div>
        {!editing && !loading && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cc-text-muted hover:bg-white/10">
            <Pencil size={15} /> Editar límite
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-cc-text-muted"><Loader2 size={18} className="animate-spin" /> Cargando presupuesto…</div>
      ) : snapshot ? (
        <>
          {editing ? (
            <div className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-black/20 p-4">
              <label className="min-w-[220px] flex-1 text-sm text-cc-text-muted">Límite mensual (MXN)
                <input type="number" min="0" step="0.01" value={limitInput} onChange={event => setLimitInput(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#1C1A1A] px-4 py-2 text-cc-text-main" />
              </label>
              <button type="button" onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 font-medium text-black disabled:opacity-50">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar</button>
              <button type="button" onClick={() => { setEditing(false); setLimitInput(snapshot.limit_mxn === null ? '' : String(snapshot.limit_mxn)); setError(null); }} className="rounded-lg border border-white/10 p-2 text-cc-text-muted hover:bg-white/10"><X size={20} /></button>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-xs text-cc-text-muted">Límite</p><p className="mt-1 text-xl font-bold text-cc-cream">{snapshot.limit_mxn === null ? 'Sin presupuesto definido' : formatMXN(snapshot.limit_mxn)}</p></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-xs text-cc-text-muted">Gasto acumulado</p><p className="mt-1 text-xl font-bold text-cc-cream">{formatMXN(snapshot.used_mxn)}</p></div>
              <div className={`rounded-lg border p-4 ${snapshot.exceeded_mxn > 0 ? 'border-red-500/35 bg-red-500/10' : isAtWarning ? 'border-amber-500/35 bg-amber-500/10' : 'border-white/10 bg-black/20'}`}><p className="text-xs text-cc-text-muted">Disponible</p><p className={`mt-1 text-xl font-bold ${snapshot.exceeded_mxn > 0 ? 'text-red-300' : 'text-cyan-200'}`}>{snapshot.limit_mxn === null ? '—' : formatMXN(snapshot.remaining_mxn || 0)}</p></div>
            </div>
          )}

          <p className="mt-3 text-xs text-cc-text-muted">Incluye sólo gastos clasificados como Limpieza, por ejemplo servitoallas, jabón Roma, Fabuloso, bolsas de basura y productos para control de plagas. Las compras a crédito cuentan al registrarse; el pago posterior de la tarjeta no se vuelve a contar.</p>
          {isAtWarning && <p className="mt-3 text-sm font-medium text-amber-200">Se alcanzó al menos el 80% del límite mensual.</p>}
          {snapshot.exceeded_mxn > 0 && <p className="mt-3 text-sm font-medium text-red-300">El gasto registrado excede el límite por {formatMXN(snapshot.exceeded_mxn)}. El exceso se informa sin impedir registrar el gasto real.</p>}
          {snapshot.unclassified_expenses.count > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>Hay {snapshot.unclassified_expenses.count} gasto(s) sin concepto por {formatMXN(snapshot.unclassified_expenses.amount_mxn)}. No se asignaron automáticamente a limpieza y no están incluidos en este acumulado.</p>
            </div>
          )}
        </>
      ) : null}

      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  );
};
