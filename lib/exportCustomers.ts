import * as XLSX from 'xlsx';
import type { Customer } from '../supabase';

/**
 * Format date string YYYY-MM-DD or ISO timestamp to DD/MM/YYYY
 */
function formatDateOnly(dateString: string | null): string {
  if (!dateString) return '';
  const date = dateString.split('T')[0];
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Export customers to Excel file
 * @param customers Array of Customer objects to export
 * @param allCount Total count of all customers (optional, for summary sheet)
 */
export function exportCustomersToExcel(customers: Customer[], allCount?: number) {
  if (!customers.length) {
    alert('No hay clientes para exportar');
    return;
  }

  const wb = XLSX.utils.book_new();

  // ─────────────────────────────────────────────────────────────
  // Sheet 1: Clientes
  // ─────────────────────────────────────────────────────────────
  const headers = ['Nombre', 'Teléfono', 'Sellos', 'Premio disponible', 'Fecha de registro', 'Última compra'];

  const rows = customers.map(c => [
    `${c.first_name} ${c.last_name}`.trim(),
    c.phone,
    c.stamps,
    c.reward_available ? 'Sí' : 'No',
    formatDateOnly(c.created_at),
    formatDateOnly(c.last_purchase_at),
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths
  ws1['!cols'] = [
    { wch: 25 }, // Nombre
    { wch: 15 }, // Teléfono
    { wch: 10 }, // Sellos
    { wch: 18 }, // Premio disponible
    { wch: 18 }, // Fecha de registro
    { wch: 18 }, // Última compra
  ];

  // Style header row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!ws1[ref]) return;
    (ws1[ref] as any).s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: 'FFB400' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
      },
    };
  });

  // Style data rows (alternating background)
  for (let i = 1; i < rows.length + 1; i++) {
    for (let j = 0; j < headers.length; j++) {
      const ref = XLSX.utils.encode_cell({ r: i, c: j });
      if (!ws1[ref]) continue;
      const bgColor = i % 2 === 0 ? 'FFF5E6' : 'FFFFFF';
      (ws1[ref] as any).s = {
        fill: { fgColor: { rgb: bgColor }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: 'E0E0E0' } },
        },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws1, 'Clientes');

  // ─────────────────────────────────────────────────────────────
  // Sheet 2: Resumen (optional summary statistics)
  // ─────────────────────────────────────────────────────────────
  const rewardCount = customers.filter(c => c.reward_available).length;
  const noRewardCount = customers.filter(c => !c.reward_available).length;
  const stamps1Count = customers.filter(c => !c.reward_available && c.stamps === 1).length;
  const stamps2Count = customers.filter(c => !c.reward_available && c.stamps === 2).length;
  const stamps3Count = customers.filter(c => !c.reward_available && c.stamps === 3).length;

  const summaryData = [
    ['Resumen de clientes', ''],
    ['', ''],
    ['Total de clientes', allCount ?? customers.length],
    ['Clientes con premio disponible', rewardCount],
    ['Clientes sin premio', noRewardCount],
    ['', ''],
    ['Distribución por sellos', ''],
    ['1 sello', stamps1Count],
    ['2 sellos', stamps2Count],
    ['3 sellos (premium)', stamps3Count],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
  ws2['!cols'] = [{ wch: 30 }, { wch: 15 }];

  // Style summary headers
  [0, 6].forEach(rowIdx => {
    const ref0 = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
    if (!ws2[ref0]) return;
    (ws2[ref0] as any).s = {
      font: { bold: true, size: 12, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: 'FFB400' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center' },
    };
  });

  // Style data rows
  [2, 3, 4, 7, 8, 9].forEach(rowIdx => {
    for (let j = 0; j < 2; j++) {
      const ref = XLSX.utils.encode_cell({ r: rowIdx, c: j });
      if (!ws2[ref]) continue;
      (ws2[ref] as any).s = {
        fill: { fgColor: { rgb: 'FFF5E6' }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center' },
      };
    }
  });

  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');

  // ─────────────────────────────────────────────────────────────
  // Save file
  // ─────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const fileName = `clientes_catcorn_${today}.xlsx`;

  XLSX.writeFile(wb, fileName);
}
