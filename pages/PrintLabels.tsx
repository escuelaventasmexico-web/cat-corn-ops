import { useEffect, useState, useMemo } from 'react';
import { supabase, Product } from '../supabase';
import { Printer, Loader2, CheckCircle2, AlertCircle, Check, Package } from 'lucide-react';
import { printLabelViaQZ, printGenericLabelViaQZ } from '../lib/printReceipt';
import type { LabelPrintData } from '../lib/printReceipt';

interface PrintResult {
  ok: boolean;
  message: string;
  sku_code: string;
  barcode_value: string;
  units_printed: number;
}

// ── Category helpers ─────────────────────────────────────────────────

/** Canonical category buckets */
const CATEGORIES = [
  { key: 'salada',   label: 'SALADAS',  emoji: '🧂' },
  { key: 'caramelo', label: 'CARAMELO', emoji: '🍯' },
  { key: 'sabores',  label: 'SABORES',  emoji: '🍿' },
] as const;

/** Map a product's flavor/category to one of the 3 buckets */
function resolveCategory(p: Product): string {
  const raw = (p.flavor || p.category || '').toLowerCase();
  if (raw.includes('salad'))   return 'salada';
  if (raw.includes('caramel')) return 'caramelo';
  return 'sabores';
}

/** Short display name: strip "Palomitas de " prefix, keep it snappy */
function shortName(p: Product): string {
  const full = p.product_name || p.name || '';
  return full
    .replace(/^palomitas\s+de\s+/i, '')
    .replace(/^palomitas\s+/i, '');
}

/** Weight display */
function weightLabel(p: Product): string {
  const g = p.grams || p.weight_grams;
  return g ? `${g}g` : p.size || '';
}

// ─────────────────────────────────────────────────────────────────────

export const PrintLabels = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [units, setUnits] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetchingProducts, setFetchingProducts] = useState(true);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Generic label state ──
  const [genericName, setGenericName] = useState('');
  const [genericPrice, setGenericPrice] = useState('');
  const [genericQty, setGenericQty] = useState(1);
  const [genericLoading, setGenericLoading] = useState(false);
  const [genericSuccess, setGenericSuccess] = useState(false);
  const [genericError, setGenericError] = useState<string | null>(null);

  // ── Fetch active products ──
  useEffect(() => {
    const load = async () => {
      if (!supabase) { setFetchingProducts(false); return; }

      let res = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (res.error) {
        res = await supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .order('name');
      }

      if (res.data) setProducts(res.data as Product[]);
      setFetchingProducts(false);
    };
    load();
  }, []);

  // ── Group products by category ──
  const grouped = useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const cat of CATEGORIES) map[cat.key] = [];

    for (const p of products) {
      const cat = resolveCategory(p);
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }

    // Sort each group by weight ascending
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => (a.grams || a.weight_grams || 0) - (b.grams || b.weight_grams || 0));
    }

    return map;
  }, [products]);

  // ── Build label data from product + RPC result ──
  const buildLabelData = (prod: Product, rpc: PrintResult): LabelPrintData => ({
    productName: prod.product_name || prod.name,
    size: prod.size,
    sku: rpc.sku_code || prod.sku_code || '',
    barcodeValue: rpc.barcode_value || rpc.sku_code || prod.sku_code || '',
    price: prod.price,
  });

  // ── Print handler ──
  const handlePrint = async () => {
    if (!selectedProductId || units < 1 || !supabase) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('print_sku_labels', {
        p_product_id: selectedProductId,
        p_units: units,
      });

      if (rpcErr) throw rpcErr;

      const res = data as PrintResult;

      if (!res || !res.ok) {
        setError(res?.message || 'Error desconocido al imprimir etiquetas');
        return;
      }

      setResult(res);

      const prod = products.find((p) => p.id === selectedProductId);
      if (prod) {
        const labelData = buildLabelData(prod, res);
        await printLabelViaQZ(labelData, units);
      }
    } catch (err: any) {
      console.error('print_sku_labels error:', err);
      const msg = err?.message || 'Error al imprimir etiquetas';
      if (msg.includes('impresora')) {
        setError(msg);
      } else if (msg.includes('QZ') || msg.includes('websocket') || msg.includes('connect')) {
        setError('QZ Tray no está conectado. Asegúrate de que esté abierto y vuelve a intentar.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Re-print (no RPC call) ──
  const handleReprint = async () => {
    if (!result) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;

    try {
      setError(null);
      const labelData = buildLabelData(prod, result);
      await printLabelViaQZ(labelData, units);
    } catch (err: any) {
      setError(err?.message || 'Error al reimprimir');
    }
  };

  // ── Select product ──
  const handleSelectProduct = (id: string) => {
    setSelectedProductId(id);
    setResult(null);
    setError(null);
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // ── Generic label print handler ──
  const handleGenericPrint = async () => {
    setGenericError(null);
    setGenericSuccess(false);
    const name = genericName.trim();
    const price = parseFloat(genericPrice);
    const qty = Math.max(1, genericQty);
    if (!name) { setGenericError('El nombre del producto es obligatorio.'); return; }
    if (!genericPrice || isNaN(price) || price <= 0) { setGenericError('El precio debe ser mayor a $0.'); return; }
    setGenericLoading(true);
    try {
      await printGenericLabelViaQZ(name, price, qty);
      setGenericSuccess(true);
    } catch (err: any) {
      const msg = err?.message || 'Error al imprimir etiqueta';
      setGenericError(
        msg.includes('QZ') || msg.includes('websocket') || msg.includes('connect')
          ? 'QZ Tray no está conectado. Asegúrate de que esté abierto y vuelve a intentar.'
          : msg
      );
    } finally {
      setGenericLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-cc-cream flex items-center gap-2">
          <Printer className="text-cc-primary" /> Imprimir Etiquetas
        </h1>
        <p className="text-cc-text-muted text-sm mt-1">
          Selecciona un producto e indica la cantidad de etiquetas a imprimir.
        </p>
      </div>

      {/* Product cards by category */}
      {fetchingProducts ? (
        <div className="flex items-center gap-2 text-cc-text-muted py-8">
          <Loader2 className="animate-spin" size={18} /> Cargando productos…
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORIES.map(({ key, label, emoji }) => {
            const items = grouped[key];
            if (!items || items.length === 0) return null;

            return (
              <section key={key}>
                <h2 className="text-sm font-bold text-cc-text-muted tracking-widest uppercase mb-3 flex items-center gap-2">
                  <span className="text-base">{emoji}</span> {label}
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((p) => {
                    const isSelected = selectedProductId === p.id;

                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProduct(p.id)}
                        className={`
                          relative text-left rounded-xl p-4 transition-all duration-150 border-2
                          ${isSelected
                            ? 'bg-cc-primary/10 border-cc-primary shadow-[0_0_16px_rgba(244,197,66,0.25)]'
                            : 'bg-neutral-800 border-transparent hover:bg-neutral-700 hover:border-white/10'
                          }
                        `}
                      >
                        {/* Selection check */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-cc-primary rounded-full p-0.5">
                            <Check size={14} className="text-cc-bg" strokeWidth={3} />
                          </div>
                        )}

                        {/* Product info */}
                        <p className={`font-semibold text-sm leading-tight ${isSelected ? 'text-cc-primary' : 'text-cc-cream'}`}>
                          {shortName(p)}
                        </p>
                        <p className="text-cc-text-muted text-xs mt-1">
                          {weightLabel(p)}
                        </p>
                        {p.sku_code && (
                          <p className="text-[10px] text-cc-text-muted/60 font-mono mt-1.5">
                            {p.sku_code}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Bottom panel: quantity + print */}
      <div className="bg-cc-surface rounded-2xl p-6 border border-white/5 max-w-lg space-y-5">
        {/* Selected product summary */}
        {selectedProduct ? (
          <div className="bg-cc-bg rounded-lg p-3 text-sm border border-white/5">
            <p className="text-cc-cream font-semibold">{selectedProduct.product_name || selectedProduct.name} – {selectedProduct.size}</p>
            <div className="flex gap-4 mt-1 text-cc-text-muted text-xs">
              <span>SKU: <span className="font-mono text-cc-text-main">{selectedProduct.sku_code || '—'}</span></span>
              <span>Precio: <span className="text-cc-text-main">${selectedProduct.price?.toFixed(2)}</span></span>
            </div>
          </div>
        ) : (
          <p className="text-cc-text-muted text-sm">Selecciona un producto arriba para continuar.</p>
        )}

        {/* Units input */}
        <div>
          <label className="block text-sm text-cc-text-muted mb-1">Cantidad de etiquetas</label>
          <input
            type="number"
            min={1}
            value={units}
            onChange={(e) => setUnits(Math.max(1, Number(e.target.value)))}
            className="w-32 bg-white text-black placeholder-gray-400 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cc-primary"
          />
        </div>

        {/* Print button */}
        <button
          onClick={handlePrint}
          disabled={!selectedProductId || units < 1 || loading}
          className="flex items-center gap-2 bg-cc-primary text-cc-bg font-semibold px-5 py-2.5 rounded-lg hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Printer size={18} />}
          {loading ? 'Procesando…' : 'Imprimir Etiquetas'}
        </button>

        {/* Success result */}
        {result && (
          <div className="bg-green-900/30 border border-green-600/40 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-green-400 mt-0.5 shrink-0" size={20} />
              <div className="text-sm space-y-1">
                <p className="text-green-300 font-medium">{result.message}</p>
                <p className="text-cc-text-muted">
                  SKU: <span className="font-mono text-cc-text-main">{result.sku_code || '—'}</span>
                </p>
                <p className="text-cc-text-muted">
                  Código de barras: <span className="font-mono text-cc-text-main">{result.barcode_value || '—'}</span>
                </p>
                <p className="text-cc-text-muted">
                  Etiquetas: <span className="text-cc-text-main font-medium">{result.units_printed}</span>
                </p>
              </div>
            </div>
            <button
              onClick={handleReprint}
              className="flex items-center gap-2 text-sm text-cc-primary hover:underline"
            >
              <Printer size={14} /> Volver a imprimir
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-red-900/30 border border-red-600/40 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={20} />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
      </div>
      {/* ── Generic / manual label ───────────────────────────────── */}
      <div className="bg-cc-surface rounded-2xl p-6 border border-white/5 max-w-lg space-y-5">
        <div>
          <h2 className="text-base font-bold text-cc-cream flex items-center gap-2">
            <Package size={18} className="text-cc-primary" /> Etiqueta genérica
          </h2>
          <p className="text-cc-text-muted text-sm mt-1">
            Imprime una etiqueta informativa para productos sin SKU.<br />
            No crea producto, no descuenta inventario, no registra venta.
          </p>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm text-cc-text-muted mb-1">Nombre del producto</label>
          <input
            type="text"
            placeholder="Ej: Mix Caramelo más mantequilla"
            value={genericName}
            onChange={(e) => { setGenericName(e.target.value); setGenericSuccess(false); setGenericError(null); }}
            className="w-full bg-white text-black placeholder-gray-400 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cc-primary"
          />
        </div>

        {/* Price + Qty row */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm text-cc-text-muted mb-1">Precio ($)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="69.00"
              value={genericPrice}
              onChange={(e) => { setGenericPrice(e.target.value); setGenericSuccess(false); setGenericError(null); }}
              className="w-full bg-white text-black placeholder-gray-400 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cc-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-cc-text-muted mb-1">Etiquetas</label>
            <input
              type="number"
              min={1}
              value={genericQty}
              onChange={(e) => { setGenericQty(Math.max(1, Number(e.target.value))); setGenericSuccess(false); }}
              className="w-24 bg-white text-black placeholder-gray-400 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cc-primary"
            />
          </div>
        </div>

        {/* Preview */}
        {genericName.trim() && parseFloat(genericPrice) > 0 && (
          <div className="bg-cc-bg rounded-lg p-3 text-xs border border-white/5 font-mono space-y-0.5 text-cc-text-muted">
            <p className="text-cc-cream font-bold text-center">CAT CORN</p>
            <p className="text-center border-t border-white/10 pt-1">{genericName.trim()}</p>
            <p className="text-cc-primary font-bold text-center text-sm">${parseFloat(genericPrice).toFixed(2)}</p>
            <p className="text-center text-cc-text-muted/70">Venta genérica</p>
          </div>
        )}

        {/* Print button */}
        <button
          onClick={handleGenericPrint}
          disabled={genericLoading}
          className="flex items-center gap-2 bg-cc-primary text-cc-bg font-semibold px-5 py-2.5 rounded-lg hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {genericLoading ? <Loader2 className="animate-spin" size={18} /> : <Printer size={18} />}
          {genericLoading ? 'Imprimiendo…' : `Imprimir ${genericQty} etiqueta${genericQty !== 1 ? 's' : ''}`}
        </button>

        {/* Success */}
        {genericSuccess && (
          <div className="bg-green-900/30 border border-green-600/40 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="text-green-400 mt-0.5 shrink-0" size={20} />
            <div className="text-sm">
              <p className="text-green-300 font-medium">{genericQty} etiqueta{genericQty !== 1 ? 's' : ''} impresa{genericQty !== 1 ? 's' : ''} correctamente.</p>
              <p className="text-cc-text-muted mt-0.5">Para cobrar este producto, usa <span className="text-cc-cream font-medium">POS &rarr; Venta genérica</span>.</p>
            </div>
          </div>
        )}

        {/* Error */}
        {genericError && (
          <div className="bg-red-900/30 border border-red-600/40 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={20} />
            <p className="text-sm text-red-300">{genericError}</p>
          </div>
        )}
      </div>
    </div>
  );
};
