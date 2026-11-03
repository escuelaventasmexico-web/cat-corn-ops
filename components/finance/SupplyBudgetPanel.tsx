import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Boxes, Loader2, Pencil, Save, X } from 'lucide-react';
import {
  getSupplyBudgetSnapshot,
  saveSupplyBudgetLimit,
  type SupplyBudgetSnapshot,
} from '../../services/supplyBudgetService';

interface SupplyBudgetPanelProps {
  monthStartISO: string;
}

const formatMXN = (amount: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
}).format(amount);

const monthLabel = (monthStartISO: string) => {
  const [year, month] = monthStartISO.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
};

export const SupplyBudgetPanel = ({ monthStartISO }: SupplyBudgetPanelProps) => {
  const [snapshot, setSnapshot] = useState<SupplyBudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getSupplyBudgetSnapshot(monthStartISO);
      setSnapshot(next);
      setLimitInput(next.limit_mxn === null ? '' : String(next.limit_mxn));
    } catch (loadError: any) {
      setError(loadError?.message || 'No se pudo cargar el presupuesto de insumos.');
      setSnapshot(null);
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
      await saveSupplyBudgetLimit(monthStartISO, limit);
      setEditing(false);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'No se pudo guardar el presupuesto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes size={22} className="text-emerald-300" />
            <h3 className="text-lg font-bold text-cc-cream">Presupuesto de compras de insumos</h3>
          </div>
          <p className="mt-1 text-xs text-cc-text-muted capitalize">{monthLabel(monthStartISO)}</p>
        </div>
        {!editing && !loading && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cc-text-muted hover:bg-white/10"
          >
            <Pencil size={15} /> Editar límite
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-cc-text-muted">
          <Loader2 size={18} className="animate-spin" /> Cargando presupuesto…
        </div>
      ) : snapshot ? (
        <>
          {editing ? (
            <div className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-black/20 p-4">
              <label className="flex-1 min-w-[220px] text-sm text-cc-text-muted">
                Límite mensual (MXN)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={limitInput}
                  onChange={event => setLimitInput(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#1C1A1A] px-4 py-2 text-cc-text-main"
                />
              </label>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black disabled:opacity-50">
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar
              </button>
              <button type="button" onClick={() => { setEditing(false); setLimitInput(snapshot.limit_mxn === null ? '' : String(snapshot.limit_mxn)); }}
                className="rounded-lg border border-white/10 p-2 text-cc-text-muted hover:bg-white/10">
                <X size={20} />
              </button>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-cc-text-muted">Límite</p>
                <p className="mt-1 text-xl font-bold text-cc-cream">
                  {snapshot.limit_mxn === null ? 'Sin presupuesto definido' : formatMXN(snapshot.limit_mxn)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-cc-text-muted">Monto utilizado</p>
                <p className="mt-1 text-xl font-bold text-cc-cream">{formatMXN(snapshot.used_mxn)}</p>
              </div>
              <div className={`rounded-lg border p-4 ${snapshot.exceeded_mxn > 0 ? 'border-red-500/35 bg-red-500/10' : 'border-white/10 bg-black/20'}`}>
                <p className="text-xs text-cc-text-muted">{snapshot.exceeded_mxn > 0 ? 'Excedido' : 'Disponible'}</p>
                <p className={`mt-1 text-xl font-bold ${snapshot.exceeded_mxn > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                  {snapshot.limit_mxn === null
                    ? '—'
                    : formatMXN(snapshot.exceeded_mxn > 0 ? snapshot.exceeded_mxn : snapshot.remaining_mxn || 0)}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {(['AURRERA', 'CHIPITLAN', 'SHARED', 'UNASSIGNED'] as const).map(scope => (
              <div key={scope} className="flex justify-between rounded-lg border border-white/5 bg-black/10 px-3 py-2 text-cc-text-muted">
                <span>{scope === 'AURRERA'
                  ? 'Aurrera'
                  : scope === 'CHIPITLAN'
                    ? 'Chipitlán'
                    : scope === 'SHARED'
                      ? 'Compartido'
                      : 'Sin destino asignado'}</span>
                <span className="font-semibold text-cc-cream">{formatMXN(snapshot.usage_by_destination[scope])}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-cc-text-muted">
            Incluye Maíz, Aceite, Condimentos, Caramelo y Empaques registrados en el mes. Compartido cuenta una sola vez y no se reparte entre sucursales.
          </p>
          {snapshot.unassigned_supply.count > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>
                {snapshot.unassigned_supply.count} gasto(s) de insumos por {formatMXN(snapshot.unassigned_supply.amount_mxn)} no tienen destino asignado.
                Ya están incluidos una sola vez en el monto utilizado.
              </p>
            </div>
          )}
          {snapshot.potential_supply_unclassified.count > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>
                Hay {snapshot.potential_supply_unclassified.count} gasto(s) sin concepto por {formatMXN(snapshot.potential_supply_unclassified.amount_mxn)}.
                Podrían corresponder a insumos, por lo que el monto utilizado puede no ser definitivo; no se infirió su concepto.
              </p>
            </div>
          )}
          {snapshot.confirmed_non_supply.count > 0 && (
            <p className="mt-3 text-xs text-cc-text-muted">
              {snapshot.confirmed_non_supply.count} gasto(s) por {formatMXN(snapshot.confirmed_non_supply.amount_mxn)} tienen un concepto confirmado que no corresponde a insumos y no consumen este presupuesto.
            </p>
          )}
        </>
      ) : null}

      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  );
};
