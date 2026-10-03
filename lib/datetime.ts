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

export const MEXICO_CITY_TIME_ZONE = 'America/Mexico_City';

export const getMexicoCityDateKey = (input: string | Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEXICO_CITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(input));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('No se pudo calcular la fecha de Ciudad de México.');
  return `${year}-${month}-${day}`;
};

export const addCalendarDays = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

/** Converts a YYYY-MM-DD business date at Mexico City midnight to UTC. */
export const mexicoCityDateStartISO = (dateKey: string): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Fecha inválida: ${dateKey}`);

  const desiredUtc = Date.UTC(year, month - 1, day);
  let guess = desiredUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MEXICO_CITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  // Two passes also cover historical DST transitions without assuming an offset.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find(part => part.type === type)?.value ?? 0);
    const representedUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    guess = desiredUtc - (representedUtc - guess);
  }

  return new Date(guess).toISOString();
};
