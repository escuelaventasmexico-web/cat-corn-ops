// Helper to format UTC dates from Supabase to Mexico City timezone
export const formatDateTimeMX = (input: string | Date) =>
  new Date(input).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
