// Helpers for dual-modality detection and formatting

import { CommercialPartner } from '../../types';
import { WholesaleDebtAuthorizationRequest, AUTH_STATUS_LABELS, AUTH_STATUS_COLORS } from './types';

/**
 * Detects if partner has comodato model
 */
export const hasComodato = (partner: CommercialPartner): boolean => {
  return partner.partner_model === 'comodato';
};

/**
 * Detects if partner has active wholesale/mayoreo
 */
export const hasWholesale = (partner: CommercialPartner): boolean => {
  return (
    partner.partner_model === 'mayoreo' ||
    partner.wholesale_status === 'active'
  );
};

/**
 * Detects if partner is dual-modality (comodato + active mayoreo)
 */
export const isDualPartner = (partner: CommercialPartner): boolean => {
  return (
    partner.partner_model === 'comodato' &&
    partner.wholesale_status === 'active'
  );
};

/**
 * Formats currency for display
 */
export const formatCurrency = (amount: number | string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

/**
 * Gets label for authorization status
 */
export const getAuthStatusLabel = (status: string): string => {
  return AUTH_STATUS_LABELS[status] || status;
};

/**
 * Gets colors for authorization status
 */
export const getAuthStatusColors = (
  status: string
): {
  bg: string;
  text: string;
  border: string;
} => {
  return (
    AUTH_STATUS_COLORS[status] || {
      bg: 'bg-gray-50',
      text: 'text-gray-800',
      border: 'border-gray-200',
    }
  );
};

/**
 * Formats date for display
 */
export const formatDate = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
};

/**
 * Determines if authorization can be used for activation
 */
export const canUseAuthorizationForActivation = (
  auth: WholesaleDebtAuthorizationRequest
): boolean => {
  return auth.status === 'approved' && !auth.used_at;
};

/**
 * Gets CSS classes for partner modality badges
 */
export const getModalityBadges = (partner: CommercialPartner) => {
  const badges: Array<{ label: string; color: string }> = [];

  if (hasComodato(partner)) {
    badges.push({
      label: 'Comodato',
      color: 'bg-blue-100 text-blue-800 border-blue-300',
    });
  }

  if (hasWholesale(partner)) {
    badges.push({
      label: 'Mayoreo',
      color: 'bg-green-100 text-green-800 border-green-300',
    });
  }

  return badges;
};

/**
 * Safe number conversion
 */
export const safeNumber = (val: any): number => {
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : 0;
};
