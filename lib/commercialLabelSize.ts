export type LabelSizeId = '50x30' | '50x40';

export interface LabelSizeConfig {
  id: LabelSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  contentHeightPx: number;
  safeMarginXPx: number;
  printWidthPx: number;
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
  return {
    id,
    label: `${widthMm} × ${heightMm} mm`,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    contentHeightPx: 240,
    safeMarginXPx,
    printWidthPx: widthPx - safeMarginXPx * 2,
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
export const YICHIP_LABEL_PRINTER_NAME = 'YICHIP3121 POS-58 Printer etiquetas';

const LABEL_SIZE_STORAGE_KEY = 'catcorn_commercial_delivery_label_sizes_v1';

export const normalizePrinterName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');

const NORMALIZED_YICHIP_LABEL_PRINTER_NAME = normalizePrinterName(YICHIP_LABEL_PRINTER_NAME);

export const isYichipLabelPrinter = (printerName: string | null | undefined) =>
  Boolean(printerName && normalizePrinterName(printerName) === NORMALIZED_YICHIP_LABEL_PRINTER_NAME);

const isLabelSizeId = (value: unknown): value is LabelSizeId =>
  value === '50x30' || value === '50x40';

const readPreferences = (): Record<string, LabelSizeId> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LABEL_SIZE_STORAGE_KEY) || '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, LabelSizeId] => isLabelSizeId(entry[1])),
    );
  } catch {
    return {};
  }
};

export const getSavedLabelSizeId = (printerName: string): LabelSizeId | null =>
  readPreferences()[normalizePrinterName(printerName)] ?? null;

export const saveLabelSizeId = (printerName: string, sizeId: LabelSizeId): void => {
  if (!isYichipLabelPrinter(printerName)) {
    throw new Error('El tamaño configurable sólo corresponde a la impresora YICHIP de etiquetas.');
  }
  try {
    localStorage.setItem(LABEL_SIZE_STORAGE_KEY, JSON.stringify({
      ...readPreferences(),
      [normalizePrinterName(printerName)]: sizeId,
    }));
  } catch {
    // Private browsing or storage quota: printing can still use this session's selection.
  }
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
