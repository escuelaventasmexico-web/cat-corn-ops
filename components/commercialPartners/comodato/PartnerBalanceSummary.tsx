import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Scale, Package, AlertCircle } from 'lucide-react';
import { supabase } from '../../../supabase';
import {
  PartnerOperationalSummary,
  fmtCurrency,
  fmtDate,
  CARD_CLS,
} from './types';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

const Stat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}> = ({ icon, label, value, sub, accent }) => (
  <div className={`${CARD_CLS} flex flex-col gap-1`}>
    <div className="flex items-center gap-2 mb-1">
      <span className={`${accent ?? 'text-[#7a4a0a]'}`}>{icon}</span>
      <span className="text-xs text-[#6b5c40] font-medium">{label}</span>
    </div>
    <p className="text-xl font-bold text-[#111111] leading-tight">{value}</p>
    {sub && <p className="text-xs text-[#6b5c40]">{sub}</p>}
  </div>
);

const PartnerBalanceSummary: React.FC<Props> = ({ partnerId, refreshKey }) => {
  const [summary, setSummary] = useState<PartnerOperationalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRelease, setPendingRelease] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true);
      setError(null);
      const { count: pendingCount } = await supabase
        .from('commercial_delivery_units')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .in('status', ['generated', 'printed', 'scanned']);
      setPendingRelease(pendingCount ?? 0);

      // Try view first; fall back to manual aggregation if view doesn't exist
      const { data, error: err } = await supabase
        .from('v_commercial_partner_operational_summary')
        .select('pending_balance, total_due, total_paid, total_units_in_partner, next_visit_date')
        .eq('partner_id', partnerId)
        .maybeSingle();

      if (err || !data) {
        // Fallback: compute from items table (more reliable)
        const [movItemRes, payRes, stockRes] = await Promise.all([
          supabase!
            .from('commercial_partner_movement_items')
            .select('amount_due, movement:commercial_partner_movements!inner(partner_id,status)')
            .eq('commercial_partner_movements.partner_id', partnerId)
            .eq('commercial_partner_movements.status', 'completed'),
          supabase!
            .from('commercial_partner_payments')
            .select('amount')
            .eq('partner_id', partnerId),
          supabase!
            .from('v_commercial_partner_current_stock')
            .select('quantity_in_partner')
            .eq('partner_id', partnerId),
        ]);

        if (movItemRes.error || payRes.error) {
          setError('No se pudo cargar el resumen financiero.');
          setLoading(false);
          return;
        }

        const totalGenerated = (movItemRes.data ?? []).reduce(
          (s: number, r: any) => s + (r.amount_due ?? 0), 0,
        );
        const totalPaid = (payRes.data ?? []).reduce(
          (s: number, r: any) => s + (r.amount ?? 0), 0,
        );
        const totalUnits = (stockRes.data ?? []).reduce(
          (s: number, r: any) => s + (r.quantity_in_partner ?? 0), 0,
        );

        setSummary({
          partner_id: partnerId,
          total_due: totalGenerated,
          total_paid: totalPaid,
          pending_balance: totalGenerated - totalPaid,
          total_units_in_partner: totalUnits,
        });
      } else {
        setSummary(data ? { partner_id: partnerId, ...data } : {
          partner_id: partnerId,
          total_due: 0,
          total_paid: 0,
          pending_balance: 0,
          total_units_in_partner: 0,
        });
      }
      setLoading(false);
    })();
  }, [partnerId, refreshKey]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARD_CLS} h-20 animate-pulse bg-[#f5e9c8]`} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-700 text-sm p-3 rounded-lg bg-red-50 border border-red-200">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {error}
      </div>
    );
  }

  const balance = summary?.pending_balance ?? 0;
  const balanceAccent = balance > 0 ? 'text-red-600' : 'text-green-600';

  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat
        icon={<Scale className="w-4 h-4" />}
        label="Saldo pendiente"
        value={fmtCurrency(summary?.pending_balance ?? 0)}
        accent={balanceAccent}
      />
      <Stat
        icon={<TrendingUp className="w-4 h-4" />}
        label="Total generado"
        value={fmtCurrency(summary?.total_due ?? 0)}
      />
      <Stat
        icon={<TrendingDown className="w-4 h-4" />}
        label="Total cobrado"
        value={fmtCurrency(summary?.total_paid ?? 0)}
        accent="text-green-700"
      />
      <Stat
        icon={<Package className="w-4 h-4" />}
        label="Pendientes de liberar"
        value={String(pendingRelease)}
        accent="text-amber-700"
      />
      <Stat
        icon={<Package className="w-4 h-4" />}
        label="Unidades en posesión"
        value={String(summary?.total_units_in_partner ?? 0)}
        sub={
          summary?.next_visit_date
            ? `Próx. visita: ${fmtDate(summary.next_visit_date)}`
            : undefined
        }
      />
    </div>
  );
};

export default PartnerBalanceSummary;
