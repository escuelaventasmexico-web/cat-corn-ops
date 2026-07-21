/* ── B2B Report Helpers ─────────────────────────────────────────── */

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

export const formatDateFull = (value: string | null | undefined): string => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

/**
 * Calcula un porcentaje de forma segura.
 * Devuelve 0 si el denominador es 0 o los valores son inválidos.
 */
export const safePercentage = (
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number => {
  const num = numerator ?? 0;
  const denom = denominator ?? 0;

  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) {
    return 0;
  }

  return (num / denom) * 100;
};

export const formatPercent = (value: number | null | undefined, decimals = 1): string => {
  if (value === null || value === undefined) return '0%';

  // Manejar NaN, Infinity y valores inválidos
  if (!Number.isFinite(value)) {
    return '0%';
  }

  // Si value ya es un porcentaje (0-100), no multiplicar por 100
  // Si value es una fracción (0-1), multiplicar por 100
  // Detectar: si value > 100, ya es porcentaje
  const percentValue = value > 100 ? value : value * 100;

  return `${formatNumber(percentValue, decimals)}%`;
};

export const daysUntil = (dateString: string | null | undefined): number | null => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const diff = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  } catch {
    return null;
  }
};

export const getDayLabel = (days: number | null): string => {
  if (days === null) return '—';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days < 0) return `Hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
  return `En ${days} ${days === 1 ? 'día' : 'días'}`;
};

export const getVisitStatusColor = (days: number | null): string => {
  if (days === null) return 'text-cc-text-muted';
  if (days < 0) return 'text-red-500'; // Expired
  if (days === 0) return 'text-amber-500'; // Today
  if (days <= 7) return 'text-orange-500'; // This week
  return 'text-green-500'; // Future
};

export const getPriorityColor = (priority: string | null | undefined): string => {
  if (priority === 'saldo_alto') return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (priority === 'saldo_medio') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  if (priority === 'saldo_bajo') return 'bg-green-500/20 text-green-400 border-green-500/30';
  return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
};

export const getPriorityLabel = (priority: string | null | undefined): string => {
  if (priority === 'saldo_alto') return 'Alta';
  if (priority === 'saldo_medio') return 'Media';
  if (priority === 'saldo_bajo') return 'Baja';
  return '—';
};

export const getCollectionPriority = (amount: number): 'saldo_alto' | 'saldo_medio' | 'saldo_bajo' => {
  if (amount > 500) return 'saldo_alto';
  if (amount > 100) return 'saldo_medio';
  return 'saldo_bajo';
};

export const getMapMarkerColor = (markerType: string | null | undefined): string => {
  if (markerType === 'saldo_pendiente') return '#EF4444'; // red
  if (markerType === 'mayoreo') return '#3B82F6'; // blue
  if (markerType === 'comodato') return '#A855F7'; // purple
  if (markerType === 'en_negociacion') return '#EAB308'; // yellow
  if (markerType === 'activo') return '#22C55E'; // green
  return '#6B7280'; // gray
};

/* ── CSV Export ──────────────────────────────────────────────── */
export const exportToCSV = (filename: string, data: any[], columns: { key: string; label: string }[]) => {
  // Build header
  const headers = columns.map(c => `"${c.label}"`).join(',');

  // Build rows
  const rows = data.map(row =>
    columns
      .map(col => {
        let value = row[col.key] ?? '';
        if (value === null || value === undefined) value = '';
        // Escape quotes in value
        if (typeof value === 'string') {
          value = value.replace(/"/g, '""');
        }
        return `"${value}"`;
      })
      .join(',')
  );

  // Combine
  const csv = [headers, ...rows].join('\n');

  // Download
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
