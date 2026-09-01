import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Printer, Search, Settings, X } from 'lucide-react';
import {
  getSavedCommercialDeliveryLabelPrinterName,
  isQZConnected,
  listPrinters,
  saveCommercialDeliveryLabelPrinterName,
} from '../../lib/qzService';

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
    void detectPrinters(configuredPrinter);
  }, [open]);

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
    saveCommercialDeliveryLabelPrinterName(selectedPrinter);
    setSavedPrinter(selectedPrinter);
    setError(null);
    onConfigured?.();
    onOpenChange(false);
  };

  const connected = detected && isQZConnected();
  const savedAvailable = !savedPrinter || !detected || printers.includes(savedPrinter);

  return <>
    <div className="rounded-xl border border-[#c49330] bg-[#fff8e6] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-[#111111]"><Printer size={16} />Impresora de etiquetas B2B</p>
          {savedPrinter ? <>
            <p className="truncate text-xs font-semibold text-[#4a2c0a]" title={savedPrinter}>{savedPrinter}</p>
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
          {printers.map(printer => <button key={printer} type="button" onClick={() => setSelectedPrinter(printer)} className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selectedPrinter === printer ? 'border-[#D6A23A] bg-[#D6A23A]/20 font-bold text-[#ffe6a3]' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
            {printer}{selectedPrinter === printer ? ' ✓' : ''}
          </button>)}
        </div>}
        {!detecting && detected && printers.length === 0 && <p className="mb-3 text-xs text-amber-200">QZ Tray está conectado, pero no encontró impresoras disponibles.</p>}
        <p className="text-xs text-[#dbc9a0]">Selección: <strong className="text-[#ffe6a3]">{selectedPrinter || 'Ninguna'}</strong></p>
        <button type="button" onClick={saveSelection} disabled={!selectedPrinter} className="mt-4 w-full rounded-lg bg-[#D6A23A] px-4 py-2 text-sm font-bold text-[#2d1a00] hover:bg-[#e6b24a] disabled:opacity-50">Guardar</button>
      </div>
    </div>}
  </>;
}
