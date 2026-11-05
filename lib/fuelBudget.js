export const FUEL_VEHICLE_CODES = Object.freeze([
  'UTILITY',
  'MANAGERIAL',
]);

export const FUEL_BUDGET_WARNING_RATIO = 0.8;

export function isFuelConcept(conceptCode) {
  return conceptCode === 'FUEL';
}

export function isFuelVehicleCode(vehicleCode) {
  return FUEL_VEHICLE_CODES.includes(vehicleCode);
}

export function getFuelVehicleLabel(vehicleCode) {
  if (vehicleCode === 'UTILITY') return 'Auto utilitario';
  if (vehicleCode === 'MANAGERIAL') return 'Auto gerencial';
  return 'Sin vehículo asignado';
}

export function summarizeFuelBudgetExpenses(expenses) {
  const result = {
    usedMxn: 0,
    usageByVehicle: {
      UTILITY: 0,
      MANAGERIAL: 0,
      UNASSIGNED: 0,
    },
    matchingExpenseCount: 0,
    unassignedVehicle: { count: 0, amountMxn: 0 },
  };

  for (const expense of expenses) {
    if (!isFuelConcept(expense?.concept_code)) continue;
    const amount = Number(expense?.amount_mxn || 0);
    const vehicle = isFuelVehicleCode(expense?.fuel_vehicle_code)
      ? expense.fuel_vehicle_code
      : 'UNASSIGNED';
    result.usedMxn += amount;
    result.matchingExpenseCount += 1;
    result.usageByVehicle[vehicle] += amount;
    if (vehicle === 'UNASSIGNED') {
      result.unassignedVehicle.count += 1;
      result.unassignedVehicle.amountMxn += amount;
    }
  }

  return result;
}

function projectBucket(limitMxn, usedMxn, addedMxn) {
  const hasBudget = limitMxn !== null && limitMxn !== undefined;
  const numericLimit = hasBudget ? Number(limitMxn) : null;
  const projectedUsedMxn = Number(usedMxn || 0) + Number(addedMxn || 0);
  const warningThresholdMxn = numericLimit === null
    ? null
    : numericLimit * FUEL_BUDGET_WARNING_RATIO;
  return {
    projectedUsedMxn,
    warningThresholdMxn,
    remainingMxn: numericLimit === null ? null : Math.max(0, numericLimit - projectedUsedMxn),
    exceededMxn: numericLimit === null ? 0 : Math.max(0, projectedUsedMxn - numericLimit),
    isAtWarning: numericLimit !== null
      && numericLimit > 0
      && projectedUsedMxn >= warningThresholdMxn
      && projectedUsedMxn <= numericLimit,
    isOverBudget: numericLimit !== null && projectedUsedMxn > numericLimit,
  };
}

export function calculateFuelBudgetProjection({
  globalLimitMxn,
  vehicleLimitsMxn,
  usedExcludingEditedExpenseMxn = 0,
  usageByVehicleExcludingEditedExpense = {},
  amountMxn = 0,
  conceptCode,
  fuelVehicleCode,
}) {
  const addedMxn = isFuelConcept(conceptCode) ? Number(amountMxn || 0) : 0;
  const vehicleAddedMxn = isFuelVehicleCode(fuelVehicleCode) ? addedMxn : 0;
  const vehicleLimitMxn = isFuelVehicleCode(fuelVehicleCode)
    ? vehicleLimitsMxn?.[fuelVehicleCode] ?? null
    : null;
  const vehicleUsedMxn = isFuelVehicleCode(fuelVehicleCode)
    ? Number(usageByVehicleExcludingEditedExpense?.[fuelVehicleCode] || 0)
    : 0;

  return {
    total: projectBucket(globalLimitMxn, usedExcludingEditedExpenseMxn, addedMxn),
    vehicle: projectBucket(vehicleLimitMxn, vehicleUsedMxn, vehicleAddedMxn),
    vehicleCode: isFuelVehicleCode(fuelVehicleCode) ? fuelVehicleCode : null,
  };
}
