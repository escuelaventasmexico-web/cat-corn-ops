import {
  ANGELICA_USER_ID,
  AURRERA_BRANCH_ID,
  GERARDO_USER_ID,
} from './posCashierAttribution.js';

export const CHIPITLAN_BRANCH_ID = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101';

export const FINANCE_BRANCHES = Object.freeze([
  Object.freeze({ key: 'chipitlan', label: 'Chipitlán 01', branchId: CHIPITLAN_BRANCH_ID }),
  Object.freeze({ key: 'aurrera', label: 'Aurrera La Luna 02', branchId: AURRERA_BRANCH_ID }),
  Object.freeze({ key: 'other', label: 'Sin sucursal identificada', branchId: null }),
]);

export const FINANCE_AURRERA_SELLERS = Object.freeze([
  Object.freeze({ key: 'angelica', label: 'Angélica' }),
  Object.freeze({ key: 'gerardo', label: 'Gerardo' }),
  Object.freeze({ key: 'administrator', label: 'Administrador' }),
  Object.freeze({ key: 'unattributed', label: 'Sin atribuir' }),
]);

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;

const isDelivery = sale => sale.sale_origin === 'delivery';
const isOrder = sale => !isDelivery(sale)
  && (sale.sale_origin === 'order' || sale.promotion_code === 'ORDER_CHECKOUT');

const branchKeyFor = branchId => {
  if (branchId === CHIPITLAN_BRANCH_ID) return 'chipitlan';
  if (branchId === AURRERA_BRANCH_ID) return 'aurrera';
  return 'other';
};

const aurreraSellerKeyFor = sale => {
  if (sale.pos_commission_attribution === 'administrator') return 'administrator';
  if (sale.pos_commission_attribution === 'employee') {
    if (sale.pos_commission_recipient_id === ANGELICA_USER_ID) return 'angelica';
    if (sale.pos_commission_recipient_id === GERARDO_USER_ID) return 'gerardo';
  }
  return 'unattributed';
};

const chipitlanSellerKeyFor = (sale, administratorUserIds) => {
  if (sale.cashier_id === ANGELICA_USER_ID) return 'angelica';
  if (sale.cashier_id === GERARDO_USER_ID) return 'gerardo';
  if (administratorUserIds.has(sale.cashier_id)) return 'administrator';
  return 'unattributed';
};

const summarize = operations => {
  const total = roundMoney(operations.reduce((sum, operation) => sum + operation.total, 0));
  const tickets = operations.length;
  return {
    total,
    tickets,
    averageTicket: tickets > 0 ? roundMoney(total / tickets) : 0,
  };
};

/** Confirmed collections are deliberately excluded: they settle B2B sales, not a second sale. */
export const calculateGeneratedGrandTotal = (salesGenerated, b2bGenerated) =>
  roundMoney((Number(salesGenerated) || 0) + (Number(b2bGenerated) || 0));

export const buildSalesParticipation = (salesBreakdown, b2bGenerated) => {
  const branchItems = salesBreakdown.branches
    .filter(branch => branch.total > 0)
    .map(branch => ({ key: branch.key, label: branch.label, amount: branch.total }));
  const items = [
    ...branchItems,
    { key: 'b2b', label: 'Socios Comerciales', amount: roundMoney(b2bGenerated) },
    { key: 'orders', label: 'Pedidos', amount: salesBreakdown.channels.orders.total },
    { key: 'delivery', label: 'Delivery', amount: salesBreakdown.channels.delivery.total },
  ].filter(item => item.amount > 0);
  const total = calculateGeneratedGrandTotal(salesBreakdown.salesTotal, b2bGenerated);
  return {
    total,
    items: items.map(item => ({
      ...item,
      percentage: total > 0 ? (item.amount / total) * 100 : 0,
    })),
    amountMatchesTotal: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)) === total,
  };
};

/**
 * Classifies each physical sales row exactly once. B2B is intentionally not
 * present here because generated revenue and confirmed collections have their
 * own canonical report sources.
 */
export const buildFinanceSalesBreakdown = (rows, options = {}) => {
  const administratorUserIds = new Set(options.administratorUserIds ?? []);
  const uniqueRows = new Map();
  for (const row of rows ?? []) {
    if (row?.id && !uniqueRows.has(row.id)) uniqueRows.set(row.id, row);
  }

  const operations = [...uniqueRows.values()].map(sale => {
    const channel = isDelivery(sale) ? 'delivery' : isOrder(sale) ? 'orders' : 'pos';
    const branchKey = channel === 'pos' ? branchKeyFor(sale.branch_id) : null;
    let sellerKey = null;
    if (channel === 'pos') {
      if (sale.branch_id === AURRERA_BRANCH_ID) sellerKey = aurreraSellerKeyFor(sale);
      else if (sale.branch_id === CHIPITLAN_BRANCH_ID) sellerKey = chipitlanSellerKeyFor(sale, administratorUserIds);
      else sellerKey = 'unattributed';
    }
    return {
      id: sale.id,
      createdAt: sale.created_at,
      total: roundMoney(sale.total),
      paymentMethod: String(sale.payment_method ?? '').toUpperCase(),
      channel,
      branchKey,
      sellerKey,
    };
  });

  const directPos = operations.filter(operation => operation.channel === 'pos');
  const branchRows = FINANCE_BRANCHES.map(branch => ({
    ...branch,
    ...summarize(directPos.filter(operation => operation.branchKey === branch.key)),
  }));
  const sellerRows = FINANCE_AURRERA_SELLERS.map(seller => {
    const summary = summarize(directPos.filter(operation => operation.sellerKey === seller.key));
    const posTotal = summarize(directPos).total;
    return {
      ...seller,
      ...summary,
      sharePercent: posTotal > 0 ? (summary.total / posTotal) * 100 : 0,
    };
  });

  const pos = summarize(directPos);
  const orders = summarize(operations.filter(operation => operation.channel === 'orders'));
  const delivery = summarize(operations.filter(operation => operation.channel === 'delivery'));
  const sellersTotal = roundMoney(sellerRows.reduce((sum, seller) => sum + seller.total, 0));

  return {
    operations,
    branches: branchRows,
    sellers: sellerRows,
    channels: { pos, orders, delivery },
    salesTotal: roundMoney(pos.total + orders.total + delivery.total),
    reconciliation: {
      inputRows: (rows ?? []).length,
      uniqueRows: operations.length,
      duplicateRows: (rows ?? []).length - operations.length,
      posTotal: pos.total,
      sellersTotal,
      sellersMatchPos: sellersTotal === pos.total,
    },
  };
};
