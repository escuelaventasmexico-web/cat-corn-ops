import type { CartItem } from '../supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PromotionCode =
  | 'MONDAY_2_MICHI'
  | 'TUESDAY_MINI_CAR'
  | 'WEDNESDAY_GATO'
  | 'THURSDAY_NON_DELIVERY'
  | 'FRIDAY_JEFE_TOPPING'
  | 'FRIDAY_MANTEQUILLA_2X1'
  | 'SATURDAY_JEFE_GATO'
  | 'SATURDAY_SABORES_50';

export interface PromotionDefinition {
  code: PromotionCode;
  label: string;
  shortLabel: string;
  day: string;
  /** 0=Sun 1=Mon … 6=Sat. When set, the promo is only available on that weekday (America/Mexico_City). */
  dayIndex?: number;
  description: string;
  /** What the promo includes, for display in UI */
  includes: string;
  /** Display promo price or discount text */
  promoPrice: string;
  /** Optional note like "No combinable con fidelidad" */
  note?: string;
  /** Returns true for cart items eligible for this promotion */
  isEligible: (item: CartItem) => boolean;
  /** Given eligible items (sorted by price desc), mutate discount_amount/discount_reason.
   *  Returns the new cart with discounts applied. */
  apply: (cart: CartItem[]) => CartItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isDeliverySku(item: CartItem): boolean {
  const sku = (item.sku_code || '').toUpperCase();
  return sku.startsWith('DEL-') || sku.startsWith('DEL_');
}

/** Returns true when item belongs to the "Sabores" category/flavor (case-insensitive). */
function isSabores(item: CartItem): boolean {
  const flavor = (item.flavor || item.category || '').toLowerCase();
  return flavor.includes('sabor');
}

/**
 * Returns true when item is Salada or Mantequilla/Mantequilla Tradicional.
 * Excludes: Sabores, Caramelo, Mix, Delivery SKUs.
 */
function isMantequilla(item: CartItem): boolean {
  if (isDeliverySku(item)) return false;
  const flavor = (item.flavor || item.category || '').toLowerCase();
  if (flavor.includes('sabor') || flavor.includes('caramel') || flavor.includes('mix')) return false;
  return (
    flavor.includes('salad') ||
    flavor.includes('mantequill') ||
    flavor.includes('tradicional')
  );
}

/** Convenience: true when today is Friday in Mexico City timezone. */
export function isTodayFriday(): boolean {
  return isTodayWeekday(5);
}

/**
 * Check if today is a given weekday (0=Sun … 6=Sat) using America/Mexico_City timezone.
 * This avoids UTC drift that would give wrong day near midnight.
 */
export function isTodayWeekday(dayIndex: number): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    weekday: 'short',
  });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return formatter.format(now) === days[dayIndex];
}

/** Convenience: true when today is Saturday in Mexico City timezone. */
export function isTodaySaturday(): boolean {
  return isTodayWeekday(6);
}

function isMichi90(item: CartItem): boolean {
  const name = (item.product_name || item.name || '').toLowerCase();
  const grams = item.grams || item.weight_grams || 0;
  const size = (item.size || '').toLowerCase();
  return name.includes('michi') && grams === 90 && size.includes('mediana');
}

function isMiniCaramelo60(item: CartItem): boolean {
  const name = (item.product_name || item.name || '').toLowerCase();
  const grams = item.grams || item.weight_grams || 0;
  return grams === 60 && name.includes('mini') && name.includes('caramel');
}

function isGatoMayor180(item: CartItem): boolean {
  const name = (item.product_name || item.name || '').toLowerCase();
  const grams = item.grams || item.weight_grams || 0;
  return name.includes('gato') && name.includes('mayor') && grams === 180;
}

function isJefeFelino240(item: CartItem): boolean {
  const name = (item.product_name || item.name || '').toLowerCase();
  const grams = item.grams || item.weight_grams || 0;
  return name.includes('jefe') && name.includes('felino') && grams === 240;
}

/** Clear all PROMO_ discounts from cart */
export function clearPromoDiscounts(cart: CartItem[]): CartItem[] {
  return cart.map(item =>
    item.discount_reason?.startsWith('PROMO_')
      ? { ...item, discount_amount: undefined, discount_reason: undefined }
      : item,
  );
}

/** Sort eligible items by unit price descending (most expensive first) */
function sortByPriceDesc(items: CartItem[]): CartItem[] {
  return [...items].sort((a, b) => b.price - a.price);
}

// ─── Promotion Definitions ──────────────────────────────────────────────────

export const PROMOTIONS: PromotionDefinition[] = [
  // --- MONDAY: Buy 2 Michi 90g, special bundle discount ($10 off each) ---
  {
    code: 'MONDAY_2_MICHI',
    label: 'Lunes: 2 Michi 90g',
    shortLabel: '2 Michi',
    day: 'Lunes',
    description: '2 Michi 90g con precio especial',
    includes: 'Incluye 2 Michi Mediana 90g',
    promoPrice: '$10 OFF c/u',
    note: 'No combinable con fidelidad',
    isEligible: (item) => isMichi90(item) && !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_MONDAY_2_MICHI';
      const cleaned = clearPromoDiscounts(cart);
      const eligible = cleaned.filter(i => isMichi90(i) && !isDeliverySku(i));
      const sorted = sortByPriceDesc(eligible);

      // Count total eligible units
      let unitsToDiscount = 0;
      for (const item of sorted) unitsToDiscount += item.quantity;
      // Need at least 2 items to form pairs
      const pairs = Math.floor(unitsToDiscount / 2);
      if (pairs === 0) return cleaned;

      // Discount = $10 per item for up to pairs*2 units
      let remaining = pairs * 2;
      return cleaned.map(item => {
        if (!isMichi90(item) || isDeliverySku(item) || remaining <= 0) return item;
        const units = Math.min(item.quantity, remaining);
        remaining -= units;
        return {
          ...item,
          discount_amount: units * 10,
          discount_reason: reason,
        };
      });
    },
  },

  // --- TUESDAY: Mini 60g Caramelo — $5 discount per unit ---
  {
    code: 'TUESDAY_MINI_CAR',
    label: 'Martes: Mini Caramelo',
    shortLabel: 'Mini Car',
    day: 'Martes',
    description: 'Mini 60g Caramelo con descuento',
    includes: 'Incluye 1 Mini Michi Caramelo 60g',
    promoPrice: '$5 OFF c/u',
    note: 'No combinable con fidelidad',
    isEligible: (item) => isMiniCaramelo60(item),
    apply: (cart) => {
      const reason = 'PROMO_TUESDAY_MINI_CAR';
      const cleaned = clearPromoDiscounts(cart);
      return cleaned.map(item => {
        if (!isMiniCaramelo60(item)) return item;
        return {
          ...item,
          discount_amount: item.quantity * 5,
          discount_reason: reason,
        };
      });
    },
  },

  // --- WEDNESDAY: Gato Mayor 180g non-delivery — $10 discount per unit ---
  {
    code: 'WEDNESDAY_GATO',
    label: 'Miércoles: Gato Mayor',
    shortLabel: 'Gato Mayor',
    day: 'Miércoles',
    description: 'Gato Mayor 180g (no delivery) con descuento',
    includes: 'Incluye 1 Gato Mayor 180g',
    promoPrice: '$10 OFF c/u',
    note: 'Solo en punto de venta (no delivery)',
    isEligible: (item) => isGatoMayor180(item) && !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_WEDNESDAY_GATO';
      const cleaned = clearPromoDiscounts(cart);
      return cleaned.map(item => {
        if (!isGatoMayor180(item) || isDeliverySku(item)) return item;
        return {
          ...item,
          discount_amount: item.quantity * 10,
          discount_reason: reason,
        };
      });
    },
  },

  // --- THURSDAY: Non-delivery products — $5 off most expensive eligible items ---
  {
    code: 'THURSDAY_NON_DELIVERY',
    label: 'Jueves: No Delivery',
    shortLabel: 'No Delivery',
    day: 'Jueves',
    description: 'Descuento en productos no-delivery',
    includes: 'Aplica a cualquier producto en punto de venta',
    promoPrice: '$5 OFF c/u',
    note: 'Excluye pedidos delivery',
    isEligible: (item) => !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_THURSDAY_NON_DELIVERY';
      const cleaned = clearPromoDiscounts(cart);
      // Apply $5 per unit to each non-delivery item, highest price first
      const eligible = cleaned.filter(i => !isDeliverySku(i));
      const sorted = sortByPriceDesc(eligible);
      const eligibleIds = new Set(sorted.map(i => i.id));
      return cleaned.map(item => {
        if (!eligibleIds.has(item.id)) return item;
        return {
          ...item,
          discount_amount: item.quantity * 5,
          discount_reason: reason,
        };
      });
    },
  },

  // --- FRIDAY: Jefe Felino 240g non-delivery — $5 off per unit ---
  {
    code: 'FRIDAY_JEFE_TOPPING',
    label: 'Viernes: Jefe Felino',
    shortLabel: 'Jefe Felino',
    day: 'Viernes',
    description: 'Jefe Felino 240g (no delivery) con descuento',
    includes: 'Incluye 1 Jefe Felino 240g',
    promoPrice: '$5 OFF c/u',
    note: 'Solo en punto de venta (no delivery)',
    isEligible: (item) => isJefeFelino240(item) && !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_FRIDAY_JEFE_TOPPING';
      const cleaned = clearPromoDiscounts(cart);
      return cleaned.map(item => {
        if (!isJefeFelino240(item) || isDeliverySku(item)) return item;
        return {
          ...item,
          discount_amount: item.quantity * 5,
          discount_reason: reason,
        };
      });
    },
  },

  // --- FRIDAY: Mantequilla/Salada 2x1 — buy 1 get 2nd (equal or cheaper) FREE ---
  // Forms pairs: sort all eligible units DESC by price.
  //   index 0 (most expensive) = full price
  //   index 1 (cheaper or equal) = 100% off (free)
  //   index 2 = full price, index 3 = free, etc.
  // Only applies on Fridays (America/Mexico_City). Excludes Delivery SKUs.
  {
    code: 'FRIDAY_MANTEQUILLA_2X1',
    label: 'Viernes: Mantequilla 2x1',
    shortLabel: 'Mantequilla 2x1',
    day: 'Viernes',
    dayIndex: 5,
    description: 'Lleva 2 Salada/Mantequilla: el más caro completo, el 2° gratis',
    includes: 'Línea Salada y Mantequilla (no Sabores, no Caramelo, no Delivery)',
    promoPrice: '2° Salada/Mantequilla GRATIS',
    note: 'Solo viernes · No combinable con fidelidad',
    isEligible: (item) => isMantequilla(item),
    apply: (cart) => {
      const reason = 'PROMO_FRIDAY_MANTEQUILLA_2X1';
      const cleaned = clearPromoDiscounts(cart);

      // Collect all eligible items
      const eligible = cleaned.filter(i => isMantequilla(i));
      if (eligible.length === 0) return cleaned;

      // Expand to individual units for pair logic
      const units: { id: string; price: number }[] = [];
      for (const item of eligible) {
        for (let u = 0; u < item.quantity; u++) {
          units.push({ id: item.id, price: item.price });
        }
      }

      // Sort DESC: most expensive first
      units.sort((a, b) => b.price - a.price);

      // Odd index = 100% off (free)
      const discountByItemId = new Map<string, number>();
      for (let i = 1; i < units.length; i += 2) {
        const unit = units[i];
        const prev = discountByItemId.get(unit.id) || 0;
        discountByItemId.set(
          unit.id,
          Math.round((prev + unit.price) * 100) / 100,
        );
      }

      if (discountByItemId.size === 0) return cleaned;

      return cleaned.map(item => {
        const disc = discountByItemId.get(item.id);
        if (disc === undefined) return item;
        return { ...item, discount_amount: disc, discount_reason: reason };
      });
    },
  },

  // --- SATURDAY: Bundle Jefe 240g + Gato Mayor 180g non-delivery — $15 off each ---
  {
    code: 'SATURDAY_JEFE_GATO',
    label: 'Sábado: Jefe + Gato',
    shortLabel: 'Jefe+Gato',
    day: 'Sábado',
    description: 'Bundle Jefe 240g + Gato Mayor 180g (no delivery)',
    includes: 'Incluye 1 Jefe Felino 240g + 1 Gato Mayor 180g',
    promoPrice: '$15 OFF c/u',
    note: 'Solo en punto de venta (no delivery)',
    isEligible: (item) =>
      (isJefeFelino240(item) || isGatoMayor180(item)) && !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_SATURDAY_JEFE_GATO';
      const cleaned = clearPromoDiscounts(cart);

      // Count available units of each type
      const jefes = cleaned.filter(i => isJefeFelino240(i) && !isDeliverySku(i));
      const gatos = cleaned.filter(i => isGatoMayor180(i) && !isDeliverySku(i));
      const jefeUnits = jefes.reduce((s, i) => s + i.quantity, 0);
      const gatoUnits = gatos.reduce((s, i) => s + i.quantity, 0);
      // Bundles = min(jefe units, gato units)
      const bundles = Math.min(jefeUnits, gatoUnits);
      if (bundles === 0) return cleaned;

      let jefeRemaining = bundles;
      let gatoRemaining = bundles;

      return cleaned.map(item => {
        if (isJefeFelino240(item) && !isDeliverySku(item) && jefeRemaining > 0) {
          const units = Math.min(item.quantity, jefeRemaining);
          jefeRemaining -= units;
          return { ...item, discount_amount: units * 15, discount_reason: reason };
        }
        if (isGatoMayor180(item) && !isDeliverySku(item) && gatoRemaining > 0) {
          const units = Math.min(item.quantity, gatoRemaining);
          gatoRemaining -= units;
          return { ...item, discount_amount: units * 15, discount_reason: reason };
        }
        return item;
      });
    },
  },

  // --- SATURDAY: Sabores Gourmet 50% — buy 1 get 2nd (equal or cheaper) at 50% ---
  // Applies ONLY to products in the "Sabores" category/flavor, never Delivery SKUs.
  // Forms pairs by sorting all eligible UNITS price DESC:
  //   index 0 = full price, index 1 = 50% off, index 2 = full, index 3 = 50% off…
  {
    code: 'SATURDAY_SABORES_50',
    label: 'Sábado: Sabores Gourmet 50%',
    shortLabel: 'Sabores 50%',
    day: 'Sábado',
    dayIndex: 6,
    description: 'Lleva 2 Sabores: el más caro completo, el 2° igual o más barato al 50%',
    includes: 'Toda la línea Sabores Gourmet (no Delivery)',
    promoPrice: '2° Sabores 50% OFF',
    note: 'Solo sábados · No combinable con fidelidad',
    isEligible: (item) => isSabores(item) && !isDeliverySku(item),
    apply: (cart) => {
      const reason = 'PROMO_SATURDAY_SABORES_50';
      const cleaned = clearPromoDiscounts(cart);

      // Collect all eligible items
      const eligible = cleaned.filter(i => isSabores(i) && !isDeliverySku(i));
      if (eligible.length === 0) return cleaned;

      // Expand to individual units so we can sort and pair regardless of quantity grouping
      const units: { id: string; price: number }[] = [];
      for (const item of eligible) {
        for (let u = 0; u < item.quantity; u++) {
          units.push({ id: item.id, price: item.price });
        }
      }

      // Sort DESC: most expensive first
      units.sort((a, b) => b.price - a.price);

      // Even index = full price, odd index = 50% off
      const discountByItemId = new Map<string, number>();
      for (let i = 1; i < units.length; i += 2) {
        const unit = units[i];
        const prev = discountByItemId.get(unit.id) || 0;
        discountByItemId.set(
          unit.id,
          Math.round((prev + unit.price * 0.5) * 100) / 100,
        );
      }

      if (discountByItemId.size === 0) return cleaned;

      return cleaned.map(item => {
        const disc = discountByItemId.get(item.id);
        if (disc === undefined) return item;
        return { ...item, discount_amount: disc, discount_reason: reason };
      });
    },
  },
];

export function getPromotion(code: PromotionCode): PromotionDefinition | undefined {
  return PROMOTIONS.find(p => p.code === code);
}

/** Count how many cart items are eligible for a given promo */
export function countEligible(cart: CartItem[], code: PromotionCode): number {
  const promo = getPromotion(code);
  if (!promo) return 0;
  return cart.filter(i => promo.isEligible(i)).reduce((s, i) => s + i.quantity, 0);
}

/** Get the emoji for a promo day */
export function getPromoEmoji(code: PromotionCode): string {
  switch (code) {
    case 'MONDAY_2_MICHI': return '🐱';
    case 'TUESDAY_MINI_CAR': return '🍯';
    case 'WEDNESDAY_GATO': return '🐈';
    case 'THURSDAY_NON_DELIVERY': return '🏪';
    case 'FRIDAY_JEFE_TOPPING': return '👑';
    case 'FRIDAY_MANTEQUILLA_2X1': return '🧈';
    case 'SATURDAY_JEFE_GATO': return '🎉';
    case 'SATURDAY_SABORES_50': return '🧡';
  }
}
