import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Barcode, CheckCircle2, Printer } from 'lucide-react';
import { CommercialDeliveryLabelPrintError, printCommercialDeliveryLabelTest, printCommercialDeliveryUnitLabels } from '../../lib/printReceipt';
import { getSavedCommercialDeliveryLabelPrinterName } from '../../lib/qzService';
import {
  CommercialDeliverySourceType,
  CommercialDeliveryUnit,
  listCommercialDeliveryUnits,
  markCommercialDeliveryUnitsPrinted,
  scanCommercialDeliveryUnitForRelease,
} from '../../services/commercialDeliveryUnitService';
import CommercialDeliveryLabelPrinterSettings from './CommercialDeliveryLabelPrinterSettings';

interface Props {
  partnerId: string;
  sourceType?: CommercialDeliverySourceType;
  onReleased?: () => void;
  refreshKey?: number;
}

const STATUS: Record<CommercialDeliveryUnit['status'], string> = {
  generated: 'Pendiente de impresión', printed: 'Pendiente de liberación', scanned: 'Escaneada',
  released: 'Liberada', returned_good: 'Devuelta en buen estado', spoiled: 'Mermada', voided: 'Anulada', replaced: 'Reemplazada',
};

export default function CommercialDeliveryUnitsPanel({ partnerId, sourceType, onReleased, refreshKey }: Props) {
  const [units, setUnits] = useState<CommercialDeliveryUnit[]>([]);
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { setUnits(await listCommercialDeliveryUnits(partnerId, sourceType)); }
    catch (err: any) { setError(err.message || 'No se pudieron cargar las etiquetas.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [partnerId, sourceType, refreshKey]);

  const pendingPrint = useMemo(() => units.filter(unit => unit.status === 'generated'), [units]);
  // The server accepts one source per atomic print confirmation. Do not mix
  // independent deliveries when a partner has more than one pending batch.
  const nextPrintBatch = useMemo(() => {
    const first = pendingPrint[0];
    if (!first) return [];
    const sourceId = first.movement_id || first.wholesale_order_id;
    return pendingPrint.filter(unit => unit.source_type === first.source_type
      && (unit.movement_id || unit.wholesale_order_id) === sourceId);
  }, [pendingPrint]);
  const progress = useMemo(() => ({
    scanned: units.filter(unit => unit.status === 'scanned' || unit.status === 'released').length,
    total: units.filter(unit => !['voided', 'replaced'].includes(unit.status)).length,
  }), [units]);
  const visible = useMemo(() => units.filter(unit => !query || [unit.scan_code, unit.barcode_value, unit.product_name, unit.product_variant, unit.product_size]
    .filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())), [units, query]);

  const labelData = (unit: CommercialDeliveryUnit) => ({
    unitId: unit.id,
    scanCode: unit.scan_code,
    partnerName: unit.commercial_partners?.business_name || unit.commercial_partners?.responsible_name || 'Socio comercial',
    productName: unit.product_name,
    variant: unit.product_variant,
    size: unit.product_size,
    sourceLabel: unit.source_type === 'comodato' ? 'COMODATO' : 'MAYOREO',
    deliveryDate: unit.commercial_partner_movements?.movement_date
      || unit.wholesale_orders?.delivery_date
      || unit.wholesale_orders?.order_date
      || unit.generated_at,
  });

  const registerAcceptedPrints = async (unitIds: string[], reason?: string) => {
    if (unitIds.length === 0) return;
    await markCommercialDeliveryUnitsPrinted(unitIds, reason);
    await load();
  };

  const printPending = async () => {
    if (!nextPrintBatch.length) return;
    if (!getSavedCommercialDeliveryLabelPrinterName()) {
      setError('Configura una impresora de etiquetas B2B antes de imprimir.');
      setPrinterSettingsOpen(true);
      return;
    }
    setPrinting(true); setError(null); setMessage(null);
    try {
      setMessage(`Preparando ${nextPrintBatch.length} etiquetas…`);
      const acceptedIds = await printCommercialDeliveryUnitLabels(nextPrintBatch.map(labelData));
      setMessage(`Enviando ${acceptedIds.length} etiquetas a la impresora B2B…`);
      await registerAcceptedPrints(acceptedIds);
      setMessage(`${acceptedIds.length} etiquetas aceptadas por QZ Tray.`);
      inputRef.current?.focus();
    } catch (err: any) {
      if (err instanceof CommercialDeliveryLabelPrintError && err.acceptedUnitIds.length > 0) {
        try {
          await registerAcceptedPrints(err.acceptedUnitIds);
          setError(`${err.message} Se registraron únicamente las ${err.acceptedUnitIds.length} etiquetas aceptadas; las demás siguen pendientes.`);
        } catch (markError: any) {
          setError(`${err.message} Además, no se pudo registrar las etiquetas aceptadas: ${markError.message || markError}`);
        }
      } else setError(err.message || 'No se pudo imprimir las etiquetas.');
    }
    finally { setPrinting(false); }
  };

  const reprint = async (unit: CommercialDeliveryUnit) => {
    if (!getSavedCommercialDeliveryLabelPrinterName()) {
      setError('Configura una impresora de etiquetas B2B antes de reimprimir.');
      setPrinterSettingsOpen(true);
      return;
    }
    const reason = window.prompt('Motivo de reimpresión (obligatorio):');
    if (!reason?.trim()) return;
    setPrinting(true); setError(null); setMessage(null);
    try {
      setMessage('Preparando 1 etiqueta…');
      const acceptedIds = await printCommercialDeliveryUnitLabels([labelData(unit)]);
      await registerAcceptedPrints(acceptedIds, reason);
      setMessage(`Etiqueta ${unit.scan_code} aceptada por QZ Tray y registrada como reimpresión.`); inputRef.current?.focus();
    } catch (err: any) {
      if (err instanceof CommercialDeliveryLabelPrintError && err.acceptedUnitIds.length > 0) {
        try {
          await registerAcceptedPrints(err.acceptedUnitIds, reason);
          setError(`${err.message} La etiqueta aceptada sí quedó registrada como reimpresión.`);
        } catch (markError: any) { setError(`${err.message} Además, no se pudo registrar la reimpresión: ${markError.message || markError}`); }
      } else setError(err.message || 'No se pudo reimprimir la etiqueta.');
    }
    finally { setPrinting(false); }
  };

  const printTest = async () => {
    if (!getSavedCommercialDeliveryLabelPrinterName()) {
      setError('Configura una impresora de etiquetas B2B antes de imprimir la prueba.');
      setPrinterSettingsOpen(true);
      return;
    }
    setPrinting(true); setError(null); setMessage('Preparando etiqueta de prueba…');
    try {
      await printCommercialDeliveryLabelTest();
      setMessage('Etiqueta de prueba aceptada por QZ Tray. No se modificó ninguna unidad.');
    } catch (err: any) { setError(err.message || 'No se pudo imprimir la etiqueta de prueba.'); }
    finally { setPrinting(false); }
  };

  const scan = async (event: FormEvent) => {
    event.preventDefault();
    if (!barcode.trim()) return;
    setError(null); setMessage(null);
    try {
      const result = await scanCommercialDeliveryUnitForRelease(barcode, partnerId);
      setMessage(result.released ? 'Entrega liberada correctamente.' : `Escaneo confirmado: ${result.scanned} / ${result.total}.`);
      setBarcode(''); await load(); inputRef.current?.focus();
      if (result.released) onReleased?.();
    } catch (err: any) { setError(err.message || 'No se pudo liberar la bolsa.'); inputRef.current?.focus(); }
  };

  return <section className="space-y-3">
    <CommercialDeliveryLabelPrinterSettings
      open={printerSettingsOpen}
      onOpenChange={setPrinterSettingsOpen}
      onConfigured={() => setError(null)}
    />
    <div className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-4 flex flex-wrap justify-between gap-3">
      <div><p className="text-sm font-bold text-[#111111]">Etiquetas de entrega</p><p className="text-xs text-[#6b5c40]">Escaneadas / total: <strong>{progress.scanned} / {progress.total}</strong></p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void printTest()} disabled={printing} className="flex items-center gap-2 rounded-lg border border-[#a87820] bg-white px-3 py-2 text-xs font-semibold text-[#4a2c0a] disabled:opacity-50"><Printer size={15} />Imprimir etiqueta de prueba</button><button type="button" onClick={printPending} disabled={!nextPrintBatch.length || printing} className="flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-800 disabled:opacity-50"><Printer size={15} />{printing ? 'Imprimiendo…' : `Imprimir siguiente entrega (${nextPrintBatch.length})`}</button></div>
    </div>
    <form onSubmit={scan} className="rounded-xl border border-[#c49330] bg-[#D6A23A] p-4">
      <label className="mb-1 block text-xs font-bold text-[#111111]">Escanear etiqueta de la bolsa</label>
      <div className="flex gap-2"><input ref={inputRef} autoFocus value={barcode} onChange={event => setBarcode(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#a87820] bg-white px-3 py-2 font-mono text-sm text-[#111111]" placeholder="1234 5678 9012 3456" /><button className="rounded-lg bg-[#2d1a00] px-4 py-2 text-xs font-bold text-white"><Barcode size={15} className="inline mr-1" />Liberar</button></div>
    </form>
    {message && <p className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} />{message}</p>}
    {error && <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={16} />{error}</p>}
    <input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-[#c49330] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Buscar por código, identificador o producto" />
  {loading ? <p className="text-sm text-[#6b5c40]">Cargando etiquetas…</p> : <div className="space-y-2">{visible.map(unit => <article key={unit.id} className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-3 text-sm"><div className="flex justify-between gap-2"><div><p className="font-mono font-bold text-[#111111]">{unit.scan_code || unit.barcode_value}</p><p className="font-semibold text-[#111111]">{unit.product_name}{unit.product_variant ? ` — ${unit.product_variant}` : ''}</p><p className="text-xs text-[#6b5c40]">{unit.product_size || '—'} · {unit.source_type === 'comodato' ? 'Comodato' : 'Mayoreo'}</p></div><span className="h-fit rounded-full bg-white px-2 py-1 text-xs font-medium text-[#4a2c0a]">{STATUS[unit.status]}</span></div><div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-[#6b5c40]">Impresiones: {unit.print_count} · Liberación: {unit.released_at ? new Date(unit.released_at).toLocaleString('es-MX') : '—'}{unit.status === 'returned_good' ? ` · Retiro: ${unit.returned_good_at ? new Date(unit.returned_good_at).toLocaleString('es-MX') : '—'}` : ''}</p>{unit.status === 'printed' && <button type="button" disabled={printing} onClick={() => void reprint(unit)} className="text-xs font-semibold text-purple-800 underline">Reimprimir</button>}</div></article>)}</div>}
  </section>;
}
