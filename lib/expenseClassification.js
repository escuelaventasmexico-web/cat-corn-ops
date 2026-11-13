export const EXPENSE_CONCEPT_OPTIONS = Object.freeze([
  { id: 'CORN', label: 'Maíz' },
  { id: 'OIL', label: 'Aceite' },
  { id: 'SEASONINGS', label: 'Condimentos' },
  { id: 'CARAMEL', label: 'Caramelo' },
  { id: 'PACKAGING', label: 'Empaques' },
  { id: 'STATIONERY', label: 'Papelería' },
  { id: 'CLEANING', label: 'Limpieza' },
  { id: 'FUEL', label: 'Combustible' },
  { id: 'SERVICES', label: 'Servicios' },
  { id: 'MAINTENANCE', label: 'Mantenimiento' },
  { id: 'OPERATIONS_MANAGEMENT', label: 'Gastos dirección operativa' },
  { id: 'PAYROLL', label: 'Nómina' },
  { id: 'RENT', label: 'Renta' },
  { id: 'COMMISSIONS', label: 'Comisiones' },
  { id: 'OTHER', label: 'Otros' },
]);

export const EXPENSE_DESTINATION_OPTIONS = Object.freeze([
  { id: 'AURRERA', label: 'Aurrera' },
  { id: 'CHIPITLAN', label: 'Chipitlán' },
  { id: 'SHARED', label: 'Compartido' },
  { id: 'ENRIQUE', label: 'Enrique' },
]);

export const EXPENSE_REPORT_DESTINATION_OPTIONS = Object.freeze([
  ...EXPENSE_DESTINATION_OPTIONS,
  { id: 'MIXED', label: 'Mixto' },
  { id: 'UNKNOWN', label: 'Destino por determinar' },
]);

const conceptLabels = new Map(EXPENSE_CONCEPT_OPTIONS.map(option => [option.id, option.label]));
const destinationLabels = new Map(EXPENSE_REPORT_DESTINATION_OPTIONS.map(option => [option.id, option.label]));

export const PENDING_CLASSIFICATION_LABEL = 'Pendiente de clasificar';
export const PAYROLL_REPORT_GROUP = 'PAYROLL_GROUP';

export function getExpenseConceptLabel(code) {
  return conceptLabels.get(code) ?? PENDING_CLASSIFICATION_LABEL;
}

export function getExpenseDestinationLabel(scope) {
  return destinationLabels.get(scope) ?? PENDING_CLASSIFICATION_LABEL;
}

export function getExpenseConceptGroupLabel(code) {
  if (code === 'PAYROLL' || code === 'COMMISSIONS') return 'Nómina';
  return getExpenseConceptLabel(code);
}

export function getExpenseBudgetDestination(expense) {
  if (expense?.concept_code === 'COMMISSIONS') return 'SHARED';
  return expense?.destination_scope ?? null;
}

export function getExpenseCommissionOrigin(expense) {
  if (expense?.concept_code !== 'COMMISSIONS') return null;
  return expense.commission_origin_scope || expense.destination_scope || 'UNKNOWN';
}

/**
 * The deployed expenses table still requires its legacy `category` column.
 * New capture keeps `concept_code` as the canonical value and mirrors the same
 * stable identifier only for backwards compatibility with that NOT NULL field.
 */
export function getLegacyExpenseCategory(code) {
  return conceptLabels.has(code) ? code : null;
}

function normalizeFixedCostDescriptor(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Suggests, but never persists, a concept when the user selects a fixed-cost
 * obligation. The current fixed_costs schema exposes `name` and the stable
 * `obligation_code`; `category` is accepted for a future catalog projection.
 */
export function getSuggestedExpenseConceptForFixedCost(fixedCost) {
  const descriptors = [fixedCost?.name, fixedCost?.category, fixedCost?.obligation_code]
    .map(normalizeFixedCostDescriptor);
  return descriptors.some(value => /(^|[^a-z])(mantenimiento|maintenance)([^a-z]|$)/.test(value))
    ? 'MAINTENANCE'
    : null;
}

export function getExpenseSaveErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const details = typeof error?.details === 'string' ? error.details.trim() : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  const technicalMessage = [message, details].filter(Boolean).join(' ');

  if (/failed to fetch|networkerror|network request failed/i.test(technicalMessage)) {
    return 'No se pudo conectar con Supabase. El gasto no se guardó. Revisa tu conexión e inténtalo nuevamente.';
  }
  if (code === '23502' || /null value .* violates not-null constraint/i.test(technicalMessage)) {
    return 'Supabase rechazó el gasto porque falta un dato obligatorio. El gasto no se guardó; actualiza la página y vuelve a intentarlo.';
  }
  if (/jwt|not authenticated|permission denied|row-level security/i.test(technicalMessage)) {
    return 'Tu sesión no tiene permiso para guardar este gasto. El gasto no se guardó; inicia sesión nuevamente o solicita acceso.';
  }
  return technicalMessage
    ? `No se pudo guardar el gasto: ${technicalMessage}`
    : 'No se pudo guardar el gasto. No se realizó ningún cambio.';
}

export function isExpenseClassificationComplete(expense) {
  const commissionOrigin = getExpenseCommissionOrigin(expense);
  return Boolean(
    expense
    && conceptLabels.has(expense.concept_code)
    && destinationLabels.has(expense.destination_scope)
    && expense.destination_scope !== 'UNKNOWN'
    && (expense.concept_code !== 'COMMISSIONS' || commissionOrigin !== 'UNKNOWN')
    && (expense.classification_status === 'CLASSIFIED' || expense.classification_status === 'SYSTEM')
  );
}

export function filterExpensesByClassification(expenses, conceptFilter = 'ALL', destinationFilter = 'ALL') {
  return expenses.filter(expense => {
    const budgetDestination = getExpenseBudgetDestination(expense);
    const conceptMatches = conceptFilter === 'ALL'
      || (conceptFilter === 'PENDING'
        ? !conceptLabels.has(expense.concept_code)
        : conceptFilter === PAYROLL_REPORT_GROUP
          ? expense.concept_code === 'PAYROLL' || expense.concept_code === 'COMMISSIONS'
          : expense.concept_code === conceptFilter);
    const destinationMatches = destinationFilter === 'ALL'
      || (destinationFilter === 'PENDING'
        ? !destinationLabels.has(budgetDestination) || budgetDestination === 'UNKNOWN'
          || getExpenseCommissionOrigin(expense) === 'UNKNOWN'
        : budgetDestination === destinationFilter);
    return conceptMatches && destinationMatches;
  });
}

export function sumExpensesOnce(expenses) {
  return expenses.reduce((total, expense) => total + Number(expense.amount_mxn || 0), 0);
}

export function summarizePendingClassification(expenses) {
  const pending = expenses.filter(expense => !isExpenseClassificationComplete(expense));
  return {
    count: pending.length,
    amount_mxn: sumExpensesOnce(pending),
  };
}

export function resolveCommissionDestination(resolvedEventDestinations) {
  if (resolvedEventDestinations.length === 0
      || resolvedEventDestinations.some(scope => scope !== 'AURRERA' && scope !== 'CHIPITLAN')) {
    return 'UNKNOWN';
  }
  const destinations = new Set(resolvedEventDestinations);
  return destinations.size === 1 ? resolvedEventDestinations[0] : 'MIXED';
}
