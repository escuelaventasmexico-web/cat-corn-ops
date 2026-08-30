import type {
  B2BDataQualityIssue,
  B2BProductAnalyticsResponse,
} from './b2bReportTypes';

const safeFilenameDate = (value: string): string => value.slice(0, 10);

const costValue = (value: number | null): number | string =>
  value === null ? 'No disponible' : value;

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

  const productRows = report.products.map(product => ({
    Producto: product.product_name,
    Variante: product.product_variant ?? '—',
    Tamaño: product.product_size ?? '—',
    'Unidades vendidas': product.units_sold,
    'Ingreso generado': product.generated_revenue,
    'Socios distintos': product.distinct_partners,
    'Comodato unidades': product.comodato_units,
    'Comodato importe': product.comodato_revenue,
    'Mayoreo unidades': product.wholesale_units,
    'Mayoreo importe': product.wholesale_revenue,
    'Promedio días liquidación': product.weighted_average_liquidation_days ?? 'No disponible',
    'Mediana días liquidación': product.weighted_median_liquidation_days ?? 'No disponible',
    'Merma piezas': product.spoiled_units,
    'Costo estimado vigente merma': costValue(product.estimated_waste_cost),
    'Estado mapeo costo': product.cost_mapping_status,
  }));

  const spoilageRows = report.spoilage_by_partner.map(partner => ({
    Socio: partner.partner_name,
    'Piezas mermadas': partner.spoiled_units,
    'Costo estimado vigente': costValue(partner.estimated_waste_cost),
    'Piezas vendidas': partner.sold_units,
    'Piezas retiradas': partner.withdrawn_units,
    'Piezas resueltas': partner.resolved_units,
    'Tasa de merma': partner.spoilage_rate,
    'Responsable del costo': partner.cost_responsibility,
    'Filas sin costo': partner.unavailable_cost_rows,
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
