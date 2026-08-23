/* ── Commission Utilities ────────────────────────────────────────── */

import { CommissionPaymentStatus, CommissionStatus, SourceType } from './commissionTypes';

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
  if (decimals === 0) {
    return new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

export const getMonthName = (date: Date): string => {
  return date.toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  });
};

export const getStatusColor = (status: CommissionStatus): string => {
  switch (status) {
    case 'pending':
      return '#f59e0b'; // amber
    case 'available':
      return '#10b981'; // green
    case 'paid':
      return '#3b82f6'; // blue
    case 'cancelled':
      return '#6b7280'; // gray
    default:
      return '#6b7280';
  }
};

export const getStatusLabel = (status: CommissionStatus): string => {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'available':
      return 'Disponible';
    case 'paid':
      return 'Pagada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return 'Desconocido';
  }
};

export const getPaymentStatusColor = (status: CommissionPaymentStatus): string => {
  switch (status) {
    case 'pending':
      return '#f59e0b';
    case 'available':
      return '#10b981';
    case 'partially_paid':
      return '#a855f7';
    case 'paid':
      return '#3b82f6';
    case 'cancelled':
      return '#6b7280';
    default:
      return '#6b7280';
  }
};

export const getPaymentStatusLabel = (status: CommissionPaymentStatus): string => {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'available':
      return 'Sin pagar';
    case 'partially_paid':
      return 'Pago parcial';
    case 'paid':
      return 'Pagada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return 'Desconocido';
  }
};

export const getSourceTypeLabel = (sourceType: SourceType): string => {
  switch (sourceType) {
    case 'comodato_sale':
      return 'Comodato';
    case 'wholesale_sale':
      return 'Mayoreo';
    case 'conversion_bonus':
      return 'Bono de conversión';
    case 'adjustment':
      return 'Ajuste';
    case 'pos_sale':
      return 'Venta en Punto de Venta';
    default:
      return 'Otro';
  }
};

export const getSourceTypeColor = (sourceType: SourceType): string => {
  switch (sourceType) {
    case 'comodato_sale':
      return '#a855f7'; // purple
    case 'wholesale_sale':
      return '#3b82f6'; // blue
    case 'conversion_bonus':
      return '#f59e0b'; // amber
    case 'adjustment':
      return '#6b7280'; // gray
    case 'pos_sale':
      return '#06b6d4'; // cyan
    default:
      return '#6b7280';
  }
};

export const parseNumericValue = (value: any): number => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

export const getProgressPercentage = (current: number, target: number): number => {
  if (target <= 0) return 0;
  const percentage = (current / target) * 100;
  return Math.min(percentage, 100); // Cap at 100% for visual progress bar
};

export const getMotivationalMessage = (
  available: number,
  pending: number,
  generated: number,
  previousGenerated: number,
  hasActivity: boolean
): string => {
  if (!hasActivity) {
    return 'Aún no tienes comisiones registradas este mes. Tus próximas ventas aparecerán aquí.';
  }

  if (available > 0) {
    return `Ya tienes ${formatCurrency(available)} disponibles para tu próximo pago.`;
  }

  if (pending > 0) {
    return `Tienes ${formatCurrency(pending)} adicionales que se liberarán cuando los clientes terminen de pagar.`;
  }

  if (previousGenerated > 0 && generated > previousGenerated) {
    const increase = ((generated - previousGenerated) / previousGenerated) * 100;
    return `Este mes llevas ${increase.toFixed(1)}% más comisiones que el mes anterior.`;
  }

  return `Has generado ${formatCurrency(generated)} en comisiones: ${formatCurrency(available)} disponibles y ${formatCurrency(pending)} pendientes.`;
};

export const getMonthStartDate = (year: number, month: number): Date => {
  return new Date(year, month, 1);
};

export const getMonthEndDate = (year: number, month: number): Date => {
  return new Date(year, month + 1, 0);
};

export const getLastSixMonthsRange = (): Array<{ year: number; month: number; label: string }> => {
  const months: Array<{ year: number; month: number; label: string }> = [];
  const now = new Date();
  
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: date.getFullYear(),
      month: date.getMonth(),
      label: date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
    });
  }
  
  return months;
};

export const canSelectMonth = (year: number, month: number): boolean => {
  const now = new Date();
  const selectedDate = new Date(year, month, 1);
  return selectedDate <= now;
};

export const exportToCSV = (
  filename: string,
  data: any[],
  columns: { key: string; label: string }[]
) => {
  const headers = columns.map(c => `"${c.label}"`).join(',');
  const rows = data.map(row =>
    columns
      .map(col => {
        let value = row[col.key] ?? '';
        if (value === null || value === undefined) value = '';
        if (typeof value === 'string') {
          value = value.replace(/"/g, '""');
        }
        return `"${value}"`;
      })
      .join(',')
  );

  const csv = [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
