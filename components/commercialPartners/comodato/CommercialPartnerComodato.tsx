import React, { useState, useEffect } from 'react';
import { Truck, PackageCheck, RotateCcw, Trash2, CreditCard, AlertTriangle, Printer, Barcode } from 'lucide-react';
import { supabase } from '../../../supabase';
import { MovementType } from './types';
import PartnerBalanceSummary from './PartnerBalanceSummary';
import PartnerCurrentStock from './PartnerCurrentStock';
import PartnerMovementHistory from './PartnerMovementHistory';
import PartnerMovementForm from './PartnerMovementForm';
import PartnerPaymentForm from './PartnerPaymentForm';
import { CommercialPartnerPrintModal } from '../CommercialPartnerPrintModal';
import CommercialDeliveryUnitsPanel from '../CommercialDeliveryUnitsPanel';

interface Props {
  partnerId: string;
  partnerStatus: string;
}

type ActiveModal =
  | { kind: 'movement'; type: MovementType }
  | { kind: 'payment' }
  | { kind: 'print' }
  | null;

const ACTION_BUTTON_DEFS: Array<{
  label: string;
  icon: React.ReactNode;
  modal: ActiveModal;
  className: string;
  requiresActivo?: boolean;
}> = [
  {
    label: 'Entrega',
    icon: <Truck className="w-4 h-4" />,
    modal: { kind: 'movement', type: 'delivery' },
    className: 'bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200',
    requiresActivo: true,
  },
  {
    label: 'Imprimir',
    icon: <Printer className="w-4 h-4" />,
    modal: { kind: 'print' },
    className: 'bg-purple-100 border-purple-300 text-purple-800 hover:bg-purple-200',
  },
  {
    label: 'Etiquetas',
    icon: <Barcode className="w-4 h-4" />,
    modal: null,
    className: 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200',
  },
  {
    label: 'Liquidación',
    icon: <PackageCheck className="w-4 h-4" />,
    modal: { kind: 'movement', type: 'settlement' },
    className: 'bg-green-100 border-green-300 text-green-800 hover:bg-green-200',
  },
  {
    label: 'Retiro',
    icon: <RotateCcw className="w-4 h-4" />,
    modal: { kind: 'movement', type: 'withdrawal' },
    className: 'bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200',
  },
  {
    label: 'Merma',
    icon: <Trash2 className="w-4 h-4" />,
    modal: { kind: 'movement', type: 'spoilage' },
    className: 'bg-red-100 border-red-300 text-red-800 hover:bg-red-200',
  },
  {
    label: 'Pago',
    icon: <CreditCard className="w-4 h-4" />,
    modal: { kind: 'payment' },
    className: 'bg-[#fff8e6] border-[#c49330] text-[#4a2c0a] hover:bg-[#f5e9c8]',
  },
];

type SubTab = 'stock' | 'history' | 'labels';

const CommercialPartnerComodato: React.FC<Props> = ({ partnerId, partnerStatus }) => {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [subTab, setSubTab] = useState<SubTab>('stock');
  const [partnerName, setPartnerName] = useState<string>('');
  const [partnerModel, setPartnerModel] = useState<string>('comodato');

  // Load partner name and model
  useEffect(() => {
    (async () => {
      if (!supabase) return;
      try {
        const { data } = await supabase
          .from('commercial_partners')
          .select('business_name, partner_model')
          .eq('id', partnerId)
          .single();
        if (data) {
          setPartnerName(data.business_name || '');
          setPartnerModel(data.partner_model || 'comodato');
        }
      } catch (err) {
        console.error('[Comodato] Error loading partner:', err);
      }
    })();
  }, [partnerId]);

  // ── Permission rules ──────────────────────────────────────────────────────
  const canDeliver = partnerStatus === 'activo';
  const canOperate = ['activo', 'pausado', 'inactivo'].includes(partnerStatus);
  const isLimited  = ['pausado', 'inactivo'].includes(partnerStatus);

  const handleSaved = () => {
    setActiveModal(null);
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Warning for pausado / inactivo */}
      {isLimited && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Este socio no está activo. Puedes consultar historial, registrar pagos, retiros o
            liquidaciones pendientes, pero no nuevas entregas.
          </p>
        </div>
      )}

      {/* Balance summary */}
      <PartnerBalanceSummary partnerId={partnerId} refreshKey={refreshKey} />

      {/* Action buttons */}
      <div>
        <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider mb-2">
          Registrar movimiento
        </p>
        <div className="flex flex-wrap gap-2">
          {ACTION_BUTTON_DEFS.map(btn => {
            const disabled = btn.requiresActivo ? !canDeliver : !canOperate;
            return (
              <button
                key={btn.label}
                type="button"
                disabled={disabled}
                onClick={disabled ? undefined : () => btn.label === 'Etiquetas' ? setSubTab('labels') : setActiveModal(btn.modal)}
                title={
                  disabled && btn.requiresActivo
                    ? 'Solo disponible para socios activos'
                    : disabled
                    ? 'No disponible para este estado'
                    : undefined
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${btn.className}${
                  disabled ? ' opacity-40 cursor-not-allowed' : ''
                }`}
              >
                {btn.icon}
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#c49330]">
        {([
          { id: 'stock', label: 'Inventario' },
          { id: 'history', label: 'Historial' },
          { id: 'labels', label: 'Etiquetas' },
        ] as const).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              subTab === t.id
                ? 'border-[#2d1a00] text-[#2d1a00]'
                : 'border-transparent text-[#6b5c40] hover:text-[#4a2c0a]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subTab === 'stock' && (
        <PartnerCurrentStock partnerId={partnerId} refreshKey={refreshKey} />
      )}
      {subTab === 'history' && (
        <PartnerMovementHistory partnerId={partnerId} refreshKey={refreshKey} />
      )}
      {subTab === 'labels' && (
        <CommercialDeliveryUnitsPanel partnerId={partnerId} sourceType="comodato" refreshKey={refreshKey} onReleased={() => setRefreshKey(k => k + 1)} />
      )}

      {/* Modals */}
      {activeModal?.kind === 'movement' && (
        <PartnerMovementForm
          partnerId={partnerId}
          movementType={activeModal.type}
          partnerStatus={partnerStatus}
          onClose={() => setActiveModal(null)}
          onSaved={handleSaved}
          onDeliveryCreated={() => setSubTab('labels')}
        />
      )}
      {activeModal?.kind === 'payment' && (
        <PartnerPaymentForm
          partnerId={partnerId}
          onClose={() => setActiveModal(null)}
          onSaved={handleSaved}
        />
      )}
      {activeModal?.kind === 'print' && (
        <CommercialPartnerPrintModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          partnerId={partnerId}
          partnerName={partnerName}
          partnerModel={partnerModel}
        />
      )}
    </div>
  );
};

export default CommercialPartnerComodato;
