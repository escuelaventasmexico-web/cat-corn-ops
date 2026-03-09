import { supabase } from '../supabase';

// =====================================================
// TYPES
// =====================================================

export interface OpsMachine {
  id: string;
  name: string;
  machine_type: string;
  serial_number: string | null;
  active: boolean;
  created_at: string;
}

export type MaintenanceType = 'PREVENTIVO' | 'CORRECTIVO';

export interface OpsMaintenance {
  id: string;
  machine_id: string;
  maintenance_date: string;
  maintenance_type: MaintenanceType;
  technician: string;
  cost_mxn: number;
  next_due_date: string | null;
  notes: string | null;
  created_at: string;
  // joined fields
  machine_name?: string;
  machine_type?: string;
}

export interface NewMachinePayload {
  name: string;
  machine_type: string;
  serial_number?: string;
}

export interface NewMaintenancePayload {
  machine_id: string;
  maintenance_date: string;
  maintenance_type: MaintenanceType;
  technician: string;
  cost_mxn: number;
  next_due_date: string | null;
  notes: string | null;
}

// =====================================================
// MACHINES
// =====================================================

export const fetchMachines = async (): Promise<OpsMachine[]> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_machines')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw new Error(`Error al cargar máquinas: ${error.message}`);
  return data ?? [];
};

export const insertMachine = async (payload: NewMachinePayload): Promise<OpsMachine> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_machines')
    .insert({
      name: payload.name,
      machine_type: payload.machine_type,
      serial_number: payload.serial_number || null,
      active: true
    })
    .select()
    .single();

  if (error) throw new Error(`Error al crear máquina: ${error.message}`);
  return data;
};

export const toggleMachineActive = async (id: string, active: boolean): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase
    .from('ops_machines')
    .update({ active })
    .eq('id', id);

  if (error) throw new Error(`Error al actualizar máquina: ${error.message}`);
};

// =====================================================
// MAINTENANCE RECORDS
// =====================================================

export const insertMaintenance = async (payload: NewMaintenancePayload): Promise<OpsMaintenance> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_machine_maintenance')
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(`Error al registrar mantenimiento: ${error.message}`);
  return data;
};

export const fetchUpcomingMaintenance = async (daysAhead: number = 5): Promise<OpsMaintenance[]> => {
  if (!supabase) throw new Error('Supabase not configured');

  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() + daysAhead);
  const limitStr = limitDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('ops_machine_maintenance')
    .select(`
      id,
      machine_id,
      maintenance_date,
      maintenance_type,
      technician,
      cost_mxn,
      next_due_date,
      notes,
      created_at,
      ops_machines (
        name,
        machine_type
      )
    `)
    .not('next_due_date', 'is', null)
    .lte('next_due_date', limitStr)
    .order('next_due_date', { ascending: true });

  if (error) throw new Error(`Error al cargar próximos mantenimientos: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    ...row,
    machine_name: row.ops_machines?.name ?? '',
    machine_type: row.ops_machines?.machine_type ?? '',
    ops_machines: undefined
  }));
};

export const fetchMaintenanceHistory = async (): Promise<OpsMaintenance[]> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('ops_machine_maintenance')
    .select(`
      id,
      machine_id,
      maintenance_date,
      maintenance_type,
      technician,
      cost_mxn,
      next_due_date,
      notes,
      created_at,
      ops_machines (
        name,
        machine_type
      )
    `)
    .order('maintenance_date', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Error al cargar historial: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    ...row,
    machine_name: row.ops_machines?.name ?? '',
    machine_type: row.ops_machines?.machine_type ?? '',
    ops_machines: undefined
  }));
};
