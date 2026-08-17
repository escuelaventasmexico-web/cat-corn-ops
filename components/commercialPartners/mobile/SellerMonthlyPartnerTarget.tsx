import { useEffect, useState } from 'react';
import { Target, Loader2 } from 'lucide-react';
import { SellerMonthlyPartnerProgress } from '../commissions/commissionTypes';
import { getSellerMonthlyPartnerProgress } from '../../../lib/sellerPartnerTargetRpcs';

interface SellerMonthlyPartnerTargetProps {
  sellerId: string;
  refreshKey?: number;
}

export const SellerMonthlyPartnerTarget = ({
  sellerId,
  refreshKey = 0,
}: SellerMonthlyPartnerTargetProps) => {
  const [progress, setProgress] = useState<SellerMonthlyPartnerProgress | null>(null);
  const [loading, setLoading] = useState(true);

  // Obtener el mes actual en zona horaria de México
  const getBusinessMonth = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    
    // Retornar el primer día del mes actual
    return `${year}-${month}-01`;
  };

  const monthStart = getBusinessMonth();

  const getMonthDisplay = () => {
    const [year, month, day] = monthStart.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const monthName = date.toLocaleString('es-MX', { month: 'long', year: 'numeric' });
    return monthName.charAt(0).toUpperCase() + monthName.slice(1);
  };

  const loadProgress = async () => {
    setLoading(true);
    const result = await getSellerMonthlyPartnerProgress(sellerId, monthStart);
    setProgress(result);
    setLoading(false);
  };

  useEffect(() => {
    loadProgress();
  }, [sellerId, monthStart, refreshKey]);

  if (loading) {
    return (
      <div className="px-4">
        <div className="h-32 flex items-center justify-center rounded-lg bg-cc-surface border border-white/5">
          <Loader2 className="w-5 h-5 text-cc-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (!progress) {
    return null;
  }

  const target = progress.target_active_partners;
  const achieved = progress.achieved_active_partners;
  const percentage = progress.progress_percentage || 0;

  // Calcular ancho de barra (máximo 100% visual)
  const barWidth = Math.min(Math.max(percentage, 0), 100);

  // Determinar mensaje de estado
  let statusMessage = '';
  let statusColor = 'text-yellow-400';

  if (target === null) {
    // Sin meta configurada
    statusMessage = '';
  } else if (achieved === target) {
    statusMessage = '✓ Meta mensual alcanzada';
    statusColor = 'text-green-400';
  } else if (achieved > target) {
    const extra = achieved - target;
    statusMessage = `✓ Meta superada por ${extra} ${extra === 1 ? 'socio' : 'socios'}`;
    statusColor = 'text-green-400';
  } else {
    const remaining = target - achieved;
    statusMessage = `${remaining} ${remaining === 1 ? 'socio' : 'socios'} más para alcanzar tu meta`;
    statusColor = 'text-yellow-400';
  }

  return (
    <div className="px-4">
      <div className="rounded-lg bg-gradient-to-br from-cc-primary/20 to-cc-primary/5 border border-cc-primary/30 p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-cc-cream flex items-center gap-2">
            <Target size={18} className="text-cc-primary" />
            Meta de socios
          </h3>
          <p className="text-xs text-cc-text-muted">{getMonthDisplay()}</p>
        </div>

        {/* Body */}
        {target === null ? (
          // Estado: Sin meta configurada
          <div className="space-y-2">
            <p className="text-sm text-cc-text-muted">
              Meta mensual aún no configurada
            </p>
            <p className="text-sm font-semibold text-green-400">
              {achieved} {achieved === 1 ? 'socio' : 'socios'} activado${achieved === 1 ? '' : 's'} este mes
            </p>
          </div>
        ) : (
          // Estado: Meta configurada
          <div className="space-y-3">
            {/* Progreso visual */}
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-cc-cream">
                  {achieved} <span className="text-sm text-cc-text-muted">/ {target}</span>
                </span>
                <span className="text-lg font-bold text-cc-primary">
                  {percentage.toFixed(2)}%
                </span>
              </div>

              {/* Barra de progreso */}
              <div className="w-full bg-cc-bg rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    percentage >= 100 ? 'bg-green-500' : 'bg-cc-primary'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>

            {/* Mensaje de estado */}
            {statusMessage && (
              <p className={`text-sm font-semibold ${statusColor}`}>
                {statusMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
