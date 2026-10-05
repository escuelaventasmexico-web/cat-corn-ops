import { supabase } from '../supabase';
import { supabaseError } from './supabaseError';

export interface AdminOperationalAlert {
  id: string;
  branch_id: string;
  branch_name: string;
  cash_session_id: string | null;
  actor_name: string;
  alert_type: 'cash_inventory_opening' | 'cash_inventory_closing' | string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export async function fetchAdminOperationalAlerts(
  includeRead = false,
): Promise<AdminOperationalAlert[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_admin_operational_alerts', {
    p_include_read: includeRead,
  });
  if (error) {
    console.error('[OPERATIONS] Error fetching alerts:', error);
    throw supabaseError(error, 'No se pudieron cargar las alertas operativas');
  }
  return ((data || []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.alert_id ?? row.id),
    branch_id: String(row.branch_id),
    branch_name: String(row.branch_name || 'Sucursal'),
    cash_session_id: row.cash_session_id ? String(row.cash_session_id) : null,
    actor_name: String(row.actor_name || 'Usuario'),
    alert_type: String(row.alert_type),
    title: String(row.title),
    message: String(row.message),
    payload: (row.payload as Record<string, unknown> | null) || {},
    created_at: String(row.created_at),
    read_at: row.read_at ? String(row.read_at) : null,
  }));
}

export async function acknowledgeAdminOperationalAlert(alertId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');
  const { error } = await supabase.rpc('acknowledge_admin_operational_alert', {
    p_alert_id: alertId,
  });
  if (error) {
    console.error('[OPERATIONS] Error acknowledging alert:', error);
    throw supabaseError(error, 'No se pudo marcar la alerta como leída');
  }
}
