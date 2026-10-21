export const AURRERA_BRANCH_ID = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202';
export const AURRERA_BRANCH_CODE = 'aurrera_la_luna_02';

export const ANGELICA_USER_ID = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b';
export const GERARDO_USER_ID = '682568c5-4339-4af5-85ef-71c8b2febd59';

export const AURRERA_CASHIER_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'angelica',
    label: 'Angélica',
    description: 'Venta con comisión POS',
    mode: 'employee',
    recipientId: ANGELICA_USER_ID,
  }),
  Object.freeze({
    key: 'gerardo',
    label: 'Gerardo',
    description: 'Venta con comisión POS',
    mode: 'employee',
    recipientId: GERARDO_USER_ID,
  }),
  Object.freeze({
    key: 'administrator',
    label: 'Administrador',
    description: 'Venta sin comisión POS',
    mode: 'administrator',
    recipientId: null,
  }),
]);

export const getAurreraCashierOption = (key) =>
  AURRERA_CASHIER_OPTIONS.find(option => option.key === key) || null;

export const buildCheckoutFingerprint = ({
  branchId,
  cart,
  cashInput,
  cardInput,
  transferInput,
  customerId,
  promotionCode,
  promotionGroups = [],
}) => JSON.stringify({
  branchId,
  cart: cart.map(item => ({
    key: item.cart_key || item.id,
    productId: item.is_generic ? null : item.id,
    quantity: item.quantity,
    price: item.price,
    discountAmount: item.discount_amount || 0,
    discountReason: item.discount_reason || null,
    beverageId: item.combo_beverage_product_id || null,
  })),
  cashInput,
  cardInput,
  transferInput,
  customerId: customerId || null,
  promotionCode: promotionCode || null,
  promotionGroups: promotionGroups.map(group => ({
    id: group.id,
    items: group.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
  })),
});
