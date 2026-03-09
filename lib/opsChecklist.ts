import { supabase } from '../supabase';

// =====================================================
// TYPES & INTERFACES
// =====================================================

export type ChecklistItemStatus = 'OK' | 'ISSUE' | 'PENDING';

export interface DailyChecklist {
  id: string;
  checklist_date: string;
  responsible_name: string;
}

export interface DailyChecklistItem {
  id: string;
  task_id?: string;
  category: string;
  code?: string;
  label: string;
  sort_order?: number;
  status: ChecklistItemStatus;
  notes: string | null;
}

export interface UpdateChecklistItemResult {
  id: string;
  status: ChecklistItemStatus;
  notes: string | null;
}

// =====================================================
// API FUNCTIONS
// =====================================================

/**
 * Get or create a daily checklist for a specific date and responsible person
 * @param checklistDate - Date in YYYY-MM-DD format
 * @param responsibleName - Name of the responsible person
 * @returns DailyChecklist object with checklist_id, checklist_date, and responsible_name
 */
export const getOrCreateDailyChecklist = async (
  checklistDate: string,
  responsibleName: string
): Promise<DailyChecklist> => {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.rpc('ops_get_or_create_daily_checklist', {
    p_checklist_date: checklistDate,
    p_responsible_name: responsibleName
  });

  if (error) {
    throw new Error(`Error al obtener/crear checklist: ${error.message}`);
  }

  if (!data) {
    throw new Error('No se recibieron datos del checklist');
  }

  // Log raw response
  console.log('[ops rpc]', data);

  // Normalize data (handle array or single object)
  const normalizedData = Array.isArray(data) ? data[0] : data;

  // Extract ID (try checklist_id first, then id)
  const checklistId = normalizedData.checklist_id || normalizedData.id;

  if (!checklistId) {
    throw new Error('La respuesta de RPC no contiene checklist_id ni id');
  }

  return {
    id: checklistId,
    checklist_date: normalizedData.checklist_date,
    responsible_name: normalizedData.responsible_name
  };
};

/**
 * Get all items for a specific daily checklist
 * @param checklistId - UUID of the checklist
 * @returns Array of DailyChecklistItem objects, sorted by sort_order ascending
 */
export const getDailyChecklistItems = async (
  checklistId: string
): Promise<DailyChecklistItem[]> => {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  // Use direct query to daily_checklist_items with join to operational_tasks_master
  const { data, error } = await supabase
    .from('daily_checklist_items')
    .select(`
      id,
      status,
      notes,
      task_id,
      operational_tasks_master (
        category,
        label,
        code,
        sort_order
      )
    `)
    .eq('checklist_id', checklistId)
    .order('operational_tasks_master(sort_order)', { ascending: true });

  if (error) {
    throw new Error(`Error al obtener items del checklist: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Map the data to our interface
  return data
    .map((item: any) => {
      const taskMaster = item.operational_tasks_master;
      return {
        id: item.id,
        task_id: item.task_id || undefined,
        category: taskMaster?.category || 'Sin Categoría',
        code: taskMaster?.code || undefined,
        label: taskMaster?.label || 'Sin Título',
        sort_order: taskMaster?.sort_order !== null ? taskMaster?.sort_order : undefined,
        status: item.status as ChecklistItemStatus,
        notes: item.notes
      };
    })
    .sort((a, b) => {
      // Sort by sort_order ascending, nulls last
      if (a.sort_order === undefined && b.sort_order === undefined) return 0;
      if (a.sort_order === undefined) return 1;
      if (b.sort_order === undefined) return -1;
      return a.sort_order - b.sort_order;
    });
};

/**
 * Update the status and notes of a checklist item
 * @param itemId - UUID of the checklist item
 * @param status - New status ('OK' or 'ISSUE')
 * @param notes - Optional notes (null to clear)
 * @returns Updated item with id, status, and notes
 */
export const updateChecklistItem = async (
  itemId: string,
  status: ChecklistItemStatus,
  notes: string | null
): Promise<UpdateChecklistItemResult> => {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  // Use direct update on daily_checklist_items table
  const { data, error } = await supabase
    .from('daily_checklist_items')
    .update({
      status: status,
      notes: notes
    })
    .eq('id', itemId)
    .select('id, status, notes')
    .single();

  if (error) {
    throw new Error(`Error al actualizar item: ${error.message}`);
  }

  if (!data) {
    throw new Error('No se recibió confirmación de la actualización');
  }

  return {
    id: data.id,
    status: data.status as ChecklistItemStatus,
    notes: data.notes
  };
};

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
export const getTodayDate = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Format date for display (e.g., "25 de febrero de 2026")
 */
export const formatDateDisplay = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

/**
 * Check if all items in a checklist are marked as OK
 */
export const isChecklistComplete = (items: DailyChecklistItem[]): boolean => {
  return items.length > 0 && items.every(item => item.status === 'OK');
};

/**
 * Count items by status
 */
export const getChecklistStats = (items: DailyChecklistItem[]) => {
  const okCount      = items.filter(item => item.status === 'OK').length;
  const issueCount   = items.filter(item => item.status === 'ISSUE').length;
  const pendingCount = items.filter(item => item.status === 'PENDING').length;
  const total        = items.length;
  // Only OK counts as completed; PENDING and ISSUE do not
  const completionPercent = total > 0 ? Math.round((okCount / total) * 100) : 0;

  return {
    okCount,
    issueCount,
    pendingCount,
    total,
    completionPercent
  };
};
