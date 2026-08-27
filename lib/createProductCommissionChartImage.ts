import type { CommissionProductSummary } from '../components/commercialPartners/commissions/commissionStatementReport';

export interface ProductCommissionChartImage {
  dataUrl: string;
  width: number;
  height: number;
}

const OUTPUT_WIDTH = 900;
const MIN_OUTPUT_HEIGHT = 430;
const RESOLUTION_SCALE = 2;
const FAMILY_COLORS: Record<string, string> = {
  Michi: '#FF2D9B',
  'Gato Mayor': '#F4C542',
  'Jefe Felino': '#8B5CF6',
};
const FALLBACK_COLORS = ['#06B6D4', '#10B981', '#F97316', '#3B82F6', '#EF4444', '#A855F7'];

const formatCurrency = (value: number): string => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  const safeRadius = Math.min(radius, height / 2, width / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const drawFittedText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontWeight: number,
  initialFontSize: number,
  align: CanvasTextAlign = 'left'
): void => {
  let fontSize = initialFontSize;
  context.textAlign = align;
  context.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;

  while (fontSize > 10 && context.measureText(text).width > maxWidth) {
    fontSize -= 1;
    context.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  }

  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }

  let shortened = text;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  context.fillText(`${shortened}…`, x, y);
};

export const createProductCommissionChartImage = (
  productGroups: CommissionProductSummary[]
): ProductCommissionChartImage | null => {
  const sortedGroups = productGroups
    .filter(group => Number.isFinite(group.generated) && group.generated > 0)
    .sort((left, right) => right.generated - left.generated || left.family.localeCompare(right.family, 'es-MX'));

  if (sortedGroups.length === 0) return null;

  const outputHeight = Math.max(MIN_OUTPUT_HEIGHT, 190 + sortedGroups.length * 70);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_WIDTH * RESOLUTION_SCALE;
  canvas.height = outputHeight * RESOLUTION_SCALE;

  const context = canvas.getContext('2d');
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error('Canvas 2D no está disponible en este navegador.');
  }

  context.scale(RESOLUTION_SCALE, RESOLUTION_SCALE);
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, OUTPUT_WIDTH, outputHeight);

  context.fillStyle = '#1F2937';
  context.font = '700 30px Arial, sans-serif';
  context.textBaseline = 'alphabetic';
  context.fillText('Comisión generada por producto', 42, 54);

  const productsTotal = sortedGroups.reduce((sum, group) => sum + group.generated, 0);
  context.fillStyle = '#4B5563';
  context.font = '500 17px Arial, sans-serif';
  context.fillText(`Total generado por productos: ${formatCurrency(productsTotal)}`, 42, 84);

  const labelX = 42;
  const barX = 220;
  const labelMaxWidth = 160;
  const barMaxWidth = 465;
  const valueX = 858;
  const valueMaxWidth = 158;
  const firstBarY = 125;
  const rowHeight = 70;
  const barHeight = 34;
  const maximumGenerated = sortedGroups[0].generated;

  sortedGroups.forEach((group, index) => {
    const y = firstBarY + index * rowHeight;
    const barWidth = Math.max(3, (group.generated / maximumGenerated) * barMaxWidth);
    const color = FAMILY_COLORS[group.family] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

    context.fillStyle = '#F3F4F6';
    roundedRect(context, barX, y, barMaxWidth, barHeight, 6);
    context.fill();

    context.fillStyle = color;
    roundedRect(context, barX, y, barWidth, barHeight, 6);
    context.fill();

    context.fillStyle = '#111827';
    context.textBaseline = 'middle';
    drawFittedText(
      context,
      group.family,
      labelX,
      y + barHeight / 2,
      labelMaxWidth,
      600,
      16
    );
    drawFittedText(
      context,
      `${formatCurrency(group.generated)} — ${group.percentage.toFixed(1)}%`,
      valueX,
      y + barHeight / 2,
      valueMaxWidth,
      600,
      15,
      'right'
    );
  });

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('El navegador no generó una imagen PNG válida.');
  }

  return { dataUrl, width: OUTPUT_WIDTH, height: outputHeight };
};
