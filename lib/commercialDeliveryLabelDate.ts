export interface CommercialDeliveryLabelDateSource {
  generatedAt?: string | null;
  createdAt?: string | null;
}

export interface CommercialDeliveryLabelDates {
  /** Date displayed as the immutable elaboration date on the label. */
  elaborationDate: string;
  /** Two-digit calendar day seven days after the elaboration date. */
  expirationDay: string;
  /** True only for anomalous historical rows without generated_at. */
  usedCreatedAtFallback: boolean;
}

interface CalendarDate { year: number; month: number; day: number; }

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const toMexicoCityCalendarDate = (value: string): CalendarDate => {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('La etiqueta no tiene una fecha de elaboración válida.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  if (!year || !month || !day) throw new Error('No se pudo resolver la fecha de elaboración de la etiqueta.');
  return { year, month, day };
};

const formatCalendarDate = ({ year, month, day }: CalendarDate) =>
  `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

/**
 * Resolves and formats the immutable elaboration date for all B2B label paths.
 * `generated_at` always wins; `created_at` exists solely for historical rows
 * where the persisted generated_at value is unexpectedly null.
 */
export const resolveCommercialDeliveryLabelDates = ({ generatedAt, createdAt }: CommercialDeliveryLabelDateSource): CommercialDeliveryLabelDates => {
  const source = generatedAt?.trim() || createdAt?.trim();
  if (!source) throw new Error('La etiqueta no tiene fecha original de generación ni respaldo histórico.');

  const elaboration = toMexicoCityCalendarDate(source);
  // UTC is used only as a calendar arithmetic container. It never represents
  // an elapsed 7 × 24-hour interval, so Mexico City day boundaries are stable.
  const expiration = new Date(Date.UTC(elaboration.year, elaboration.month - 1, elaboration.day + 7));
  return {
    elaborationDate: formatCalendarDate(elaboration),
    expirationDay: String(expiration.getUTCDate()).padStart(2, '0'),
    usedCreatedAtFallback: !generatedAt?.trim() && Boolean(createdAt?.trim()),
  };
};
