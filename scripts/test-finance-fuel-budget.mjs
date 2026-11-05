import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  calculateFuelBudgetProjection,
  getFuelVehicleLabel,
  isFuelConcept,
  summarizeFuelBudgetExpenses,
} from '../lib/fuelBudget.js';

const read = relativePath => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

assert.equal(isFuelConcept('FUEL'), true);
for (const concept of ['CORN', 'SERVICES', 'OTHER', 'COMMISSIONS', null]) {
  assert.equal(isFuelConcept(concept), false);
}
assert.equal(getFuelVehicleLabel('UTILITY'), 'Auto utilitario');
assert.equal(getFuelVehicleLabel('MANAGERIAL'), 'Auto gerencial');
assert.equal(getFuelVehicleLabel(null), 'Sin vehículo asignado');

const summary = summarizeFuelBudgetExpenses([
  { amount_mxn: 300, concept_code: 'FUEL', fuel_vehicle_code: 'UTILITY', payment_instrument: 'CASH' },
  { amount_mxn: 250, concept_code: 'FUEL', fuel_vehicle_code: 'MANAGERIAL', payment_instrument: 'CREDIT_CARD' },
  { amount_mxn: 100, concept_code: 'FUEL', fuel_vehicle_code: null, payment_instrument: null },
  { amount_mxn: 70, concept_code: 'OTHER', fuel_vehicle_code: null, notes: 'caseta' },
  { amount_mxn: 80, concept_code: 'OTHER', fuel_vehicle_code: null, notes: 'llanta' },
]);
assert.equal(summary.usedMxn, 650, 'each fuel expense counts once in the global total');
assert.deepEqual(summary.usageByVehicle, { UTILITY: 300, MANAGERIAL: 250, UNASSIGNED: 100 });
assert.equal(summary.unassignedVehicle.count, 1);
assert.equal(summary.unassignedVehicle.amountMxn, 100);
assert.equal(summary.matchingExpenseCount, 3);
assert.equal(summary.usageByVehicle.UTILITY + summary.usageByVehicle.MANAGERIAL + summary.usageByVehicle.UNASSIGNED, summary.usedMxn);

const utilityWarning = calculateFuelBudgetProjection({
  globalLimitMxn: 1000,
  vehicleLimitsMxn: { UTILITY: 600, MANAGERIAL: 400 },
  usedExcludingEditedExpenseMxn: 650,
  usageByVehicleExcludingEditedExpense: { UTILITY: 430, MANAGERIAL: 220 },
  amountMxn: 50,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'UTILITY',
});
assert.equal(utilityWarning.total.projectedUsedMxn, 700);
assert.equal(utilityWarning.vehicle.projectedUsedMxn, 480);
assert.equal(utilityWarning.vehicle.isAtWarning, true, 'utility warning starts at MXN 480');
assert.equal(utilityWarning.vehicle.isOverBudget, false);

const globalWarning = calculateFuelBudgetProjection({
  globalLimitMxn: 1000,
  vehicleLimitsMxn: { UTILITY: 600, MANAGERIAL: 400 },
  usedExcludingEditedExpenseMxn: 750,
  usageByVehicleExcludingEditedExpense: { UTILITY: 350, MANAGERIAL: 300 },
  amountMxn: 50,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'MANAGERIAL',
});
assert.equal(globalWarning.total.projectedUsedMxn, 800);
assert.equal(globalWarning.total.isAtWarning, true, 'global warning starts at MXN 800');

const managerialOver = calculateFuelBudgetProjection({
  globalLimitMxn: 1000,
  vehicleLimitsMxn: { UTILITY: 600, MANAGERIAL: 400 },
  usedExcludingEditedExpenseMxn: 850,
  usageByVehicleExcludingEditedExpense: { UTILITY: 500, MANAGERIAL: 350 },
  amountMxn: 100,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'MANAGERIAL',
});
assert.equal(managerialOver.total.projectedUsedMxn, 950);
assert.equal(managerialOver.vehicle.projectedUsedMxn, 450);
assert.equal(managerialOver.vehicle.isOverBudget, true);
assert.equal(managerialOver.vehicle.exceededMxn, 50);

const globalOver = calculateFuelBudgetProjection({
  globalLimitMxn: 1000,
  vehicleLimitsMxn: { UTILITY: 600, MANAGERIAL: 400 },
  usedExcludingEditedExpenseMxn: 950,
  usageByVehicleExcludingEditedExpense: { UTILITY: 450, MANAGERIAL: 350 },
  amountMxn: 100,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'UTILITY',
});
assert.equal(globalOver.total.projectedUsedMxn, 1050);
assert.equal(globalOver.total.exceededMxn, 50);
assert.equal(globalOver.total.isOverBudget, true);

const editedReplacement = calculateFuelBudgetProjection({
  globalLimitMxn: 1000,
  vehicleLimitsMxn: { UTILITY: 600, MANAGERIAL: 400 },
  usedExcludingEditedExpenseMxn: 500,
  usageByVehicleExcludingEditedExpense: { UTILITY: 300, MANAGERIAL: 200 },
  amountMxn: 175,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'UTILITY',
});
assert.equal(editedReplacement.total.projectedUsedMxn, 675, 'editing replaces the excluded expense instead of duplicating it');
assert.equal(editedReplacement.vehicle.projectedUsedMxn, 475);

const noBudget = calculateFuelBudgetProjection({
  globalLimitMxn: null,
  vehicleLimitsMxn: { UTILITY: null, MANAGERIAL: null },
  usedExcludingEditedExpenseMxn: 100,
  usageByVehicleExcludingEditedExpense: { UTILITY: 100, MANAGERIAL: 0 },
  amountMxn: 50,
  conceptCode: 'FUEL',
  fuelVehicleCode: 'UTILITY',
});
assert.equal(noBudget.total.projectedUsedMxn, 150);
assert.equal(noBudget.total.remainingMxn, null);
assert.equal(noBudget.total.isAtWarning, false);
assert.equal(noBudget.total.isOverBudget, false);

const migration = read('../supabase/applied-manually/20261104120000_finance_fuel_budget.sql');
const verification = read('../supabase/verification/20261104120000_verify_finance_fuel_budget.sql');
const enforcement = read('../supabase/pending/20261104121000_enforce_fuel_vehicle.sql');
const enforcementVerification = read('../supabase/verification/20261104121000_verify_fuel_vehicle_enforcement.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const panel = read('../components/finance/FuelBudgetPanel.tsx');
const finance = read('../pages/Finanzas.tsx');
const expensesManager = read('../components/finance/ExpensesManager.tsx');
const exportExpenses = read('../lib/exportExpenses.ts');

assert.equal(
  existsSync(new URL('../supabase/migrations/20261104120000_finance_fuel_budget.sql', import.meta.url)),
  false,
  'the manually applied base must stay outside the automatic migration directory',
);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261104121000_enforce_fuel_vehicle.sql', import.meta.url)),
  false,
  'mandatory vehicle enforcement must remain pending and outside automatic migrations',
);

assert.match(migration, /ADD COLUMN fuel_vehicle_code TEXT/);
assert.match(migration, /APPLIED MANUALLY IN SUPABASE/);
assert.match(migration, /fuel_vehicle_code IN \('UTILITY', 'MANAGERIAL'\)/);
assert.doesNotMatch(migration, /CREATE TRIGGER enforce_expense_fuel_vehicle_trigger/,
  'the compatible base must not activate mandatory vehicle capture');
assert.match(migration, /new FUEL expenses may keep fuel_vehicle_code NULL/);
assert.match(migration, /finance_calculate_fuel_budget/,
  'the RPC and verifier must share the canonical calculation');
assert.match(migration, /GRANT INSERT \(fuel_vehicle_code\), UPDATE \(fuel_vehicle_code\)/);
assert.doesNotMatch(migration, /GRANT INSERT \(commission_settlement_id/);
assert.match(migration, /DATE '2026-11-01'[\s\S]*1000\.00[\s\S]*600\.00[\s\S]*400\.00/);
assert.match(migration, /ON CONFLICT \(month_start\) DO NOTHING/,
  'the November seed must not overwrite an existing reviewed limit');
assert.doesNotMatch(migration, /finance_credit_card_payments[\s\S]*SUM/i,
  'credit-card payments must not consume the fuel budget');
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i,
  'historical expenses must not be modified');

assert.match(verification, /READ-ONLY/);
assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/im);
assert.match(verification, /vehicle_breakdown_sums_to_global/);
assert.match(verification, /actual_managerial_credit_purchase_counted_once/);
assert.match(verification, /actual_nonfuel_tolls_and_tires_excluded/);
assert.match(verification, /functional_calculation_checks_passed/);
assert.match(verification, /all_checks_passed/);

assert.match(enforcement, /ACTIVATION STEP/);
assert.match(enforcement, /New FUEL expenses require fuel_vehicle_code/);
assert.match(enforcement, /OLD\.fuel_vehicle_code IS NOT NULL/,
  'historical null vehicle rows must remain editable');
assert.match(enforcement, /CREATE TRIGGER enforce_expense_fuel_vehicle_trigger/);
assert.doesNotMatch(enforcement, /^\s*(INSERT|UPDATE|DELETE)\s+public\.expenses\b/im,
  'activation must not modify historical expenses');
assert.match(enforcementVerification, /READ-ONLY/);
assert.doesNotMatch(enforcementVerification, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/im);
assert.match(enforcementVerification, /unassigned_fuel_count/);
assert.match(enforcementVerification, /all_fuel_rows_classified/);

assert.match(form, /Vehículo de la carga/);
assert.match(form, /Selecciona el vehículo correspondiente/);
assert.match(form, /preservesHistoricalUnassignedFuel/);
assert.match(form, /Puedes conservarlo así al editar/);
assert.match(form, /getFuelBudgetSnapshot\(monthStart, expense\?\.id\)/);
assert.match(form, /La carga rebasará/);
assert.match(form, /al menos el 80%/);
assert.match(form, /Puedes registrar el gasto real/);
assert.match(form, /La compra a crédito consume este presupuesto al registrarse/);
assert.match(panel, /Presupuesto mensual de combustible/);
assert.match(panel, /Sin presupuesto definido/);
assert.match(panel, /<dt>Disponible<\/dt>/);
assert.match(panel, /<dt>Exceso<\/dt>/);
assert.match(panel, /Se alcanzó al menos el 80% del límite/);
assert.match(panel, /Sin vehículo asignado/);
assert.match(panel, /Ya cuentan una sola vez en el total global/);
assert.match(panel, /casetas y llantas no se incluyen/);
assert.match(finance, /FuelBudgetPanel monthStartISO=\{monthStartISO\}/);
assert.match(expensesManager, /getFuelVehicleLabel\(expense\.fuel_vehicle_code\)/);
assert.match(exportExpenses, /Vehículo combustible/);

console.log('✓ finance fuel budget tests passed');
