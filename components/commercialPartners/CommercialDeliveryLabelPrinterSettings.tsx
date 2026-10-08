import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Printer, Search, Settings, X } from 'lucide-react';
import {
  getSavedCommercialDeliveryLabelPrinterName,
  isQZConnected,
  listPrinters,
  saveCommercialDeliveryLabelPrinterName,
} from '../../lib/qzService';
import {
  DEFAULT_LABEL_ALIGNMENT,
  DEFAULT_BARCODE_SIZE_ID,
  DEFAULT_LABEL_OFFSET_MM,
  isYichipLabelPrinter,
  LABEL_SIZE_CATALOG,
  LABEL_OFFSET_STEP_MM,
  BARCODE_SIZE_CATALOG,
  BarcodeSizeId,
  LabelSizeId,
  LabelHorizontalAlignment,
  MAX_LABEL_OFFSET_MM,
  MIN_LABEL_OFFSET_MM,
  resolveHorizontalPlacement,
  resolveLabelPrinterProfile,
  resolveLabelSize,
  saveLabelPrinterProfile,
} from '../../lib/commercialLabelSize';
import { printCommercialDeliveryAlignmentTest } from '../../lib/printReceipt';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured?: () => void;
}

const qzUnavailableMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /unable to connect|websocket|connection/i.test(message)
    ? 'QZ Tray no está ejecutándose. Ábrelo e intenta de nuevo.'
    : `No se pudo conectar con QZ Tray: ${message}`;
};

/** Independent, browser-local printer selection for B2B barcode labels. */
export default function CommercialDeliveryLabelPrinterSettings({ open, onOpenChange, onConfigured }: Props) {
  const [savedPrinter, setSavedPrinter] = useState(() => getSavedCommercialDeliveryLabelPrinterName() || '');
  const [selectedPrinter, setSelectedPrinter] = useState(savedPrinter);
  const [selectedSizeId, setSelectedSizeId] = useState<LabelSizeId | ''>(() => (
    savedPrinter && isYichipLabelPrinter(savedPrinter)
      ? resolveLabelPrinterProfile(savedPrinter).sizeId
      : ''
  ));
  const [horizontalAlignment, setHorizontalAlignment] = useState<LabelHorizontalAlignment>(DEFAULT_LABEL_ALIGNMENT);
  const [horizontalOffsetMm, setHorizontalOffsetMm] = useState(DEFAULT_LABEL_OFFSET_MM);
  const [barcodeSizeId, setBarcodeSizeId] = useState<BarcodeSizeId>(DEFAULT_BARCODE_SIZE_ID);
  const [testingAlignment, setTestingAlignment] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectPrinters = async (printerToCheck = getSavedCommercialDeliveryLabelPrinterName() || '') => {
    setDetecting(true);
    setError(null);
    try {
      const found = await listPrinters();
      setPrinters(found);
      setDetected(true);
      if (printerToCheck && !found.includes(printerToCheck)) {
        setError(`La impresora guardada "${printerToCheck}" no está disponible en QZ Tray.`);
      }
    } catch (err) {
      setDetected(false);
      setError(qzUnavailableMessage(err));
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    void detectPrinters();
  }, []);

  useEffect(() => {
    if (!open) return;
    const configuredPrinter = getSavedCommercialDeliveryLabelPrinterName() || '';
    setSavedPrinter(configuredPrinter);
    setSelectedPrinter(configuredPrinter);
    const profile = configuredPrinter && isYichipLabelPrinter(configuredPrinter)
      ? resolveLabelPrinterProfile(configuredPrinter)
      : null;
    setSelectedSizeId(profile?.sizeId ?? '');
    setHorizontalAlignment(profile?.horizontalAlignment ?? DEFAULT_LABEL_ALIGNMENT);
    setHorizontalOffsetMm(profile?.horizontalOffsetMm ?? DEFAULT_LABEL_OFFSET_MM);
    setBarcodeSizeId(profile?.barcodeSizeId ?? DEFAULT_BARCODE_SIZE_ID);
    setTestMessage(null);
    void detectPrinters(configuredPrinter);
  }, [open]);

  const selectPrinter = (printer: string) => {
    setSelectedPrinter(printer);
    const profile = isYichipLabelPrinter(printer) ? resolveLabelPrinterProfile(printer) : null;
    setSelectedSizeId(profile?.sizeId ?? '');
    setHorizontalAlignment(profile?.horizontalAlignment ?? DEFAULT_LABEL_ALIGNMENT);
    setHorizontalOffsetMm(profile?.horizontalOffsetMm ?? DEFAULT_LABEL_OFFSET_MM);
    setBarcodeSizeId(profile?.barcodeSizeId ?? DEFAULT_BARCODE_SIZE_ID);
    setError(null);
    setTestMessage(null);
  };

  const saveSelection = () => {
    if (!selectedPrinter) {
      setError('Selecciona una impresora de etiquetas B2B antes de guardar.');
      return;
    }
    if (!detected) {
      setError('Detecta las impresoras con QZ Tray antes de guardar.');
      return;
    }
    if (!printers.includes(selectedPrinter)) {
      setError(`La impresora seleccionada "${selectedPrinter}" ya no está disponible en QZ Tray.`);
      return;
    }
    if (isYichipLabelPrinter(selectedPrinter) && !selectedSizeId) {
      setError('Selecciona el tamaño de etiqueta antes de guardar.');
      return;
    }
    if (isYichipLabelPrinter(selectedPrinter)) {
      const profile = {
        sizeId: selectedSizeId as LabelSizeId,
        horizontalAlignment,
        horizontalOffsetMm,
        barcodeSizeId,
      };
      try {
        resolveHorizontalPlacement(LABEL_SIZE_CATALOG[profile.sizeId], profile);
        saveLabelPrinterProfile(selectedPrinter, profile);
      } catch (profileError) {
        setError(profileError instanceof Error ? profileError.message : String(profileError));
        return;
      }
    }
    saveCommercialDeliveryLabelPrinterName(selectedPrinter);
    setSavedPrinter(selectedPrinter);
    setError(null);
    onConfigured?.();
    onOpenChange(false);
  };

  const printAlignmentTest = async () => {
    if (!selectedPrinter || !isYichipLabelPrinter(selectedPrinter) || !selectedSizeId) return;
    if (!detected || !printers.includes(selectedPrinter)) {
      setError('Detecta y selecciona una impresora disponible antes de imprimir la prueba.');
      return;
    }
    setTestingAlignment(true);
    setError(null);
    setTestMessage(null);
    try {
      await printCommercialDeliveryAlignmentTest(selectedPrinter, {
        sizeId: selectedSizeId,
        horizontalAlignment,
        horizontalOffsetMm,
        barcodeSizeId,
      });
      setTestMessage('Prueba de alineación aceptada por QZ Tray. No se modificaron datos ni entregas.');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTestingAlignment(false);
    }
  };

  const connected = detected && isQZConnected();
  const savedAvailable = !savedPrinter || !detected || printers.includes(savedPrinter);
  const savedSize = savedPrinter && isYichipLabelPrinter(savedPrinter)
    ? resolveLabelSize(savedPrinter)
    : null;
  const savedProfile = savedPrinter && isYichipLabelPrinter(savedPrinter)
    ? resolveLabelPrinterProfile(savedPrinter)
    : null;

  return <>
    <div className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-[#111111]"><Printer size={16} />Impresora de etiquetas B2B</p>
          {savedPrinter ? <>
            <p className="truncate text-xs font-semibold text-[#4a2c0a]" title={savedPrinter}>{savedPrinter}</p>
            {savedProfile && <p className="text-xs text-[#4a2c0a]">{savedSize?.label} · {savedProfile.horizontalAlignment === 'left' ? 'Izquierda' : savedProfile.horizontalAlignment === 'center' ? 'Centro' : 'Derecha'} · {savedProfile.horizontalOffsetMm >= 0 ? '+' : ''}{savedProfile.horizontalOffsetMm.toFixed(1)} mm · Código {BARCODE_SIZE_CATALOG[savedProfile.barcodeSizeId].label.toLowerCase()}</p>}
            <p className={`mt-1 flex items-center gap-1 text-xs ${connected && savedAvailable ? 'text-green-700' : 'text-amber-800'}`}>
              {connected && savedAvailable ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
              {connected && savedAvailable ? 'Conectada' : savedAvailable ? 'Pendiente de verificación con QZ Tray' : 'Impresora guardada no disponible'}
            </p>
          </> : <p className="text-xs text-[#6b5c40]">Sin impresora de etiquetas configurada.</p>}
        </div>
        <button type="button" onClick={() => onOpenChange(true)} className="flex items-center gap-1 rounded-lg border border-[#a87820] bg-white px-3 py-2 text-xs font-bold text-[#4a2c0a] hover:bg-[#fff3d1]">
          <Settings size={14} />{savedPrinter ? 'Cambiar impresora' : 'Configurar impresora'}
        </button>
      </div>
    </div>

    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => onOpenChange(false)}>
      <div className="w-full max-w-md rounded-xl border border-[#c49330] bg-[#2d1a00] p-5 text-[#fff8e6] shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h3 className="flex items-center gap-2 font-bold"><Printer size={17} className="text-[#D6A23A]" />Impresora de etiquetas B2B</h3><p className="mt-1 text-xs text-[#dbc9a0]">Esta selección no cambia la impresora del Punto de Venta.</p></div>
          <button type="button" onClick={() => onOpenChange(false)} className="text-[#dbc9a0] hover:text-white" aria-label="Cerrar"><X size={17} /></button>
        </div>
        <p className="mb-3 text-xs text-[#dbc9a0]">Estado QZ Tray: <strong className={connected ? 'text-green-300' : 'text-amber-300'}>{connected ? 'Conectada' : 'Sin conexión verificada'}</strong></p>
        <button type="button" onClick={() => void detectPrinters()} disabled={detecting} className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#c49330]/50 bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15 disabled:opacity-50">
          {detecting ? <><span className="animate-spin">⏳</span>Detectando impresoras…</> : <><Search size={14} />Detectar impresoras</>}
        </button>
        {error && <p className="mb-3 rounded-lg border border-red-400/40 bg-red-500/15 p-2 text-xs text-red-200">{error}</p>}
        {printers.length > 0 && <div className="mb-3 max-h-52 space-y-1.5 overflow-y-auto">
          {printers.map(printer => <button key={printer} type="button" onClick={() => selectPrinter(printer)} className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selectedPrinter === printer ? 'border-[#D6A23A] bg-[#D6A23A]/20 font-bold text-[#ffe6a3]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
            {printer}{selectedPrinter === printer ? ' ✓' : ''}
          </button>)}
        </div>}
        {!detecting && detected && printers.length === 0 && <p className="mb-3 text-xs text-amber-200">QZ Tray está conectado, pero no encontró impresoras disponibles.</p>}
        <p className="text-xs text-[#dbc9a0]">Selección: <strong className="text-[#ffe6a3]">{selectedPrinter || 'Ninguna'}</strong></p>
        {isYichipLabelPrinter(selectedPrinter) && (
          <fieldset className="mt-4 rounded-lg border border-[#c49330]/50 bg-white/5 p-3">
            <legend className="px-1 text-xs font-bold text-[#ffe6a3]">Tamaño de etiqueta</legend>
            <div className="mt-1 space-y-2">
              {(Object.values(LABEL_SIZE_CATALOG) as Array<(typeof LABEL_SIZE_CATALOG)[LabelSizeId]>).map(size => (
                <label key={size.id} className="flex cursor-pointer items-center gap-2 text-sm text-[#fff8e6]">
                  <input
                    type="radio"
                    name="commercial-label-size"
                    value={size.id}
                    checked={selectedSizeId === size.id}
                    onChange={() => setSelectedSizeId(size.id)}
                    className="accent-[#D6A23A]"
                  />
                  {size.label}
                </label>
              ))}
            </div>
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-xs font-bold text-[#ffe6a3]">Alineación del rollo</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(['left', 'center', 'right'] as LabelHorizontalAlignment[]).map(alignment => (
                  <label key={alignment} className="flex cursor-pointer items-center gap-1.5 text-xs capitalize text-[#fff8e6]">
                    <input type="radio" name="commercial-label-alignment" checked={horizontalAlignment === alignment} onChange={() => setHorizontalAlignment(alignment)} className="accent-[#D6A23A]" />
                    {alignment === 'left' ? 'Izquierda' : alignment === 'center' ? 'Centro' : 'Derecha'}
                  </label>
                ))}
              </div>
              <label className="mt-3 block text-xs font-bold text-[#ffe6a3]" htmlFor="commercial-label-offset">Ajuste horizontal fino</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="commercial-label-offset"
                  type="number"
                  min={MIN_LABEL_OFFSET_MM}
                  max={MAX_LABEL_OFFSET_MM}
                  step={LABEL_OFFSET_STEP_MM}
                  value={horizontalOffsetMm}
                  onChange={event => setHorizontalOffsetMm(Number(event.target.value))}
                  className="w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-black"
                />
                <span className="text-xs text-[#dbc9a0]">mm</span>
              </div>
              <p className="mt-1 text-[11px] text-[#dbc9a0]">Rango: {MIN_LABEL_OFFSET_MM.toFixed(1)} a +{MAX_LABEL_OFFSET_MM.toFixed(1)} mm · pasos de {LABEL_OFFSET_STEP_MM.toFixed(1)} mm</p>
            </div>
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-xs font-bold text-[#ffe6a3]">Tamaño del código de barras</p>
              <div className="mt-2 space-y-2">
                {(Object.values(BARCODE_SIZE_CATALOG) as Array<(typeof BARCODE_SIZE_CATALOG)[BarcodeSizeId]>).map(barcodeSize => (
                  <label key={barcodeSize.id} className="flex cursor-pointer items-center gap-2 text-xs text-[#fff8e6]">
                    <input type="radio" name="commercial-barcode-size" checked={barcodeSizeId === barcodeSize.id} onChange={() => setBarcodeSizeId(barcodeSize.id)} className="accent-[#D6A23A]" />
                    <span><strong>{barcodeSize.label}</strong> — {Math.round(barcodeSize.targetScale * 100)} %</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[#dbc9a0]">Usa Compacto o Reducido si las barras quedan cortadas en los costados.</p>
            </div>
            <button type="button" onClick={() => void printAlignmentTest()} disabled={testingAlignment || !selectedSizeId} className="mt-4 w-full rounded-lg border border-[#D6A23A] bg-white/10 px-3 py-2 text-xs font-bold text-[#ffe6a3] hover:bg-white/15 disabled:opacity-50">
              {testingAlignment ? 'Imprimiendo prueba…' : 'Imprimir prueba de alineación y código'}
            </button>
            {testMessage && <p className="mt-2 text-xs text-green-300">{testMessage}</p>}
          </fieldset>
        )}
        <button type="button" onClick={saveSelection} disabled={!selectedPrinter || (isYichipLabelPrinter(selectedPrinter) && !selectedSizeId)} className="mt-4 w-full rounded-lg bg-[#D6A23A] px-4 py-2 text-sm font-bold text-[#2d1a00] hover:bg-[#e6b24a] disabled:opacity-50">Guardar</button>
      </div>
    </div>}
  </>;
}
