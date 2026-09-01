import React, { useEffect, useState } from 'react';
import { Package, AlertCircle } from 'lucide-react';
import { supabase } from '../../../supabase';
import {
  PartnerCurrentStockItem,
  fmtCurrency,
  CARD_CLS,
  SECTION_TITLE_CLS,
} from './types';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

const PartnerCurrentStock: React.FC<Props> = ({ partnerId, refreshKey }) => {
  const [items, setItems] = useState<PartnerCurrentStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('v_commercial_partner_current_stock')
        .select('*')
        .eq('partner_id', partnerId)
        .order('product_name');

      if (err) {
        // Fallback: aggregate from movement items
        const { data: raw, error: rawErr } = await supabase
          .from('commercial_partner_movement_items')
          .select('product_name, product_variant, product_size, quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled, price_to_catcorn, suggested_retail_price, movement:commercial_partner_movements!inner(partner_id,status)')
          .eq('commercial_partner_movements.partner_id', partnerId)
          .eq('commercial_partner_movements.status', 'completed');

        if (rawErr) {
          setError('No se pudo cargar el inventario en posesión.');
          setLoading(false);
          return;
        }

        // Group by product_name + variant + size
        const map = new Map<string, PartnerCurrentStockItem>();
        (raw ?? []).forEach((r: any) => {
          const key = `${r.product_name}|${r.product_variant ?? ''}|${r.product_size ?? ''}`;
          const prev = map.get(key) ?? {
            partner_id: partnerId,
            product_name: r.product_name,
            product_variant: r.product_variant,
            product_size: r.product_size,
            total_delivered: 0,
            total_sold: 0,
            total_withdrawn: 0,
            total_spoiled: 0,
            adjustments: 0,
            current_quantity: 0,
            last_price_to_catcorn: r.price_to_catcorn,
            suggested_retail_price: r.suggested_retail_price,
          };
          prev.total_delivered! += r.quantity_delivered ?? 0;
          prev.total_sold! += r.quantity_sold ?? 0;
          prev.total_withdrawn! += r.quantity_withdrawn ?? 0;
          prev.total_spoiled! += r.quantity_spoiled ?? 0;
          prev.current_quantity =
            (prev.total_delivered ?? 0) -
            (prev.total_sold ?? 0) -
            (prev.total_withdrawn ?? 0) -
            (prev.total_spoiled ?? 0);
          map.set(key, prev);
        });

        setItems([...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name)));
        setLoading(false);
        return;
      }

      setItems(data ?? []);
      setLoading(false);
    })();
  }, [partnerId, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className={`${CARD_CLS} h-14 animate-pulse bg-[#f5e9c8]`} />
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

  const inStock = items.filter(i => (i.current_quantity ?? 0) > 0);
  const outOfStock = items.filter(i => (i.current_quantity ?? 0) <= 0);

  if (items.length === 0) {
    return (
      <div className={`${CARD_CLS} text-center py-8`}>
        <Package className="w-8 h-8 text-[#c49330] mx-auto mb-2" />
        <p className="text-sm text-[#6b5c40]">No hay productos en posesión</p>
        <p className="text-xs text-[#9a8060] mt-1">
          Registra una entrega para comenzar el inventario
        </p>
      </div>
    );
  }

  const renderRow = (item: PartnerCurrentStockItem) => {
    const qty = item.current_quantity ?? 0;
    const qtyColor = qty > 0 ? 'text-[#2d6a1a]' : 'text-red-600';

    return (
      <div
        key={`${item.product_name}|${item.product_variant}|${item.product_size}`}
        className={`${CARD_CLS} flex flex-col gap-1`}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#111111] leading-tight">
              {item.product_name}
              {item.product_variant ? ` — ${item.product_variant}` : ''}
            </p>
            {item.product_size && (
              <p className="text-xs text-[#6b5c40]">{item.product_size}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <p className={`text-lg font-bold ${qtyColor}`}>{qty}</p>
            <p className="text-xs text-[#9a8060]">piezas</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-1 pt-2 border-t border-[#e8d5a0]">
          {[
            { label: 'Entregado', value: item.total_delivered },
            { label: 'Vendido', value: item.total_sold },
            { label: 'Retirado', value: item.total_withdrawn },
            { label: 'Merma', value: item.total_spoiled },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-[#9a8060]">{label}</p>
              <p className="text-xs font-semibold text-[#374151]">{value ?? 0}</p>
            </div>
          ))}
        </div>
        {(item.last_price_to_catcorn ?? 0) > 0 && (
          <div className="flex gap-4 text-xs text-[#6b5c40] mt-1">
            <span>Cat Corn: <strong>{fmtCurrency(item.last_price_to_catcorn)}</strong></span>
            {(item.last_suggested_retail_price ?? 0) > 0 && (
              <span>PVP sug.: <strong>{fmtCurrency(item.last_suggested_retail_price)}</strong></span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {inStock.length > 0 && (
        <div className="space-y-2">
          <p className={SECTION_TITLE_CLS}>En posesión ({inStock.length})</p>
          {inStock.map(renderRow)}
        </div>
      )}
      {outOfStock.length > 0 && (
        <div className="space-y-2">
          <p className={SECTION_TITLE_CLS}>Sin existencia ({outOfStock.length})</p>
          {outOfStock.map(renderRow)}
        </div>
      )}
    </div>
  );
};

export default PartnerCurrentStock;
