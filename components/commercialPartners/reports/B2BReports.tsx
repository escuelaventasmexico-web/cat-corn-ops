import { useState } from 'react';
import { BarChart3, TrendingUp, Zap, Package, Calendar, MapPin, Layers } from 'lucide-react';
import { B2BSummaryReport } from './B2BSummaryReport';
import { B2BCollectionsReport } from './B2BCollectionsReport';
import { B2BRankingsReport } from './B2BRankingsReport';
import { B2BProductsReport } from './B2BProductsReport';
import { B2BVisitsReport } from './B2BVisitsReport';
import { B2BMapReport } from './B2BMapReport';
import { B2BZoneReport } from './B2BZoneReport';

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

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handlePartnerSelect = (partnerId: string) => {
    onPartnerSelect?.(partnerId);
  };

  return (
    <div className="space-y-6">
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
          <B2BSummaryReport refreshTrigger={refreshTrigger} />
        )}

        {activeTab === 'cobranza' && (
          <B2BCollectionsReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
          />
        )}

        {activeTab === 'rankings' && (
          <B2BRankingsReport
            refreshTrigger={refreshTrigger}
            onPartnerSelect={handlePartnerSelect}
          />
        )}

        {activeTab === 'productos' && (
          <B2BProductsReport refreshTrigger={refreshTrigger} />
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
