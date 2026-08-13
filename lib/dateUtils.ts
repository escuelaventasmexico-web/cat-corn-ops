/**
 * Date utility functions for Cat Corn OPS
 * 
 * All business dates use America/Mexico_City timezone
 * This ensures dates are consistent with local operations
 */

/**
 * Get business date in YYYY-MM-DD format (America/Mexico_City timezone)
 * 
 * Used for:
 * - payment_date in payment tables (commercial_partner_payments, wholesale_payments)
 * - sale_date in sales tables
 * 
 * Example:
 *   2026-08-07 23:30 México = 2026-08-08 05:30 UTC
 *   getBusinessDateString() returns "2026-08-07" (not "2026-08-08")
 * 
 * @param dateParam Optional Date object. Defaults to current date/time.
 * @returns Business date string in format YYYY-MM-DD (America/Mexico_City timezone)
 */
export function getBusinessDateString(dateParam?: Date | string): string {
  let date: Date;
  
  if (typeof dateParam === 'string') {
    // If string is already YYYY-MM-DD, parse it as naive date
    // This handles form input dates that are already in local date format
    const parts = dateParam.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      // Already in YYYY-MM-DD format from HTML date input
      // Return as-is (it's already in business date format)
      return dateParam;
    }
    date = new Date(dateParam);
  } else if (dateParam instanceof Date) {
    date = dateParam;
  } else {
    date = new Date();
  }
  
  // Format date in America/Mexico_City timezone
  // Using toLocaleString to get Mexico City time, then extract date portion
  const formatter = new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Mexico_City',
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  if (!year || !month || !day) {
    throw new Error('Failed to format date');
  }
  
  return `${year}-${month}-${day}`;
}

/**
 * Get business date as Date object at midnight America/Mexico_City
 * 
 * Useful for database queries that need date boundaries
 * 
 * @param dateParam Optional Date object. Defaults to current date/time.
 * @returns Date object representing business midnight in Mexico City timezone
 */
export function getBusinessDate(dateParam?: Date | string): Date {
  const dateStr = getBusinessDateString(dateParam);
  // Parse as UTC midnight, then adjust to represent Mexico City date
  // This ensures the Date object semantically represents the Mexico City date
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Convert business date (YYYY-MM-DD) to UTC midnight ISO string
 * 
 * CRITICAL: This function NEVER uses browser timezone.
 * Input date is treated as a CALENDAR DATE (business date),
 * and output is ALWAYS UTC midnight: YYYY-MM-DDT00:00:00.000Z
 * 
 * This ensures consistency when sending dates to backend as TIMESTAMPTZ parameters.
 * 
 * Example:
 *   businessDateToUtcMidnight('2026-08-11') → '2026-08-11T00:00:00.000Z'
 *   businessDateToUtcMidnight('2026-08-12') → '2026-08-12T00:00:00.000Z'
 * 
 * @param dateString Business date in format YYYY-MM-DD
 * @returns ISO string in UTC midnight format
 * @throws Error if format is invalid
 */
export function businessDateToUtcMidnight(dateString: string): string {
  // Validate format: YYYY-MM-DD
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD, got: ${dateString}`);
  }
  
  const [, year, month, day] = match;
  
  // Validate reasonable values
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  
  if (monthNum < 1 || monthNum > 12) {
    throw new Error(`Invalid month: ${monthNum}`);
  }
  
  if (dayNum < 1 || dayNum > 31) {
    throw new Error(`Invalid day: ${dayNum}`);
  }
  
  // Return as UTC midnight ISO string
  // Using Date.UTC to ensure UTC timezone, not browser timezone
  const utcDate = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  return utcDate.toISOString();
}

/**
 * Default export of getter for current business date string
 * 
 * This is the PRIMARY function to use when setting default payment_date
 * in form components.
 * 
 * Usage in React:
 *   const [paymentDate, setPaymentDate] = useState(getBusinessDateString());
 */
export default getBusinessDateString;
