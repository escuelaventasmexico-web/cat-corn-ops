import type {
  B2BDataQualityIssue,
  B2BProductAnalyticsResponse,
} from './b2bReportTypes';

const safeFilenameDate = (value: string): string => value.slice(0, 10);

const costValue = (value: number | null): number | string =>
  value === null ? 'No disponible' : value;

const WASTE_SOURCE_LABELS = {
  tagged_spoilage: 'Merma escaneada',
  legacy_spoilage: 'Merma histórica',
  withdrawal: 'Producto retirado',
} as const;

const PRICING_SOURCE_LABELS = {
  historical_suggested_retail_price_snapshot: 'Snapshot histórico de precio público',
  current_public_product_price: 'Precio público vigente',
  public_price_unavailable: 'Precio público no identificado',
} as const;

const responsibilityLabel = (value: string): string => {
  if (value === 'catcorn') return 'Absorbido por Cat Corn';
  if (value === 'partner') return 'Absorbido por el socio';
  if (value === 'mixed') return 'Responsabilidad mixta';
  if (value === 'not_recorded') return 'No registrado';
  return value;
};

const flattenQualityRows = (report: B2BProductAnalyticsResponse): Array<Record<string, unknown>> =>
  Object.entries(report.data_quality).flatMap(([check, section]) => {
    if (section.rows.length === 0) {
      return [{ verificacion: check, registros: section.count, detalle: 'Sin incidencias' }];
    }
    return section.rows.map((row: B2BDataQualityIssue) => ({
      verificacion: check,
      registros: section.count,
      ...row,
    }));
  });

export const exportB2BProductAnalytics = async (
  report: B2BProductAnalyticsResponse
): Promise<void> => {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const wasteByProduct = new Map(report.waste.products.map(product => [product.product_key, product]));
  const baseByProduct = new Map(report.products.map(product => [product.product_key, product]));
  const productKeys = new Set([...baseByProduct.keys(), ...wasteByProduct.keys()]);

  const productRows = [...productKeys].map(productKey => {
    const product = baseByProduct.get(productKey);
    const waste = wasteByProduct.get(productKey);
    return {
      Producto: product?.product_name ?? waste?.product_name ?? 'Producto no identificado',
      Variante: product?.product_variant ?? waste?.product_variant ?? '—',
      Tamaño: product?.product_size ?? waste?.product_size ?? '—',
      'Unidades vendidas': product?.units_sold ?? 0,
      'Ingreso generado': product?.generated_revenue ?? 0,
      'Socios distintos': product?.distinct_partners ?? 0,
      'Comodato unidades': product?.comodato_units ?? 0,
      'Comodato importe': product?.comodato_revenue ?? 0,
      'Mayoreo unidades': product?.wholesale_units ?? 0,
      'Mayoreo importe': product?.wholesale_revenue ?? 0,
      'Promedio días liquidación': product?.weighted_average_liquidation_days ?? 'No disponible',
      'Mediana días liquidación': product?.weighted_median_liquidation_days ?? 'No disponible',
      'Merma y retiros': waste?.waste_units ?? 0,
      'Merma escaneada': waste?.tagged_spoilage_units ?? 0,
      'Merma histórica': waste?.legacy_spoilage_units ?? 0,
      Retiros: waste?.withdrawal_units ?? 0,
      'Costo de producción': costValue(waste?.production_cost_total ?? null),
      'Valor comercial': costValue(waste?.public_value_total ?? null),
      '% merma respecto a entregadas': waste?.waste_rate ?? 'No disponible',
      'Estado mapeo costo': product?.cost_mapping_status ?? 'not_applicable',
    };
  });

  const spoilageRows = report.waste.partners.map(partner => ({
    Socio: partner.partner_name,
    'Total piezas': partner.total_units,
    'Merma escaneada': partner.tagged_spoilage_units,
    'Merma histórica': partner.legacy_spoilage_units,
    Retiros: partner.withdrawal_units,
    '% de la merma mensual': partner.monthly_waste_percentage,
    'Costo de producción': costValue(partner.production_cost_total),
    'Valor comercial': costValue(partner.public_value_total),
    'Responsable del costo': responsibilityLabel(partner.cost_responsibility),
    'Piezas sin costo': partner.missing_cost_quantity,
    'Piezas sin precio público': partner.missing_public_price_quantity,
  }));

  const wasteSummaryRows = [{
    Periodo: `${report.waste.period.start_date} a ${report.waste.period.end_date_exclusive} (fin exclusivo)`,
    'Total de piezas': report.waste.summary.total_units,
    'Merma escaneada': report.waste.summary.tagged_spoilage_units,
    'Merma histórica': report.waste.summary.legacy_spoilage_units,
    Retiros: report.waste.summary.withdrawal_units,
    'Costo de producción': costValue(report.waste.summary.production_cost_total),
    'Valor comercial': costValue(report.waste.summary.public_value_total),
    'Piezas sin costo': report.waste.summary.missing_cost_quantity,
    'Piezas sin precio público': report.waste.summary.missing_public_price_quantity,
    'Piezas valuadas a precio público vigente': report.waste.summary.current_public_price_quantity ?? 0,
  }];

  const wasteDetailRows = report.waste.details.map(event => ({
    Fecha: event.event_date,
    Socio: event.partner_name,
    Producto: event.product_name,
    Variante: event.product_variant ?? '—',
    Tamaño: event.product_size ?? '—',
    Cantidad: event.quantity,
    Fuente: WASTE_SOURCE_LABELS[event.waste_source],
    Movimiento: event.movement_id,
    'Costo unitario': costValue(event.production_unit_cost),
    'Costo total': costValue(event.production_cost_total),
    'Precio público unitario': costValue(event.public_unit_price),
    'Valor comercial': costValue(event.public_value_total),
    'Fuente del precio': PRICING_SOURCE_LABELS[event.pricing_source],
    'Observación de deduplicación': event.deduplication_evidence,
  }));

  const liquidationRows = report.liquidation_time_by_product.map(product => ({
    Producto: product.product_name,
    Variante: product.product_variant ?? '—',
    Tamaño: product.product_size ?? '—',
    'Unidades vendidas emparejadas': product.sold_units_with_fifo,
    'Promedio ponderado de días': product.weighted_average_days ?? 'No disponible',
    'Mediana ponderada de días': product.weighted_median_days ?? 'No disponible',
  }));

  const slowInventoryRows = report.slow_inventory.map(item => ({
    Socio: item.partner_name,
    Producto: item.product_name,
    Variante: item.product_variant ?? '—',
    Tamaño: item.product_size ?? '—',
    'Piezas en posesión': item.units_in_possession,
    'Entrega más antigua': item.oldest_delivery_date,
    'Antigüedad en días': item.age_days,
    Rango: item.age_bucket,
    'Costo unitario vigente': costValue(item.current_unit_cost),
    'Valor estimado a costo vigente': costValue(item.estimated_inventory_cost),
    'Estado mapeo costo': item.cost_mapping_status,
  }));

  const sheets: Array<[string, Array<Record<string, unknown>>]> = [
    ['Resumen de merma', wasteSummaryRows],
    ['Detalle de merma', wasteDetailRows],
    ['Rendimiento productos', productRows],
    ['Merma por socio', spoilageRows],
    ['Tiempo liquidación', liquidationRows],
    ['Inventario lento', slowInventoryRows],
    ['Calidad de datos', flattenQualityRows(report)],
  ];

  sheets.forEach(([name, rows]) => {
    const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Resultado: 'Sin registros' }]);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });

  const start = safeFilenameDate(report.period.start_at);
  const end = safeFilenameDate(report.period.end_at_exclusive);
  XLSX.writeFile(workbook, `productos-b2b-${start}-a-${end}.xlsx`);
};
