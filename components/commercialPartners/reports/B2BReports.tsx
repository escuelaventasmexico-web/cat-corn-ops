import { useState } from 'react';
import { BarChart3, TrendingUp, Zap, Package, Calendar, MapPin, Layers, ChevronLeft, ChevronRight } from 'lucide-react';
import { B2BSummaryReport } from './B2BSummaryReport';
import { B2BCollectionsReport } from './B2BCollectionsReport';
import { B2BRankingsReport } from './B2BRankingsReport';
import { B2BProductsReport } from './B2BProductsReport';
import { B2BVisitsReport } from './B2BVisitsReport';
import { B2BMapReport } from './B2BMapReport';
import { B2BZoneReport } from './B2BZoneReport';
import { getMexicoCityCurrentMonth } from '../../../services/b2bMonthlyAnalysisService';

interface B2BReportsProps {
  onPartnerSelect?: (partnerId: string) => void;
}

type ReportTab =
  | 'resumen'
  | 'cobranza'
  | 'rankings'
  | 'productos'
  | 'visitas'
  | 'mapa'
  | 'zonas';

interface TabItem {
  id: ReportTab;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: 'resumen', label: 'Resumen', icon: <BarChart3 size={16} /> },
  { id: 'cobranza', label: 'Cobranza', icon: <TrendingUp size={16} /> },
  { id: 'rankings', label: 'Rankings', icon: <Zap size={16} /> },
  { id: 'productos', label: 'Productos', icon: <Package size={16} /> },
  { id: 'visitas', label: 'Visitas', icon: <Calendar size={16} /> },
  { id: 'mapa', label: 'Mapa', icon: <MapPin size={16} /> },
  { id: 'zonas', label: 'Zonas', icon: <Layers size={16} /> },
];

export const B2BReports = ({ onPartnerSelect }: B2BReportsProps) => {
  const [activeTab, setActiveTab] = useState<ReportTab>('resumen');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [month, setMonth] = useState(getMexicoCityCurrentMonth);
  const currentMonth = getMexicoCityCurrentMonth();

  const moveMonth = (amount: number) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
    const next = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (next <= currentMonth) setMonth(next);
  };

  const monthLabel = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`));

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handlePartnerSelect = (partnerId: string) => {
    onPartnerSelect?.(partnerId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-cc-surface p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cc-text-muted">Periodo de análisis</p>
          <div className="mt-1 flex items-center gap-2">
            <button onClick={() => moveMonth(-1)} className="rounded-lg p-2 text-cc-text-main hover:bg-white/10" aria-label="Mes anterior"><ChevronLeft size={18} /></button>
            <p className="min-w-44 text-center text-base font-bold capitalize text-cc-cream">{monthLabel}</p>
            <button onClick={() => moveMonth(1)} disabled={month >= currentMonth} className="rounded-lg p-2 text-cc-text-main hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Mes siguiente"><ChevronRight size={18} /></button>
          </div>
        </div>
        <p className="max-w-md text-xs text-cc-text-muted">Aplica a Resumen, Cobranza, Rankings y Productos. Mapa, zonas y visitas conservan su estado actual.</p>
      </div>

      {/* ── Tabs Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2">
        <div className="flex gap-2 flex-nowrap">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-cc-primary text-cc-bg shadow-[0_0_15px_rgba(244,197,66,0.3)]'
                  : 'bg-white/10 text-cc-text-main hover:bg-white/15'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 rounded-lg bg-white/10 text-cc-text-main hover:bg-white/15 font-semibold text-sm transition-colors flex-shrink-0"
        >
          Actualizar
        </button>
      </div>

      {/* ── Tab Content ────────────────────────────────────────── */}
      <div>
        {activeTab === 'resumen' && (
          <B2BSummaryReport refreshTrigger={refreshTrigger} month={month} />
        )}

        {activeTab === 'cobranza' && (
          <B2BCollectionsReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
            month={month}
          />
        )}

        {activeTab === 'rankings' && (
          <B2BRankingsReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
            month={month}
          />
        )}

        {activeTab === 'productos' && (
          <B2BProductsReport refreshTrigger={refreshTrigger} month={month} />
        )}

        {activeTab === 'visitas' && (
          <B2BVisitsReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
          />
        )}

        {activeTab === 'mapa' && (
          <B2BMapReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
          />
        )}

        {activeTab === 'zonas' && (
          <B2BZoneReport refreshTrigger={refreshTrigger} />
        )}
      </div>
    </div>
  );
};
