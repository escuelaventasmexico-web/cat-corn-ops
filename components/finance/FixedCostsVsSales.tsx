import { useEffect, useState } from 'react';
import { X, TrendingUp, AlertCircle } from 'lucide-react';
import { supabase } from '../../supabase';

const mxn = (value: number | null | undefined) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
interface Obligation { fixed_cost_id: string; obligation_name: string; obligation_scope: string; periodicity: string; payment_amount_mxn: number|null; monthly_provision_mxn: number|null; expected_payment_in_month_mxn:number|null; paid_in_month_mxn:number|null; pending_through_month_mxn:number|null; credit_through_month_mxn:number|null; configuration_status:string; }

export const FixedCostsVsSales = ({ onClose }: { onClose: () => void }) => {
  const now = new Date(); const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const [data,setData]=useState<any>(); const [error,setError]=useState(''); const [scenario,setScenario]=useState(false);
  useEffect(()=>{(async()=>{ if(!supabase)return; const {data,error}=await supabase.rpc('finance_month_summary',{p_month_start:month}); if(error)setError(error.message);else setData(data); })();},[month]);
  const obligations: Obligation[] = data?.fixed_obligations || [];
  return <div className="space-y-6">
    <div className="flex justify-between"><div className="flex gap-3"><TrendingUp className="text-cc-primary"/><div><h2 className="text-3xl font-bold text-cc-cream">Presupuesto de gastos fijos</h2><p className="text-cc-text-muted">Mes consultado: {month}</p></div></div><button onClick={onClose}><X/></button></div>
    {error&&<div className="text-red-400 flex gap-2"><AlertCircle/>{error}</div>}
    {data&&<><div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Metric title="Apartar este mes" value={data.fixed_reserved_mxn} note="Provisión mensual conocida" color="orange"/>
      <Metric title="Pagos que vencen este mes" value={data.fixed_due_mxn} note="Sólo calendarios e importes configurados" color="blue"/>
      <Metric title="Pagos registrados" value={data.fixed_registered_mxn} note="Todos los gastos FIXED del mes" color="green"/>
    </div>
    {data.fixed_reconciliation_status==='LEGACY_UNRECONCILED'&&<div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded text-amber-200">Sin conciliación por obligación. Los pagos históricos del mes siguen incluidos en gastos registrados, pero no se atribuyen a conceptos por coincidencias de texto.</div>}
    {(data.fixed_amount_unknown_count>0||data.fixed_schedule_pending_count>0)&&<div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded text-blue-200">Configuración pendiente: {data.fixed_amount_unknown_count} importe(s) desconocido(s) y {data.fixed_schedule_pending_count} calendario(s) sin mes ancla. No se presentan como cero.</div>}
    <div className="bg-cc-surface rounded-xl overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-cc-text-muted border-b border-white/10"><th className="p-3 text-left">Obligación</th><th>Ámbito</th><th>Reserva</th><th>Vence</th><th>Registrado</th><th>Saldo acumulado</th><th>Crédito</th><th>Estado</th></tr></thead><tbody>{obligations.map(o=><tr key={o.fixed_cost_id} className="border-b border-white/5"><td className="p-3">{o.obligation_name}</td><td>{o.obligation_scope}</td><td>{o.monthly_provision_mxn==null?'Pendiente':mxn(o.monthly_provision_mxn)}</td><td>{o.expected_payment_in_month_mxn==null?'Pendiente':mxn(o.expected_payment_in_month_mxn)}</td><td>{o.paid_in_month_mxn==null?'Sin conciliación':mxn(o.paid_in_month_mxn)}</td><td>{o.pending_through_month_mxn==null?'—':mxn(o.pending_through_month_mxn)}</td><td>{o.credit_through_month_mxn==null?'—':mxn(o.credit_through_month_mxn)}</td><td>{o.configuration_status}</td></tr>)}</tbody></table></div>
    <div className="bg-purple-500/10 border border-purple-500/30 p-4 rounded"><label className="flex gap-2"><input type="checkbox" checked={scenario} onChange={e=>setScenario(e.target.checked)}/><span>Escenario de flujo: incluir Pago Enrique por $6,000 (no se registra como gasto)</span></label>{scenario&&<p className="text-2xl font-bold mt-2">Reserva conocida + escenario: {mxn(Number(data.fixed_reserved_mxn)+6000)}</p>}</div>
    </>}
  </div>;
};

const Metric=({title,value,note,color}:{title:string;value:number;note:string;color:'orange'|'blue'|'green'})=>{
  const classes = color === 'orange' ? 'bg-orange-500/10 border-orange-500/30' : color === 'blue' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-green-500/10 border-green-500/30';
  return <div className={`${classes} border p-5 rounded-xl`}><p className="text-sm text-cc-text-muted">{title}</p><p className="text-3xl font-bold text-cc-cream">{mxn(value)}</p><p className="text-xs text-cc-text-muted">{note}</p></div>;
};
