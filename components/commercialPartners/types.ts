// Shared types for the Commercial Partners module

export interface CommercialPartner {
  id: string;
  folio?: string | null;
  business_name: string;
  responsible_name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  business_type: string;
  business_type_other?: string | null;
  partner_model: string;
  status: string;
  wholesale_status?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_notes?: string | null;
  opening_hours?: string | null;
  preferred_visit_days?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  notes?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const BUSINESS_TYPES = [
  { value: 'restaurante',        label: 'Restaurante' },
  { value: 'tienda',             label: 'Tienda' },
  { value: 'bar',                label: 'Bar' },
  { value: 'cafeteria',          label: 'Cafetería' },
  { value: 'lugar_con_alcohol',  label: 'Lugar con alcohol' },
  { value: 'oficina',            label: 'Oficina' },
  { value: 'otro',               label: 'Otro' },
];

export const PARTNER_MODELS = [
  { value: 'prospecto', label: 'Prospecto' },
  { value: 'comodato',  label: 'Comodato' },
  { value: 'mayoreo',   label: 'Mayoreo' },
];

export const PARTNER_STATUSES = [
  { value: 'prospecto',       label: 'Prospecto' },
  { value: 'en_negociacion',  label: 'En negociación' },
  { value: 'activo',          label: 'Activo' },
  { value: 'pausado',         label: 'Pausado' },
  { value: 'rechazado',       label: 'Rechazado' },
  { value: 'inactivo',        label: 'Inactivo' },
];

export const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  prospecto:      { label: 'Prospecto',       className: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  en_negociacion: { label: 'En negociación',  className: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  activo:         { label: 'Activo',          className: 'bg-green-500/15 text-green-300 border-green-500/30' },
  pausado:        { label: 'Pausado',         className: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  rechazado:      { label: 'Rechazado',       className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  inactivo:       { label: 'Inactivo',        className: 'bg-white/5 text-cc-text-muted border-white/10' },
};

export const MODEL_BADGE: Record<string, { label: string; className: string }> = {
  prospecto: { label: 'Prospecto', className: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  comodato:  { label: 'Comodato',  className: 'bg-cc-primary/15 text-cc-primary border-cc-primary/30' },
  mayoreo:   { label: 'Mayoreo',   className: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
};
