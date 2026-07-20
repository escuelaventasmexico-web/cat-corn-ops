import React, { useState } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { CommercialPartner } from '../types';
import { supabase } from '../../../supabase';
import { LABEL_CLS, INPUT_CLS, CARD_CLS } from './types';

// Business Type Options
const BUSINESS_TYPE_OPTIONS = [
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'tienda', label: 'Tienda' },
  { value: 'bar', label: 'Bar' },
  { value: 'cafeteria', label: 'Cafetería' },
  { value: 'lugar_con_alcohol', label: 'Lugar con alcohol' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'otro', label: 'Otro' },
];

// Status Options
const STATUS_OPTIONS = [
  { value: 'prospecto', label: 'Prospecto' },
  { value: 'en_negociacion', label: 'En negociación' },
  { value: 'activo', label: 'Activo' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'rechazado', label: 'Rechazado' },
  { value: 'inactivo', label: 'Inactivo' },
];

// Normalize business_type to valid Supabase value
function normalizeBusinessType(value: string): string {
  if (!value) return 'otro';
  const normalized = value?.trim().toLowerCase();

  const map: Record<string, string> = {
    'restaurante': 'restaurante',
    'tienda': 'tienda',
    'bar': 'bar',
    'cafeteria': 'cafeteria',
    'cafetería': 'cafeteria',
    'lugar con alcohol': 'lugar_con_alcohol',
    'lugar_con_alcohol': 'lugar_con_alcohol',
    'oficina': 'oficina',
    'otro': 'otro',
  };

  return map[normalized] || 'otro';
}

// Normalize status to valid Supabase value
function normalizeStatus(value: string): string {
  if (!value) return 'prospecto';
  const normalized = value?.trim().toLowerCase();

  const map: Record<string, string> = {
    'prospecto': 'prospecto',
    'en_negociacion': 'en_negociacion',
    'en negociación': 'en_negociacion',
    'activo': 'activo',
    'pausado': 'pausado',
    'rechazado': 'rechazado',
    'inactivo': 'inactivo',
  };

  return map[normalized] || 'prospecto';
}

interface VerificationData {
  business_name: string;
  responsible_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
  business_type: string;
  business_type_other: string;
  status: string;
}

interface Props {
  partner: CommercialPartner;
  onComplete: (data: { verified: boolean; consentimiento: boolean; updatedPartner?: CommercialPartner }) => void;
}

const WholesaleDataVerification: React.FC<Props> = ({ partner, onComplete }) => {
  const [datosVerificados, setDatosVerificados] = useState(false);
  const [consentimientoAceptado, setConsentimientoAceptado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Local form state for editable fields
  // Normalize incoming values from partner
  const [verificationData, setVerificationData] = useState<VerificationData>({
    business_name: partner.business_name || '',
    responsible_name: partner.responsible_name || '',
    phone: partner.phone || '',
    whatsapp: partner.whatsapp || '',
    email: partner.email || '',
    address: partner.address || '',
    neighborhood: partner.neighborhood || '',
    city: partner.city || '',
    state: partner.state || '',
    postal_code: partner.postal_code || '',
    business_type: normalizeBusinessType(partner.business_type),
    business_type_other: partner.business_type_other || '',
    status: normalizeStatus(partner.status),
  });

  // Validate form data
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!verificationData.business_name?.trim()) {
      errors.business_name = 'El nombre del negocio es requerido';
    }
    if (!verificationData.responsible_name?.trim()) {
      errors.responsible_name = 'El nombre del responsable es requerido';
    }
    if (!verificationData.business_type?.trim()) {
      errors.business_type = 'El giro comercial es requerido';
    }
    if (verificationData.business_type === 'otro' && !verificationData.business_type_other?.trim()) {
      errors.business_type_other = 'Especifica el giro comercial';
    }
    if (!verificationData.status?.trim()) {
      errors.status = 'El estado es requerido';
    }

    if (!datosVerificados) {
      errors.datosVerificados = 'Debes confirmar que los datos fueron revisados';
    }
    if (!consentimientoAceptado) {
      errors.consentimiento = 'Debes aceptar el tratamiento de datos personales';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle save and continue to next step
  const handleSaveVerificationAndContinue = async () => {
    if (!validateForm()) {
      setError('Por favor, completa los campos requeridos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!supabase) {
        throw new Error('Supabase no está configurado');
      }

      // Normalize values before sending to Supabase
      const normalizedBusinessType = normalizeBusinessType(verificationData.business_type);
      const normalizedStatus = normalizeStatus(verificationData.status);

      // Update commercial_partners in Supabase
      const { error: updateError } = await supabase
        .from('commercial_partners')
        .update({
          business_name: verificationData.business_name,
          responsible_name: verificationData.responsible_name,
          phone: verificationData.phone || null,
          whatsapp: verificationData.whatsapp || null,
          email: verificationData.email || null,
          address: verificationData.address || null,
          neighborhood: verificationData.neighborhood || null,
          city: verificationData.city || null,
          state: verificationData.state || null,
          postal_code: verificationData.postal_code || null,
          business_type: normalizedBusinessType,
          business_type_other: verificationData.business_type_other || null,
          status: normalizedStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', partner.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      // Update the partner object with new data using normalized values
      const updatedPartner: CommercialPartner = {
        ...partner,
        business_name: verificationData.business_name,
        responsible_name: verificationData.responsible_name,
        phone: verificationData.phone || null,
        whatsapp: verificationData.whatsapp || null,
        email: verificationData.email || null,
        address: verificationData.address || null,
        neighborhood: verificationData.neighborhood || null,
        city: verificationData.city || null,
        state: verificationData.state || null,
        postal_code: verificationData.postal_code || null,
        business_type: normalizedBusinessType,
        business_type_other: verificationData.business_type_other || null,
        status: normalizedStatus,
      };

      // Call onComplete with successful verification
      onComplete({
        verified: datosVerificados,
        consentimiento: consentimientoAceptado,
        updatedPartner,
      });
    } catch (err: any) {
      console.error('Error saving verification:', err);
      setError(err.message || 'Error al guardar los cambios. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof VerificationData, value: string) => {
    setVerificationData(prev => ({
      ...prev,
      [field]: value,
    }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Info message */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          Revisa y edita los datos del socio comercial. Los cambios serán guardados en el siguiente paso.
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">{error}</div>
        </div>
      )}

      {/* Datos del Socio */}
      <div>
        <h3 className="text-sm font-semibold text-[#4a2c0a] mb-3">Datos del Socio Comercial</h3>
        <div className={`${CARD_CLS} space-y-3`}>
          {/* Folio (read-only) */}
          <div>
            <label className={LABEL_CLS}>Folio</label>
            <input
              type="text"
              value={partner.folio || ''}
              disabled
              className={INPUT_CLS}
            />
          </div>

          {/* Nombre negocio y Responsable */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>
                Nombre del negocio <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={verificationData.business_name}
                onChange={e => handleInputChange('business_name', e.target.value)}
                className={`${INPUT_CLS} ${validationErrors.business_name ? 'border-red-500' : ''}`}
              />
              {validationErrors.business_name && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.business_name}</p>
              )}
            </div>
            <div>
              <label className={LABEL_CLS}>
                Responsable <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={verificationData.responsible_name}
                onChange={e => handleInputChange('responsible_name', e.target.value)}
                className={`${INPUT_CLS} ${validationErrors.responsible_name ? 'border-red-500' : ''}`}
              />
              {validationErrors.responsible_name && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.responsible_name}</p>
              )}
            </div>
          </div>

          {/* Teléfono y WhatsApp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Teléfono</label>
              <input
                type="text"
                value={verificationData.phone}
                onChange={e => handleInputChange('phone', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>WhatsApp</label>
              <input
                type="text"
                value={verificationData.whatsapp}
                onChange={e => handleInputChange('whatsapp', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Correo */}
          <div>
            <label className={LABEL_CLS}>Correo</label>
            <input
              type="email"
              value={verificationData.email}
              onChange={e => handleInputChange('email', e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {/* Dirección */}
          <div>
            <label className={LABEL_CLS}>Dirección</label>
            <input
              type="text"
              value={verificationData.address}
              onChange={e => handleInputChange('address', e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {/* Neighborhood, City, State */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLS}>Colonia / Delegación</label>
              <input
                type="text"
                value={verificationData.neighborhood}
                onChange={e => handleInputChange('neighborhood', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Ciudad</label>
              <input
                type="text"
                value={verificationData.city}
                onChange={e => handleInputChange('city', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Estado</label>
              <input
                type="text"
                value={verificationData.state}
                onChange={e => handleInputChange('state', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Postal Code */}
          <div>
            <label className={LABEL_CLS}>Código Postal</label>
            <input
              type="text"
              value={verificationData.postal_code}
              onChange={e => handleInputChange('postal_code', e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {/* Giro y Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>
                Giro <span className="text-red-500">*</span>
              </label>
              <select
                value={verificationData.business_type}
                onChange={e => handleInputChange('business_type', e.target.value)}
                className={`${INPUT_CLS} ${validationErrors.business_type ? 'border-red-500' : ''}`}
              >
                <option value="">Selecciona un giro</option>
                {BUSINESS_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {validationErrors.business_type && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.business_type}</p>
              )}
            </div>
            <div>
              <label className={LABEL_CLS}>
                Estado <span className="text-red-500">*</span>
              </label>
              <select
                value={verificationData.status}
                onChange={e => handleInputChange('status', e.target.value)}
                className={`${INPUT_CLS} ${validationErrors.status ? 'border-red-500' : ''}`}
              >
                <option value="">Selecciona un estado</option>
                {STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {validationErrors.status && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.status}</p>
              )}
            </div>
          </div>

          {/* Giro "Otro" specification */}
          {verificationData.business_type === 'otro' && (
            <div>
              <label className={LABEL_CLS}>
                Especifica el giro <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={verificationData.business_type_other}
                onChange={e => handleInputChange('business_type_other', e.target.value)}
                placeholder="Describe el giro comercial"
                className={`${INPUT_CLS} ${validationErrors.business_type_other ? 'border-red-500' : ''}`}
              />
              {validationErrors.business_type_other && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.business_type_other}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Validaciones Requeridas */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#4a2c0a]">Validaciones Requeridas</h3>

        <div className={`flex items-start gap-3 p-3 bg-white rounded-lg border ${validationErrors.datosVerificados ? 'border-red-500' : 'border-[#e8d5a0]'}`}>
          <input
            type="checkbox"
            id="datosVerificados"
            checked={datosVerificados}
            onChange={e => setDatosVerificados(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
          />
          <label htmlFor="datosVerificados" className="text-sm text-[#111111] cursor-pointer">
            Confirmo que los datos del socio fueron revisados y son correctos.
          </label>
        </div>

        <div className={`flex items-start gap-3 p-3 bg-white rounded-lg border ${validationErrors.consentimiento ? 'border-red-500' : 'border-[#e8d5a0]'}`}>
          <input
            type="checkbox"
            id="privacidad"
            checked={consentimientoAceptado}
            onChange={e => setConsentimientoAceptado(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
          />
          <label htmlFor="privacidad" className="text-sm text-[#111111] cursor-pointer">
            El socio acepta el tratamiento de sus datos personales para fines de identificación, alta comercial, generación de contrato y seguimiento de relación B2B.
          </label>
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-4 border-t border-[#e8d5a0]">
        <button
          onClick={handleSaveVerificationAndContinue}
          disabled={loading}
          className="w-full px-4 py-3 bg-[#111111] text-[#D6A23A] font-semibold rounded-lg hover:bg-[#374151] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader size={16} className="animate-spin" />}
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </button>
      </div>
    </div>
  );
};

export default WholesaleDataVerification;
