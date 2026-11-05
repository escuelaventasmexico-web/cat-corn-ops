export const STATIONERY_CONCEPT_CODE = 'STATIONERY';
export const STATIONERY_BUDGET_WARNING_RATIO = 0.8;

export function isStationeryConcept(conceptCode) {
  return conceptCode === STATIONERY_CONCEPT_CODE;
}

export function calculateStationeryBudgetProjection({
  limitMxn,
  usedExcludingEditedExpenseMxn = 0,
  amountMxn = 0,
  conceptCode,
}) {
  const usedBefore = Number(usedExcludingEditedExpenseMxn || 0);
  const addedMxn = isStationeryConcept(conceptCode) ? Number(amountMxn || 0) : 0;
  const projectedUsedMxn = usedBefore + addedMxn;
  const hasBudget = limitMxn !== null && limitMxn !== undefined;
  const numericLimit = hasBudget ? Number(limitMxn) : null;
  const warningThresholdMxn = numericLimit === null
    ? null
    : numericLimit * STATIONERY_BUDGET_WARNING_RATIO;
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
