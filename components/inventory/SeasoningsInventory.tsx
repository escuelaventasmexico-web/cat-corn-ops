import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../supabase';
import { connectQZ, printRaw, getSavedPrinterName } from '../../lib/qzService';
import {
  AlertCircle, Plus, X, Clock, Printer, RefreshCw, ChevronDown, ChevronUp, ShoppingCart
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SeasoningItem {
  id: string;
  name: string;
  category: 'sabores' | 'caramelizadas';
  active: boolean;
  min_quantity_numeric: number | null;
  min_unit: string | null;
  created_at: string;
}

interface SeasoningCount {
  id: string;
  seasoning_item_id: string;
  count_date: string;
  quantity_text: string;
  quantity_numeric: number | null;
  unit: string | null;
  notes: string | null;
  responsible: string | null;
  needs_purchase: boolean;
  purchase_note: string | null;
  created_at: string;
}

interface ItemWithCounts extends SeasoningItem {
  counts: SeasoningCount[];
}

type Status = 'OK' | 'Revisar' | 'Bajo' | 'Comprar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getStatus = (item: ItemWithCounts): Status => {
  const last = item.counts[0];
  if (!last) return 'Revisar';
  if (item.min_quantity_numeric === null) return 'Revisar';
  const qty = last.quantity_numeric;
  if (qty === null) return 'Revisar';
  if (qty <= 0) return 'Comprar';
  if (qty < item.min_quantity_numeric * 0.5) return 'Comprar';
  if (qty < item.min_quantity_numeric) return 'Bajo';
  return 'OK';
};

const STATUS_STYLES: Record<Status, string> = {
  OK:      'bg-green-500/20 text-green-400 border-green-500/30',
  Revisar: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Bajo:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Comprar: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

const today = () => new Date().toISOString().split('T')[0];

// ─── Component ───────────────────────────────────────────────────────────────

export const SeasoningsInventory = () => {
  const [items, setItems] = useState<ItemWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Category filter
  const [activeCategory, setActiveCategory] = useState<'all' | 'sabores' | 'caramelizadas'>('all');

  // Count modal
  const [countTarget, setCountTarget] = useState<ItemWithCounts | null>(null);
  const [countText, setCountText] = useState('');
  const [countNumeric, setCountNumeric] = useState('');
  const [countUnit, setCountUnit] = useState('');
  const [countDate, setCountDate] = useState(today());
  const [countNotes, setCountNotes] = useState('');
  const [countResponsible, setCountResponsible] = useState('');
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState('');
  // 'form' = filling fields, 'purchase' = asking ¿comprar?
  const [countStep, setCountStep] = useState<'form' | 'purchase'>('form');

  // History modal
  const [historyTarget, setHistoryTarget] = useState<ItemWithCounts | null>(null);

  // Collapsed categories
  const [collapsedSabores, setCollapsedSabores] = useState(false);
  const [collapsedCaramelizadas, setCollapsedCaramelizadas] = useState(false);

  // Print
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState('');

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [{ data: itemsData, error: itemsErr }, { data: countsData, error: countsErr }] =
        await Promise.all([
          supabase.from('seasoning_items').select('*').eq('active', true).order('name'),
          supabase
            .from('seasoning_counts')
            .select('*')
            .order('count_date', { ascending: false })
            .order('created_at', { ascending: false }),
        ]);

      if (itemsErr) throw new Error(itemsErr.message);
      if (countsErr) throw new Error(countsErr.message);

      const countsByItem: Record<string, SeasoningCount[]> = {};
      (countsData || []).forEach((c) => {
        if (!countsByItem[c.seasoning_item_id]) countsByItem[c.seasoning_item_id] = [];
        countsByItem[c.seasoning_item_id].push(c);
      });

      const enriched: ItemWithCounts[] = (itemsData || []).map((item) => ({
        ...item,
        counts: countsByItem[item.id] || [],
      }));

      setItems(enriched);
    } catch (e: any) {
      setError(e.message || 'Error al cargar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Save count ─────────────────────────────────────────────────────────────

  // Step 1: validate form → advance to purchase confirmation
  const handleSaveCount = () => {
    if (!countTarget || !countText.trim()) {
      setCountError('La cantidad es obligatoria');
      return;
    }
    setCountError('');
    setCountStep('purchase');
  };

  // Step 2: save to DB with needs_purchase decision
  const handleConfirmPurchase = async (needs: boolean) => {
    if (!countTarget || !supabase) return;
    setCountLoading(true);
    setCountError('');
    try {
      const { error: err } = await supabase.from('seasoning_counts').insert({
        seasoning_item_id: countTarget.id,
        count_date: countDate,
        quantity_text: countText.trim(),
        quantity_numeric: countNumeric ? parseFloat(countNumeric) : null,
        unit: countUnit.trim() || null,
        notes: countNotes.trim() || null,
        responsible: countResponsible.trim() || null,
        needs_purchase: needs,
      });
      if (err) throw new Error(err.message);
      setCountTarget(null);
      setCountStep('form');
      await loadData();
    } catch (e: any) {
      setCountError(e.message);
      setCountStep('form');
    } finally {
      setCountLoading(false);
    }
  };

  const openCountModal = (item: ItemWithCounts) => {
    setCountTarget(item);
    setCountText('');
    setCountNumeric('');
    setCountUnit('');
    setCountDate(today());
    setCountNotes('');
    setCountResponsible('');
    setCountError('');
    setCountStep('form');
  };

  // ── Print via QZ Tray ─────────────────────────────────────────────────────

  const handlePrint = async () => {
    setPrintError('');
    const printerName = getSavedPrinterName();
    if (!printerName) {
      setPrintError('No hay impresora configurada. Configúrala en Punto de Venta → Configuración.');
      return;
    }

    setPrintLoading(true);
    try {
      await connectQZ();

      const now = new Date();
      const ts = now.toLocaleDateString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      }) + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      const sabores = items.filter((i) => i.category === 'sabores');
      const caramelizadas = items.filter((i) => i.category === 'caramelizadas');
      const porComprar = items.filter((i) => i.counts[0]?.needs_purchase === true);

      const SEP  = '--------------------------------\n';
      const THIN = '- - - - - - - - - - - - - - - -\n';
      const NL   = '\n';

      const buildSection = (list: ItemWithCounts[]): string[] => {
        if (list.length === 0) return ['  (sin registros)\n', NL];
        return list.flatMap((item) => {
          const last = item.counts[0];
          const status = last?.needs_purchase ? 'COMPRAR' : getStatus(item);
          const lines: string[] = [
            `${item.name}\n`,
            last ? `  Cant: ${last.quantity_text}\n` : '  Cant: Sin conteo\n',
            last ? `  Fecha: ${fmtDate(last.count_date)}\n` : '',
            `  Estado: ${status}\n`,
            NL,
          ];
          return lines.filter(Boolean);
        });
      };

      const data: string[] = [
        '\x1B\x40',           // ESC @ init
        '\x1B\x61\x01',       // center
        '\x1B\x45\x01',       // bold on
        'CAT CORN\n',
        '\x1B\x45\x00',       // bold off
        'INVENTARIO SABORIZANTES\n',
        `${ts}\n`,
        '\x1B\x61\x00',       // left
        SEP,
        '\x1B\x45\x01',
        'SABORES\n',
        '\x1B\x45\x00',
        THIN,
        ...buildSection(sabores),
        SEP,
        '\x1B\x45\x01',
        'CARAMELIZADAS\n',
        '\x1B\x45\x00',
        THIN,
        ...buildSection(caramelizadas),
        SEP,
        '\x1B\x45\x01',
        'POR COMPRAR\n',
        '\x1B\x45\x00',
        THIN,
        ...(porComprar.length === 0
          ? ['  Sin insumos marcados para compra\n', NL]
          : porComprar.map((item) => {
              const last = item.counts[0];
              return `* ${item.name} - ${last?.quantity_text ?? '?'}\n`;
            })
        ),
        SEP,
        '\n\n\n\n',
        '\x1D\x56\x00',       // GS V 0 — full cut
      ];

      await printRaw(printerName, data);
    } catch (e: any) {
      setPrintError('Error al imprimir: ' + (e?.message ?? String(e)));
    } finally {
      setPrintLoading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const filtered =
    activeCategory === 'all'
      ? items
      : items.filter((i) => i.category === activeCategory);

  const saboresList = filtered.filter((i) => i.category === 'sabores');
  const caramelizadasList = filtered.filter((i) => i.category === 'caramelizadas');

  const renderTable = (list: ItemWithCounts[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left min-w-[640px]">
        <thead className="bg-black/20 text-cc-text-muted text-xs uppercase tracking-wider">
          <tr>
            <th className="p-3">Nombre</th>
            <th className="p-3">Última cantidad</th>
            <th className="p-3">Fecha</th>
            <th className="p-3">Anterior</th>
            <th className="p-3">Fecha ant.</th>
            <th className="p-3">Estado</th>
            <th className="p-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {list.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-8 text-center text-cc-text-muted">
                Sin registros
              </td>
            </tr>
          ) : (
            list.map((item) => {
              const last = item.counts[0];
              const prev = item.counts[1];
              const status = getStatus(item);
              const needsBuy = last?.needs_purchase === true;
              return (
                <tr key={item.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-3">
                    <span className="font-medium text-cc-text-main">{item.name}</span>
                    {needsBuy && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-bold">
                        <ShoppingCart size={10} /> Comprar
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-cc-cream font-semibold">
                    {last ? last.quantity_text : <span className="text-cc-text-muted italic">Sin conteo</span>}
                  </td>
                  <td className="p-3 text-cc-text-muted text-sm">
                    {last ? fmtDate(last.count_date) : '—'}
                  </td>
                  <td className="p-3 text-cc-text-muted text-sm">
                    {prev ? prev.quantity_text : '—'}
                  </td>
                  <td className="p-3 text-cc-text-muted text-sm">
                    {prev ? fmtDate(prev.count_date) : '—'}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_STYLES[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setHistoryTarget(item)}
                        className="p-1.5 hover:bg-white/10 rounded-lg text-cc-text-muted hover:text-cc-cream transition-colors"
                        title="Ver historial"
                      >
                        <Clock size={15} />
                      </button>
                      <button
                        onClick={() => openCountModal(item)}
                        className="px-3 py-1 bg-cc-accent/20 hover:bg-cc-accent/30 border border-cc-accent/30 rounded-lg text-cc-accent text-sm font-medium transition-colors flex items-center gap-1"
                      >
                        <Plus size={13} /> Contar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-cc-cream">Inventario de Saborizantes</h2>
          <p className="text-cc-text-muted text-sm mt-0.5">Control físico de saborizantes por categoría</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={loadData}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-cc-text-main flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={15} /> Actualizar
          </button>
          <button
            onClick={handlePrint}
            disabled={printLoading}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-lg text-sm text-cc-text-main flex items-center gap-2 transition-colors"
          >
            <Printer size={15} /> {printLoading ? 'Imprimiendo...' : 'Imprimir inventario'}
          </button>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-1">
        {(['all', 'sabores', 'caramelizadas'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-t-lg text-sm font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-cc-accent/20 text-cc-accent border-b-2 border-cc-accent'
                : 'text-cc-text-muted hover:text-cc-text-main'
            }`}
          >
            {cat === 'all' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
        {/* Por comprar badge-tab */}
        {(() => {
          const n = items.filter((i) => i.counts[0]?.needs_purchase === true).length;
          return (
            <button
              onClick={() => setActiveCategory('all')}
              className="px-4 py-1.5 rounded-t-lg text-sm font-medium text-orange-400 hover:text-orange-300 flex items-center gap-1.5 transition-colors"
              title="Filtro rápido — desplázate a la sección Por comprar"
            >
              <ShoppingCart size={14} />
              Por comprar
              {n > 0 && (
                <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 font-bold">{n}</span>
              )}
            </button>
          );
        })()}
      </div>

      {/* Load error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Print error */}
      {printError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{printError}</p>
          <button onClick={() => setPrintError('')} className="ml-auto text-red-400 hover:text-red-300"><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-cc-text-muted">Cargando saborizantes...</div>
      ) : (
        <>
          {/* SABORES */}
          {(activeCategory === 'all' || activeCategory === 'sabores') && (
            <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
              <button
                className="w-full flex items-center justify-between bg-black/30 px-6 py-4 border-b border-white/5 hover:bg-black/40 transition-colors"
                onClick={() => setCollapsedSabores((v) => !v)}
              >
                <h3 className="text-base font-semibold text-cc-cream uppercase tracking-wide">
                  Sabores <span className="ml-2 text-cc-text-muted font-normal text-sm normal-case">({saboresList.length})</span>
                </h3>
                {collapsedSabores ? <ChevronDown size={18} className="text-cc-text-muted" /> : <ChevronUp size={18} className="text-cc-text-muted" />}
              </button>
              {!collapsedSabores && renderTable(saboresList)}
            </div>
          )}

          {/* CARAMELIZADAS */}
          {(activeCategory === 'all' || activeCategory === 'caramelizadas') && (
            <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
              <button
                className="w-full flex items-center justify-between bg-black/30 px-6 py-4 border-b border-white/5 hover:bg-black/40 transition-colors"
                onClick={() => setCollapsedCaramelizadas((v) => !v)}
              >
                <h3 className="text-base font-semibold text-cc-cream uppercase tracking-wide">
                  Caramelizadas <span className="ml-2 text-cc-text-muted font-normal text-sm normal-case">({caramelizadasList.length})</span>
                </h3>
                {collapsedCaramelizadas ? <ChevronDown size={18} className="text-cc-text-muted" /> : <ChevronUp size={18} className="text-cc-text-muted" />}
              </button>
              {!collapsedCaramelizadas && renderTable(caramelizadasList)}
            </div>
          )}

          {/* POR COMPRAR */}
          {activeCategory === 'all' && (() => {
            const list = items.filter((i) => i.counts[0]?.needs_purchase === true);
            return (
              <div className="bg-cc-surface rounded-xl border border-orange-500/20 overflow-hidden">
                <div className="flex items-center gap-3 bg-orange-500/10 px-6 py-4 border-b border-orange-500/20">
                  <ShoppingCart size={18} className="text-orange-400" />
                  <h3 className="text-base font-semibold text-orange-300 uppercase tracking-wide">
                    Por comprar
                  </h3>
                  <span className="ml-1 text-orange-400/70 font-normal text-sm normal-case">({list.length})</span>
                </div>
                {list.length === 0 ? (
                  <p className="p-6 text-cc-text-muted text-sm text-center">Sin insumos marcados para compra</p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {list.map((item) => {
                      const last = item.counts[0];
                      return (
                        <li key={item.id} className="flex items-center justify-between px-6 py-3 hover:bg-white/5">
                          <div>
                            <span className="font-medium text-cc-text-main">{item.name}</span>
                            <span className="ml-2 text-cc-text-muted text-xs capitalize">{item.category}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-cc-cream text-sm">{last?.quantity_text}</span>
                            <span className="ml-2 text-cc-text-muted text-xs">{last ? fmtDate(last.count_date) : ''}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* ── COUNT MODAL ───────────────────────────────────────────────────── */}
      {countTarget && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="text-lg font-semibold text-[#f4c542]">
                  {countStep === 'form' ? 'Registrar conteo' : '¿Se debe comprar?'}
                </h3>
                <p className="text-cc-text-muted text-sm mt-0.5">{countTarget.name}</p>
              </div>
              <button
                onClick={() => { setCountTarget(null); setCountStep('form'); }}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* ── STEP 1: form ── */}
            {countStep === 'form' && (
              <div className="space-y-4">
                {countError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-sm">{countError}</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Cantidad <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={countText}
                    onChange={(e) => setCountText(e.target.value)}
                    placeholder='Ej: Medio bote, 1 kilo + 800gr, 500gr'
                    className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                    autoFocus
                  />
                  <p className="text-cc-text-muted text-xs mt-1">Texto libre — escribe como lo mides</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Cantidad numérica (opcional)</label>
                    <input
                      type="number" step="any" value={countNumeric}
                      onChange={(e) => setCountNumeric(e.target.value)}
                      placeholder='500'
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Unidad</label>
                    <input
                      type="text" value={countUnit}
                      onChange={(e) => setCountUnit(e.target.value)}
                      placeholder='g, kg, bote'
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Fecha del conteo</label>
                  <input
                    type="date" value={countDate}
                    onChange={(e) => setCountDate(e.target.value)}
                    className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Responsable (opcional)</label>
                  <input
                    type="text" value={countResponsible}
                    onChange={(e) => setCountResponsible(e.target.value)}
                    placeholder='Nombre de quien contó'
                    className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Notas (opcional)</label>
                  <textarea
                    value={countNotes}
                    onChange={(e) => setCountNotes(e.target.value)}
                    placeholder='Observaciones...'
                    rows={2}
                    className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none resize-none"
                  />
                </div>
                <button
                  onClick={handleSaveCount}
                  className="w-full px-4 py-2.5 bg-[#b08d57] hover:bg-[#c49d67] rounded-lg text-white font-semibold transition-colors"
                >
                  Guardar conteo
                </button>
              </div>
            )}

            {/* ── STEP 2: purchase confirmation ── */}
            {countStep === 'purchase' && (
              <div className="space-y-5">
                {countError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-sm">{countError}</p>
                  </div>
                )}

                {/* Summary */}
                <div className="bg-black/30 rounded-lg p-4 border border-white/10 space-y-1.5">
                  <p className="text-cc-text-muted text-xs uppercase tracking-wide mb-2">Conteo a guardar</p>
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted text-sm">Cantidad:</span>
                    <span className="text-cc-cream font-semibold text-sm">{countText}{countUnit ? ' ' + countUnit : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted text-sm">Fecha:</span>
                    <span className="text-cc-text-main text-sm">{fmtDate(countDate)}</span>
                  </div>
                </div>

                <div className="text-center">
                  <ShoppingCart size={32} className="text-orange-400 mx-auto mb-3" />
                  <p className="text-cc-text-main font-medium">¿Este insumo se debe comprar?</p>
                  <p className="text-cc-text-muted text-sm mt-1">El conteo se guarda en ambos casos.</p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleConfirmPurchase(true)}
                    disabled={countLoading}
                    className="flex-1 px-4 py-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 rounded-lg text-orange-300 font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <ShoppingCart size={16} />
                    {countLoading ? 'Guardando...' : 'Sí, agregar a lista'}
                  </button>
                  <button
                    onClick={() => handleConfirmPurchase(false)}
                    disabled={countLoading}
                    className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-cc-text-main font-semibold transition-colors disabled:opacity-50"
                  >
                    No
                  </button>
                </div>

                <button
                  onClick={() => setCountStep('form')}
                  disabled={countLoading}
                  className="w-full text-cc-text-muted text-sm hover:text-cc-text-main transition-colors"
                >
                  ← Volver al conteo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY MODAL ────────────────────────────────────────────────── */}
      {historyTarget && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center mb-5 flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-[#f4c542]">Historial de conteos</h3>
                <p className="text-cc-text-muted text-sm mt-0.5">{historyTarget.name}</p>
              </div>
              <button onClick={() => setHistoryTarget(null)} className="text-zinc-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {historyTarget.counts.length === 0 ? (
                <p className="text-cc-text-muted text-sm text-center py-8">Sin conteos registrados aún</p>
              ) : (
                historyTarget.counts.map((c, idx) => (
                  <div
                    key={c.id}
                    className={`rounded-lg p-3 border ${idx === 0 ? 'border-[#b08d57]/40 bg-[#b08d57]/10' : 'border-white/5 bg-black/20'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-cc-cream font-semibold text-sm">{c.quantity_text}</span>
                        {c.unit && (
                          <span className="ml-1 text-cc-text-muted text-xs">{c.unit}</span>
                        )}
                        {idx === 0 && (
                          <span className="ml-2 text-xs bg-cc-accent/20 text-cc-accent px-1.5 py-0.5 rounded-full border border-cc-accent/30 font-medium">
                            Más reciente
                          </span>
                        )}
                      </div>
                      <span className="text-cc-text-muted text-xs whitespace-nowrap">{fmtDate(c.count_date)}</span>
                    </div>
                    {c.responsible && (
                      <p className="text-cc-text-muted text-xs mt-1">👤 {c.responsible}</p>
                    )}
                    {c.notes && (
                      <p className="text-cc-text-muted text-xs mt-1 italic">📝 {c.notes}</p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex-shrink-0 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => {
                  setHistoryTarget(null);
                  openCountModal(historyTarget);
                }}
                className="w-full px-4 py-2 bg-cc-accent/20 hover:bg-cc-accent/30 border border-cc-accent/30 rounded-lg text-cc-accent text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={15} /> Registrar nuevo conteo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
