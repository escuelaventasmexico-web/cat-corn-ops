const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT_PATTERN = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00(?::?00)?)$/i;

export const assertBusinessDate = (value) => {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`Fecha comercial inválida: ${String(value)}`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Fecha comercial inválida: ${String(value)}`);
  }
  return value;
};

export const getMexicoCityDate = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Fecha de pago inválida.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('No se pudo resolver la fecha de pago en México.');
  return `${year}-${month}-${day}`;
};

/**
 * Compatibility resolver for rows created before an explicit business_date.
 *
 * Exact UTC midnight can mean either an HTML date or the UTC day returned by
 * toISOString(). When it matches the UTC creation day, the Mexico City
 * creation date recovers the historical "today" default. A different UTC day
 * is preserved as an explicitly selected effective date. Real timestamps are
 * interpreted as instants in America/Mexico_City.
 */
export const resolveLegacyB2BPaymentBusinessDate = ({
  businessDate,
  paymentDate,
  createdAt,
}) => {
  if (businessDate) return assertBusinessDate(businessDate);

  const midnightMatch = typeof paymentDate === 'string'
    ? UTC_MIDNIGHT_PATTERN.exec(paymentDate)
    : null;
  if (!midnightMatch) return getMexicoCityDate(paymentDate);

  const encodedDate = midnightMatch[1];
  if (!createdAt) return encodedDate;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return encodedDate;
  const createdUtcDate = created.toISOString().slice(0, 10);
  return createdUtcDate === encodedDate ? getMexicoCityDate(created) : encodedDate;
};
