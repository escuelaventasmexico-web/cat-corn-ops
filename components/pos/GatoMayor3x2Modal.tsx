import { Minus, Plus, Sparkles, X } from 'lucide-react';
import type { CartItem } from '../../supabase';
import { isGatoMayor3x2Eligible } from '../../lib/gatoMayor3x2.js';

interface Props {
  cart: CartItem[];
  availableByProduct: Map<string, number>;
  selected: Record<string, number>;
  onChange: (productId: string, quantity: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const GatoMayor3x2Modal = ({
  cart,
  availableByProduct,
  selected,
  onChange,
  onCancel,
  onConfirm,
}: Props) => {
  const products = cart.filter(isGatoMayor3x2Eligible);
  const selectedCount = Object.values(selected).reduce((sum, quantity) => sum + quantity, 0);
  const selectedUnits = products.flatMap(product =>
    Array.from({ length: selected[product.id] || 0 }, () => product),
  );
  const freeUnit = [...selectedUnits].sort((a, b) => a.price - b.price
    || (a.sku_code || '').localeCompare(b.sku_code || ''))[0];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="gato-3x2-title" className="w-full max-w-md rounded-2xl border border-amber-400/20 bg-[#211f1f] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <Sparkles size={20} />
            </div>
            <h2 id="gato-3x2-title" className="text-xl font-bold text-cc-cream">3 × 2 Gato Mayor</h2>
            <p className="mt-1 text-sm text-cc-text-muted">Selecciona exactamente tres bolsas disponibles en el carrito.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar promoción" className="rounded-lg p-2 text-cc-text-muted hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          {products.map(product => {
            const quantity = selected[product.id] || 0;
            const available = availableByProduct.get(product.id) || 0;
            return (
              <div key={product.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-cc-cream">{product.product_name || product.name}</div>
                  <div className="text-xs text-cc-text-muted">${product.price.toFixed(2)} · {available} sin agrupar</div>
                </div>
                <button type="button" onClick={() => onChange(product.id, Math.max(0, quantity - 1))} disabled={quantity === 0} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 disabled:opacity-30"><Minus size={13} /></button>
                <span className="w-5 text-center font-bold text-cc-cream">{quantity}</span>
                <button type="button" onClick={() => onChange(product.id, quantity + 1)} disabled={selectedCount >= 3 || quantity >= available} className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/15 text-amber-300 disabled:opacity-30"><Plus size={13} /></button>
              </div>
            );
          })}
          {products.length === 0 && <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-center text-sm text-cc-text-muted">Agrega bolsas Gato Mayor al carrito para formar la promoción.</div>}
        </div>

        <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs">
          <div className="flex justify-between text-cc-text-muted"><span>Seleccionadas</span><span className="font-bold text-cc-cream">{selectedCount} / 3</span></div>
          {selectedCount === 3 && freeUnit && (
            <div className="mt-2 flex justify-between text-amber-300"><span>Bolsa bonificada</span><span className="font-bold">{freeUnit.product_name || freeUnit.name} · ${freeUnit.price.toFixed(2)}</span></div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-cc-text-main hover:bg-white/10">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={selectedCount !== 3} className="rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">Aplicar grupo</button>
        </div>
      </div>
    </div>
  );
};
