export const GATO_MAYOR_3X2_PROMOTION_CODE = 'GATO_MAYOR_3X2';
export const GATO_MAYOR_3X2_DISCOUNT_REASON = 'PROMO_GATO_MAYOR_3X2';
export const GATO_MAYOR_3X2_SKUS = Object.freeze(['SLGM180', 'SBGM180', 'CAGM180']);

const eligibleSkus = new Set(GATO_MAYOR_3X2_SKUS);

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const isGatoMayor3x2Eligible = item =>
  eligibleSkus.has(String(item?.sku_code || '').trim().toUpperCase());

export const clearGatoMayor3x2Discounts = cart => cart.map(item =>
  item.discount_reason === GATO_MAYOR_3X2_DISCOUNT_REASON
    ? { ...item, discount_amount: undefined, discount_reason: undefined }
    : item,
);

const quantitiesByProduct = cart => new Map(
  cart
    .filter(isGatoMayor3x2Eligible)
    .map(item => [item.id, Number(item.quantity) || 0]),
);

export const reconcileGatoMayor3x2Groups = (cart, groups) => {
  const available = quantitiesByProduct(cart);
  const eligibleIds = new Set(cart.filter(isGatoMayor3x2Eligible).map(item => item.id));
  const kept = [];

  for (const group of groups) {
    const unitCount = group.items.reduce((sum, item) => sum + item.quantity, 0);
    if (unitCount !== 3) continue;
    const canKeep = group.items.every(item =>
      eligibleIds.has(item.productId)
      && item.quantity > 0
      && (available.get(item.productId) || 0) >= item.quantity,
    );
    if (!canKeep) continue;
    for (const item of group.items) {
      available.set(item.productId, (available.get(item.productId) || 0) - item.quantity);
    }
    kept.push(group);
  }
  return kept;
};

export const getAvailableGatoMayor3x2Quantities = (cart, groups) => {
  const available = quantitiesByProduct(cart);
  for (const group of groups) {
    for (const item of group.items) {
      available.set(item.productId, Math.max(0, (available.get(item.productId) || 0) - item.quantity));
    }
  }
  return available;
};

export const evaluateGatoMayor3x2Groups = (cart, groups) => {
  const cleaned = clearGatoMayor3x2Discounts(cart);
  const productById = new Map(cleaned.map(item => [item.id, item]));
  const validGroups = reconcileGatoMayor3x2Groups(cleaned, groups);
  const discountByProductId = new Map();
  const evaluatedGroups = validGroups.map((group, groupIndex) => {
    const units = group.items.flatMap(selection => {
      const product = productById.get(selection.productId);
      if (!product) return [];
      return Array.from({ length: selection.quantity }, (_, unitIndex) => ({
        productId: product.id,
        name: product.product_name || product.name,
        skuCode: product.sku_code || '',
        price: roundMoney(product.price),
        unitIndex,
      }));
    });
    units.sort((a, b) => a.price - b.price
      || a.skuCode.localeCompare(b.skuCode)
      || a.productId.localeCompare(b.productId)
      || a.unitIndex - b.unitIndex);
    const freeUnit = units[0];
    const discount = roundMoney(freeUnit?.price || 0);
    if (freeUnit) {
      discountByProductId.set(
        freeUnit.productId,
        roundMoney((discountByProductId.get(freeUnit.productId) || 0) + discount),
      );
    }
    return {
      ...group,
      groupNumber: groupIndex + 1,
      units: units.map((unit, index) => ({ ...unit, free: index === 0 })),
      freeProductId: freeUnit?.productId || null,
      discountAmount: discount,
    };
  });

  const nextCart = cleaned.map(item => {
    const discount = discountByProductId.get(item.id);
    return discount
      ? { ...item, discount_amount: discount, discount_reason: GATO_MAYOR_3X2_DISCOUNT_REASON }
      : item;
  });

  return {
    cart: nextCart,
    groups: evaluatedGroups,
    totalDiscount: roundMoney(evaluatedGroups.reduce((sum, group) => sum + group.discountAmount, 0)),
  };
};

export const buildGatoMayor3x2Group = (id, selectedQuantities) => ({
  id,
  items: Object.entries(selectedQuantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([productId, quantity]) => ({ productId, quantity })),
});

