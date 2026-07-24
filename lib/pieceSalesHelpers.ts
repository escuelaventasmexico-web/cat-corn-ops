/* ── Piece Sales Helpers ────────────────────────────────────── */

import { PieceSaleProduct, PieceSaleItemDisplay } from '../types/pieceSales';

export const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatNumber = (value: number | null | undefined, decimals = 0): string => {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

export const calculateItemSubtotal = (retailPrice: number, quantity: number): number => {
  return retailPrice * quantity;
};

export const calculateItemCommission = (unitCommission: number, quantity: number): number => {
  return unitCommission * quantity;
};

export const createPieceSaleItem = (
  product: PieceSaleProduct,
  quantity: number
): PieceSaleItemDisplay => {
  const subtotal = calculateItemSubtotal(product.retail_price, quantity);
  const commission_total = calculateItemCommission(product.unit_commission, quantity);

  return {
    ...product,
    quantity,
    subtotal,
    commission_total,
  };
};

export const calculateTotals = (items: PieceSaleItemDisplay[]) => {
  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const totalCommission = items.reduce((sum, item) => sum + item.commission_total, 0);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    totalAmount,
    totalCommission,
    totalUnits,
  };
};

export const sanitizeFileName = (fileName: string): string => {
  // Remove special characters and spaces
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
};

export const validateFileSize = (fileSizeBytes: number, maxMB: number = 10): boolean => {
  return fileSizeBytes <= maxMB * 1024 * 1024;
};

export const validateFileType = (mimeType: string): boolean => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  return allowedTypes.includes(mimeType);
};

export const getPaymentMethodLabel = (method: 'cash' | 'transfer'): string => {
  return method === 'cash' ? 'Efectivo' : 'Transferencia';
};

export const getSaleStatusLabel = (status: string): string => {
  switch (status) {
    case 'draft':
      return 'Borrador';
    case 'pending_review':
      return 'En revisión';
    case 'payment_rejected':
      return 'Pago rechazado';
    case 'confirmed':
      return 'Confirmada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status;
  }
};

export const getSaleStatusColor = (status: string): string => {
  switch (status) {
    case 'draft':
      return 'text-gray-400';
    case 'pending_review':
      return 'text-orange-400';
    case 'payment_rejected':
      return 'text-red-400';
    case 'confirmed':
      return 'text-green-400';
    case 'cancelled':
      return 'text-red-500';
    default:
      return 'text-cc-text-muted';
  }
};

export const formatDateMx = (dateString: string | null | undefined): string => {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};
/* ── Safe Number Formatting (handles null/undefined from Supabase) ── */

export const safeNumber = (value: unknown): number => {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
};

export const safeInteger = (value: unknown): string => {
  const num = safeNumber(value);
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

export const safeCurrency = (value: unknown): string => {
  const num = safeNumber(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};