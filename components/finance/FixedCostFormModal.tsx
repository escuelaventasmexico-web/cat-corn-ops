import { useState } from 'react';
import { supabase } from '../../supabase';
import { X, Save } from 'lucide-react';

export interface FixedCostRecord {
  id: string; name: string; amount_mxn: number | null; active: boolean; notes: string | null;
  obligation_code: string; scope: 'CHIPITLAN' | 'AURRERA' | 'SHARED' | 'UNASSIGNED';
  periodicity: 'MONTHLY' | 'BIMONTHLY'; payment_interval_months: number;
  monthly_provision_mxn: number | null; effective_from: string; effective_to: string | null;
  billing_anchor_month: string | null;
  configuration_status: 'READY' | 'AMOUNT_PENDING' | 'SCHEDULE_PENDING' | 'LEGACY';
}

interface Props { fixedCost: FixedCostRecord | null; onClose: () => void; }
const nextMonthStart = (after?: string) => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (!after) return next.toISOString().slice(0, 10);
  const [year, month] = after.split('-').map(Number);
  const afterVersion = new Date(year, month, 1);
  return new Date(Math.max(next.getTime(), afterVersion.getTime())).toISOString().slice(0, 10);
};

export const FixedCostFormModal = ({ fixedCost, onClose }: Props) => {
  const [form, setForm] = useState({
    name: fixedCost?.name || '', obligation_code: fixedCost?.obligation_code || '', scope: fixedCost?.scope || 'SHARED',
    periodicity: fixedCost?.periodicity || 'MONTHLY', amount_mxn: fixedCost?.amount_mxn?.toString() || '',
    monthly_provision_mxn: fixedCost?.monthly_provision_mxn?.toString() || '', effective_from: nextMonthStart(fixedCost?.effective_from),
    billing_anchor_month: fixedCost?.billing_anchor_month || '',
    configuration_status: fixedCost?.configuration_status === 'LEGACY' ? 'READY' : (fixedCost?.configuration_status || 'READY'),
    notes: fixedCost?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    try {
      const amount = form.amount_mxn === '' ? null : Number(form.amount_mxn);
      const provision = form.monthly_provision_mxn === '' ? null : Number(form.monthly_provision_mxn);
      if (form.effective_from.slice(8, 10) !== '01') throw new Error('La vigencia debe iniciar el primer día de un mes.');
      if (form.billing_anchor_month && form.billing_anchor_month.slice(8, 10) !== '01') throw new Error('El mes ancla debe usar el primer día del mes.');
      if (form.configuration_status === 'READY' && (amount === null || provision === null)) throw new Error('Una obligación configurada requiere pago y provisión mensual.');
      if (form.configuration_status === 'AMOUNT_PENDING' && (amount !== null || provision !== null)) throw new Error('Un importe pendiente debe dejar pago y provisión vacíos.');
      if (form.configuration_status === 'SCHEDULE_PENDING' && (form.periodicity !== 'BIMONTHLY' || amount === null || provision === null || form.billing_anchor_month)) throw new Error('Un calendario pendiente debe ser bimestral, tener importes y no tener mes ancla.');
      if (form.periodicity === 'BIMONTHLY' && amount !== null && provision !== null && provision * 2 !== amount) throw new Error('La provisión mensual bimestral debe ser la mitad del pago contractual.');
      const payload = { name: form.name.trim(), obligation_code: form.obligation_code.trim(), scope: form.scope,
        periodicity: form.periodicity, payment_interval_months: form.periodicity === 'BIMONTHLY' ? 2 : 1,
        amount_mxn: amount, monthly_provision_mxn: provision,
        effective_from: form.effective_from, effective_to: null, billing_anchor_month: form.billing_anchor_month || null,
        configuration_status: form.configuration_status, notes: form.notes.trim() || null, active: true };
      if (fixedCost) {
        const { error } = await supabase.rpc('finance_version_fixed_cost', {
          p_fixed_cost_id: fixedCost.id, p_effective_from: payload.effective_from,
          p_name: payload.name, p_scope: payload.scope, p_periodicity: payload.periodicity,
          p_amount_mxn: payload.amount_mxn, p_monthly_provision_mxn: payload.monthly_provision_mxn,
          p_billing_anchor_month: payload.billing_anchor_month,
          p_configuration_status: payload.configuration_status, p_notes: payload.notes,
        });
        if (error) throw error;
      } else { const { error } = await supabase.from('fixed_costs').insert([payload]); if (error) throw error; }
      onClose();
    } catch (error: any) { alert(error.message || 'No se pudo guardar la obligación'); } finally { setSaving(false); }
  };
  const input = 'mt-1 w-full bg-[#1C1A1A] rounded p-2 text-white';
  return <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"><div className="bg-[#2A2A2A] rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
    <div className="p-6 border-b border-white/10 flex justify-between"><div><h3 className="text-xl font-bold text-cc-cream">{fixedCost ? 'Crear nueva vigencia' : 'Nueva obligación'}</h3>{fixedCost && <p className="text-xs text-amber-300 mt-1">La versión anterior se cerrará; su historial no cambia.</p>}</div><button onClick={onClose}><X className="text-cc-text-muted"/></button></div>
    <form onSubmit={submit} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
      <label className="text-sm text-cc-text-muted">Concepto<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className={input}/></label>
      <label className="text-sm text-cc-text-muted">Código estable<input required disabled={!!fixedCost} value={form.obligation_code} onChange={e=>setForm({...form,obligation_code:e.target.value})} className={`${input} disabled:opacity-60`}/></label>
      <label className="text-sm text-cc-text-muted">Ámbito<select value={form.scope} onChange={e=>setForm({...form,scope:e.target.value as any})} className={input}><option value="AURRERA">Aurrera</option><option value="CHIPITLAN">Chipitlán</option><option value="SHARED">Compartido</option></select></label>
      <label className="text-sm text-cc-text-muted">Periodicidad<select value={form.periodicity} onChange={e=>setForm({...form,periodicity:e.target.value as any})} className={input}><option value="MONTHLY">Mensual</option><option value="BIMONTHLY">Bimestral</option></select></label>
      <label className="text-sm text-cc-text-muted">Pago contractual<input type="number" min="0" step=".01" value={form.amount_mxn} onChange={e=>setForm({...form,amount_mxn:e.target.value})} placeholder="Pendiente" className={input}/></label>
      <label className="text-sm text-cc-text-muted">Provisión mensual<input type="number" min="0" step=".01" value={form.monthly_provision_mxn} onChange={e=>setForm({...form,monthly_provision_mxn:e.target.value})} placeholder="Pendiente" className={input}/></label>
      <label className="text-sm text-cc-text-muted">Vigente desde<input required type="date" value={form.effective_from} onChange={e=>setForm({...form,effective_from:e.target.value})} className={input}/></label>
      <label className="text-sm text-cc-text-muted">Mes ancla de pago<input type="date" value={form.billing_anchor_month} onChange={e=>setForm({...form,billing_anchor_month:e.target.value})} className={input}/></label>
      <label className="text-sm text-cc-text-muted">Estado<select value={form.configuration_status} onChange={e=>setForm({...form,configuration_status:e.target.value as any})} className={input}><option value="READY">Configurado</option><option value="AMOUNT_PENDING">Importe pendiente</option><option value="SCHEDULE_PENDING">Calendario pendiente</option></select></label>
      <label className="text-sm text-cc-text-muted md:col-span-2">Notas<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className={input}/></label>
      <div className="md:col-span-2 flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2 bg-[#444] rounded">Cancelar</button><button disabled={saving} className="px-4 py-2 bg-cc-primary text-black rounded flex gap-2"><Save size={18}/>{saving?'Guardando…':'Guardar'}</button></div>
    </form></div></div>;
};
