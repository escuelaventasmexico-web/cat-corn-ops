import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabase';
import {
  CommercialDirectoryRecord,
  CommercialPartner,
  CommercialProspectDirectoryRecord,
} from '../types';
import { SellerMobileHeader } from './SellerMobileHeader';
import { SellerMobileNavigation } from './SellerMobileNavigation';
import { SellerMobileHome } from './SellerMobileHome';
import { SellerMobilePartners } from './SellerMobilePartners';
import { SellerMobileMore } from './SellerMobileMore';
import { CommercialPartnerForm } from '../CommercialPartnerForm';
import { CommercialPartnerDetail } from '../CommercialPartnerDetail';
import { SellerCommissionDashboard } from '../commissions/SellerCommissionDashboard';
import { PieceSalesModule } from '../pieceSales/PieceSalesModule';
import { PieceSalesErrorBoundary } from '../pieceSales/PieceSalesErrorBoundary';
import { safeNumber } from '../../../lib/pieceSalesHelpers';

type MobilePageTab = 'inicio' | 'socios' | 'vender' | 'comisiones' | 'mas';

interface SellerCommercialPartnersViewProps {
  userProfile: any;
  user: any;
  onLogout: () => void;
}

export const SellerCommercialPartnersView = ({
  userProfile,
  user,
  onLogout,
}: SellerCommercialPartnersViewProps) => {
  const [activeTab, setActiveTab] = useState<MobilePageTab>('inicio');
  const [directoryRecords, setDirectoryRecords] = useState<CommercialDirectoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<CommercialPartner | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [commissionData, setCommissionData] = useState({
    pending: 0,
    available: 0,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  /* ── Load seller commissions ──────────────────────────────── */
  const loadSellerCommissions = useCallback(async () => {
    if (!supabase || !user?.id) return;

    try {
      // Load pending commissions
      const { data: pendingRows, error: pendingError } = await supabase
        .from('v_seller_commission_movements')
        .select('commission_amount')
        .eq('seller_id', user.id)
        .eq('status', 'pending');

      // Load available commissions
      const { data: availableRows, error: availableError } = await supabase
        .from('v_seller_commission_movements')
        .select('commission_amount')
        .eq('seller_id', user.id)
        .eq('status', 'available');

      if (pendingError) {
        console.error('Error loading seller pending commissions:', pendingError);
      }
      if (availableError) {
        console.error('Error loading seller available commissions:', availableError);
      }

      const pendingTotal = (pendingRows ?? []).reduce(
        (sum, row) => sum + safeNumber(row.commission_amount),
        0
      );
      const availableTotal = (availableRows ?? []).reduce(
        (sum, row) => sum + safeNumber(row.commission_amount),
        0
      );

      setCommissionData({
        pending: pendingTotal,
        available: availableTotal,
      });
    } catch (err) {
      console.error('Error loading seller commission metrics:', err);
      setCommissionData({ pending: 0, available: 0 });
    }
  }, [user?.id]);

  /* ── Load partners ─────────────────────────────────────────── */
  const loadPartners = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      if (!user?.id) throw new Error('No se encontró el usuario autenticado.');

      const [partnerResult, prospectResult] = await Promise.all([
        supabase
          .from('commercial_partners')
          .select('*')
          .order('business_name', { ascending: true }),
        supabase
          .from('v_commercial_prospect_details')
          .select('id, business_name, contact_name, phone, address, location_reference, business_type, status, originator_name, assigned_to, next_follow_up_at, proposed_visit_at, created_at, commercial_partner_id')
          .eq('assigned_to', user.id)
          .is('commercial_partner_id', null)
          .neq('status', 'convertido')
          .neq('status', 'archivado')
          .order('business_name', { ascending: true }),
      ]);

      if (partnerResult.error) throw partnerResult.error;
      if (prospectResult.error) throw prospectResult.error;

      const partnerRecords: CommercialDirectoryRecord[] = ((partnerResult.data as CommercialPartner[]) ?? [])
        .map(partner => ({
          recordKind: 'commercial_partner' as const,
          id: partner.id,
          partner,
        }));
      const prospectRecords: CommercialProspectDirectoryRecord[] = (prospectResult.data ?? [])
        .map(prospect => ({
          recordKind: 'commercial_prospect' as const,
          id: prospect.id,
          prospectId: prospect.id,
          businessName: prospect.business_name,
          contactName: prospect.contact_name,
          phone: prospect.phone,
          address: prospect.address,
          locationReference: prospect.location_reference,
          businessType: prospect.business_type,
          status: prospect.status,
          originatorAlias: prospect.originator_name,
          assignedTo: prospect.assigned_to,
          nextFollowUpAt: prospect.next_follow_up_at,
          proposedVisitAt: prospect.proposed_visit_at,
          createdAt: prospect.created_at,
        }));

      setDirectoryRecords([...partnerRecords, ...prospectRecords].sort((left, right) => {
        const leftName = left.recordKind === 'commercial_partner'
          ? left.partner.business_name
          : left.businessName;
        const rightName = right.recordKind === 'commercial_partner'
          ? right.partner.business_name
          : right.businessName;
        return leftName.localeCompare(rightName, 'es-MX');
      }));
      
      // Refresh home tarjeta
      if (activeTab === 'inicio') {
        setHomeRefreshKey(prev => prev + 1);
      }
    } catch (e: any) {
      setError(e?.message || 'Error al cargar socios');
    } finally {
      setLoading(false);
    }
  }, [activeTab, user?.id]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    loadSellerCommissions();
  }, [loadSellerCommissions]);

  useEffect(() => {
    // Reload commissions when returning to home tab
    if (activeTab === 'inicio') {
      loadSellerCommissions();
    }
  }, [activeTab, loadSellerCommissions]);

  /* ── Callbacks ─────────────────────────────────────────────– */
  const handleCreated = (newPartner: CommercialPartner) => {
    setDirectoryRecords(prev => {
      const next: CommercialDirectoryRecord[] = [
        ...prev,
        { recordKind: 'commercial_partner', id: newPartner.id, partner: newPartner },
      ];
      next.sort((left, right) => {
        const leftName = left.recordKind === 'commercial_partner' ? left.partner.business_name : left.businessName;
        const rightName = right.recordKind === 'commercial_partner' ? right.partner.business_name : right.businessName;
        return leftName.localeCompare(rightName, 'es-MX');
      });
      return next;
    });
    setShowNewForm(false);
    setSelectedPartner(newPartner);
    showToast(`✓ ${newPartner.business_name} creado exitosamente`);
  };

  const handleUpdated = (updated: CommercialPartner) => {
    setDirectoryRecords(prev =>
      prev.map(record => (
        record.recordKind === 'commercial_partner' && record.partner.id === updated.id
          ? { recordKind: 'commercial_partner', id: updated.id, partner: updated }
          : record
      ))
    );
    showToast('✓ Socio actualizado');
  };

  /* ── Render page content ───────────────────────────────────── */
  const renderPageContent = () => {
    switch (activeTab) {
      case 'inicio':
        return (
          <SellerMobileHome
            commissionPending={commissionData.pending}
            commissionAvailable={commissionData.available}
            partnersCount={directoryRecords.filter(record => record.recordKind === 'commercial_partner').length}
            sellerId={user?.id}
            refreshKey={homeRefreshKey}
            onNavigate={(page) => setActiveTab(page)}
          />
        );
      case 'socios':
        return (
          <SellerMobilePartners
            records={directoryRecords}
            loading={loading}
            error={error}
            onSelectRecord={record => {
              if (record.recordKind === 'commercial_prospect') {
                window.location.href = `/prospectos-comerciales?prospectId=${encodeURIComponent(record.prospectId)}`;
                return;
              }
              setSelectedPartner(record.partner);
            }}
            onNewPartner={() => setShowNewForm(true)}
          />
        );
      case 'vender':
        return (
          <PieceSalesErrorBoundary>
            <div className="pb-24">
              <PieceSalesModule
                refreshTrigger={Math.random()}
                isAdmin={false}
                userId={user?.id || ''}
              />
            </div>
          </PieceSalesErrorBoundary>
        );
      case 'comisiones':
        return (
          <div className="pb-24">
            <SellerCommissionDashboard sellerId={user?.id || ''} />
          </div>
        );
      case 'mas':
        return <SellerMobileMore onLogout={onLogout} />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-cc-bg min-h-screen flex flex-col">
      {/* Header */}
      <SellerMobileHeader
        userName={userProfile?.username || 'Usuario'}
        onRefresh={loadPartners}
        onLogout={onLogout}
        loading={loading}
      />

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto">
        {renderPageContent()}
      </div>

      {/* Navigation */}
      <SellerMobileNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-green-500/20 border border-green-500/40 text-green-300 text-sm px-5 py-2.5 rounded-xl shadow-xl backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* New Partner Modal */}
      {showNewForm && (
        <CommercialPartnerForm
          partner={null}
          onClose={() => setShowNewForm(false)}
          onSaved={handleCreated}
          onPhotoWarning={msg => showToast(msg)}
        />
      )}

      {/* Partner Detail Panel */}
      {selectedPartner && (
        <CommercialPartnerDetail
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
};
