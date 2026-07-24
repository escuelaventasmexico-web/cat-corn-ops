import { SellerPieceStock } from '../../../types/pieceSales';
import { formatNumber, safeNumber } from '../../../lib/pieceSalesHelpers';

interface SellerPieceStockTableProps {
  stock: SellerPieceStock[];
}

export const SellerPieceStockTable = ({ stock }: SellerPieceStockTableProps) => {
  if (stock.length === 0) {
    return (
      <div className="text-center py-12 text-cc-text-muted border border-white/5 rounded-2xl">
        No hay stock asignado todavía.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-white/5 rounded-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 bg-cc-surface/50">
            <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Producto</th>
            <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Variante</th>
            <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Presentación</th>
            <th className="px-6 py-3 text-right text-cc-text-muted font-semibold">Asignadas</th>
            <th className="px-6 py-3 text-right text-cc-text-muted font-semibold">Vendidas</th>
            <th className="px-6 py-3 text-right text-cc-text-muted font-semibold">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((item) => (
            <tr
              key={`${item.product_id}`}
              className="border-b border-white/5 hover:bg-cc-surface/30"
            >
              <td className="px-6 py-3 text-cc-cream font-semibold">
                {item.product_name}
              </td>
              <td className="px-6 py-3 text-cc-text-muted">
                {item.product_variant || '—'}
              </td>
              <td className="px-6 py-3 text-cc-text-muted">
                {item.product_size || '—'}
              </td>
              <td className="px-6 py-3 text-right text-cc-cream">
                {formatNumber(item.assigned_net_units)}
              </td>
              <td className="px-6 py-3 text-right text-cc-cream">
                {formatNumber(item.sold_units)}
              </td>
              <td className={`px-6 py-3 text-right font-semibold ${
                safeNumber(item.informational_balance) > 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {formatNumber(item.informational_balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
