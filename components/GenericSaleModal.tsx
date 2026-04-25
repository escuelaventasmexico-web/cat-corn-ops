import { useState } from 'react';
import { X, Package, DollarSign, Hash } from 'lucide-react';

interface GenericSaleModalProps {
  onClose: () => void;
  onAdd: (name: string, price: number, quantity: number) => void;
}

export function GenericSaleModal({ onClose, onAdd }: GenericSaleModalProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [errors, setErrors] = useState<{ name?: string; price?: string; quantity?: string }>({});

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'El nombre es obligatorio';
    const p = parseFloat(price);
    if (!price || isNaN(p) || p <= 0) e.price = 'El precio debe ser mayor a $0';
    const q = parseInt(quantity);
    if (!quantity || isNaN(q) || q <= 0) e.quantity = 'La cantidad debe ser al menos 1';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onAdd(name.trim(), parseFloat(price), parseInt(quantity));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-cc-primary" />
            <h2 className="font-bold text-cc-cream text-base">Venta genérica</h2>
          </div>
          <button
            onClick={onClose}
            className="text-cc-text-muted hover:text-cc-cream transition-colors p-1 rounded-lg hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* Nombre */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-cc-text-muted uppercase tracking-wide mb-1.5">
              <Package size={12} /> Nombre del producto
            </label>
            <input
              type="text"
              placeholder="Ej: Mix mantequilla con caramelo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-cc-cream placeholder-gray-500 focus:ring-2 focus:ring-cc-primary/50 focus:border-cc-primary/50 outline-none transition-all"
              autoFocus
            />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
          </div>

          {/* Precio + Cantidad en fila */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-cc-text-muted uppercase tracking-wide mb-1.5">
                <DollarSign size={12} /> Precio unitario
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted font-bold text-sm">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-7 pr-3 py-2.5 text-sm text-cc-cream placeholder-gray-500 focus:ring-2 focus:ring-cc-primary/50 focus:border-cc-primary/50 outline-none transition-all"
                />
              </div>
              {errors.price && <p className="text-xs text-red-400 mt-1">{errors.price}</p>}
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-cc-text-muted uppercase tracking-wide mb-1.5">
                <Hash size={12} /> Cantidad
              </label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-cc-cream placeholder-gray-500 focus:ring-2 focus:ring-cc-primary/50 focus:border-cc-primary/50 outline-none transition-all"
              />
              {errors.quantity && <p className="text-xs text-red-400 mt-1">{errors.quantity}</p>}
            </div>
          </div>

          {/* Preview */}
          {name.trim() && parseFloat(price) > 0 && parseInt(quantity) > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <p className="text-xs text-cc-text-muted mb-0.5">Vista previa</p>
              <p className="text-sm font-semibold text-cc-cream">{name.trim()}</p>
              <p className="text-xs text-cc-text-muted mt-0.5">
                {parseInt(quantity) || 1} × ${parseFloat(price).toFixed(2)} ={' '}
                <span className="font-bold text-cc-primary">
                  ${((parseFloat(price) || 0) * (parseInt(quantity) || 1)).toFixed(2)}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-cc-text-muted text-sm font-semibold hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl bg-cc-primary text-black text-sm font-bold hover:bg-cc-primary/90 transition-colors"
          >
            Agregar al carrito
          </button>
        </div>
      </div>
    </div>
  );
}
