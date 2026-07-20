import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CreditCard, Truck, AlertCircle } from 'lucide-react';
import { supabase } from '../../../supabase';
import {
  PartnerMovement,
  PartnerPayment,
  PartnerMovementItem,
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPE_COLORS,
  PAYMENT_METHODS,
  fmtCurrency,
  fmtDate,
  CARD_CLS,
  SECTION_TITLE_CLS,
} from './types';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

// Calculate aggregated quantities from items
const calculateMovementTotals = (items: PartnerMovementItem[]) => ({
  total_delivered: items.reduce((sum, it) => sum + (it.quantity_delivered ?? 0), 0),
  total_sold: items.reduce((sum, it) => sum + (it.quantity_sold ?? 0), 0),
  total_withdrawn: items.reduce((sum, it) => sum + (it.quantity_withdrawn ?? 0), 0),
  total_spoiled: items.reduce((sum, it) => sum + (it.quantity_spoiled ?? 0), 0),
  total_due: items.reduce((sum, it) => sum + (it.amount_due ?? 0), 0),
});

const PartnerMovementHistory: React.FC<Props> = ({ partnerId, refreshKey }) => {
  const [movements, setMovements] = useState<PartnerMovement[]>([]);
  const [payments, setPayments] = useState<PartnerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true);
      setError(null);

      const [movRes, payRes] = await Promise.all([
        supabase!
          .from('commercial_partner_movements')
          .select('*, commercial_partner_movement_items(*)')
          .eq('partner_id', partnerId)
          .order('movement_date', { ascending: false })
          .limit(60),
        supabase!
          .from('commercial_partner_payments')
          .select('*')
          .eq('partner_id', partnerId)
          .order('payment_date', { ascending: false })
          .limit(60),
      ]);

      if (movRes.error || payRes.error) {
        setError('No se pudo cargar el historial de movimientos.');
      } else {
        setMovements(movRes.data ?? []);
        setPayments(payRes.data ?? []);
      }
      setLoading(false);
    })();
  }, [partnerId, refreshKey]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className={`${CARD_CLS} h-16 animate-pulse bg-[#f5e9c8]`} />
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

  if (movements.length === 0 && payments.length === 0) {
    return (
      <div className={`${CARD_CLS} text-center py-8`}>
        <Truck className="w-8 h-8 text-[#c49330] mx-auto mb-2" />
        <p className="text-sm text-[#6b5c40]">No hay movimientos registrados.</p>
      </div>
    );
  }

  // Build a unified timeline sorted by date desc
  type TimelineItem =
    | { kind: 'movement'; data: PartnerMovement }
    | { kind: 'payment';  data: PartnerPayment };

  const timeline: TimelineItem[] = [
    ...movements.map(m => ({ kind: 'movement' as const, data: m })),
    ...payments.map(p => ({ kind: 'payment' as const, data: p })),
  ].sort((a, b) => {
    const aDate = a.kind === 'movement' ? a.data.movement_date : a.data.payment_date;
    const bDate = b.kind === 'movement' ? b.data.movement_date : b.data.payment_date;
    return bDate.localeCompare(aDate);
  });

  // Render movement based on type
  const renderMovementSummary = (mv: PartnerMovement) => {
    const items = mv.commercial_partner_movement_items ?? [];
    const totals = calculateMovementTotals(items);

    switch (mv.movement_type) {
      case 'delivery':
        return {
          summary: `Entregado: ${totals.total_delivered} piezas`,
          details: (
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map(it => (
                  <div key={it.id} className="text-xs text-[#374151]">
                    <div className="font-semibold text-[#111111]">
                      {it.product_name}
                      {it.product_variant ? ` — ${it.product_variant}` : ''}
                      {it.product_size ? ` (${it.product_size})` : ''}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {it.quantity_delivered > 0 && (
                        <div>Entregado: {it.quantity_delivered}</div>
                      )}
                      {(it.price_to_catcorn ?? 0) > 0 && (
                        <div>Precio: {fmtCurrency(it.price_to_catcorn)}</div>
                      )}
                      {(it.suggested_retail_price ?? 0) > 0 && (
                        <div>PVP: {fmtCurrency(it.suggested_retail_price)}</div>
                      )}
                    </div>
                    {it.notes && (
                      <div className="italic text-[#9a8060] mt-1">{it.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[#9a8060] italic">Sin productos asociados.</div>
              )}
            </div>
          ),
        };

      case 'settlement':
        return {
          summary: `Vendido: ${totals.total_sold} · Retirado: ${totals.total_withdrawn} · Merma: ${totals.total_spoiled} · Generado: ${fmtCurrency(totals.total_due)}`,
          details: (
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map(it => (
                  <div key={it.id} className="text-xs text-[#374151]">
                    <div className="font-semibold text-[#111111]">
                      {it.product_name}
                      {it.product_variant ? ` — ${it.product_variant}` : ''}
                      {it.product_size ? ` (${it.product_size})` : ''}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {it.quantity_sold > 0 && (
                        <div>Vendido: {it.quantity_sold}</div>
                      )}
                      {it.quantity_withdrawn > 0 && (
                        <div>Retirado: {it.quantity_withdrawn}</div>
                      )}
                      {it.quantity_spoiled > 0 && (
                        <div className="text-red-600">Merma: {it.quantity_spoiled}</div>
                      )}
                      {it.amount_due > 0 && (
                        <div className="font-semibold text-[#7a4a0a]">
                          Monto: {fmtCurrency(it.amount_due)}
                        </div>
                      )}
                    </div>
                    {it.notes && (
                      <div className="italic text-[#9a8060] mt-1">{it.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[#9a8060] italic">Sin productos asociados.</div>
              )}
            </div>
          ),
        };

      case 'withdrawal':
        return {
          summary: `Retirado: ${totals.total_withdrawn} piezas`,
          details: (
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map(it => (
                  <div key={it.id} className="text-xs text-[#374151]">
                    <div className="font-semibold text-[#111111]">
                      {it.product_name}
                      {it.product_variant ? ` — ${it.product_variant}` : ''}
                      {it.product_size ? ` (${it.product_size})` : ''}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {it.quantity_withdrawn > 0 && (
                        <div>Retirado: {it.quantity_withdrawn}</div>
                      )}
                    </div>
                    {it.notes && (
                      <div className="italic text-[#9a8060] mt-1">{it.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[#9a8060] italic">Sin productos asociados.</div>
              )}
            </div>
          ),
        };

      case 'spoilage':
        return {
          summary: `Merma: ${totals.total_spoiled} pieza(s)`,
          details: (
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map(it => (
                  <div key={it.id} className="text-xs text-[#374151]">
                    <div className="font-semibold text-[#111111]">
                      {it.product_name}
                      {it.product_variant ? ` — ${it.product_variant}` : ''}
                      {it.product_size ? ` (${it.product_size})` : ''}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {it.quantity_spoiled > 0 && (
                        <div className="text-red-600">Merma: {it.quantity_spoiled}</div>
                      )}
                      {it.spoilage_absorbed_by && (
                        <div>
                          Absorbe:{' '}
                          {it.spoilage_absorbed_by === 'catcorn'
                            ? 'Cat Corn'
                            : it.spoilage_absorbed_by === 'partner'
                              ? 'Socio'
                              : it.spoilage_absorbed_by}
                        </div>
                      )}
                      {it.amount_due > 0 && (
                        <div className="font-semibold text-[#7a4a0a]">
                          Monto: {fmtCurrency(it.amount_due)}
                        </div>
                      )}
                    </div>
                    {it.notes && (
                      <div className="italic text-[#9a8060] mt-1">{it.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[#9a8060] italic">Sin productos asociados.</div>
              )}
            </div>
          ),
        };

      case 'adjustment':
      case 'visit':
      default:
        return {
          summary: items.length > 0 ? `${items.length} producto(s)` : 'Sin detalles',
          details: (
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map(it => (
                  <div key={it.id} className="text-xs text-[#374151]">
                    <div className="font-semibold text-[#111111]">
                      {it.product_name}
                      {it.product_variant ? ` — ${it.product_variant}` : ''}
                      {it.product_size ? ` (${it.product_size})` : ''}
                    </div>
                    {it.quantity_delivered > 0 && (
                      <div>Entregado: {it.quantity_delivered}</div>
                    )}
                    {it.quantity_sold > 0 && <div>Vendido: {it.quantity_sold}</div>}
                    {it.quantity_withdrawn > 0 && (
                      <div>Retirado: {it.quantity_withdrawn}</div>
                    )}
                    {it.quantity_spoiled > 0 && (
                      <div className="text-red-600">Merma: {it.quantity_spoiled}</div>
                    )}
                    {it.notes && (
                      <div className="italic text-[#9a8060] mt-1">{it.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[#9a8060] italic">Sin productos asociados.</div>
              )}
            </div>
          ),
        };
    }
  };

  return (
    <div className="space-y-2">
      <p className={SECTION_TITLE_CLS}>Historial ({timeline.length})</p>
      {timeline.map((item) => {
        if (item.kind === 'payment') {
          const p = item.data;
          const methodLabel = PAYMENT_METHODS.find(m => m.value === p.payment_method)?.label ?? p.payment_method;
          return (
            <div key={`pay-${p.id}`} className={`${CARD_CLS} flex justify-between items-center gap-2`}>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[#111111]">Pago recibido</p>
                  <p className="text-xs text-[#6b5c40]">{fmtDate(p.payment_date)} · {methodLabel}</p>
                  {p.reference && <p className="text-xs text-[#9a8060]">Ref: {p.reference}</p>}
                  {p.notes && <p className="text-xs text-[#9a8060] italic">{p.notes}</p>}
                </div>
              </div>
              <p className="text-base font-bold text-green-700 flex-shrink-0">{fmtCurrency(p.amount)}</p>
            </div>
          );
        }

        // movement
        const mv = item.data;
        const isOpen = expanded.has(mv.id);
        const colorClass = MOVEMENT_TYPE_COLORS[mv.movement_type] ?? '';
        const typeLabel = MOVEMENT_TYPE_LABELS[mv.movement_type] ?? mv.movement_type;
        const movementContent = renderMovementSummary(mv);

        return (
          <div key={`mov-${mv.id}`} className={CARD_CLS}>
            <button
              className="w-full flex justify-between items-start gap-2 text-left"
              onClick={() => toggleExpand(mv.id)}
            >
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <Truck className="w-4 h-4 text-[#7a4a0a] flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
                      {typeLabel}
                    </span>
                    <span className="text-xs text-[#6b5c40]">{fmtDate(mv.movement_date)}</span>
                  </div>
                  <p className="text-xs text-[#6b5c40]">{movementContent.summary}</p>
                  {mv.notes && <p className="text-xs text-[#9a8060] italic truncate mt-0.5">{mv.notes}</p>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {mv.total_amount_due > 0 && (
                  <p className="text-sm font-bold text-[#111111]">{fmtCurrency(mv.total_amount_due)}</p>
                )}
                {isOpen
                  ? <ChevronUp className="w-4 h-4 text-[#7a4a0a]" />
                  : <ChevronDown className="w-4 h-4 text-[#7a4a0a]" />
                }
              </div>
            </button>

            {isOpen && (
              <div className="mt-3 pt-3 border-t border-[#e8d5a0]">
                {movementContent.details}
                {mv.next_visit_date && (
                  <p className="text-xs text-[#6b5c40] mt-3 pt-3 border-t border-[#e8d5a0]">
                    Próx. visita: {fmtDate(mv.next_visit_date)}
                    {mv.next_visit_reason ? ` — ${mv.next_visit_reason}` : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PartnerMovementHistory;
