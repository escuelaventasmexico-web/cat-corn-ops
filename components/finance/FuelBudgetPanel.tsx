import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Car, Loader2, Pencil, Save, X } from 'lucide-react';
import { getFuelVehicleLabel, type FuelVehicleCode } from '../../lib/fuelBudget.js';
import {
  getFuelBudgetSnapshot,
  saveFuelBudgetLimits,
  type FuelBudgetSnapshot,
} from '../../services/fuelBudgetService';

interface Props { monthStartISO: string }

const formatMXN = (amount: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN',
}).format(amount);

const monthLabel = (monthStartISO: string) => {
  const [year, month] = monthStartISO.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
};

const StatusCard = ({ label, limit, used, remaining, exceeded }: {
  label: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: number;
}) => {
  const isOver = limit !== null && exceeded > 0;
  const isAtWarning = limit !== null && limit > 0 && used >= limit * 0.8 && !isOver;
  return (
    <div className={`rounded-lg border p-4 ${isOver ? 'border-red-500/35 bg-red-500/10' : isAtWarning ? 'border-amber-500/35 bg-amber-500/10' : 'border-white/10 bg-black/20'}`}>
      <p className="font-semibold text-cc-cream">{label}</p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-3 text-cc-text-muted"><dt>Límite</dt><dd className="text-cc-cream">{limit === null ? 'Sin presupuesto definido' : formatMXN(limit)}</dd></div>
        <div className="flex justify-between gap-3 text-cc-text-muted"><dt>Registrado</dt><dd className="text-cc-cream">{formatMXN(used)}</dd></div>
        <div className="flex justify-between gap-3 text-cc-text-muted"><dt>Disponible</dt><dd className="font-semibold text-amber-200">{limit === null ? '—' : formatMXN(remaining || 0)}</dd></div>
        <div className="flex justify-between gap-3 text-cc-text-muted"><dt>Exceso</dt><dd className={isOver ? 'font-semibold text-red-300' : 'text-cc-cream'}>{limit === null ? '—' : formatMXN(exceeded)}</dd></div>
      </dl>
      {isOver && <p className="mt-3 text-xs font-medium text-red-300">Límite rebasado.</p>}
      {isAtWarning && <p className="mt-3 text-xs font-medium text-amber-200">Se alcanzó al menos el 80% del límite.</p>}
    </div>
  );
};

export const FuelBudgetPanel = ({ monthStartISO }: Props) => {
  const [snapshot, setSnapshot] = useState<FuelBudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [limits, setLimits] = useState({ global: '', utility: '', managerial: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getFuelBudgetSnapshot(monthStartISO);
      setSnapshot(next);
      setLimits({
        global: next.global_limit_mxn === null ? '' : String(next.global_limit_mxn),
        utility: next.vehicle_limits_mxn.UTILITY === null ? '' : String(next.vehicle_limits_mxn.UTILITY),
        managerial: next.vehicle_limits_mxn.MANAGERIAL === null ? '' : String(next.vehicle_limits_mxn.MANAGERIAL),
      });
    } catch (loadError: any) {
      setSnapshot(null);
      setError(loadError?.message || 'No se pudo cargar el presupuesto de combustible.');
    } finally {
      setLoading(false);
    }
  }, [monthStartISO]);

  useEffect(() => { load(); }, [load]);

  const resetInputs = () => {
    if (!snapshot) return;
    setLimits({
      global: snapshot.global_limit_mxn === null ? '' : String(snapshot.global_limit_mxn),
      utility: snapshot.vehicle_limits_mxn.UTILITY === null ? '' : String(snapshot.vehicle_limits_mxn.UTILITY),
      managerial: snapshot.vehicle_limits_mxn.MANAGERIAL === null ? '' : String(snapshot.vehicle_limits_mxn.MANAGERIAL),
    });
  };

  const handleSave = async () => {
    const global = Number(limits.global);
    const utility = Number(limits.utility);
    const managerial = Number(limits.managerial);
    if (![global, utility, managerial].every(value => Number.isFinite(value) && value >= 0)) {
      setError('Los tres límites deben ser importes iguales o mayores a cero.');
      return;
    }
    if (Math.abs(global - utility - managerial) > 0.005) {
      setError('El límite global debe ser igual a la suma de los límites de ambos vehículos.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveFuelBudgetLimits(monthStartISO, global, utility, managerial);
      setEditing(false);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'No se pudo guardar el presupuesto de combustible.');
    } finally {
      setSaving(false);
    }
  };

  const vehicleCards = snapshot ? (['UTILITY', 'MANAGERIAL'] as FuelVehicleCode[]).map(vehicle => ({
    vehicle,
    ...snapshot.vehicle_status[vehicle],
  })) : [];

  return (
    <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Car size={22} className="text-amber-300" />
            <h3 className="text-lg font-bold text-cc-cream">Presupuesto mensual de combustible</h3>
          </div>
          <p className="mt-1 text-xs capitalize text-cc-text-muted">{monthLabel(monthStartISO)}</p>
        </div>
        {!editing && !loading && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cc-text-muted hover:bg-white/10">
            <Pencil size={15} /> Editar límites
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-cc-text-muted"><Loader2 size={18} className="animate-spin" /> Cargando presupuesto…</div>
      ) : snapshot ? (
        <>
          {editing ? (
            <div className="mt-5 grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/20 p-4 md:grid-cols-3">
              {([
                ['global', 'Límite global'],
                ['utility', 'Auto utilitario'],
                ['managerial', 'Auto gerencial'],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-sm text-cc-text-muted">{label} (MXN)
                  <input type="number" min="0" step="0.01" value={limits[key]} onChange={event => setLimits(previous => ({ ...previous, [key]: event.target.value }))} className="mt-2 w-full rounded-lg border border-white/10 bg-[#1C1A1A] px-4 py-2 text-cc-text-main" />
                </label>
              ))}
              <div className="flex gap-2 md:col-span-3">
                <button type="button" onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-medium text-black disabled:opacity-50">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar</button>
                <button type="button" onClick={() => { setEditing(false); resetInputs(); setError(null); }} className="rounded-lg border border-white/10 p-2 text-cc-text-muted hover:bg-white/10"><X size={20} /></button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <StatusCard label="Total combustible" limit={snapshot.global_limit_mxn} used={snapshot.used_mxn} remaining={snapshot.remaining_mxn} exceeded={snapshot.exceeded_mxn} />
              {vehicleCards.map(({ vehicle, limit_mxn, used_mxn, remaining_mxn, exceeded_mxn }) => (
                <StatusCard key={vehicle} label={getFuelVehicleLabel(vehicle)} limit={limit_mxn} used={used_mxn} remaining={remaining_mxn} exceeded={exceeded_mxn} />
              ))}
            </div>
          )}

          <p className="mt-3 text-xs text-cc-text-muted">Incluye sólo gastos clasificados como Combustible. Las compras a crédito cuentan al registrarse; los pagos posteriores de tarjeta, casetas y llantas no se incluyen.</p>
          {snapshot.unassigned_vehicle.count > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>{snapshot.unassigned_vehicle.count} gasto(s) histórico(s) por {formatMXN(snapshot.unassigned_vehicle.amount_mxn)} están en “Sin vehículo asignado”. Ya cuentan una sola vez en el total global; el desglose por vehículo está incompleto.</p>
            </div>
          )}
        </>
      ) : null}

      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  );
};
