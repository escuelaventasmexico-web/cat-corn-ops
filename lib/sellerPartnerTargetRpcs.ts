import { supabase } from '../supabase';

export interface SellerMonthlyPartnerProgress {
  seller_id: string;
  seller_name: string;
  month_start: string;
  target_active_partners: number | null;
  achieved_active_partners: number;
  remaining_active_partners: number | null;
  progress_percentage: number | null;
}

export interface SetTargetResponse {
  success: boolean;
  target_id: string | null;
  error_message: string | null;
}

/**
 * Obtiene el progreso mensual de metas de socios para un vendedor
 * @param sellerId UUID del vendedor
 * @param monthStart Fecha de inicio del mes (YYYY-MM-DD)
 * @returns Progreso con meta, socios logrados, restantes y porcentaje
 */
export async function getSellerMonthlyPartnerProgress(
  sellerId: string,
  monthStart: string
): Promise<SellerMonthlyPartnerProgress | null> {
  if (!supabase) {
    console.error('Supabase no está configurado');
    return null;
  }

  try {
    const { data, error } = await supabase.rpc(
      'get_seller_monthly_partner_progress',
      {
        p_seller_id: sellerId,
        p_month_start: monthStart,
      }
    );

    if (error) {
      console.error('Error fetching partner progress:', error);
      return null;
    }

    // RPC retorna array con una sola fila
    if (data && Array.isArray(data) && data.length > 0) {
      return data[0] as SellerMonthlyPartnerProgress;
    }

    return null;
  } catch (err: any) {
    console.error('Exception in getSellerMonthlyPartnerProgress:', err);
    return null;
  }
}

/**
 * Establece o actualiza la meta mensual de socios (solo admin)
 * @param sellerId UUID del vendedor
 * @param monthStart Fecha de inicio del mes (YYYY-MM-DD)
 * @param targetActivePartners Número meta de socios activos
 * @returns Respuesta con success, target_id y posible error
 */
export async function setSellerMonthlyPartnerTarget(
  sellerId: string,
  monthStart: string,
  targetActivePartners: number
): Promise<SetTargetResponse> {
  if (!supabase) {
    return {
      success: false,
      target_id: null,
      error_message: 'Supabase no está configurado',
    };
  }

  try {
    // Validar entrada
    if (!Number.isInteger(targetActivePartners) || targetActivePartners <= 0) {
      return {
        success: false,
        target_id: null,
        error_message: 'La meta debe ser un número entero positivo',
      };
    }

    const { data, error } = await supabase.rpc(
      'set_seller_monthly_partner_target',
      {
        p_seller_id: sellerId,
        p_month_start: monthStart,
        p_target_active_partners: targetActivePartners,
      }
    );

    if (error) {
      console.error('Error setting partner target:', error);
      return {
        success: false,
        target_id: null,
        error_message: error.message || 'Error al guardar la meta',
      };
    }

    // RPC retorna array con una sola fila
    if (data && Array.isArray(data) && data.length > 0) {
      const result = data[0];
      return {
        success: result.success === true,
        target_id: result.target_id || null,
        error_message: result.error_message || null,
      };
    }

    return {
      success: false,
      target_id: null,
      error_message: 'Respuesta inválida del servidor',
    };
  } catch (err: any) {
    console.error('Exception in setSellerMonthlyPartnerTarget:', err);
    return {
      success: false,
      target_id: null,
      error_message: err.message || 'Error desconocido',
    };
  }
}
