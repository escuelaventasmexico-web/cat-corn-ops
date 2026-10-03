export type ProspectStatus =
  | 'nuevo'
  | 'seguimiento'
  | 'visita_programada'
  | 'convertido'
  | 'no_interesado'
  | 'archivado';

export type ProspectResult =
  | 'no_contesto'
  | 'numero_incorrecto'
  | 'encargado_ausente'
  | 'pidio_informacion'
  | 'llamar_despues'
  | 'interesado'
  | 'solicito_visita'
  | 'no_interesado';

export interface CommercialProspect {
  id: string;
  business_name: string;
  business_type: 'tienda' | 'bar' | 'restaurante' | 'cafeteria' | 'otro';
  phone: string;
  address: string | null;
  location_reference: string | null;
  contact_name: string | null;
  sells_snacks: 'yes' | 'no' | 'unknown';
  status: ProspectStatus;
  latest_result: ProspectResult | null;
  next_follow_up_at: string | null;
  proposed_visit_at: string | null;
  general_notes: string | null;
  created_by: string;
  originator_user_id: string;
  assigned_to: string | null;
  origin_channel: string;
  converted_by: string | null;
  converted_at: string | null;
  commercial_partner_id: string | null;
  created_at: string;
  updated_at: string;
  originator_name: string | null;
  assigned_to_name: string | null;
  converted_by_name: string | null;
  commercial_partner_folio: string | null;
  interaction_count: number;
  last_interaction_at: string | null;
}

export interface ProspectInteraction {
  id: string;
  prospect_id: string;
  occurred_at: string;
  performed_by: string;
  result: ProspectResult;
  notes: string | null;
  next_follow_up_at: string | null;
  proposed_visit_at: string | null;
  created_at: string;
}

export interface DuplicateWarning {
  source: 'prospecto' | 'socio';
  match_type: string;
  id: string | null;
  label: string;
  status: string | null;
  phone_hint: string | null;
}

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  nuevo: 'Nuevo',
  seguimiento: 'Seguimiento',
  visita_programada: 'Visita programada',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
  archivado: 'Archivado',
};

export const PROSPECT_RESULT_LABELS: Record<ProspectResult, string> = {
  no_contesto: 'No contestó',
  numero_incorrecto: 'Número incorrecto',
  encargado_ausente: 'Encargado ausente',
  pidio_informacion: 'Pidió información',
  llamar_despues: 'Llamar después',
  interesado: 'Interesado',
  solicito_visita: 'Solicitó visita',
  no_interesado: 'No interesado',
};

export const PROSPECT_BUSINESS_TYPES = [
  { value: 'tienda', label: 'Tienda' },
  { value: 'bar', label: 'Bar' },
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'cafeteria', label: 'Cafetería' },
  { value: 'otro', label: 'Otro' },
] as const;

