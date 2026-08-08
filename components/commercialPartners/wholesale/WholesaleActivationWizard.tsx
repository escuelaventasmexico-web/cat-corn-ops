import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { supabase } from '../../../supabase';
import { CommercialPartner } from '../types';
import { BUTTON_PRIMARY_CLS } from './types';
import WholesaleDataVerification from './WholesaleDataVerification';
import WholesaleDocumentsUploader from './WholesaleDocumentsUploader';
import WholesaleContractGenerator from './WholesaleContractGenerator';
import WholesaleSignedUploader from './WholesaleSignedUploader';
import DebtAuthorizationStatus from './debtAuthorization/DebtAuthorizationStatus';
import DebtAuthorizationRequestModal from './debtAuthorization/DebtAuthorizationRequestModal';
import { safeNumber } from './debtAuthorization/helpers';

interface Props {
  partner: CommercialPartner;
  onClose: () => void;
  onActivated: () => void;
}

type StepType = 'verification' | 'documents' | 'contract' | 'signed' | 'review';

interface ActivationState {
  datosVerificados: boolean;
  consentimientoAceptado: boolean;
  documentos: {
    ine_front_path?: string;
    ine_back_path?: string;
    business_photo_path?: string;
  };
  contractId?: string;
  contractPdfPath?: string;
  signedContractPath?: string;
}

const STEPS: Array<{ id: StepType; label: string }> = [
  { id: 'verification', label: 'Verificación' },
  { id: 'documents', label: 'Documentos' },
  { id: 'contract', label: 'Contrato' },
  { id: 'signed', label: 'Contrato Firmado' },
  { id: 'review', label: 'Revisar' },
];

const WholesaleActivationWizard: React.FC<Props> = ({ partner: initialPartner, onClose, onActivated }) => {
  const [currentStep, setCurrentStep] = useState<StepType>('verification');
  const [currentPartner, setCurrentPartner] = useState<CommercialPartner>(initialPartner);
  const [state, setState] = useState<ActivationState>({
    datosVerificados: false,
    consentimientoAceptado: false,
    documentos: {},
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comodatoPendingBalance, setComodatoPendingBalance] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);

  // Load comodato pending balance on mount
  useEffect(() => {
    const loadBalance = async () => {
      if (!supabase) return;
      try {
        const { data, error: rpcErr } = await supabase.rpc(
          'get_partner_comodato_pending_balance',
          { p_partner_id: initialPartner.id }
        );
        if (rpcErr) throw rpcErr;
        setComodatoPendingBalance(safeNumber(data));
      } catch (err: any) {
        console.error('Error loading comodato balance:', err);
      }
    };
    loadBalance();
  }, [initialPartner.id]);

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);
  const canGoNext = () => {
    switch (currentStep) {
      case 'verification':
        return state.datosVerificados && state.consentimientoAceptado;
      case 'documents':
        return !!state.documentos.ine_front_path && !!state.documentos.ine_back_path && !!state.documentos.business_photo_path;
      case 'contract':
        return !!state.contractPdfPath;
      case 'signed':
        return !!state.signedContractPath;
      default:
        return true;
    }
  };

  const handleNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id);
      setError(null);
    }
  };

  const handlePrevStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].id);
      setError(null);
    }
  };

  const handleVerificationComplete = (datos: { verified: boolean; consentimiento: boolean; updatedPartner?: CommercialPartner }) => {
    setState(prev => ({
      ...prev,
      datosVerificados: datos.verified,
      consentimientoAceptado: datos.consentimiento,
    }));
    
    // Update partner if provided
    if (datos.updatedPartner) {
      setCurrentPartner(datos.updatedPartner);
    }
    
    // Auto-advance to next step
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id);
      setError(null);
    }
  };

  const handleDocumentsUploaded = (paths: { ine_front_path: string; ine_back_path: string; business_photo_path: string }) => {
    setState(prev => ({
      ...prev,
      documentos: paths,
    }));
  };

  const handleContractGenerated = (contractId: string, pdfPath: string) => {
    setState(prev => ({
      ...prev,
      contractId,
      contractPdfPath: pdfPath,
    }));
  };

  const handleSignedContractUploaded = (path: string) => {
    setState(prev => ({
      ...prev,
      signedContractPath: path,
    }));
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'verification':
        return (
          <WholesaleDataVerification
            partner={currentPartner}
            onComplete={handleVerificationComplete}
          />
        );
      case 'documents':
        return (
          <WholesaleDocumentsUploader
            partnerId={currentPartner.id}
            onUploaded={handleDocumentsUploaded}
            onError={setError}
          />
        );
      case 'contract':
        return (
          <WholesaleContractGenerator
            partner={currentPartner}
            documentPaths={state.documentos}
            onGenerated={handleContractGenerated}
            onError={setError}
          />
        );
      case 'signed':
        return (
          <WholesaleSignedUploader
            partnerId={currentPartner.id}
            contractId={state.contractId}
            onUploaded={handleSignedContractUploaded}
            onError={setError}
          />
        );
      case 'review':
        return (
          <div className="space-y-4">
            {/* Authorization Status Section - Show if there's pending comodato debt */}
            {comodatoPendingBalance > 0.005 && (
              <div key={`auth-${authRefreshKey}`}>
                <DebtAuthorizationStatus
                  partnerId={currentPartner.id}
                  pendingBalance={comodatoPendingBalance}
                  onRequestClick={() => setShowAuthModal(true)}
                  onAuthorizationLoaded={() => {
                    // Authorization loaded, UI will update
                  }}
                />
              </div>
            )}

            <div className="bg-green-50 border border-green-300 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-900">Todos los documentos están listos</p>
                  <p className="text-xs text-green-700 mt-1">
                    El socio comercial será activado en el esquema Mayoreo después de presionar "Activar Mayoreo".
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-[#fffbf0] border border-[#e8d5a0] rounded-lg p-4">
              <p className="text-sm text-[#4a2c0a]">
                <strong>Resumen:</strong>
              </p>
              <ul className="text-xs text-[#6b7280] mt-2 space-y-1">
                <li>✓ Datos verificados</li>
                <li>✓ Consentimiento de privacidad aceptado</li>
                <li>✓ INE frente subido</li>
                <li>✓ INE reverso subido</li>
                <li>✓ Foto del negocio subida</li>
                <li>✓ Contrato PDF generado</li>
                <li>✓ Contrato firmado subido</li>
              </ul>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center pt-4 px-4 pb-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-[#D6A23A] shadow-2xl flex flex-col max-h-[95vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
          <h2 className="text-xl font-bold text-[#111111]">Activación Esquema Mayoreo</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex-shrink-0 px-6 pt-4 pb-2">
          <div className="flex items-center gap-2">
            {STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    idx <= currentStepIndex
                      ? 'bg-[#111111] text-[#D6A23A]'
                      : 'bg-white/20 text-[#111111]'
                  }`}
                >
                  {idx < currentStepIndex ? '✓' : idx + 1}
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 transition-all ${
                      idx < currentStepIndex ? 'bg-[#111111]' : 'bg-white/20'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map(step => (
              <span key={step.id} className="text-xs text-[#4a2c0a] font-medium">
                {step.label}
              </span>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm">
              {error}
            </div>
          )}
          {renderStepContent()}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex justify-between items-center px-6 py-4 border-t border-[#c49330] bg-[#fff8e6]">
          <button
            onClick={handlePrevStep}
            disabled={currentStepIndex === 0 || loading}
            className="flex items-center gap-2 px-4 py-2 text-[#111111] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5e9c8] rounded-lg transition-colors"
          >
            <ChevronLeft size={16} />
            Anterior
          </button>

          {currentStep === 'review' ? (
            <button
              onClick={async () => {
                // Validación: contractId
                if (!state.contractId) {
                  setError('No se encontró el contrato para activar mayoreo.');
                  return;
                }

                // Validación: contrato debe tener los archivos necesarios
                if (!state.contractPdfPath) {
                  setError('El contrato PDF no se ha generado correctamente.');
                  return;
                }

                if (!state.signedContractPath) {
                  setError('El contrato firmado no se ha subido.');
                  return;
                }

                if (!state.documentos.ine_front_path || !state.documentos.ine_back_path || !state.documentos.business_photo_path) {
                  setError('Faltan documentos requeridos (INE o foto del negocio).');
                  return;
                }

                if (!state.consentimientoAceptado) {
                  setError('El consentimiento de privacidad no ha sido aceptado.');
                  return;
                }

                setLoading(true);
                setError(null);
                try {
                  if (!supabase) throw new Error('Supabase no configurado');
                  
                  // Llamar RPC con el parámetro correcto: p_contract_id
                  const { data, error: rpcError } = await supabase.rpc('activate_wholesale_partner', {
                    p_contract_id: state.contractId,
                  });
                  
                  if (rpcError) {
                    console.error('Error RPC:', rpcError);
                    // Check if error is about debt/authorization
                    const errMsg = rpcError.message || '';
                    if (errMsg.includes('liquidar su adeudo') || errMsg.includes('solicita autorización')) {
                      // Reload balance and authorization status
                      const { data: balanceData } = await supabase.rpc(
                        'get_partner_comodato_pending_balance',
                        { p_partner_id: currentPartner.id }
                      );
                      if (balanceData) {
                        setComodatoPendingBalance(safeNumber(balanceData));
                        setAuthRefreshKey(prev => prev + 1);
                      }
                    }
                    throw rpcError;
                  }

                  console.log('✅ Mayoreo activado:', data);

                  // Refrescar datos del socio desde BD
                  const { data: updatedPartner, error: fetchError } = await supabase
                    .from('commercial_partners')
                    .select('*')
                    .eq('id', currentPartner.id)
                    .single();

                  if (fetchError) {
                    console.warn('⚠️ No se pudo refrescar socio:', fetchError);
                  } else if (updatedPartner) {
                    console.log('✅ Socio actualizado:', updatedPartner);
                  }

                  // Llamar callback con partner actualizado
                  onActivated();
                } catch (err: any) {
                  console.error('Error al activar mayoreo:', err);
                  setError(err.message || 'Error al activar mayoreo');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={!canGoNext() || loading}
              className={`${BUTTON_PRIMARY_CLS} ${!canGoNext() || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {loading ? 'Activando...' : 'Activar Mayoreo'}
            </button>
          ) : (
            <button
              onClick={handleNextStep}
              disabled={!canGoNext() || loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#111111] text-[#D6A23A] font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#374151] transition-colors"
            >
              Siguiente
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {/* Conditional message for disabled button */}
        {!canGoNext() && currentStep === 'documents' && (
          <div className="flex-shrink-0 px-6 py-3 bg-[#fff8e6] border-t border-[#e8d5a0]">
            <div className="text-xs text-amber-800 text-center">
              Para continuar debes subir INE frente, INE reverso y foto del negocio.
            </div>
          </div>
        )}
      </div>

      {/* Debt Authorization Request Modal */}
      {showAuthModal && (
        <DebtAuthorizationRequestModal
          partnerId={currentPartner.id}
          pendingBalance={comodatoPendingBalance}
          onClose={() => setShowAuthModal(false)}
          onSubmitted={() => {
            setAuthRefreshKey(prev => prev + 1);
          }}
        />
      )}
    </div>
  );
};

export default WholesaleActivationWizard;
