import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CommissionProductSummary } from './commissionStatementReport';
import { formatCurrency, formatNumber } from './commissionUtils';

interface CommissionProductChartProps {
  products: CommissionProductSummary[];
  productGenerated: number;
  nonProductGenerated: number;
  totalGenerated: number;
}

const COLORS = ['#F4C542', '#F47BAA', '#06B6D4', '#A855F7', '#10B981', '#FB923C'];

const ProductTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CommissionProductSummary }>;
}) => {
  const product = payload?.[0]?.payload;
  if (!active || !product) return null;

  return (
    <div className="max-w-xs rounded-lg border border-white/15 bg-[#171717] p-3 text-xs shadow-xl">
      <p className="mb-2 font-bold text-cc-cream">{product.family}</p>
      <div className="space-y-1 text-cc-text-muted">
        <p>Generada: <span className="font-semibold text-cc-primary">{formatCurrency(product.generated)}</span></p>
        <p>Pagada: <span className="text-cc-text-main">{formatCurrency(product.paid)}</span></p>
        <p>Pendiente: <span className="text-cc-text-main">{formatCurrency(product.pending)}</span></p>
        <p>Disponible: <span className="text-cc-text-main">{formatCurrency(product.allocatable)}</span></p>
        <p>Unidades: <span className="text-cc-text-main">{formatNumber(product.units)}</span></p>
        <p>Movimientos: <span className="text-cc-text-main">{product.movements}</span></p>
        <p>Participación: <span className="text-cc-text-main">{product.percentage.toFixed(1)}%</span></p>
      </div>
    </div>
  );
};

export const CommissionProductChart = ({
  products,
  productGenerated,
  nonProductGenerated,
  totalGenerated,
}: CommissionProductChartProps) => {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-cc-text-muted">
        No hay comisiones mensuales asociadas a productos.
      </div>
    );
  }

  const chartHeight = Math.max(280, products.length * 58);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-cc-cream">Comisión generada por producto</h3>
        <p className="mt-1 text-xs text-cc-text-muted">
          Las barras representan comisión histórica generada; los pagos posteriores no reducen su longitud.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 sm:p-4">
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={products}
              layout="vertical"
              margin={{ top: 8, right: 24, bottom: 8, left: 12 }}
            >
              <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: '#A3A3A3', fontSize: 11 }}
                tickFormatter={value => `$${Number(value).toLocaleString('es-MX')}`}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
              />
              <YAxis
                type="category"
                dataKey="family"
                width={115}
                tick={{ fill: '#F6E7C1', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ProductTooltip />} />
              <Bar dataKey="generated" name="Comisión generada" radius={[0, 6, 6, 0]}>
                {products.map((product, index) => (
                  <Cell key={product.family} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryValue label="Comisiones generadas por productos" value={productGenerated} />
        <SummaryValue label="Conceptos no asociados a bolsas" value={nonProductGenerated} />
        <SummaryValue label="Total generado" value={totalGenerated} highlighted />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-[1120px] w-full text-xs">
          <thead className="bg-white/5 text-cc-text-muted">
            <tr>
              <th className="px-3 py-3 text-left">Familia</th>
              <th className="px-3 py-3 text-left">Variantes</th>
              <th className="px-3 py-3 text-right">Unidades</th>
              <th className="px-3 py-3 text-right">Movimientos</th>
              <th className="px-3 py-3 text-right">Generada</th>
              <th className="px-3 py-3 text-right">Pagada</th>
              <th className="px-3 py-3 text-right">Pendiente</th>
              <th className="px-3 py-3 text-right">Saldo liberado</th>
              <th className="px-3 py-3 text-right">Reservada</th>
              <th className="px-3 py-3 text-right">Disponible</th>
              <th className="px-3 py-3 text-right">Porcentaje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {products.map(product => (
              <tr key={product.family} className="text-cc-text-main hover:bg-white/[0.03]">
                <td className="px-3 py-3 font-semibold text-cc-cream">{product.family}</td>
                <td className="px-3 py-3 text-cc-text-muted">{product.variants.join(', ') || '—'}</td>
                <td className="px-3 py-3 text-right">{formatNumber(product.units)}</td>
                <td className="px-3 py-3 text-right">{product.movements}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatCurrency(product.generated)}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(product.paid)}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(product.pending)}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(product.releasedOutstanding)}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(product.reserved)}</td>
                <td className="px-3 py-3 text-right text-cc-primary">{formatCurrency(product.allocatable)}</td>
                <td className="px-3 py-3 text-right">{product.percentage.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SummaryValue = ({
  label,
  value,
  highlighted = false,
}: {
  label: string;
  value: number;
  highlighted?: boolean;
}) => (
  <div className={`rounded-lg border p-3 ${highlighted ? 'border-cc-primary/40 bg-cc-primary/10' : 'border-white/10 bg-white/[0.03]'}`}>
    <p className="text-xs text-cc-text-muted">{label}</p>
    <p className={`mt-1 text-lg font-bold ${highlighted ? 'text-cc-primary' : 'text-cc-cream'}`}>
      {formatCurrency(value)}
    </p>
  </div>
);
