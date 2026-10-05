export const formatSupabaseError = (
  error: unknown,
  fallback = 'Error de Supabase',
): string => {
  if (!error || typeof error !== 'object') {
    return error instanceof Error ? error.message : fallback;
  }

  const value = error as Record<string, unknown>;
  const parts = [
    value.message ? String(value.message) : '',
    value.details ? `Detalles: ${String(value.details)}` : '',
    value.hint ? `Sugerencia: ${String(value.hint)}` : '',
    value.code ? `Código: ${String(value.code)}` : '',
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(' · ');
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const supabaseError = (error: unknown, fallback?: string): Error =>
  new Error(formatSupabaseError(error, fallback));
