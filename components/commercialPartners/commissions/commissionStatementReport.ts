import { getBusinessDateString } from '../../../lib/dateUtils';
import {
  CommissionMovement,
  CommissionPaymentStatus,
  CommissionStatus,
  SellerCommissionMonthlySummary,
  SourceType,
} from './commissionTypes';
import { parseNumericValue } from './commissionUtils';

export type StatementTab = 'detail' | 'extra_days' | 'products';
export type StatementDetailFilter =
  | 'all'
  | 'pending'
  | 'available'
  | 'partially_paid'
  | 'paid'
  | 'cancelled';

export interface CommissionFinancialTotals {
  generated: number;
  paid: number;
  pending: number;
  releasedOutstanding: number;
  reserved: number;
  allocatable: number;
}

export interface CommissionSourceSummary extends CommissionFinancialTotals {
  key: CommissionSourceKey;
  label: string;
  movements: number;
}

export interface CommissionExtraDaySummary {
  businessDate: string;
  description: string;
  generated: number;
  paid: number;
  available: number;
  statusLabel: string;
  extraDayMovements: CommissionMovement[];
  otherMovements: CommissionMovement[];
  otherGenerated: number;
  dayGeneratedTotal: number;
}

export interface CommissionProductSummary extends CommissionFinancialTotals {
  family: string;
  variants: string[];
  units: number;
  movements: number;
  percentage: number;
}

export interface CommissionStatementReconciliation {
  generatedEquation: boolean;
  releasedEquation: boolean;
  sourceGenerated: boolean;
  sourcePaid: boolean;
  sourcePending: boolean;
  sourceAllocatable: boolean;
  productEquation: boolean;
  uniqueEffectiveEvents: boolean;
  summaryGenerated: boolean;
  summaryPaid: boolean;
  summaryPending: boolean;
  summaryAllocatable: boolean;
  summaryEventCount: boolean;
  isValid: boolean;
  issues: string[];
}

export interface CommissionStatementReport {
  allMovements: CommissionMovement[];
  effectiveMovements: CommissionMovement[];
  cancelledMovements: CommissionMovement[];
  totals: CommissionFinancialTotals;
  sourceBreakdown: CommissionSourceSummary[];
  extraDays: CommissionExtraDaySummary[];
  productBreakdown: CommissionProductSummary[];
  productGenerated: number;
  nonProductGenerated: number;
  reconciliation: CommissionStatementReconciliation;
}

type CommissionSourceKey =
  | 'extra_day'
  | 'pos_sale'
  | 'comodato_sale'
  | 'conversion_bonus'
  | 'wholesale_sale'
  | 'piece_sale'
  | 'other_adjustment';

const SOURCE_DEFINITIONS: Array<{ key: CommissionSourceKey; label: string }> = [
  { key: 'extra_day', label: 'Día extra' },
  { key: 'pos_sale', label: 'Punto de Venta' },
  { key: 'comodato_sale', label: 'Comodato' },
  { key: 'conversion_bonus', label: 'Bono de conversión' },
  { key: 'wholesale_sale', label: 'Mayoreo' },
  { key: 'piece_sale', label: 'Venta por pieza' },
  { key: 'other_adjustment', label: 'Otros ajustes' },
];

const PRODUCT_SOURCE_TYPES = new Set<SourceType>([
  'comodato_sale',
  'wholesale_sale',
  'piece_sale',
  'pos_sale',
]);

const EMPTY_TOTALS = (): CommissionFinancialTotals => ({
  generated: 0,
  paid: 0,
  pending: 0,
  releasedOutstanding: 0,
  reserved: 0,
  allocatable: 0,
});

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const parseCommissionMetadata = (
  metadata: CommissionMovement['metadata']
): Record<string, unknown> => {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return metadata;
};

const validDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

export const isExtraDayMovement = (movement: CommissionMovement): boolean => {
  const metadata = parseCommissionMetadata(movement.metadata);
  return movement.source_type === 'adjustment'
    && metadata.adjustment_type === 'extra_day';
};

const isLogicalUtcMidnight = (value: string): boolean => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const hasUtcOffset = /(?:Z|[+-]00:00)$/i.test(value);
  return hasUtcOffset
    && parsed.getUTCHours() === 0
    && parsed.getUTCMinutes() === 0
    && parsed.getUTCSeconds() === 0
    && parsed.getUTCMilliseconds() === 0;
};

export const getCommissionBusinessDate = (movement: CommissionMovement): string => {
  const metadata = parseCommissionMetadata(movement.metadata);
  if (isExtraDayMovement(movement) && validDateOnly(metadata.work_date)) {
    return metadata.work_date;
  }
  if (validDateOnly(metadata.business_date)) {
    return metadata.business_date;
  }
  if (isLogicalUtcMidnight(movement.earned_at)) {
    return movement.earned_at.slice(0, 10);
  }
  return getBusinessDateString(movement.earned_at);
};

export const formatCommissionDate = (date: string): string => {
  if (!validDateOnly(date)) return '—';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

export const formatCommissionPeriod = (monthStart: string): string => {
  if (!validDateOnly(monthStart)) return monthStart;
  const [year, month] = monthStart.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
};

export const shiftDateOnly = (date: string, days: number): string => {
  if (!validDateOnly(date)) throw new Error(`Fecha mensual inválida: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

export const getMovementFinancials = (
  movement: CommissionMovement
): CommissionFinancialTotals => ({
  generated: parseNumericValue(movement.commission_amount),
  paid: parseNumericValue(movement.paid_amount),
  pending: movement.status === 'pending'
    ? parseNumericValue(movement.commission_amount)
    : 0,
  releasedOutstanding: movement.status === 'available'
    ? parseNumericValue(movement.remaining_amount)
    : 0,
  reserved: movement.status === 'available'
    ? parseNumericValue(movement.reserved_amount)
    : 0,
  allocatable: movement.status === 'available'
    ? parseNumericValue(movement.allocatable_amount)
    : 0,
});

const addTotals = (
  target: CommissionFinancialTotals,
  movement: CommissionMovement
): void => {
  const amounts = getMovementFinancials(movement);
  target.generated += amounts.generated;
  target.paid += amounts.paid;
  target.pending += amounts.pending;
  target.releasedOutstanding += amounts.releasedOutstanding;
  target.reserved += amounts.reserved;
  target.allocatable += amounts.allocatable;
};

const sumMovements = (movements: CommissionMovement[]): CommissionFinancialTotals => {
  const result = EMPTY_TOTALS();
  movements.forEach(movement => addTotals(result, movement));
  return result;
};

const sourceKeyForMovement = (movement: CommissionMovement): CommissionSourceKey => {
  if (isExtraDayMovement(movement)) return 'extra_day';
  switch (movement.source_type) {
    case 'pos_sale':
    case 'comodato_sale':
    case 'conversion_bonus':
    case 'wholesale_sale':
    case 'piece_sale':
      return movement.source_type;
    case 'adjustment':
    default:
      return 'other_adjustment';
  }
};

export const getStatementSourceLabel = (movement: CommissionMovement): string => {
  const key = sourceKeyForMovement(movement);
  return SOURCE_DEFINITIONS.find(source => source.key === key)?.label ?? 'Otros ajustes';
};

export const getMovementDescription = (movement: CommissionMovement): string => {
  const metadata = parseCommissionMetadata(movement.metadata);
  if (isExtraDayMovement(movement)) {
    return typeof metadata.description === 'string' && metadata.description.trim()
      ? metadata.description.trim()
      : 'Día extra';
  }
  if (movement.source_type === 'conversion_bonus') return 'Bono de conversión';
  return movement.product_name?.trim() || getStatementSourceLabel(movement);
};

export const getMovementFolio = (movement: CommissionMovement): string => {
  if (movement.source_folio?.trim()) return movement.source_folio.trim();
  if (movement.partner_folio?.trim()) return movement.partner_folio.trim();
  if (movement.source_type === 'pos_sale') return 'Punto de Venta';
  return '—';
};

export const getMovementCounterparty = (movement: CommissionMovement): string => {
  if (movement.business_name?.trim()) return movement.business_name.trim();
  if (movement.source_type === 'pos_sale') return 'Punto de Venta';
  if (movement.source_type === 'piece_sale') return 'Venta por pieza';
  if (movement.source_type === 'adjustment') return 'Administrativo';
  return '—';
};

export const getMovementDisplayStatus = (movement: CommissionMovement): string => {
  if (movement.status === 'cancelled') return 'Cancelada';
  if (movement.status === 'paid' || movement.payment_status === 'paid') return 'Pagada';
  if (movement.status === 'available' && parseNumericValue(movement.reserved_amount) !== 0) {
    return 'Reservada en liquidación';
  }
  if (movement.payment_status === 'partially_paid') return 'Parcialmente pagada';
  if (movement.status === 'pending') return 'Pendiente de liberación';
  return 'Disponible';
};

export const getMovementDisplayStatusColor = (movement: CommissionMovement): string => {
  const label = getMovementDisplayStatus(movement);
  if (label === 'Pendiente de liberación') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (label === 'Disponible') return 'bg-green-500/15 text-green-300 border-green-500/30';
  if (label === 'Parcialmente pagada') return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  if (label === 'Reservada en liquidación') return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
  if (label === 'Pagada') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  return 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30';
};

export const movementMatchesFilter = (
  movement: CommissionMovement,
  filter: StatementDetailFilter
): boolean => {
  if (filter === 'all') return true;
  if (filter === 'cancelled') return movement.status === 'cancelled';
  if (filter === 'partially_paid') return movement.status !== 'cancelled'
    && movement.payment_status === 'partially_paid';
  if (filter === 'paid') return movement.status !== 'cancelled'
    && (movement.status === 'paid' || movement.payment_status === 'paid');
  if (filter === 'pending') return movement.status === 'pending';
  return movement.status === 'available' && movement.payment_status !== 'partially_paid';
};

const getGroupedStatusLabel = (movements: CommissionMovement[]): string => {
  const labels = Array.from(new Set(movements.map(getMovementDisplayStatus)));
  return labels.length === 1 ? labels[0] : 'Mixto';
};

const buildExtraDaySummaries = (
  allMovements: CommissionMovement[],
  effectiveMovements: CommissionMovement[]
): CommissionExtraDaySummary[] => {
  const extraGroups = new Map<string, CommissionMovement[]>();
  allMovements.filter(isExtraDayMovement).forEach(movement => {
    const date = getCommissionBusinessDate(movement);
    const group = extraGroups.get(date) ?? [];
    group.push(movement);
    extraGroups.set(date, group);
  });

  const effectiveByDate = new Map<string, CommissionMovement[]>();
  effectiveMovements.filter(movement => !isExtraDayMovement(movement)).forEach(movement => {
    const date = getCommissionBusinessDate(movement);
    const group = effectiveByDate.get(date) ?? [];
    group.push(movement);
    effectiveByDate.set(date, group);
  });

  return Array.from(extraGroups.entries()).map(([businessDate, extraDayMovements]) => {
    const effectiveExtraDays = extraDayMovements.filter(movement => movement.status !== 'cancelled');
    const otherMovements = effectiveByDate.get(businessDate) ?? [];
    const descriptions = Array.from(new Set(extraDayMovements.map(getMovementDescription)));
    const generated = effectiveExtraDays.reduce(
      (sum, movement) => sum + parseNumericValue(movement.commission_amount),
      0
    );
    const paid = effectiveExtraDays.reduce(
      (sum, movement) => sum + parseNumericValue(movement.paid_amount),
      0
    );
    const available = effectiveExtraDays.reduce(
      (sum, movement) => sum + (
        movement.status === 'available' ? parseNumericValue(movement.allocatable_amount) : 0
      ),
      0
    );
    const otherGenerated = otherMovements.reduce(
      (sum, movement) => sum + parseNumericValue(movement.commission_amount),
      0
    );

    return {
      businessDate,
      description: descriptions.join(' / '),
      generated,
      paid,
      available,
      statusLabel: getGroupedStatusLabel(extraDayMovements),
      extraDayMovements,
      otherMovements,
      otherGenerated,
      dayGeneratedTotal: generated + otherGenerated,
    };
  }).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
};

const normalizeProductIdentity = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const titleFromProductName = (value: string): string => value
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());

export const getProductFamily = (movement: CommissionMovement): string | null => {
  if (!PRODUCT_SOURCE_TYPES.has(movement.source_type)) return null;
  const rawIdentity = movement.product_key?.trim() || movement.product_name?.trim();
  if (!rawIdentity) return null;

  const key = normalizeProductIdentity(rawIdentity);
  const fallback = normalizeProductIdentity(movement.product_name ?? '');
  const identities = [key, fallback].filter(Boolean);

  if (identities.some(identity => identity.startsWith('tipi_mini_michi'))) return 'Tipi Mini Michi';
  if (identities.some(identity => identity === 'caramelo_michi' || identity.startsWith('michi_') || identity === 'michi')) {
    return 'Michi';
  }
  if (identities.some(identity => identity === 'caramelo_gato_mayor' || identity.startsWith('gato_mayor_') || identity === 'gato_mayor')) {
    return 'Gato Mayor';
  }
  if (identities.some(identity => identity.startsWith('jefe_felino_') || identity === 'jefe_felino')) {
    return 'Jefe Felino';
  }
  return titleFromProductName(movement.product_name?.trim() || rawIdentity.replace(/_/g, ' '));
};

const buildProductSummaries = (
  effectiveMovements: CommissionMovement[]
): { rows: CommissionProductSummary[]; productGenerated: number; nonProductGenerated: number } => {
  const groups = new Map<string, {
    totals: CommissionFinancialTotals;
    variants: Set<string>;
    units: number;
    movementIds: Set<string>;
  }>();
  let nonProductGenerated = 0;

  effectiveMovements.forEach(movement => {
    const family = getProductFamily(movement);
    if (!family) {
      nonProductGenerated += parseNumericValue(movement.commission_amount);
      return;
    }
    const group = groups.get(family) ?? {
      totals: EMPTY_TOTALS(),
      variants: new Set<string>(),
      units: 0,
      movementIds: new Set<string>(),
    };
    addTotals(group.totals, movement);
    if (movement.product_variant?.trim()) group.variants.add(movement.product_variant.trim());
    group.units += parseNumericValue(movement.quantity);
    group.movementIds.add(movement.commission_event_id);
    groups.set(family, group);
  });

  const productGenerated = Array.from(groups.values()).reduce(
    (sum, group) => sum + group.totals.generated,
    0
  );
  const rows = Array.from(groups.entries()).map(([family, group]) => ({
    family,
    variants: Array.from(group.variants).sort((a, b) => a.localeCompare(b, 'es-MX')),
    units: group.units,
    movements: group.movementIds.size,
    percentage: productGenerated === 0 ? 0 : (group.totals.generated / productGenerated) * 100,
    ...group.totals,
  })).sort((a, b) => b.generated - a.generated || a.family.localeCompare(b.family, 'es-MX'));

  return { rows, productGenerated, nonProductGenerated };
};

const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const moneyEquals = (left: number, right: number): boolean => toCents(left) === toCents(right);

const compareSummaryValue = (
  actual: number,
  summaryValue: number | string | undefined
): boolean => summaryValue === undefined || moneyEquals(actual, parseNumericValue(summaryValue));

const buildReconciliation = (
  effectiveMovements: CommissionMovement[],
  totals: CommissionFinancialTotals,
  sourceBreakdown: CommissionSourceSummary[],
  productGenerated: number,
  nonProductGenerated: number,
  monthlySummary: SellerCommissionMonthlySummary
): CommissionStatementReconciliation => {
  const sourceTotals = sourceBreakdown.reduce((accumulator, source) => {
    accumulator.generated += source.generated;
    accumulator.paid += source.paid;
    accumulator.pending += source.pending;
    accumulator.allocatable += source.allocatable;
    return accumulator;
  }, { generated: 0, paid: 0, pending: 0, allocatable: 0 });

  const checks = {
    generatedEquation: moneyEquals(
      totals.generated,
      totals.paid + totals.pending + totals.releasedOutstanding
    ),
    releasedEquation: moneyEquals(
      totals.releasedOutstanding,
      totals.reserved + totals.allocatable
    ),
    sourceGenerated: moneyEquals(sourceTotals.generated, totals.generated),
    sourcePaid: moneyEquals(sourceTotals.paid, totals.paid),
    sourcePending: moneyEquals(sourceTotals.pending, totals.pending),
    sourceAllocatable: moneyEquals(sourceTotals.allocatable, totals.allocatable),
    productEquation: moneyEquals(
      productGenerated + nonProductGenerated,
      totals.generated
    ),
    uniqueEffectiveEvents: new Set(
      effectiveMovements.map(movement => movement.commission_event_id)
    ).size === effectiveMovements.length,
    summaryGenerated: compareSummaryValue(totals.generated, monthlySummary.generated_total),
    summaryPaid: compareSummaryValue(totals.paid, monthlySummary.paid_total),
    summaryPending: compareSummaryValue(totals.pending, monthlySummary.pending_total),
    summaryAllocatable: compareSummaryValue(totals.allocatable, monthlySummary.available_total),
    summaryEventCount: monthlySummary.events_count === undefined
      || effectiveMovements.length === parseNumericValue(monthlySummary.events_count),
  };

  const issueLabels: Array<[keyof typeof checks, string]> = [
    ['generatedEquation', 'Generado no coincide con pagado + pendiente + saldo liberado.'],
    ['releasedEquation', 'Saldo liberado no coincide con reservado + disponible.'],
    ['sourceGenerated', 'El generado por origen no coincide con el total generado.'],
    ['sourcePaid', 'El pagado por origen no coincide con el total pagado.'],
    ['sourcePending', 'El pendiente por origen no coincide con el total pendiente.'],
    ['sourceAllocatable', 'El disponible por origen no coincide con el total disponible.'],
    ['productEquation', 'Productos + conceptos sin bolsa no coincide con el total generado.'],
    ['uniqueEffectiveEvents', 'La vista devolvió movimientos efectivos duplicados.'],
    ['summaryGenerated', 'El total generado difiere del resumen mensual.'],
    ['summaryPaid', 'El total pagado difiere del resumen mensual.'],
    ['summaryPending', 'El pendiente difiere del resumen mensual.'],
    ['summaryAllocatable', 'El disponible difiere del resumen mensual.'],
    ['summaryEventCount', 'El número de movimientos efectivos difiere del resumen mensual.'],
  ];
  const issues = issueLabels.filter(([key]) => !checks[key]).map(([, label]) => label);

  return {
    ...checks,
    isValid: issues.length === 0,
    issues,
  };
};

export const buildCommissionStatementReport = (
  movements: CommissionMovement[],
  monthlySummary: SellerCommissionMonthlySummary
): CommissionStatementReport => {
  const allMovements = [...movements].sort((left, right) => {
    const dateComparison = getCommissionBusinessDate(right)
      .localeCompare(getCommissionBusinessDate(left));
    if (dateComparison !== 0) return dateComparison;
    const timestampComparison = right.earned_at.localeCompare(left.earned_at);
    return timestampComparison !== 0
      ? timestampComparison
      : right.commission_event_id.localeCompare(left.commission_event_id);
  });
  const effectiveMovements = allMovements.filter(movement => movement.status !== 'cancelled');
  const cancelledMovements = allMovements.filter(movement => movement.status === 'cancelled');
  const totals = sumMovements(effectiveMovements);

  const sourceMap = new Map<CommissionSourceKey, CommissionSourceSummary>();
  SOURCE_DEFINITIONS.forEach(definition => {
    sourceMap.set(definition.key, {
      ...EMPTY_TOTALS(),
      key: definition.key,
      label: definition.label,
      movements: 0,
    });
  });
  effectiveMovements.forEach(movement => {
    const source = sourceMap.get(sourceKeyForMovement(movement));
    if (!source) return;
    addTotals(source, movement);
    source.movements += 1;
  });
  const sourceBreakdown = SOURCE_DEFINITIONS.map(definition => sourceMap.get(definition.key)!)
    .filter(source => source.movements > 0 || source.key !== 'other_adjustment');

  const extraDays = buildExtraDaySummaries(allMovements, effectiveMovements);
  const products = buildProductSummaries(effectiveMovements);
  const reconciliation = buildReconciliation(
    effectiveMovements,
    totals,
    sourceBreakdown,
    products.productGenerated,
    products.nonProductGenerated,
    monthlySummary
  );

  return {
    allMovements,
    effectiveMovements,
    cancelledMovements,
    totals,
    sourceBreakdown,
    extraDays,
    productBreakdown: products.rows,
    productGenerated: products.productGenerated,
    nonProductGenerated: products.nonProductGenerated,
    reconciliation,
  };
};

export const isCommissionStatus = (value: string): value is CommissionStatus => (
  value === 'pending' || value === 'available' || value === 'paid' || value === 'cancelled'
);

export const isCommissionPaymentStatus = (value: string): value is CommissionPaymentStatus => (
  isCommissionStatus(value) || value === 'partially_paid'
);
