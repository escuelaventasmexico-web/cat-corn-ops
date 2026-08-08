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
 * Default export of getter for current business date string
 * 
 * This is the PRIMARY function to use when setting default payment_date
 * in form components.
 * 
 * Usage in React:
 *   const [paymentDate, setPaymentDate] = useState(getBusinessDateString());
 */
export default getBusinessDateString;
