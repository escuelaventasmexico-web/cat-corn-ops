import { supabase } from '../supabase';

type FinancialAccessPasswordVerification =
  | { status: 'verified' }
  | { status: 'invalid'; errorMessage: string }
  | { status: 'error'; errorMessage: string };

/**
 * Validates the existing secondary financial-access password. The password is
 * sent only to the installed verification RPC and is never persisted here.
 */
export const verifyFinancialAccessPassword = async (
  password: string,
): Promise<FinancialAccessPasswordVerification> => {
  if (!supabase) {
    return { status: 'error', errorMessage: 'No se pudo verificar la clave financiera. Intenta nuevamente.' };
  }

  const { data, error } = await supabase.rpc('verify_financial_access_password', {
    p_password: password,
  });

  if (error) {
    return { status: 'error', errorMessage: 'No se pudo verificar la clave financiera. Intenta nuevamente.' };
  }

  // The installed RPC is declared as RETURNS TABLE, so Supabase can return an
  // array even when it produces just one verification result.
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return { status: 'error', errorMessage: 'No se pudo verificar la clave financiera. Intenta nuevamente.' };
  }

  if (result.success === true) {
    return { status: 'verified' };
  }

  return {
    status: 'invalid',
    errorMessage: result.error_message || 'Clave financiera incorrecta.',
  };
};
