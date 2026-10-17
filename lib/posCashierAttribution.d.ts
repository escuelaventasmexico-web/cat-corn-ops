import type { CartItem } from '../supabase';

export type AurreraCashierKey = 'angelica' | 'gerardo' | 'administrator';
export type PosCommissionAttributionMode = 'employee' | 'administrator';

export interface AurreraCashierOption {
  key: AurreraCashierKey;
  label: string;
  description: string;
  mode: PosCommissionAttributionMode;
  recipientId: string | null;
}

export const AURRERA_BRANCH_ID: string;
export const AURRERA_BRANCH_CODE: string;
export const ANGELICA_USER_ID: string;
export const GERARDO_USER_ID: string;
export const AURRERA_CASHIER_OPTIONS: readonly AurreraCashierOption[];
export function getAurreraCashierOption(key: AurreraCashierKey | null): AurreraCashierOption | null;
export function buildCheckoutFingerprint(input: {
  branchId: string | null | undefined;
  cart: CartItem[];
  cashInput: number;
  cardInput: number;
  transferInput: number;
  customerId?: string | null;
  promotionCode?: string | null;
}): string;
