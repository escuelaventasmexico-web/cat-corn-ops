import { CommissionMovement, CommissionFilters } from './commissionTypes';
import {
  formatCurrency,
  formatDate,
  getStatusLabel,
  getStatusColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
  getSourceTypeLabel,
  parseNumericValue,
  exportToCSV,
} from './commissionUtils';
import { Download } from 'lucide-react';

interface CommissionMovementsTableProps {
  movements: CommissionMovement[];
  filters: CommissionFilters;
  onFiltersChange: (filters: CommissionFilters) => void;
}

export const CommissionMovementsTable = ({
  movements,
  filters,
  onFiltersChange,
}: CommissionMovementsTableProps) => {
  // Debug: Log movements with correct field names
  console.table(
    movements.map(row => ({
      product: row.product_name,
      variant: row.product_variant,
      quantity: row.quantity,
      unit_commission: row.unit_commission,
      commission_amount: row.commission_amount,
      paid_amount: row.paid_amount,
      remaining_amount: row.remaining_amount,
      reserved_amount: row.reserved_amount,
      allocatable_amount: row.allocatable_amount,
      status: row.status,
      payment_status: row.payment_status,
    }))
  );

  const filteredMovements = movements.filter(m => {
    // Status filter
    if (filters.status !== 'todos' && m.status !== filters.status) return false;

    // Source type filter
    if (filters.sourceType !== 'todos' && m.source_type !== filters.sourceType) return false;

    // Search filter
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const matches =
        m.business_name?.toLowerCase().includes(q) ||
        m.partner_folio?.toLowerCase().includes(q) ||
        m.product_name?.toLowerCase().includes(q) ||
        m.source_folio?.toLowerCase().includes(q);
      if (!matches) return false;
    }

    return true;
  });

  const handleExport = () => {
    const columns = [
      { key: 'earned_at', label: 'Fecha' },
      { key: 'business_name', label: 'Socio' },
      { key: 'partner_folio', label: 'Folio socio' },
      { key: 'source_type', label: 'Origen' },
      { key: 'product_name', label: 'Producto' },
      { key: 'product_variant', label: 'Variante' },
      { key: 'quantity', label: 'Cantidad' },
      { key: 'unit_commission', label: 'Comisión/unidad' },
      { key: 'commission_amount', label: 'Comisión generada' },
      { key: 'paid_amount', label: 'Monto pagado' },
      { key: 'remaining_amount', label: 'Saldo pendiente' },
      { key: 'reserved_amount', label: 'Monto reservado' },
      { key: 'allocatable_amount', label: 'Monto disponible para liquidar' },
      { key: 'status', label: 'Estado de comisión' },
      { key: 'payment_status', label: 'Estado de pago' },
    ];

    const data = filteredMovements.map(m => ({
      earned_at: formatDate(m.earned_at),
      business_name: m.business_name,
      partner_folio: m.partner_folio,
      source_type: getSourceTypeLabel(m.source_type),
      product_name: m.product_name,
      product_variant: m.product_variant,
      quantity: m.quantity,
      unit_commission: formatCurrency(parseNumericValue(m.unit_commission)),
      commission_amount: formatCurrency(parseNumericValue(m.commission_amount)),
      paid_amount: formatCurrency(parseNumericValue(m.paid_amount)),
      remaining_amount: formatCurrency(parseNumericValue(m.remaining_amount)),
      reserved_amount: formatCurrency(parseNumericValue(m.reserved_amount)),
      allocatable_amount: formatCurrency(parseNumericValue(m.allocatable_amount)),
      status: getStatusLabel(m.status),
      payment_status: getPaymentStatusLabel(m.payment_status),
    }));

    exportToCSV('comisiones-movimientos', data, columns);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-cc-surface rounded-xl border border-white/5 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {/* Status Filter */}
            <div className="flex gap-1">
              {['todos', 'pending', 'available', 'paid', 'cancelled'].map(status => (
                <button
                  key={status}
                  onClick={() => onFiltersChange({ ...filters, status: status as any })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filters.status === status
                      ? 'bg-cc-primary text-cc-bg'
                      : 'bg-white/5 text-cc-text-muted hover:bg-white/10'
                  }`}
                >
                  {status === 'todos'
                    ? 'Todos'
                    : status === 'pending'
                      ? 'Pendientes'
                      : status === 'available'
                        ? 'Disponibles'
                        : status === 'paid'
                          ? 'Pagadas'
                          : 'Canceladas'}
                </button>
              ))}
            </div>

            {/* Source Type Filter */}
            <div className="flex gap-1">
              {['todos', 'comodato_sale', 'wholesale_sale', 'conversion_bonus'].map(type => (
                <button
                  key={type}
                  onClick={() => onFiltersChange({ ...filters, sourceType: type as any })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filters.sourceType === type
                      ? 'bg-cc-primary text-cc-bg'
                      : 'bg-white/5 text-cc-text-muted hover:bg-white/10'
                  }`}
                >
                  {type === 'todos'
                    ? 'Todos'
                    : type === 'comodato_sale'
                      ? 'Comodato'
                      : type === 'wholesale_sale'
                        ? 'Mayoreo'
                        : 'Conversiones'}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 bg-cc-primary text-cc-bg rounded-lg text-xs font-semibold hover:bg-cc-primary-dark transition-colors"
          >
            <Download className="w-4 h-4" />
            Exportar
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Buscar por socio, folio, producto..."
          value={filters.searchQuery}
          onChange={e => onFiltersChange({ ...filters, searchQuery: e.target.value })}
          className="w-full bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main placeholder-cc-text-muted focus:outline-none focus:border-cc-primary/50"
        />
      </div>

      {/* Table */}
      {filteredMovements.length === 0 ? (
        <div className="bg-cc-surface rounded-xl border border-white/5 p-8 text-center">
          <p className="text-cc-text-muted">No hay movimientos para este periodo.</p>
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-cc-text-muted">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-cc-text-muted">
                    Socio
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-cc-text-muted">
                    Origen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-cc-text-muted">
                    Producto
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                    Cantidad
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                    Montos
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-cc-text-muted">
                    Estados
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredMovements.map(movement => {
                  const commissionAmount = parseNumericValue(movement.commission_amount);
                  const paidAmount = parseNumericValue(movement.paid_amount);
                  const remainingAmount = parseNumericValue(movement.remaining_amount);
                  const reservedAmount = parseNumericValue(movement.reserved_amount);
                  const allocatableAmount = parseNumericValue(movement.allocatable_amount);
                  const unitCommission = parseNumericValue(movement.unit_commission);
                  const quantity = parseNumericValue(movement.quantity);

                  return (
                    <tr key={movement.commission_event_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-cc-text-main">
                        {formatDate(movement.earned_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-cc-text-main font-medium">{movement.business_name}</div>
                        <div className="text-xs text-cc-text-muted">{movement.partner_folio}</div>
                      </td>
                      <td className="px-4 py-3 text-cc-text-main">
                        {getSourceTypeLabel(movement.source_type)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-cc-text-main">
                          {movement.source_type === 'conversion_bonus'
                            ? 'Conversión a mayoreo'
                            : movement.product_name}
                        </div>
                        {movement.product_variant && (
                          <div className="text-xs text-cc-text-muted">{movement.product_variant}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-cc-text-main">
                        {quantity}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-cc-cream font-semibold">
                          Generada: {formatCurrency(commissionAmount)}
                        </div>
                        <div className="text-xs text-cc-text-muted">
                          Pagada: {formatCurrency(paidAmount)}
                        </div>
                        <div className="text-xs text-cc-text-muted">
                          Saldo: {formatCurrency(remainingAmount)}
                        </div>
                        <div className="text-xs text-cc-text-muted">
                          Reservada: {formatCurrency(reservedAmount)}
                        </div>
                        <div className="text-xs text-cc-text-muted">
                          Disponible: {formatCurrency(allocatableAmount)}
                        </div>
                        <div className="text-xs text-cc-text-muted">
                          {quantity} × {formatCurrency(unitCommission)} c/u
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="inline-block px-2 py-1 rounded-full text-xs font-semibold"
                          style={{
                            backgroundColor: getStatusColor(movement.status) + '20',
                            color: getStatusColor(movement.status),
                          }}
                        >
                          {getStatusLabel(movement.status)}
                        </span>
                        <span
                          className="mt-1 block rounded-full px-2 py-1 text-xs font-semibold"
                          style={{
                            backgroundColor: getPaymentStatusColor(movement.payment_status) + '20',
                            color: getPaymentStatusColor(movement.payment_status),
                          }}
                        >
                          {getPaymentStatusLabel(movement.payment_status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
