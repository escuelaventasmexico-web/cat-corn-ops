import type { CartItem } from '../supabase';

export const GATO_MAYOR_3X2_PROMOTION_CODE: 'GATO_MAYOR_3X2';
export const GATO_MAYOR_3X2_DISCOUNT_REASON: 'PROMO_GATO_MAYOR_3X2';
export const GATO_MAYOR_3X2_SKUS: readonly ['SLGM180', 'SBGM180', 'CAGM180'];

export interface GatoMayor3x2GroupItem {
  productId: string;
  quantity: number;
}

export interface GatoMayor3x2Group {
  id: string;
  items: GatoMayor3x2GroupItem[];
}

export interface EvaluatedGatoMayor3x2Unit {
  productId: string;
  name: string;
  skuCode: string;
  price: number;
  unitIndex: number;
  free: boolean;
}

export interface EvaluatedGatoMayor3x2Group extends GatoMayor3x2Group {
  groupNumber: number;
  units: EvaluatedGatoMayor3x2Unit[];
  freeProductId: string | null;
  discountAmount: number;
}

export function isGatoMayor3x2Eligible(item: Partial<CartItem>): boolean;
export function clearGatoMayor3x2Discounts(cart: CartItem[]): CartItem[];
export function reconcileGatoMayor3x2Groups(cart: CartItem[], groups: GatoMayor3x2Group[]): GatoMayor3x2Group[];
export function getAvailableGatoMayor3x2Quantities(cart: CartItem[], groups: GatoMayor3x2Group[]): Map<string, number>;
export function evaluateGatoMayor3x2Groups(cart: CartItem[], groups: GatoMayor3x2Group[]): {
  cart: CartItem[];
  groups: EvaluatedGatoMayor3x2Group[];
  totalDiscount: number;
};
export function buildGatoMayor3x2Group(id: string, selectedQuantities: Record<string, number>): GatoMayor3x2Group;

