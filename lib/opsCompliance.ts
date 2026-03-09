import { supabase } from '../supabase';

// =====================================================
// TYPES — Fumigación
// =====================================================

export type FumigationStatus = 'VIGENTE' | 'VENCIDO';

export interface OpsFumigation {
  id: string;
  fumigation_date: string;
  provider: string;
  next_fumigation_date: string | null;
  document_id: string | null;
  status: FumigationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewFumigationPayload {
  fumigation_date: string;
  provider: string;
  next_fumigation_date: string | null;
  document_id: string | null;
  status: FumigationStatus;
  notes: string | null;
}

export type UpdateFumigationPayload = Partial<NewFumigationPayload>;

// =====================================================
// TYPES — Limpieza Profunda
// =====================================================

export const DEEP_CLEANING_AREAS = [
  'PISOS',
  'CORTINAS',
  'VITRINAS',
  'REFRIGERADOR',
  'EXTRACTORES',
  'ALMACEN'
] as const;

export type DeepCleaningArea = (typeof DEEP_CLEANING_AREAS)[number];

export interface OpsDeepCleaning {
  id: string;
  area: DeepCleaningArea;
  cleaning_date: string;
  responsible: string;
  evidence_url: string | null;
  next_suggested_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDeepCleaningPayload {
  area: DeepCleaningArea;
  cleaning_date: string;
  responsible: string;
  evidence_url: string | null;
  next_suggested_date: string | null;
  notes: string | null;
}

export type UpdateDeepCleaningPayload = Partial<NewDeepCleaningPayload>;

// =====================================================
// FUMIGACIÓN CRUD
// =====================================================

export const fetchFumigationRecords = async (): Promise<OpsFumigation[]> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_fumigation')
    .select('*')
    .order('fumigation_date', { ascending: false })
    .limit(20);

  if (error) throw new Error(`Error al cargar fumigaciones: ${error.message}`);
  return data ?? [];
};

export const insertFumigationRecord = async (
  payload: NewFumigationPayload
): Promise<OpsFumigation> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_fumigation')
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(`Error al registrar fumigación: ${error.message}`);
  return data;
};

export const updateFumigationRecord = async (
  id: string,
  payload: UpdateFumigationPayload
): Promise<OpsFumigation> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_fumigation')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar fumigación: ${error.message}`);
  return data;
};

// =====================================================
// LIMPIEZA PROFUNDA CRUD
// =====================================================

export const fetchDeepCleaningRecords = async (): Promise<OpsDeepCleaning[]> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_deep_cleaning')
    .select('*')
    .order('cleaning_date', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Error al cargar limpiezas: ${error.message}`);
  return data ?? [];
};

export const insertDeepCleaningRecord = async (
  payload: NewDeepCleaningPayload
): Promise<OpsDeepCleaning> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_deep_cleaning')
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(`Error al registrar limpieza: ${error.message}`);
  return data;
};

export const updateDeepCleaningRecord = async (
  id: string,
  payload: UpdateDeepCleaningPayload
): Promise<OpsDeepCleaning> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_deep_cleaning')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar limpieza: ${error.message}`);
  return data;
};

// =====================================================
// HELPERS — badge / status logic
// =====================================================

/** Compute fumigation display status based on next_fumigation_date vs today */
export const computeFumigationStatus = (
  nextDate: string | null
): { label: string; color: string } => {
  if (!nextDate) return { label: 'Sin próxima fecha', color: 'bg-gray-500/20 text-gray-400' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(nextDate + 'T00:00:00');
  const diffDays = Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: 'Vencido', color: 'bg-red-500/20 text-red-400' };
  if (diffDays <= 5) return { label: 'Vence pronto', color: 'bg-red-500/20 text-red-400' };
  return { label: 'Vigente', color: 'bg-green-500/20 text-green-400' };
};

/** Compute deep-cleaning display status based on next_suggested_date vs today */
export const computeCleaningStatus = (
  nextDate: string | null
): { label: string; color: string } => {
  if (!nextDate) return { label: 'Sin programación', color: 'bg-gray-500/20 text-gray-400' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(nextDate + 'T00:00:00');
  const diffDays = Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return { label: 'Pendiente', color: 'bg-red-500/20 text-red-400' };
  if (diffDays <= 5) return { label: 'Próxima', color: 'bg-yellow-500/20 text-yellow-400' };
  return { label: 'Al día', color: 'bg-green-500/20 text-green-400' };
};
