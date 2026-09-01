import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Barcode, CheckCircle2, Printer, X } from 'lucide-react';
import { printCommercialDeliveryLabelTest, printCommercialDeliveryUnitLabels, renderCommercialDeliveryLabel } from '../../lib/printReceipt';
import { getSavedCommercialDeliveryLabelPrinterName } from '../../lib/qzService';
import {
  adminCancelCommercialDelivery,
  adminForceReleaseCommercialDelivery,
  CommercialDeliverySourceType,
  CommercialDeliveryUnit,
  listCommercialDeliveryUnits,
  markCommercialDeliveryUnitsPrinted,
  scanCommercialDeliveryUnitForRelease,
} from '../../services/commercialDeliveryUnitService';
import { useAuth } from '../../contexts/AuthContext';
import { verifyFinancialAccessPassword } from '../../lib/financialAccessPassword';
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

type DeliveryGroup = {
  id: string;
  sourceType: CommercialDeliverySourceType;
  sourceStatus: string;
  deliveryDate: string;
  units: CommercialDeliveryUnit[];
};

type AdminAction = { kind: 'release' | 'cancel'; delivery: DeliveryGroup } | null;

export default function CommercialDeliveryUnitsPanel({ partnerId, sourceType, onReleased, refreshKey }: Props) {
  const { isAdmin } = useAuth();
  const [units, setUnits] = useState<CommercialDeliveryUnit[]>([]);
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction>(null);
  const [adminReason, setAdminReason] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [adminProcessing, setAdminProcessing] = useState(false);
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
  const deliveries = useMemo(() => {
    const groups = new Map<string, DeliveryGroup>();
    for (const unit of units) {
      const id = unit.movement_id || unit.wholesale_order_id;
      if (!id) continue;
      const sourceStatus = unit.source_type === 'comodato'
        ? unit.commercial_partner_movements?.status || 'unknown'
        : unit.wholesale_orders?.order_status || 'unknown';
      const deliveryDate = unit.source_type === 'comodato'
        ? unit.commercial_partner_movements?.movement_date || unit.generated_at
        : unit.wholesale_orders?.order_date || unit.generated_at;
      const key = `${unit.source_type}:${id}`;
      const current = groups.get(key);
      if (current) current.units.push(unit);
      else groups.set(key, { id, sourceType: unit.source_type, sourceStatus, deliveryDate, units: [unit] });
    }
    const normalizedQuery = query.trim().toLowerCase();
    return [...groups.values()].filter(delivery => !normalizedQuery || delivery.units.some(unit =>
      [unit.scan_code, unit.product_name, unit.product_variant, unit.product_size]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)));
  }, [units, query]);

  const labelData = (unit: CommercialDeliveryUnit) => ({
    unitId: unit.id,
    scanCode: unit.scan_code,
    partnerName: unit.commercial_partners?.business_name || unit.commercial_partners?.responsible_name || 'Socio comercial',
    productName: unit.product_name,
    variant: unit.product_variant,
    size: unit.product_size,
    sourceLabel: unit.source_type === 'comodato' ? 'COMODATO' : 'MAYOREO',
    deliveryDate: unit.generated_at,
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
    } catch (err: any) { setError(err.message || 'No se pudo imprimir las etiquetas.'); }
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
    } catch (err: any) { setError(err.message || 'No se pudo reimprimir la etiqueta.'); }
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

  const openLabelPreview = () => {
    const sample = nextPrintBatch[0];
    try {
      const rendered = sample
        ? renderCommercialDeliveryLabel(labelData(sample))
        : renderCommercialDeliveryLabel({
          unitId: 'vista-previa',
          scanCode: '1234567890123456',
          partnerName: 'SOCIO DE PRUEBA',
          productName: 'ETIQUETA DE PRUEBA',
          variant: '50 × 30 mm',
          size: '400 × 240 px',
          sourceLabel: 'COMODATO',
          deliveryDate: new Date().toISOString().slice(0, 10),
        });
      setError(null);
      setPreviewImage(rendered.previewImageDataUrl);
    } catch (err: any) {
      setError(err.message || 'No se pudo generar la vista previa de la etiqueta.');
    }
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

  const openAdminAction = (kind: NonNullable<AdminAction>['kind'], delivery: DeliveryGroup) => {
    setAdminReason('');
    setAdminPassword('');
    setAdminConfirmed(false);
    setAdminAction({ kind, delivery });
  };

  const closeAdminAction = () => {
    setAdminPassword('');
    setAdminReason('');
    setAdminConfirmed(false);
    setAdminAction(null);
  };

  const runAdminAction = async () => {
    if (!adminAction || adminReason.trim().length < 10 || !adminConfirmed || !adminPassword) return;
    setAdminProcessing(true); setError(null); setMessage(null);
    try {
      const verification = await verifyFinancialAccessPassword(adminPassword);
      setAdminPassword('');
      if (verification.status !== 'verified') {
        throw new Error(verification.status === 'invalid'
          ? 'Contraseña administrativa incorrecta'
          : verification.errorMessage);
      }
      const args = {
        sourceType: adminAction.delivery.sourceType,
        sourceId: adminAction.delivery.id,
        reason: adminReason,
      };
      const result = adminAction.kind === 'release'
        ? await adminForceReleaseCommercialDelivery(args)
        : await adminCancelCommercialDelivery(args);
      setMessage(adminAction.kind === 'release'
        ? `Entrega liberada administrativamente: ${result.released_units} bolsas.`
        : `Entrega cancelada: ${result.voided_units} etiquetas anuladas sin borrar historial.`);
      closeAdminAction();
      await load();
      onReleased?.();
    } catch (err: any) {
      setError(err.message || 'No se pudo completar la acción administrativa.');
    } finally {
      setAdminPassword('');
      setAdminProcessing(false);
    }
  };

  return <section className="space-y-3">
    <CommercialDeliveryLabelPrinterSettings
      open={printerSettingsOpen}
      onOpenChange={setPrinterSettingsOpen}
      onConfigured={() => setError(null)}
    />
    {adminAction && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !adminProcessing && closeAdminAction()}>
      <div className="w-full max-w-lg rounded-xl border border-red-300 bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="font-bold text-[#111111]">{adminAction.kind === 'release' ? 'Liberación administrativa' : 'Cancelar entrega'}</h3><p className="mt-1 text-xs text-[#6b5c40]">{adminAction.delivery.sourceType === 'comodato' ? 'Comodato' : 'Mayoreo'} · {adminAction.delivery.units.length} bolsas</p></div><button type="button" disabled={adminProcessing} onClick={closeAdminAction} aria-label="Cerrar" className="text-[#4a2c0a]"><X size={18} /></button></div>
        {adminAction.kind === 'release' ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Esta excepción libera las bolsas pendientes sin los escaneos faltantes. Escaneadas: <strong>{adminAction.delivery.units.filter(unit => unit.status === 'scanned').length}</strong>. Omitidas: <strong>{adminAction.delivery.units.filter(unit => ['generated', 'printed'].includes(unit.status)).length}</strong>.</p> : <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">La entrega y sus etiquetas se conservarán para auditoría; no se eliminará ningún historial.</p>}
        <label className="mt-4 block text-xs font-bold text-[#111111]">Motivo obligatorio (mínimo 10 caracteres)</label>
        <textarea value={adminReason} onChange={event => setAdminReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[#c49330] p-2 text-sm" placeholder="Describe la autorización excepcional…" />
        <label className="mt-3 block text-xs font-bold text-[#111111]">Contraseña administrativa</label>
        <input type="password" autoComplete="current-password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-[#c49330] p-2 text-sm" />
        <label className="mt-3 flex items-start gap-2 text-xs text-[#4a2c0a]"><input type="checkbox" checked={adminConfirmed} onChange={event => setAdminConfirmed(event.target.checked)} />Confirmo esta acción administrativa y su auditoría permanente.</label>
        <button type="button" disabled={adminProcessing || !adminConfirmed || adminReason.trim().length < 10 || !adminPassword} onClick={() => void runAdminAction()} className={`mt-4 w-full rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${adminAction.kind === 'release' ? 'bg-amber-700 hover:bg-amber-800' : 'bg-red-700 hover:bg-red-800'}`}>{adminProcessing ? 'Procesando…' : adminAction.kind === 'release' ? 'Confirmar liberación administrativa' : 'Cancelar entrega'}</button>
      </div>
    </div>}
    {previewImage && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewImage(null)}>
      <div className="w-full max-w-[440px] rounded-xl border border-[#c49330] bg-[#fff8e6] p-4 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-bold text-[#111111]">Vista previa de etiqueta</h3><p className="text-xs text-[#6b5c40]">400 × 240 px · no imprime ni modifica datos</p></div><button type="button" onClick={() => setPreviewImage(null)} aria-label="Cerrar vista previa" className="text-[#4a2c0a]"><X size={18} /></button></div>
        <img src={previewImage} width={400} height={240} alt="Vista previa de etiqueta B2B" className="mx-auto block h-auto max-w-full border border-[#c49330] bg-white" />
      </div>
    </div>}
    <div className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-4 flex flex-wrap justify-between gap-3">
      <div><p className="text-sm font-bold text-[#111111]">Etiquetas de entrega</p><p className="text-xs text-[#6b5c40]">Escaneadas / total: <strong>{progress.scanned} / {progress.total}</strong></p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={openLabelPreview} disabled={printing} className="flex items-center gap-2 rounded-lg border border-[#a87820] bg-white px-3 py-2 text-xs font-semibold text-[#4a2c0a] disabled:opacity-50"><Barcode size={15} />Vista previa de etiqueta</button><button type="button" onClick={() => void printTest()} disabled={printing} className="flex items-center gap-2 rounded-lg border border-[#a87820] bg-white px-3 py-2 text-xs font-semibold text-[#4a2c0a] disabled:opacity-50"><Printer size={15} />Imprimir etiqueta de prueba</button><button type="button" onClick={printPending} disabled={!nextPrintBatch.length || printing} className="flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-800 disabled:opacity-50"><Printer size={15} />{printing ? 'Imprimiendo…' : `Imprimir siguiente entrega (${nextPrintBatch.length})`}</button></div>
    </div>
    <form onSubmit={scan} className="rounded-xl border border-[#c49330] bg-[#D6A23A] p-4">
      <label className="mb-1 block text-xs font-bold text-[#111111]">Escanear etiqueta de la bolsa</label>
      <div className="flex gap-2"><input ref={inputRef} autoFocus value={barcode} onChange={event => setBarcode(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#a87820] bg-white px-3 py-2 font-mono text-sm text-[#111111]" placeholder="1234 5678 9012 3456" /><button className="rounded-lg bg-[#2d1a00] px-4 py-2 text-xs font-bold text-white"><Barcode size={15} className="inline mr-1" />Liberar</button></div>
    </form>
    {message && <p className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} />{message}</p>}
    {error && <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={16} />{error}</p>}
    <input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-[#c49330] bg-white px-3 py-2 text-sm text-[#111111]" placeholder="Buscar por código, identificador o producto" />
  {loading ? <p className="text-sm text-[#6b5c40]">Cargando etiquetas…</p> : <div className="space-y-3">{deliveries.map(delivery => {
    const printed = delivery.units.filter(unit => unit.print_count > 0).length;
    const scanned = delivery.units.filter(unit => unit.status === 'scanned').length;
    const pending = delivery.units.filter(unit => ['generated', 'printed'].includes(unit.status)).length;
    const canAdminister = isAdmin && delivery.sourceStatus === 'pending_release';
    return <section key={`${delivery.sourceType}:${delivery.id}`} className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-[#111111]">{delivery.sourceType === 'comodato' ? 'Entrega Comodato' : 'Pedido Mayoreo'}</p><p className="text-xs text-[#6b5c40]">{new Date(delivery.deliveryDate).toLocaleDateString('es-MX')} · Estado: <strong>{delivery.sourceStatus}</strong></p><p className="mt-1 text-xs text-[#4a2c0a]">{delivery.units.length} bolsas · {printed} impresas · {scanned} escaneadas · {pending} pendientes</p></div>{canAdminister && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => openAdminAction('release', delivery)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800">Liberación administrativa</button><button type="button" onClick={() => openAdminAction('cancel', delivery)} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800">Cancelar entrega</button></div>}</div>
      <div className="mt-3 space-y-2">{delivery.units.map(unit => <article key={unit.id} className="rounded-lg border border-[#dec27f] bg-white p-3 text-sm"><div className="flex justify-between gap-2"><div><p className="font-mono font-bold text-[#111111]">{unit.scan_code}</p><p className="font-semibold text-[#111111]">{unit.product_name}{unit.product_variant ? ` — ${unit.product_variant}` : ''}</p><p className="text-xs text-[#6b5c40]">{unit.product_size || '—'} · {unit.source_type === 'comodato' ? 'Comodato' : 'Mayoreo'}</p></div><span className="h-fit rounded-full bg-[#fff8e6] px-2 py-1 text-xs font-medium text-[#4a2c0a]">{STATUS[unit.status]}</span></div><div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-[#6b5c40]">Impresiones: {unit.print_count} · Liberación: {unit.released_at ? new Date(unit.released_at).toLocaleString('es-MX') : '—'}{unit.status === 'returned_good' ? ` · Retiro: ${unit.returned_good_at ? new Date(unit.returned_good_at).toLocaleString('es-MX') : '—'}` : ''}</p>{unit.status === 'printed' && <button type="button" disabled={printing} onClick={() => void reprint(unit)} className="text-xs font-semibold text-purple-800 underline">Reimprimir</button>}</div></article>)}</div>
    </section>;
  })}</div>}
  </section>;
}
