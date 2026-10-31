import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { Receipt, X, Plus, Edit2, Archive, AlertCircle } from 'lucide-react';
import { FixedCostFormModal, FixedCostRecord } from './FixedCostFormModal.tsx';

export const FixedCostsManager = ({ onClose }: { onClose: () => void }) => {
  const [rows, setRows] = useState<FixedCostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<FixedCostRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = async () => {
    setLoading(true);
    setError('');
    if (!supabase) return;
    const { data, error: queryError } = await supabase
      .from('fixed_costs')
      .select('*')
      .order('effective_from', { ascending: false })
      .order('scope')
      .order('name');
    if (queryError) setError(queryError.message);
    else setRows((data || []) as FixedCostRecord[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const close = async (row: FixedCostRecord) => {
    if (!supabase || !confirm(`¿Cerrar la vigencia de ${row.name}? El historial permanecerá visible.`)) return;
    const { error: updateError } = await supabase
      .from('fixed_costs')
      .update({ effective_to: today, active: false })
      .eq('id', row.id);
    if (updateError) alert(updateError.message);
    else load();
  };

  const knownProvision = rows
    .filter(row => row.effective_from <= today && (!row.effective_to || row.effective_to >= today))
    .reduce((sum, row) => sum + Number(row.monthly_provision_mxn || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div className="flex gap-3">
          <Receipt size={32} className="text-cc-primary" />
          <div>
            <h2 className="text-3xl font-bold text-cc-cream">Obligaciones fijas</h2>
            <p className="text-cc-text-muted">
              Provisión mensual conocida vigente: {'$' + knownProvision.toLocaleString('es-MX')}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFormOpen(true)} className="px-4 py-2 bg-cc-primary text-black rounded flex gap-2">
            <Plus /> Nueva obligación
          </button>
          <button onClick={onClose}><X /></button>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded text-sm text-blue-200">
        Los cambios monetarios crean una nueva vigencia. Las obligaciones cerradas permanecen visibles.
      </div>
      {error && <div className="text-red-400 flex gap-2"><AlertCircle />{error}</div>}

      {loading ? <p>Cargando…</p> : (
        <div className="bg-cc-surface rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-cc-text-muted">
                <th className="p-3 text-left">Concepto</th><th>Ámbito</th><th>Pago</th>
                <th>Provisión mensual</th><th>Periodicidad</th><th>Vigencia</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-white/5">
                  <td className="p-3">{row.name}</td><td>{row.scope}</td>
                  <td>{row.amount_mxn == null ? 'Pendiente' : '$' + Number(row.amount_mxn).toLocaleString('es-MX')}</td>
                  <td>{row.monthly_provision_mxn == null ? 'Pendiente' : '$' + Number(row.monthly_provision_mxn).toLocaleString('es-MX')}</td>
                  <td>{row.periodicity === 'BIMONTHLY' ? 'Bimestral' : 'Mensual'}</td>
                  <td>{row.effective_from} — {row.effective_to || 'actual'}</td>
                  <td><span className={row.configuration_status === 'READY' ? 'text-green-400' : 'text-amber-300'}>{row.configuration_status}</span></td>
                  <td>
                    <div className="flex justify-center gap-2">
                      {!row.effective_to && <button title="Nueva vigencia" onClick={() => { setEditing(row); setFormOpen(true); }}><Edit2 size={16} /></button>}
                      {!row.effective_to && row.effective_from <= today && <button title="Cerrar vigencia" onClick={() => close(row)}><Archive size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && (
        <FixedCostFormModal
          fixedCost={editing}
          onClose={() => { setFormOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
};
