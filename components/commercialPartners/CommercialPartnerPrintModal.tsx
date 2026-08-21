/**
 * CommercialPartnerPrintModal.tsx
 * 
 * Modal workflow for printing commercial partner receipts:
 * 1. Show print options (last delivery, by date, current stock, etc.)
 * 2. If date-based, show date selector
 * 3. If multiple results, show selector
 * 4. Show text preview
 * 5. Print via QZ Tray (reusing qzService.printRaw)
 * 
 * Reuses existing printer configuration from POS.
 */

import React, { useState } from 'react';
import { X, Printer, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import {
  getLastDeliveryComodato,
  getDeliveriesByDateComodato,
  getCurrentStockComodato,
  getLastOrderMayoreo,
  getOrdersByDateMayoreo,
  getPartnerForPrint,
  type CommercialPartnerPrintData,
  type CommercialPrintOption,
} from '../../services/commercialPartnerPrintService';
import {
  buildComodatoDeliveryReceipt,
  buildCurrentStockReceipt,
  buildMayoreoOrderReceipt,
  escPosToTextPreview,
} from '../../lib/commercialPartnerPrintReceipt';
import { printRaw, getSavedPrinterName } from '../../lib/qzService';

interface CommercialPartnerPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerId: string;
  partnerName: string;
  partnerModel: string; // 'comodato', 'mayoreo', etc.
}

type ModalStage = 'options' | 'date-select' | 'select-result' | 'preview' | 'printing' | 'error';

interface PrintOption {
  id: CommercialPrintOption;
  label: string;
  description: string;
  icon: React.ReactNode;
  requiresDate: boolean;
  requiresSelection?: boolean;
}

const PRINT_OPTIONS: Record<string, PrintOption> = {
  last_delivery_comodato: {
    id: 'last_delivery_comodato',
    label: 'Última entrega',
    description: 'Comprobante de la última entrega realizada',
    icon: <Printer size={16} />,
    requiresDate: false,
  },
  delivery_by_date_comodato: {
    id: 'delivery_by_date_comodato',
    label: 'Buscar entrega por fecha',
    description: 'Selecciona una fecha para ver entregas',
    icon: <Calendar size={16} />,
    requiresDate: true,
  },
  current_stock: {
    id: 'current_stock',
    label: 'Existencia actual',
    description: 'Inventario actual en posesión del socio',
    icon: <Printer size={16} />,
    requiresDate: false,
  },
  last_order_mayoreo: {
    id: 'last_order_mayoreo',
    label: 'Último pedido mayoreo',
    description: 'Comprobante del último pedido mayoreo',
    icon: <Printer size={16} />,
    requiresDate: false,
  },
  order_by_date_mayoreo: {
    id: 'order_by_date_mayoreo',
    label: 'Buscar pedido por fecha',
    description: 'Selecciona una fecha para ver pedidos',
    icon: <Calendar size={16} />,
    requiresDate: true,
  },
};

export const CommercialPartnerPrintModal: React.FC<CommercialPartnerPrintModalProps> = ({
  isOpen,
  onClose,
  partnerId,
  partnerName,
  partnerModel,
}) => {
  // ─── State ───────────────────────────────────────────────────────

  const [stage, setStage] = useState<ModalStage>('options');
  const [selectedOption, setSelectedOption] = useState<CommercialPrintOption | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [printDataList, setPrintDataList] = useState<CommercialPartnerPrintData[]>([]);
  const [selectedPrintData, setSelectedPrintData] = useState<CommercialPartnerPrintData | null>(null);
  const [previewText, setPreviewText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleSelectOption = async (optionId: CommercialPrintOption) => {
    setSelectedOption(optionId);
    setError(null);

    const option = PRINT_OPTIONS[optionId];
    if (!option) return;

    // If option requires date, go to date select
    if (option.requiresDate) {
      setStage('date-select');
      return;
    }

    // Otherwise, fetch data immediately
    await fetchPrintData(optionId, null);
  };

  const handleDateSubmit = async () => {
    if (!selectedDate || !selectedOption) {
      setError('Selecciona una fecha');
      return;
    }
    await fetchPrintData(selectedOption, selectedDate);
  };

  const fetchPrintData = async (optionId: CommercialPrintOption, dateStr: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const partnerData = await getPartnerForPrint(partnerId);
      if (!partnerData) {
        setError('No se pudo cargar información del socio');
        setLoading(false);
        return;
      }

      let results: CommercialPartnerPrintData[] = [];

      switch (optionId) {
        case 'last_delivery_comodato': {
          const data = await getLastDeliveryComodato(partnerId, partnerData);
          if (data) results = [data];
          break;
        }
        case 'delivery_by_date_comodato': {
          if (!dateStr) break;
          const date = new Date(dateStr);
          results = await getDeliveriesByDateComodato(partnerId, date, partnerData);
          break;
        }
        case 'current_stock': {
          const data = await getCurrentStockComodato(partnerId, partnerData);
          if (data) results = [data];
          break;
        }
        case 'last_order_mayoreo': {
          const data = await getLastOrderMayoreo(partnerId, partnerData);
          if (data) results = [data];
          break;
        }
        case 'order_by_date_mayoreo': {
          if (!dateStr) break;
          const date = new Date(dateStr);
          results = await getOrdersByDateMayoreo(partnerId, date, partnerData);
          break;
        }
      }

      if (results.length === 0) {
        setError('No hay datos para esta búsqueda');
        setStage('date-select');
      } else if (results.length === 1) {
        // Single result → go directly to preview
        const data = results[0];
        setSelectedPrintData(data);
        const escos = buildEscPosForOption(optionId, data);
        setPreviewText(escPosToTextPreview(escos));
        setStage('preview');
      } else {
        // Multiple results → show selector
        setPrintDataList(results);
        setStage('select-result');
      }
    } catch (err) {
      console.error('[Print] Error fetching data:', err);
      setError('Error al cargar datos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectResult = (data: CommercialPartnerPrintData) => {
    setSelectedPrintData(data);
    const escos = buildEscPosForOption(selectedOption || 'last_delivery_comodato', data);
    setPreviewText(escPosToTextPreview(escos));
    setStage('preview');
  };

  const handlePrint = async () => {
    if (!selectedPrintData || !selectedOption) {
      setError('No hay datos para imprimir');
      return;
    }

    setStage('printing');
    setError(null);

    try {
      const printerName = getSavedPrinterName();
      if (!printerName) {
        setError('No hay impresora configurada. Configura tu impresora en el POS.');
        setStage('preview');
        return;
      }

      const escos = buildEscPosForOption(selectedOption, selectedPrintData);
      await printRaw(printerName, escos);

      // Success
      setError(null);
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      console.error('[Print] Error printing:', err);
      setError('Error al imprimir. Verifica la impresora y QZ Tray.');
      setStage('preview');
    }
  };

  const handleBack = () => {
    if (stage === 'options') {
      onClose();
    } else if (stage === 'date-select') {
      setStage('options');
      setSelectedDate('');
    } else if (stage === 'select-result') {
      setStage('date-select');
    } else if (stage === 'preview') {
      setSelectedDate('');
      if (selectedOption && PRINT_OPTIONS[selectedOption]?.requiresDate) {
        setStage('date-select');
      } else {
        setStage('options');
      }
    } else if (stage === 'error') {
      setStage('options');
    }
  };

  if (!isOpen) return null;

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-[#c49330] to-[#a0752a] text-white p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">🖨️ Imprimir Comprobante</h2>
          <button
            onClick={onClose}
            className="text-white hover:bg-black hover:bg-opacity-20 rounded-lg p-1 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Partner Info */}
          <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-600">Socio Comercial</p>
            <p className="font-semibold text-gray-800">{partnerName}</p>
            <p className="text-xs text-gray-500">Modalidad: {partnerModel}</p>
          </div>

          {/* Stage: Options */}
          {stage === 'options' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 mb-4">Selecciona qué comprobante deseas imprimir:</p>
              {getAvailableOptions(partnerModel).map(optionId => {
                const option = PRINT_OPTIONS[optionId];
                return (
                  <button
                    key={optionId}
                    onClick={() => handleSelectOption(optionId)}
                    className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-amber-50 hover:border-[#c49330] transition group"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-[#c49330] group-hover:scale-110 transition mt-1">{option.icon}</span>
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{option.label}</p>
                        <p className="text-xs text-gray-600">{option.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Stage: Date Select */}
          {stage === 'date-select' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                Selecciona una fecha:
              </p>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c49330]"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleBack}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Atrás
                </button>
                <button
                  onClick={handleDateSubmit}
                  disabled={!selectedDate || loading}
                  className="flex-1 px-4 py-2 bg-[#c49330] text-white rounded-lg hover:bg-[#a0752a] disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                  Buscar
                </button>
              </div>
            </div>
          )}

          {/* Stage: Select Result */}
          {stage === 'select-result' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Se encontraron {printDataList.length} resultado(s). Selecciona cuál imprimir:</p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {printDataList.map((data, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectResult(data)}
                    className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-amber-50 hover:border-[#c49330] transition"
                  >
                    <p className="font-semibold text-sm text-gray-800">
                      {data.comodato?.movement?.movement_date || data.mayoreo?.order?.order_date || new Date().toISOString().split('T')[0]}
                    </p>
                    <p className="text-xs text-gray-600">
                      {data.comodato?.items?.length || data.mayoreo?.items?.length || 0} producto(s)
                    </p>
                  </button>
                ))}
              </div>
              <button
                onClick={handleBack}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
              >
                Atrás
              </button>
            </div>
          )}

          {/* Stage: Preview */}
          {stage === 'preview' && (
            <div className="space-y-4">
              <div className="bg-white p-4 rounded-lg border border-gray-200 font-mono text-xs text-black whitespace-pre-wrap max-h-64 overflow-y-auto">
                {previewText}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleBack}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Atrás
                </button>
                <button
                  onClick={handlePrint}
                  className="flex-1 px-4 py-2 bg-[#c49330] text-white rounded-lg hover:bg-[#a0752a] transition flex items-center justify-center gap-2"
                >
                  <Printer size={16} />
                  Imprimir
                </button>
              </div>
            </div>
          )}

          {/* Stage: Printing */}
          {stage === 'printing' && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <Loader2 size={32} className="text-[#c49330] animate-spin" />
              <p className="text-sm text-gray-700">Enviando a impresora...</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Get available print options based on partner model.
 */
function getAvailableOptions(partnerModel: string): CommercialPrintOption[] {
  if (partnerModel === 'comodato') {
    return ['last_delivery_comodato', 'delivery_by_date_comodato', 'current_stock'];
  } else if (partnerModel === 'mayoreo') {
    return ['last_order_mayoreo', 'order_by_date_mayoreo', 'current_stock'];
  } else {
    // Both or other
    return [
      'last_delivery_comodato',
      'delivery_by_date_comodato',
      'current_stock',
      'last_order_mayoreo',
      'order_by_date_mayoreo',
    ];
  }
}

/**
 * Build ESC/POS commands based on option and data.
 */
function buildEscPosForOption(
  option: CommercialPrintOption,
  data: CommercialPartnerPrintData
): string[] {
  switch (option) {
    case 'last_delivery_comodato':
    case 'delivery_by_date_comodato':
      return buildComodatoDeliveryReceipt(data);
    case 'current_stock':
      return buildCurrentStockReceipt(data);
    case 'last_order_mayoreo':
    case 'order_by_date_mayoreo':
      return buildMayoreoOrderReceipt(data);
    default:
      return [];
  }
}
