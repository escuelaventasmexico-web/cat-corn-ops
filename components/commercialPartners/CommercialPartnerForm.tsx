import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase';
import { X, Loader2, Save, AlertCircle, Camera, Trash2, ImageOff } from 'lucide-react';
import {
  CommercialPartner,
  BUSINESS_TYPES,
  PARTNER_MODELS,
  PARTNER_STATUSES,
} from './types';
import { OpenStreetMapPicker, type OSMLocationResult } from './OpenStreetMapPicker';
import { uploadPartnerPhoto } from './CommercialPartnerPhotos';
import WholesaleActivationWizard from './wholesale/WholesaleActivationWizard';

interface CommercialPartnerFormProps {
  partner?: CommercialPartner | null; // null = create mode
  onClose: () => void;
  onSaved: (partner: CommercialPartner) => void;
  /** Called when the partner was created but some photos failed to upload */
  onPhotoWarning?: (msg: string) => void;
}

type FormState = Omit<CommercialPartner, 'id' | 'folio' | 'created_at' | 'updated_at'>;

const EMPTY_FORM: FormState = {
  business_name: '',
  responsible_name: '',
  phone: '',
  whatsapp: '',
  email: '',
  business_type: '',
  business_type_other: '',
  partner_model: '',
  status: '',
  address: '',
  neighborhood: '',
  city: '',
  state: '',
  postal_code: '',
  google_maps_url: '',
  latitude: null,
  longitude: null,
  location_notes: '',
  opening_hours: '',
  preferred_visit_days: '',
  assigned_to: '',
  created_by: '',
  notes: '',
  active: true,
};

const toFormState = (p: CommercialPartner): FormState => ({
  business_name: p.business_name,
  responsible_name: p.responsible_name,
  phone: p.phone ?? '',
  whatsapp: p.whatsapp ?? '',
  email: p.email ?? '',
  business_type: p.business_type,
  business_type_other: p.business_type_other ?? '',
  partner_model: p.partner_model,
  status: p.status,
  address: p.address ?? '',
  neighborhood: p.neighborhood ?? '',
  city: p.city ?? '',
  state: p.state ?? '',
  postal_code: p.postal_code ?? '',
  google_maps_url: p.google_maps_url ?? '',
  latitude: p.latitude ?? null,
  longitude: p.longitude ?? null,
  location_notes: p.location_notes ?? '',
  opening_hours: p.opening_hours ?? '',
  preferred_visit_days: p.preferred_visit_days ?? '',
  assigned_to: p.assigned_to ?? '',
  created_by: p.created_by ?? '',
  notes: p.notes ?? '',
  active: p.active ?? true,
});

// ─── Schedule helpers (module-level) ────────────────────────────────────────
const HOURS = [
  '06:00','07:00','08:00','09:00','10:00','11:00','12:00',
  '13:00','14:00','15:00','16:00','17:00','18:00','19:00',
  '20:00','21:00','22:00','23:00','00:00',
];

const ALL_DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const MON_FRI  = ALL_DAYS.slice(0, 5);
const WEEKEND  = ALL_DAYS.slice(5);

const QUICK_DAY_SELECTS: { label: string; days: string[] }[] = [
  { label: 'Lun \u2013 Vie',      days: [...MON_FRI]  },
  { label: 'Fin de semana',  days: [...WEEKEND]   },
  { label: 'Todos los días', days: [...ALL_DAYS]  },
  { label: 'No especificado', days: []            },
];

function parseHours(val?: string | null): { open: string; close: string } {
  if (!val) return { open: '', close: '' };
  if (val.trim() === 'No especificado') return { open: 'no_especificado', close: '' };
  const m = val.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (m) return { open: m[1], close: m[2] };
  return { open: '', close: '' };
}

function parseDays(val?: string | null): string[] {
  if (!val || val.trim() === 'No especificado') return [];
  if (val.trim() === 'Todos los días') return [...ALL_DAYS];
  if (val.trim() === 'Lunes a viernes') return [...MON_FRI];
  if (val.trim() === 'Fin de semana') return [...WEEKEND];
  const cleaned = val.replace(/ y /g, ', ').split(',').map(s => s.trim()).filter(Boolean);
  return cleaned.filter(d => ALL_DAYS.includes(d));
}

function composeDays(days: string[]): string {
  const sorted = ALL_DAYS.filter(d => days.includes(d));
  if (sorted.length === 0) return 'No especificado';
  if (sorted.length === 7) return 'Todos los días';
  if (sorted.length === 5 && MON_FRI.every(d => sorted.includes(d))) return 'Lunes a viernes';
  if (sorted.length === 2 && WEEKEND.every(d => sorted.includes(d))) return 'Fin de semana';
  if (sorted.length === 1) return sorted[0];
  return sorted.slice(0, -1).join(', ') + ' y ' + sorted[sorted.length - 1];
}

// ─── Photo staging types ─────────────────────────────────────────────────
interface PendingPhoto {
  id: string;       // local UI key
  file: File;
  type: string;
  caption: string;
  previewUrl: string;
}

const FORM_PHOTO_TYPES = [
  { value: 'fachada',    label: 'Fachada' },
  { value: 'interior',   label: 'Interior' },
  { value: 'exhibicion', label: 'Exhibición' },
  { value: 'anaquel',    label: 'Anaquel' },
  { value: 'otro',       label: 'Otro' },
];

export const CommercialPartnerForm = ({
  partner,
  onClose,
  onSaved,
  onPhotoWarning,
}: CommercialPartnerFormProps) => {
  const isEditing = !!partner;
  const [form, setForm] = useState<FormState>(
    partner ? toFormState(partner) : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Mayoreo activation state ────────────────────────────────────────────────
  const [showMayoreoConfirmation, setShowMayoreoConfirmation] = useState(false);
  const [showMayoreoWizard, setShowMayoreoWizard] = useState(false);
  const [pendingPartnerData, setPendingPartnerData] = useState<CommercialPartner | null>(null);

  // ─── Schedule UI state ───────────────────────────────────────────────────────
  const [openHour,     setOpenHour]     = useState<string>(() => parseHours(partner?.opening_hours).open);
  const [closeHour,    setCloseHour]    = useState<string>(() => parseHours(partner?.opening_hours).close);
  const [selectedDays, setSelectedDays] = useState<string[]>(() => parseDays(partner?.preferred_visit_days));

  // ─── Pending photos (create mode only) ──────────────────────────────────────
  const [pendingPhotos,  setPendingPhotos]  = useState<PendingPhoto[]>([]);
  const [photoAddError,  setPhotoAddError]  = useState<string | null>(null);
  const pendingPhotosInputRef = useRef<HTMLInputElement>(null);
  // Ref tracks latest array so cleanup on unmount works correctly
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  pendingPhotosRef.current = pendingPhotos;
  useEffect(() => () => {
    pendingPhotosRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  // Reset when partner prop changes
  useEffect(() => {
    const parsedH = parseHours(partner?.opening_hours);
    setOpenHour(parsedH.open);
    setCloseHour(parsedH.close);
    setSelectedDays(parseDays(partner?.preferred_visit_days));
    pendingPhotosRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPendingPhotos([]);
    setPhotoAddError(null);
    setForm(partner ? toFormState(partner) : EMPTY_FORM);
    setErrors({});
    setSaveError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner]);

  /* ─── Helpers ────────────────────────────────────────────── */
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormState, string>> = {};
    if (!form.business_name.trim()) newErrors.business_name = 'Requerido';
    if (!form.responsible_name.trim()) newErrors.responsible_name = 'Requerido';
    if (!form.business_type) newErrors.business_type = 'Requerido';
    if (form.business_type === 'otro' && !form.business_type_other?.trim())
      newErrors.business_type_other = 'Especifica el giro';
    if (!form.partner_model) newErrors.partner_model = 'Requerido';
    if (!form.status) newErrors.status = 'Requerido';
    // Hours: error si solo se llenó uno de los dos lados
    const openIsTime  = openHour  !== '' && openHour  !== 'no_especificado';
    const closeIsTime = closeHour !== '' && closeHour !== 'no_especificado';
    if (openIsTime && !closeHour)  newErrors.opening_hours = 'Selecciona también la hora de cierre';
    if (!openHour && closeIsTime)  newErrors.opening_hours = 'Selecciona también la hora de apertura';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /* ─── Handle partner model change with mayoreo interception ───────────────── */
  const handlePartnerModelChange = (newModel: string) => {
    // Si el modelo es mayoreo, revisar si ya está activado
    if (newModel === 'mayoreo') {
      // Determinar si mayoreo ya está activo
      const isWholesaleActive =
        form.partner_model === 'mayoreo' ||
        partner?.partner_model === 'mayoreo' ||
        partner?.wholesale_status === 'active';

      // Si ya está activo, solo cambiar el form sin mostrar confirmación
      if (isWholesaleActive) {
        set('partner_model', newModel);
        return;
      }

      // Si no está activado y es un socio existente, mostrar confirmación
      if (partner?.id) {
        setShowMayoreoConfirmation(true);
        return;
      }

      // Si es socio nuevo, mostrar error
      if (!partner?.id) {
        setSaveError('Primero guarda el socio comercial. Después podrás activar esquema Mayoreo desde su ficha.');
        return;
      }
    }

    // Cambio normal de modelo
    set('partner_model', newModel);
  };

  /* ─── Save ───────────────────────────────────────────────── */
  const handleSave = async () => {
    if (!supabase || !validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Compute standardized schedule values from UI selects/chips
      const isNoEspHours = openHour === 'no_especificado' || (!openHour && !closeHour);
      const computedOpeningHours = isNoEspHours ? 'No especificado' : `${openHour} - ${closeHour}`;
      const computedDays = composeDays(selectedDays);
      const payload: Record<string, any> = {
        business_name: form.business_name.trim(),
        responsible_name: form.responsible_name.trim(),
        phone: form.phone?.trim() || null,
        whatsapp: form.whatsapp?.trim() || null,
        email: form.email?.trim() || null,
        business_type: form.business_type,
        business_type_other:
          form.business_type === 'otro' ? (form.business_type_other?.trim() || null) : null,
        partner_model: form.partner_model,
        status: form.status,
        address: form.address?.trim() || null,
        neighborhood: form.neighborhood?.trim() || null,
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        postal_code: form.postal_code?.trim() || null,
        google_maps_url: form.google_maps_url?.trim() || null,
        latitude:
          form.latitude !== null && form.latitude !== undefined && String(form.latitude).trim() !== ''
            ? Number(form.latitude)
            : null,
        longitude:
          form.longitude !== null && form.longitude !== undefined && String(form.longitude).trim() !== ''
            ? Number(form.longitude)
            : null,
        location_notes: form.location_notes?.trim() || null,
        opening_hours: computedOpeningHours,
        preferred_visit_days: computedDays,
        notes: form.notes?.trim() || null,
        active: form.active,
      };

      if (isEditing && partner) {
        const { data, error } = await supabase
          .from('commercial_partners')
          .update(payload)
          .eq('id', partner.id)
          .select()
          .single();
        if (error) throw error;
        onSaved(data as CommercialPartner);
      } else {
        const { data, error } = await supabase
          .from('commercial_partners')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        const newPartner = data as CommercialPartner;
        // Upload any staged photos — if some fail, we still proceed
        let photoFailCount = 0;
        for (const pp of pendingPhotos) {
          try {
            await uploadPartnerPhoto(newPartner.id, pp.file, pp.type, pp.caption.trim() || null);
          } catch {
            photoFailCount++;
          }
        }
        // Always deliver the partner to the parent (closes form, opens detail)
        onSaved(newPartner);
        if (photoFailCount > 0 && onPhotoWarning) {
          onPhotoWarning(
            `El socio se creó, pero ${photoFailCount} foto${photoFailCount > 1 ? 's' : ''} no pudo${photoFailCount > 1 ? 'ron' : ''} subirse. Puedes intentarlo desde el panel de detalle.`
          );
        }
      }
    } catch (e: any) {
      setSaveError(e?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  /* ─── OSM location callback ────────────────────────────────── */
  const handleLocationSelect = (result: OSMLocationResult) => {
    setForm(prev => ({
      ...prev,
      latitude:       result.latitude,
      longitude:      result.longitude,
      google_maps_url: result.google_maps_url,
      // Auto-fill address only if the user left it empty
      address: prev.address?.trim() ? prev.address : (result.formatted_address || prev.address || ''),
    }));
  };
  /* ─── Pending photo handlers (create mode) ─────────────────────────────── */
  const addPendingPhotos = (files: FileList | null) => {
    if (!files) return;
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    const newItems: PendingPhoto[] = [];
    const errs: string[] = [];
    Array.from(files).forEach(file => {
      if (!ACCEPTED.includes(file.type)) {
        errs.push(`${file.name}: tipo no permitido (usa JPG, PNG o WebP)`);
        return;
      }
      if (file.size > MAX_BYTES) {
        errs.push(`${file.name}: supera los 5 MB`);
        return;
      }
      newItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        type: 'fachada',
        caption: '',
        previewUrl: URL.createObjectURL(file),
      });
    });
    setPhotoAddError(errs.length ? errs.join(' · ') : null);
    if (newItems.length) setPendingPhotos(prev => [...prev, ...newItems]);
    if (pendingPhotosInputRef.current) pendingPhotosInputRef.current.value = '';
  };

  const removePendingPhoto = (id: string) => {
    setPendingPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const updatePendingPhoto = (id: string, field: 'type' | 'caption', value: string) => {
    setPendingPhotos(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };
  /* ─── Field helpers ──────────────────────────────────────── */
  const field = (
    label: string,
    key: keyof FormState,
    opts?: { type?: string; placeholder?: string; required?: boolean }
  ) => (
    <div>
      <label className="block text-xs font-medium text-[#374151] mb-1">
        {label} {opts?.required && <span className="text-[#7a4a0a] font-bold">*</span>}
      </label>
      <input
        type={opts?.type ?? 'text'}
        value={(form[key] as string) ?? ''}
        onChange={e => set(key, e.target.value as any)}
        placeholder={opts?.placeholder}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-sm text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-[#7a4a0a] transition-colors ${
          errors[key] ? 'border-red-500' : 'border-[#c49330]'
        }`}
      />
      {errors[key] && <p className="text-red-700 text-xs mt-0.5">{errors[key]}</p>}
    </div>
  );

  const selectField = (
    label: string,
    key: keyof FormState,
    options: { value: string; label: string }[],
    opts?: { required?: boolean; placeholder?: string }
  ) => (
    <div>
      <label className="block text-xs font-medium text-[#374151] mb-1">
        {label} {opts?.required && <span className="text-[#7a4a0a] font-bold">*</span>}
      </label>
      <select
        value={(form[key] as string) ?? ''}
        onChange={e => set(key, e.target.value as any)}
        style={{ color: '#111111', backgroundColor: '#ffffff' }}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7a4a0a] transition-colors ${
          errors[key] ? 'border-red-500' : 'border-[#c49330]'
        }`}
      >
        <option value="" style={{ color: '#111111', background: '#ffffff' }}>{opts?.placeholder ?? 'Seleccionar...'}</option>
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ color: '#111111', background: '#ffffff' }}>{o.label}</option>
        ))}
      </select>
      {errors[key] && <p className="text-red-700 text-xs mt-0.5">{errors[key]}</p>}
    </div>
  );

  const selectFieldPartnerModel = (
    label: string,
    options: { value: string; label: string }[],
    opts?: { required?: boolean; placeholder?: string }
  ) => (
    <div>
      <label className="block text-xs font-medium text-[#374151] mb-1">
        {label} {opts?.required && <span className="text-[#7a4a0a] font-bold">*</span>}
      </label>
      <select
        value={form.partner_model ?? ''}
        onChange={e => handlePartnerModelChange(e.target.value)}
        style={{ color: '#111111', backgroundColor: '#ffffff' }}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7a4a0a] transition-colors ${
          errors.partner_model ? 'border-red-500' : 'border-[#c49330]'
        }`}
      >
        <option value="" style={{ color: '#111111', background: '#ffffff' }}>{opts?.placeholder ?? 'Seleccionar...'}</option>
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ color: '#111111', background: '#ffffff' }}>{o.label}</option>
        ))}
      </select>
      {errors.partner_model && <p className="text-red-700 text-xs mt-0.5">{errors.partner_model}</p>}
    </div>
  );

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-[#D6A23A] rounded-2xl border border-[#a87820] my-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/20">
          <h2 className="text-lg font-bold text-[#111111]">
            {isEditing ? 'Editar socio comercial' : 'Nuevo socio comercial'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#1f2937] hover:bg-black/10 hover:text-black transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {/* Section: Datos principales */}
          <section className="space-y-4">
            <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
              Datos principales
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Nombre del negocio', 'business_name', { required: true, placeholder: 'Ej. Mariscos El Capitán' })}
              {field('Dueño / Gerente / Responsable', 'responsible_name', { required: true, placeholder: 'Nombre completo' })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {selectField('Giro', 'business_type', BUSINESS_TYPES, { required: true })}
              {selectFieldPartnerModel('Modelo comercial', PARTNER_MODELS, { required: true })}
              {selectField('Estado', 'status', PARTNER_STATUSES, { required: true })}
            </div>
            {form.business_type === 'otro' && (
              <div>
                {field('Especificar giro', 'business_type_other', {
                  required: true,
                  placeholder: 'Describe el tipo de negocio',
                })}
              </div>
            )}
          </section>

          {/* Section: Contacto */}
          <section className="space-y-4">
            <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
              Contacto
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {field('Teléfono', 'phone', { type: 'tel', placeholder: '55 1234 5678' })}
              {field('WhatsApp', 'whatsapp', { type: 'tel', placeholder: '55 1234 5678' })}
              {field('Correo electrónico', 'email', { type: 'email', placeholder: 'correo@ejemplo.com' })}
            </div>
          </section>

          {/* Section: Ubicación */}
          <section className="space-y-4">
            <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
              Ubicación
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Dirección', 'address', { placeholder: 'Calle, número' })}
              {field('Colonia', 'neighborhood', { placeholder: 'Colonia' })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {field('Ciudad', 'city', { placeholder: 'Ciudad' })}
              {field('Estado', 'state', { placeholder: 'Estado' })}
              {field('Código postal', 'postal_code', { placeholder: 'CP' })}
            </div>

            {/* OpenStreetMap interactive picker */}
            <div>
              <p className="text-xs font-medium text-[#374151] mb-2">Ubicación en el mapa</p>
              <OpenStreetMapPicker
                key={partner?.id ?? 'new'}
                initialLatitude={form.latitude}
                initialLongitude={form.longitude}
                initialAddress={form.address || ''}
                onLocationSelect={handleLocationSelect}
              />
            </div>

            {field('Referencias para llegar', 'location_notes', {
              placeholder: 'Ej. Frente al parque, junto al OXXO...',
            })}
          </section>

          {/* Section: Operación */}
          <section className="space-y-5">
            <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
              Operación
            </p>

            {/* ── Horario de atención ─────────────────────────────────── */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#374151]">Horario de atención</label>
              <div className="grid grid-cols-2 gap-3">
                {/* Apertura */}
                <div>
                  <p className="text-xs text-[#6b7280] mb-1">Apertura</p>
                  <select
                    value={openHour}
                    onChange={e => {
                      const v = e.target.value;
                      setOpenHour(v);
                      if (v === 'no_especificado') setCloseHour('');
                      setErrors(prev => ({ ...prev, opening_hours: undefined }));
                    }}
                    style={{ color: '#111111', backgroundColor: '#ffffff' }}
                    className="w-full border border-[#c49330] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7a4a0a] transition-colors"
                  >
                    <option value="">Seleccionar...</option>
                    <option value="no_especificado" style={{ color: '#111111', background: '#ffffff' }}>No especificado</option>
                    {HOURS.map(h => (
                      <option key={h} value={h} style={{ color: '#111111', background: '#ffffff' }}>{h}</option>
                    ))}
                  </select>
                </div>
                {/* Cierre */}
                <div>
                  <p className="text-xs text-[#6b7280] mb-1">Cierre</p>
                  <select
                    value={closeHour}
                    onChange={e => {
                      setCloseHour(e.target.value);
                      setErrors(prev => ({ ...prev, opening_hours: undefined }));
                    }}
                    disabled={openHour === 'no_especificado'}
                    style={{
                      color: '#111111',
                      backgroundColor: openHour === 'no_especificado' ? '#f3f4f6' : '#ffffff',
                    }}
                    className="w-full border border-[#c49330] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7a4a0a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Seleccionar...</option>
                    {HOURS.map(h => (
                      <option key={h} value={h} style={{ color: '#111111', background: '#ffffff' }}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>
              {errors.opening_hours && (
                <p className="text-red-700 text-xs mt-0.5">{errors.opening_hours}</p>
              )}
              <p className="text-xs text-[#4a2c0a] italic">
                Se guardará como:{' '}
                <strong>
                  {openHour === 'no_especificado' || (!openHour && !closeHour)
                    ? 'No especificado'
                    : openHour && closeHour
                    ? `${openHour} - ${closeHour}`
                    : 'Selecciona apertura y cierre'}
                </strong>
              </p>
            </div>

            {/* ── Días recomendados para visita ──────────────────────────── */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#374151]">
                Días recomendados para visita
              </label>
              {/* Accesos rápidos */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_DAY_SELECTS.map(q => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setSelectedDays(q.days)}
                    className="px-2.5 py-1 rounded-md text-xs border border-[#a87820] bg-[#f5e5c0] text-[#4a2c0a] hover:bg-[#e8cc96] font-medium transition-colors"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              {/* Chips de días */}
              <div className="flex flex-wrap gap-1.5">
                {ALL_DAYS.map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setSelectedDays(prev =>
                        prev.includes(day)
                          ? prev.filter(d => d !== day)
                          : [...prev, day]
                      )
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      selectedDays.includes(day)
                        ? 'bg-[#2d1a00] text-[#F6E7C1] border-[#2d1a00]'
                        : 'bg-white text-[#374151] border-[#c49330] hover:border-[#7a4a0a]'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              {/* Vista previa */}
              <p className="text-xs text-[#4a2c0a] italic">
                Se guardará como: <strong>{composeDays(selectedDays)}</strong>
              </p>
            </div>
          </section>

          {/* Section: Notas */}
          <section className="space-y-3">
            <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
              Notas internas
            </p>
            <div>
              <textarea
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)}
                placeholder="Observaciones, historial de visitas, puntos de contacto..."
                rows={3}
                className="w-full bg-white border border-[#c49330] rounded-lg px-3 py-2 text-sm text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-[#7a4a0a] transition-colors resize-none"
              />
            </div>
            {/* Active toggle (edit only) */}
            {isEditing && (
              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div
                  onClick={() => set('active', !form.active)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    form.active ? 'bg-[#4a2c0a]' : 'bg-black/25'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      form.active ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
                <span className="text-sm text-[#1f2937] font-medium">
                  {form.active ? 'Socio activo' : 'Socio inactivo'}
                </span>
              </label>
            )}
          </section>

          {/* Section: Fotografías del lugar (solo modo nuevo) */}
          {!isEditing && (
            <section className="space-y-4">
              <p className="text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider">
                Fotografías del lugar{' '}
                <span className="font-normal normal-case text-[#6b7280]">(opcional)</span>
              </p>

              {/* File picker */}
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[#a87820] bg-[#f5e5c0] hover:bg-[#e8cc96] cursor-pointer transition-colors text-[#4a2c0a] text-sm font-medium">
                <Camera size={15} />
                Seleccionar fotos
                <input
                  ref={pendingPhotosInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={e => addPendingPhotos(e.target.files)}
                />
              </label>

              {photoAddError && (
                <p className="text-red-700 text-xs">{photoAddError}</p>
              )}

              {pendingPhotos.length > 0 ? (
                <div className="space-y-2">
                  {pendingPhotos.map(pp => (
                    <div
                      key={pp.id}
                      className="flex gap-3 items-start bg-white border border-[#c49330] rounded-xl p-3"
                    >
                      {/* Thumbnail */}
                      <img
                        src={pp.previewUrl}
                        alt="preview"
                        className="w-20 h-20 object-cover rounded-lg flex-shrink-0 border border-gray-200"
                      />
                      {/* Controls */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <select
                          value={pp.type}
                          onChange={e => updatePendingPhoto(pp.id, 'type', e.target.value)}
                          style={{ color: '#111111', backgroundColor: '#ffffff' }}
                          className="w-full border border-[#c49330] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#7a4a0a] transition-colors"
                        >
                          {FORM_PHOTO_TYPES.map(t => (
                            <option key={t.value} value={t.value} style={{ color: '#111111', background: '#ffffff' }}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={pp.caption}
                          onChange={e => updatePendingPhoto(pp.id, 'caption', e.target.value)}
                          placeholder="Nota o descripción (opcional)"
                          className="w-full bg-white border border-[#c49330] rounded-lg px-2 py-1.5 text-xs text-[#111111] placeholder:text-gray-400 focus:outline-none focus:border-[#7a4a0a] transition-colors"
                        />
                      </div>
                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removePendingPhoto(pp.id)}
                        className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                        title="Quitar foto"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <p className="text-xs text-[#4a2c0a]">
                    {pendingPhotos.length} foto{pendingPhotos.length !== 1 ? 's' : ''} seleccionada{pendingPhotos.length !== 1 ? 's' : ''}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[#6b7280] text-xs">
                  <ImageOff size={13} />
                  Sin fotos seleccionadas — se pueden agregar después desde el detalle del socio
                </div>
              )}
            </section>
          )}

          {/* Save error */}
          {saveError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-500 px-4 py-3 text-red-700 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/20">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-black/20 text-[#1f2937] hover:bg-black/10 text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#2d1a00] text-[#F6E7C1] font-semibold text-sm hover:bg-[#1a0f00] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear socio'}
          </button>
        </div>
      </div>

      {/* ─── Mayoreo confirmation modal ────────────────────────────────────────── */}
      {showMayoreoConfirmation && partner && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-[#111111] mb-3">Activar esquema Mayoreo</h2>
            <p className="text-sm text-[#374151] mb-6">
              El socio está por cambiarse al esquema Mayoreo. Favor de verificar sus datos antes de continuar.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMayoreoConfirmation(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-[#c49330] text-[#111111] font-medium text-sm hover:bg-[#fffbf0] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowMayoreoConfirmation(false);
                  setShowMayoreoWizard(true);
                  setPendingPartnerData(partner);
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-[#D6A23A] text-[#111111] font-medium text-sm hover:bg-[#c49330] transition-colors"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Mayoreo activation wizard ────────────────────────────────────────── */}
      {showMayoreoWizard && pendingPartnerData && (
        <WholesaleActivationWizard
          partner={pendingPartnerData}
          onClose={() => {
            setShowMayoreoWizard(false);
            setPendingPartnerData(null);
          }}
          onActivated={async () => {
            try {
              // Refrescar el socio desde la BD para obtener partner_model y wholesale_status actualizados
              if (supabase && pendingPartnerData?.id) {
                const { data: updatedPartner, error } = await supabase
                  .from('commercial_partners')
                  .select('*')
                  .eq('id', pendingPartnerData.id)
                  .single();

                if (!error && updatedPartner) {
                  // Actualizar form con los datos actualizados
                  set('partner_model', 'mayoreo');
                  console.log('✅ Socio actualizado con mayoreo activo');
                  // Llamar callback del padre para refrescar lista
                  onSaved(updatedPartner);
                } else {
                  console.warn('⚠️ No se pudo refrescar socio:', error);
                  // De todas formas, actualizar el form
                  set('partner_model', 'mayoreo');
                  onSaved(pendingPartnerData);
                }
              }
            } catch (err) {
              console.error('Error al refrescar socio activado:', err);
              set('partner_model', 'mayoreo');
              onSaved(pendingPartnerData);
            } finally {
              setShowMayoreoWizard(false);
              setPendingPartnerData(null);
            }
          }}
        />
      )}
    </div>
  );
};
