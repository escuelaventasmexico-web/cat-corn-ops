import * as XLSX from 'xlsx';
import { supabase } from '../supabase';

interface ProspectExportPayload {
  prospects: Array<Record<string, unknown>>;
  interactions: Array<Record<string, unknown>>;
  generated_at: string;
}

const protectSpreadsheetValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const firstNonBlank = value.trimStart().charAt(0);
  return ['=', '+', '-', '@'].includes(firstNonBlank) ? `'${value}` : value;
};

const protectRows = (rows: Array<Record<string, unknown>>) =>
  rows.map(row => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, protectSpreadsheetValue(value)])
  ));

const formatDate = (value: unknown) => {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? protectSpreadsheetValue(value) : date.toLocaleString('es-MX');
};

export const exportCommercialProspects = async () => {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const { data, error } = await supabase.rpc('export_commercial_prospects');
  if (error) throw error;
  const payload = data as ProspectExportPayload;

  const prospectRows = protectRows((payload.prospects ?? []).map(row => ({
    Negocio: row.business_name,
    Tipo: row.business_type,
    Teléfono: row.phone,
    Dirección: row.address,
    'Referencia de ubicación': row.location_reference,
    Contacto: row.contact_name,
    'Vende botanas': row.sells_snacks,
    Estado: row.status,
    'Último resultado': row.latest_result,
    'Próximo seguimiento': formatDate(row.next_follow_up_at),
    'Visita propuesta': formatDate(row.proposed_visit_at),
    Notas: row.general_notes,
    Originó: row.originator,
    Asignado: row.assigned_to,
    Canal: row.origin_channel,
    'Socio convertido': row.commercial_partner_folio,
    Conversión: formatDate(row.converted_at),
    Creación: formatDate(row.created_at),
    Actualización: formatDate(row.updated_at),
  })));

  const interactionRows = protectRows((payload.interactions ?? []).map(row => ({
    Negocio: row.business_name,
    Fecha: formatDate(row.occurred_at),
    Responsable: row.performed_by,
    Resultado: row.result,
    Notas: row.notes,
    'Próximo seguimiento': formatDate(row.next_follow_up_at),
    'Visita propuesta': formatDate(row.proposed_visit_at),
  })));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(prospectRows), 'Prospectos');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(interactionRows),
    'Historial de contactos'
  );
  XLSX.writeFile(workbook, `prospectos-comerciales-${new Date().toISOString().slice(0, 10)}.xlsx`);
};
