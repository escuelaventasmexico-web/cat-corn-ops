import { useEffect, useState } from 'react';
import { supabase, Product } from '../supabase';
import { Printer, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { printLabelViaQZ } from '../lib/printReceipt';
import type { LabelPrintData } from '../lib/printReceipt';

interface PrintResult {
  ok: boolean;
  message: string;
  sku_code: string;
  barcode_value: string;
  units_printed: number;
}

export const PrintLabels = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [units, setUnits] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetchingProducts, setFetchingProducts] = useState(true);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      // 1) Call RPC to register production / deduct inventory
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

      // 2) Print labels via QZ Tray
      const prod = products.find((p) => p.id === selectedProductId);
      if (prod) {
        const labelData = buildLabelData(prod, res);
        await printLabelViaQZ(labelData, units);
      }
    } catch (err: any) {
      console.error('print_sku_labels error:', err);
      const msg = err?.message || 'Error al imprimir etiquetas';
      // Distinguish QZ Tray errors from RPC errors
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

  // ── Re-print (no RPC call — just send to printer again) ──
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

  // ── Selected product helper ──
  const selectedProduct = products.find((p) => p.id === selectedProductId);

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

      {/* Form card */}
      <div className="bg-cc-surface rounded-2xl p-6 border border-white/5 max-w-lg space-y-5">
        {/* Product selector */}
        <div>
          <label className="block text-sm text-cc-text-muted mb-1">Producto</label>
          {fetchingProducts ? (
            <div className="flex items-center gap-2 text-cc-text-muted">
              <Loader2 className="animate-spin" size={16} /> Cargando productos…
            </div>
          ) : (
            <select
              value={selectedProductId}
              onChange={(e) => { setSelectedProductId(e.target.value); setResult(null); setError(null); }}
              className="w-full bg-white text-black placeholder-gray-400 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cc-primary"
            >
              <option value="">— Selecciona un producto —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name || p.name} – {p.size} {p.sku_code ? `(${p.sku_code})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

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

        {/* Selected product preview */}
        {selectedProduct && (
          <div className="bg-cc-bg rounded-lg p-3 text-sm text-cc-text-muted border border-white/5">
            <p><span className="text-cc-text-main font-medium">SKU:</span> {selectedProduct.sku_code || '—'}</p>
            <p><span className="text-cc-text-main font-medium">Código de barras:</span> {selectedProduct.barcode_value || selectedProduct.sku_code || '—'}</p>
            <p><span className="text-cc-text-main font-medium">Precio:</span> ${selectedProduct.price?.toFixed(2)}</p>
          </div>
        )}

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
    </div>
  );
};
