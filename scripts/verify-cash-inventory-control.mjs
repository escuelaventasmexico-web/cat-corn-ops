import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const openModal = read('components/OpenCashRegisterModal.tsx');
const closeModal = read('components/CloseCashRegisterModal.tsx');
const cashRegister = read('lib/cashRegister.ts');
const pos = read('pages/POS.tsx');

const checks = [
  ['opening loads the server contract', openModal.includes('fetchCashInventoryControlForBranch(branch.id)')],
  ['closing loads the server contract', closeModal.includes('fetchCashInventoryControlForBranch(branch.id)')],
  ['opening blocks while contract is not ready', openModal.includes("contractState.status !== 'ready'")],
  ['closing blocks while contract is not ready', closeModal.includes("contractState.status !== 'ready'")],
  ['opening does not authorize by branch code', !openModal.includes("branch.code === 'chipitlan_01'")],
  ['closing does not authorize by branch code', !closeModal.includes("branch.code === 'chipitlan_01'")],
  ['cash flow is selected from the contract', cashRegister.includes('resolveCashInventoryFlow')],
  ['loading or error contract cannot select a flow', cashRegister.includes("if (state.status !== 'ready')")],
  ['an uncontrolled branch such as Aurrera selects legacy', cashRegister.includes("return state.contract.control_enabled && required ? 'controlled' : 'legacy';")],
  ['controlled opening uses only the inventory RPC', cashRegister.includes("flow === 'controlled'\n    ? await supabase.rpc('open_cash_register_with_inventory_for_branch'")],
  ['controlled closing uses only the inventory RPC', cashRegister.includes("flow === 'controlled'\n    ? await supabase.rpc('close_cash_register_with_inventory_for_branch'")],
  ['legacy opening rejects supplied controlled counts', cashRegister.includes("flow === 'legacy' && inventory")],
  ['POS loads the server contract', pos.includes('fetchCashInventoryControlForBranch(selectedBranch.id)')],
  ['POS delivery does not authorize by branch code', !pos.includes("selectedBranch.code === 'chipitlan_01'")],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
