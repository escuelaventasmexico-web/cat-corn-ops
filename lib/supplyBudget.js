export const SUPPLY_CONCEPT_CODES = Object.freeze([
  'CORN',
  'OIL',
  'SEASONINGS',
  'CARAMEL',
  'PACKAGING',
]);

export const SUPPLY_BUDGET_WARNING_RATIO = 0.8;

export function isSupplyConcept(conceptCode) {
  return SUPPLY_CONCEPT_CODES.includes(conceptCode);
}

export function getMonthStart(dateOnly) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly || '')) return null;
  return `${dateOnly.slice(0, 7)}-01`;
}

export function summarizeSupplyBudgetExpenses(expenses) {
  const result = {
    usedMxn: 0,
    usageByDestination: {
      AURRERA: 0,
      CHIPITLAN: 0,
      SHARED: 0,
      UNASSIGNED: 0,
    },
    matchingExpenseCount: 0,
    unassignedSupply: { count: 0, amountMxn: 0 },
    potentialSupplyUnclassified: { count: 0, amountMxn: 0 },
    confirmedNonSupply: { count: 0, amountMxn: 0 },
  };

  for (const expense of expenses) {
    const amount = Number(expense?.amount_mxn || 0);
    const conceptCode = expense?.concept_code ?? null;
    const destination = expense?.destination_scope;
    if (isSupplyConcept(conceptCode)) {
      result.usedMxn += amount;
      result.matchingExpenseCount += 1;
      const bucket = destination === 'AURRERA' || destination === 'CHIPITLAN' || destination === 'SHARED'
        ? destination
        : 'UNASSIGNED';
      result.usageByDestination[bucket] += amount;
      if (bucket === 'UNASSIGNED') {
        result.unassignedSupply.count += 1;
        result.unassignedSupply.amountMxn += amount;
      }
    } else if (conceptCode === null) {
      result.potentialSupplyUnclassified.count += 1;
      result.potentialSupplyUnclassified.amountMxn += amount;
    } else {
      result.confirmedNonSupply.count += 1;
      result.confirmedNonSupply.amountMxn += amount;
    }
  }

  return result;
}

export function calculateSupplyBudgetProjection({
  limitMxn,
  usedExcludingEditedExpenseMxn = 0,
  amountMxn = 0,
  conceptCode,
}) {
  const usedBefore = Number(usedExcludingEditedExpenseMxn || 0);
  const projectedAmount = isSupplyConcept(conceptCode) ? Number(amountMxn || 0) : 0;
  const projectedUsedMxn = usedBefore + projectedAmount;
  const hasBudget = limitMxn !== null && limitMxn !== undefined;
  const numericLimit = hasBudget ? Number(limitMxn) : null;
  const warningThresholdMxn = numericLimit === null
    ? null
    : numericLimit * SUPPLY_BUDGET_WARNING_RATIO;
  const exceededMxn = numericLimit === null
    ? 0
    : Math.max(0, projectedUsedMxn - numericLimit);
  const remainingMxn = numericLimit === null
    ? null
    : Math.max(0, numericLimit - projectedUsedMxn);

  return {
    projectedUsedMxn,
    warningThresholdMxn,
    remainingMxn,
    exceededMxn,
    isAtWarning: numericLimit !== null
      && numericLimit > 0
      && projectedUsedMxn >= warningThresholdMxn
      && projectedUsedMxn <= numericLimit,
    isOverBudget: numericLimit !== null && projectedUsedMxn > numericLimit,
  };
}
