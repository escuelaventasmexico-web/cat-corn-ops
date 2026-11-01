const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const EXPENSE_TIME_ZONE = 'America/Mexico_City';

export function getMexicoCityExpenseDate(input = new Date()) {
  const instant = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('No se pudo calcular la fecha del gasto.');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPENSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = type => parts.find(part => part.type === type)?.value;
  const year = read('year');
  const month = read('month');
  const day = read('day');

  if (!year || !month || !day) {
    throw new Error('No se pudo calcular la fecha del gasto.');
  }
  return `${year}-${month}-${day}`;
}

export function getInitialExpenseDate(expenseDate, now = new Date()) {
  if (expenseDate) {
    if (!DATE_ONLY_PATTERN.test(expenseDate)) {
      throw new Error(`Fecha de gasto inválida: ${expenseDate}`);
    }
    return expenseDate;
  }
  return getMexicoCityExpenseDate(now);
}
