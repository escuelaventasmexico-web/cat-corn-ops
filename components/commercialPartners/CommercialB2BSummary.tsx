import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Scale,
  Package,
  AlertCircle,
  ShoppingCart,
  Calendar,
} from 'lucide-react';
import { supabase } from '../../supabase';

// ── Types ─────────────────────────────────────────────────────────────────
interface ComodatoSummary {
  total_due?: number | null;
  total_paid?: number | null;
  pending_balance?: number | null;
  total_units_in_partner?: number | null;
}

interface WholesaleSummary {
  total_purchased?: number | null;
  total_paid?: number | null;
  pending_balance?: number | null;
  total_pieces?: number | null;
  purchase_count?: number | null;
  last_purchase_date?: string | null;
}

interface B2BTotals {
  total_generated_or_purchased: number;
  total_collected_or_paid: number;
  total_pending: number;
}

// ── Formatters ────────────────────────────────────────────────────────────
const n = (v: number | null | undefined) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

export const fmtCurrency = (
  value: number | null | undefined,
  hasData: boolean = true
): string => {
  if (!hasData || value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const fmtPieces = (value: number | null | undefined, hasData: boolean = true): string => {
  if (!hasData || value == null || Number.isNaN(value)) return '—';
  return `${Math.trunc(value)} piezas`;
};

export const fmtDateMx = (
  value: string | null | undefined,
  hasData: boolean = true
): string => {
  if (!hasData || !value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
};

const computeB2BTotals = (
  comodato?: ComodatoSummary | null,
  mayoreo?: WholesaleSummary | null
): B2BTotals => {
  return {
    total_generated_or_purchased: n(comodato?.total_due) + n(mayoreo?.total_purchased),
    total_collected_or_paid: n(comodato?.total_paid) + n(mayoreo?.total_paid),
    total_pending: n(comodato?.pending_balance) + n(mayoreo?.pending_balance),
  };
};

// ── Card Components ───────────────────────────────────────────────────────

const StatRow: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
}> = ({ label, value, icon }) => (
  <div className="flex items-center justify-between py-2 border-b border-[#e9d9c3] last:border-b-0">
    <div className="flex items-center gap-2">
      {icon && <span className="text-[#7a4a0a]">{icon}</span>}
      <span className="text-xs text-[#6b5c40] font-medium">{label}</span>
    </div>
    <span className="text-sm font-semibold text-[#111111]">{value}</span>
  </div>
);

const B2BCard: React.FC<{
  title: string;
  children: React.ReactNode;
  highlightPending?: boolean;
  pendingAmount?: number;
}> = ({ title, children, highlightPending, pendingAmount }) => (
  <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4">
    <h4 className="text-sm font-semibold text-[#111111] mb-3">{title}</h4>
    {highlightPending && pendingAmount !== undefined && pendingAmount > 0 && (
      <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-xs text-red-700 font-medium">⚠️ Saldo pendiente</p>
      </div>
    )}
    {children}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────

interface CommercialB2BSummaryProps {
  partnerId: string;
}

export const CommercialB2BSummary: React.FC<CommercialB2BSummaryProps> = ({ partnerId }) => {
  const [comodato, setComodato] = useState<ComodatoSummary | null>(null);
  const [mayoreo, setMayoreo] = useState<WholesaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [partnerId]);

  const loadData = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    try {
      // Load comodato data
      const { data: comodatoData, error: comodatoError } = await supabase
        .from('v_commercial_partner_operational_summary')
        .select('total_due, total_paid, pending_balance, total_units_in_partner')
        .eq('partner_id', partnerId)
        .maybeSingle();

      if (comodatoError && comodatoError.code !== 'PGRST116') {
        console.warn('Comodato data error:', comodatoError);
      } else if (comodatoData) {
        setComodato(comodatoData);
      }

      // Load mayoreo data
      const { data: mayoreoData, error: mayoreoError } = await supabase
        .from('v_commercial_partner_wholesale_summary')
        .select('total_purchased, total_paid, pending_balance, total_pieces, purchase_count, last_purchase_date')
        .eq('partner_id', partnerId)
        .maybeSingle();

      if (mayoreoError && mayoreoError.code !== 'PGRST116') {
        console.warn('Mayoreo data error:', mayoreoError);
      } else if (mayoreoData) {
        setMayoreo(mayoreoData);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar resumen comercial');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl bg-[#fff8e6] border border-[#c49330] p-4 flex items-center gap-2">
        <div className="animate-spin inline-block w-4 h-4 border-2 border-[#7a4a0a] border-t-transparent rounded-full" />
        <span className="text-sm text-[#6b5c40]">Cargando resumen comercial...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2">
        <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-red-800">Error</p>
          <p className="text-xs text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  const hasComodato = !!(
    comodato &&
    (comodato.total_due || comodato.total_paid || comodato.pending_balance || comodato.total_units_in_partner)
  );
  const hasMayoreo = !!(
    mayoreo &&
    (mayoreo.total_purchased || mayoreo.total_paid || mayoreo.pending_balance || mayoreo.total_pieces)
  );

  // Don't show section if no data at all
  if (!hasComodato && !hasMayoreo) {
    return null;
  }

  const totals = computeB2BTotals(comodato || undefined, mayoreo || undefined);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
        Resumen comercial
      </p>

      {/* Total general B2B */}
      <B2BCard
        title="Total general B2B"
        highlightPending={totals.total_pending > 0}
        pendingAmount={totals.total_pending}
      >
        <StatRow
          label="Total generado/comprado"
          value={fmtCurrency(totals.total_generated_or_purchased, hasComodato || hasMayoreo)}
          icon={<TrendingUp size={14} />}
        />
        <StatRow
          label="Total cobrado/pagado"
          value={fmtCurrency(totals.total_collected_or_paid, hasComodato || hasMayoreo)}
          icon={<TrendingDown size={14} />}
        />
        <div className="py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Scale size={14} className="text-[#7a4a0a]" />
              <span className="text-xs text-[#6b5c40] font-medium">Saldo pendiente total</span>
            </div>
            <span
              className={`text-sm font-semibold ${
                totals.total_pending > 0 ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {fmtCurrency(totals.total_pending, hasComodato || hasMayoreo)}
            </span>
          </div>
        </div>
      </B2BCard>

      {/* Comodato */}
      {hasComodato && (
        <B2BCard title="Comodato">
          <StatRow
            label="Generado por comodato"
            value={fmtCurrency(comodato?.total_due, hasComodato)}
            icon={<TrendingUp size={14} />}
          />
          <StatRow
            label="Cobrado en comodato"
            value={fmtCurrency(comodato?.total_paid, hasComodato)}
            icon={<TrendingDown size={14} />}
          />
          <StatRow
            label="Saldo pendiente comodato"
            value={fmtCurrency(comodato?.pending_balance, hasComodato)}
            icon={<Scale size={14} />}
          />
          <StatRow
            label="Unidades en posesión"
            value={
              hasComodato
                ? `${Math.trunc(comodato?.total_units_in_partner ?? 0)} uds`
                : '—'
            }
            icon={<Package size={14} />}
          />
        </B2BCard>
      )}

      {/* Mayoreo */}
      {hasMayoreo && (
        <B2BCard title="Mayoreo">
          <StatRow
            label="Comprado en mayoreo"
            value={fmtCurrency(mayoreo?.total_purchased, hasMayoreo)}
            icon={<TrendingUp size={14} />}
          />
          <StatRow
            label="Pagado en mayoreo"
            value={fmtCurrency(mayoreo?.total_paid, hasMayoreo)}
            icon={<TrendingDown size={14} />}
          />
          <StatRow
            label="Saldo pendiente mayoreo"
            value={fmtCurrency(mayoreo?.pending_balance, hasMayoreo)}
            icon={<Scale size={14} />}
          />
          <StatRow
            label="Piezas compradas"
            value={fmtPieces(mayoreo?.total_pieces, hasMayoreo)}
            icon={<Package size={14} />}
          />
          <StatRow
            label="Compras realizadas"
            value={hasMayoreo ? `${Math.trunc(mayoreo?.purchase_count ?? 0)}` : '—'}
            icon={<ShoppingCart size={14} />}
          />
          <StatRow
            label="Última compra"
            value={fmtDateMx(mayoreo?.last_purchase_date, hasMayoreo)}
            icon={<Calendar size={14} />}
          />
        </B2BCard>
      )}
    </div>
  );
};
