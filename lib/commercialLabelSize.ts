export type LabelSizeId = '50x30' | '50x40';
export type LabelHorizontalAlignment = 'left' | 'center' | 'right';

export interface LabelPrinterProfile {
  sizeId: LabelSizeId;
  horizontalAlignment: LabelHorizontalAlignment;
  horizontalOffsetMm: number;
}

export interface LabelSizeConfig {
  id: LabelSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  contentHeightPx: number;
  safeMarginXPx: number;
  printableWidthPx: number;
  printWidthPx: number;
  sourceCropXPx: number;
  nativeOriginXPx: number;
  gapMm: number;
  dpi: number;
  dotsPerMm: number;
}

const buildLabelSize = (
  id: LabelSizeId,
  widthMm: number,
  heightMm: number,
  widthPx: number,
  heightPx: number,
): LabelSizeConfig => {
  const safeMarginXPx = 8;
  const printableWidthPx = 384;
  return {
    id,
    label: `${widthMm} × ${heightMm} mm`,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    contentHeightPx: 240,
    safeMarginXPx,
    printableWidthPx,
    printWidthPx: printableWidthPx - safeMarginXPx * 2,
    sourceCropXPx: widthPx - printableWidthPx + safeMarginXPx,
    nativeOriginXPx: safeMarginXPx,
    gapMm: 3,
    dpi: 203,
    dotsPerMm: 8,
  };
};

export const LABEL_SIZE_CATALOG: Record<LabelSizeId, LabelSizeConfig> = {
  '50x30': buildLabelSize('50x30', 50, 30, 400, 240),
  '50x40': buildLabelSize('50x40', 50, 40, 400, 320),
};

export const DEFAULT_LABEL_SIZE_ID: LabelSizeId = '50x30';
export const DEFAULT_LABEL_ALIGNMENT: LabelHorizontalAlignment = 'center';
export const DEFAULT_LABEL_OFFSET_MM = 0;
export const MIN_LABEL_OFFSET_MM = -5;
export const MAX_LABEL_OFFSET_MM = 10;
export const LABEL_OFFSET_STEP_MM = 0.5;
export const YICHIP_LABEL_PRINTER_NAME = 'YICHIP3121 POS-58 Printer etiquetas';

const LABEL_SIZE_STORAGE_KEY = 'catcorn_commercial_delivery_label_sizes_v1';

export const normalizePrinterName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');

const NORMALIZED_YICHIP_LABEL_PRINTER_NAME = normalizePrinterName(YICHIP_LABEL_PRINTER_NAME);

export const isYichipLabelPrinter = (printerName: string | null | undefined) =>
  Boolean(printerName && normalizePrinterName(printerName) === NORMALIZED_YICHIP_LABEL_PRINTER_NAME);

export const isLabelSizeId = (value: unknown): value is LabelSizeId =>
  value === '50x30' || value === '50x40';

const isAlignment = (value: unknown): value is LabelHorizontalAlignment =>
  value === 'left' || value === 'center' || value === 'right';

const defaultProfile = (sizeId: LabelSizeId = DEFAULT_LABEL_SIZE_ID): LabelPrinterProfile => ({
  sizeId,
  horizontalAlignment: DEFAULT_LABEL_ALIGNMENT,
  horizontalOffsetMm: DEFAULT_LABEL_OFFSET_MM,
});

const normalizeProfile = (value: unknown): LabelPrinterProfile | null => {
  if (isLabelSizeId(value)) return defaultProfile(value);
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<LabelPrinterProfile>;
  if (!isLabelSizeId(source.sizeId) || !isAlignment(source.horizontalAlignment)) return null;
  if (typeof source.horizontalOffsetMm !== 'number' || !Number.isFinite(source.horizontalOffsetMm)) return null;
  return {
    sizeId: source.sizeId,
    horizontalAlignment: source.horizontalAlignment,
    horizontalOffsetMm: source.horizontalOffsetMm,
  };
};

const readPreferences = (): Record<string, LabelPrinterProfile> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LABEL_SIZE_STORAGE_KEY) || '{}') as Record<string, unknown>;
    const profiles: Record<string, LabelPrinterProfile> = {};
    for (const [printer, value] of Object.entries(parsed)) {
      const profile = normalizeProfile(value);
      if (profile) profiles[printer] = profile;
    }
    return profiles;
  } catch {
    return {};
  }
};

export const getSavedLabelSizeId = (printerName: string): LabelSizeId | null =>
  readPreferences()[normalizePrinterName(printerName)]?.sizeId ?? null;

export const getSavedLabelPrinterProfile = (printerName: string): LabelPrinterProfile | null =>
  readPreferences()[normalizePrinterName(printerName)] ?? null;

export const resolveLabelPrinterProfile = (printerName: string): LabelPrinterProfile =>
  isYichipLabelPrinter(printerName)
    ? getSavedLabelPrinterProfile(printerName) ?? defaultProfile()
    : defaultProfile();

export const saveLabelPrinterProfile = (printerName: string, profile: LabelPrinterProfile): void => {
  if (!isYichipLabelPrinter(printerName)) {
    throw new Error('El perfil configurable sólo corresponde a la impresora YICHIP de etiquetas.');
  }
  const normalized = normalizeProfile(profile);
  if (!normalized) throw new Error('El perfil de impresión de etiquetas no es válido.');
  if (normalized.horizontalOffsetMm < MIN_LABEL_OFFSET_MM || normalized.horizontalOffsetMm > MAX_LABEL_OFFSET_MM) {
    throw new Error('El ajuste horizontal está fuera del rango permitido.');
  }
  try {
    localStorage.setItem(LABEL_SIZE_STORAGE_KEY, JSON.stringify({
      ...readPreferences(),
      [normalizePrinterName(printerName)]: normalized,
    }));
  } catch {
    // Private browsing or storage quota: callers retain their in-memory selection.
  }
};

export const saveLabelSizeId = (printerName: string, sizeId: LabelSizeId): void => {
  saveLabelPrinterProfile(printerName, {
    ...resolveLabelPrinterProfile(printerName),
    sizeId,
  });
};

export const resolveLabelSize = (printerName: string): LabelSizeConfig => {
  const sizeId = isYichipLabelPrinter(printerName)
    ? getSavedLabelSizeId(printerName) ?? DEFAULT_LABEL_SIZE_ID
    : DEFAULT_LABEL_SIZE_ID;
  return LABEL_SIZE_CATALOG[sizeId];
};

export const describeLabelPixels = (size: LabelSizeConfig) =>
  `${size.widthPx} × ${size.heightPx} px`;

export const getContentVerticalOffset = (size: LabelSizeConfig) =>
  Math.max(0, Math.round((size.heightPx - size.contentHeightPx) / 2));

export interface LabelHorizontalPlacement {
  xPx: number;
  totalOffsetMm: number;
  baseOffsetPx: number;
  fineOffsetPx: number;
  availablePresetSpacePx: number;
}

export const resolveHorizontalPlacement = (
  size: LabelSizeConfig,
  profile: LabelPrinterProfile,
): LabelHorizontalPlacement => {
  if (!Number.isFinite(profile.horizontalOffsetMm)
    || profile.horizontalOffsetMm < MIN_LABEL_OFFSET_MM
    || profile.horizontalOffsetMm > MAX_LABEL_OFFSET_MM
    || Math.abs(profile.horizontalOffsetMm / LABEL_OFFSET_STEP_MM - Math.round(profile.horizontalOffsetMm / LABEL_OFFSET_STEP_MM)) > 1e-9) {
    throw new Error('El ajuste horizontal debe estar entre -5.0 y +10.0 mm en pasos de 0.5 mm.');
  }
  const availablePresetSpacePx = Math.max(0, size.printableWidthPx - size.widthPx);
  const baseOffsetPx = profile.horizontalAlignment === 'right'
    ? availablePresetSpacePx
    : profile.horizontalAlignment === 'center'
      ? availablePresetSpacePx / 2
      : 0;
  const fineOffsetPx = Math.round(profile.horizontalOffsetMm * size.dotsPerMm);
  const xPx = Math.round(size.nativeOriginXPx + baseOffsetPx + fineOffsetPx);
  if (xPx < 0 || xPx + size.printWidthPx > size.printableWidthPx) {
    throw new Error('La alineación seleccionada excede el área imprimible');
  }
  return {
    xPx,
    totalOffsetMm: (baseOffsetPx + fineOffsetPx) / size.dotsPerMm,
    baseOffsetPx,
    fineOffsetPx,
    availablePresetSpacePx,
  };
};

export interface ResolvedLabelPrinterProfile {
  profile: LabelPrinterProfile;
  size: LabelSizeConfig;
  placement: LabelHorizontalPlacement;
}

export const resolveSavedLabelPrinterProfile = (printerName: string): ResolvedLabelPrinterProfile => {
  const profile = resolveLabelPrinterProfile(printerName);
  if (!isYichipLabelPrinter(printerName)) {
    const catalogSize = LABEL_SIZE_CATALOG[DEFAULT_LABEL_SIZE_ID];
    const size: LabelSizeConfig = {
      ...catalogSize,
      printWidthPx: catalogSize.printableWidthPx,
      sourceCropXPx: catalogSize.safeMarginXPx,
      nativeOriginXPx: 0,
    };
    return {
      profile,
      size,
      placement: {
        xPx: 0,
        totalOffsetMm: 0,
        baseOffsetPx: 0,
        fineOffsetPx: 0,
        availablePresetSpacePx: 0,
      },
    };
  }
  const size = LABEL_SIZE_CATALOG[profile.sizeId];
  return {
    profile,
    size,
    placement: resolveHorizontalPlacement(size, profile),
  };
};
