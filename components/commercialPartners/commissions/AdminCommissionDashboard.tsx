import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { SellerCommissionMonthlySummary, UserProfile } from './commissionTypes';
import {
  formatCurrency,
  parseNumericValue,
  getMonthName,
  getMonthStartDate,
  getMonthStartDateString,
} from './commissionUtils';
import { CommissionSummaryCards } from './CommissionSummaryCards';
import { ActivitySummary } from './ActivitySummary';
import { PayCommissionsButton } from './payments/PayCommissionsButton';
import { CommissionSettlementHistory } from './payments/CommissionSettlementHistory';
import { PendingPaymentVerifications } from './PendingPaymentVerifications';
import { PendingCommissionsModal } from './PendingCommissionsModal';
import { AvailableCommissionsModal } from './AvailableCommissionsModal';
import { ExtraDayCommissionModal } from './ExtraDayCommissionModal';
import { AdminPartnerTargetEditor } from './AdminPartnerTargetEditor';
import { loadAvailableForPayment } from './payments/paymentUtils';

export const AdminCommissionDashboard = () => {
  const [sellers, setSellers] = useState<UserProfile[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [summary, setSummary] = useState<SellerCommissionMonthlySummary | null>(null);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showAvailableModal, setShowAvailableModal] = useState(false);
  const [showExtraDayModal, setShowExtraDayModal] = useState(false);
  const [allSellers, setAllSellers] = useState<Array<{
    seller_id: string;
    full_name: string;
    generated_total: number;
    pending_total: number;
    available_total: number;
    paid_total: number;
    comodato_units: number;
    wholesale_units: number;
    conversion_count: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [verificationRefreshKey, setVerificationRefreshKey] = useState(0);

  const loadSellers = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('role', 'socios_comerciales')
        .eq('is_active', true);

      if (err) throw err;
      setSellers((data as UserProfile[]) || []);
      if (data && data.length > 0) {
        setSelectedSellerId(data[0].id);
      }
    } catch (err: any) {
      console.error('Error loading sellers:', err);
      setError('No se pudieron cargar los vendedores.');
    } finally {
      setLoading(false);
    }
  };

  const loadSellerSummary = async (sellerId: string) => {
    if (!supabase) return;

    try {
      const monthStart = getMonthStartDateString(
        currentDate.getFullYear(),
        currentDate.getMonth()
      );

      const { data, error: err } = await supabase
        .from('v_seller_commission_monthly_summary')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('month_start', monthStart)
        .single();

      if (err && err.code !== 'PGRST116') throw err;
      setSummary((data as SellerCommissionMonthlySummary) || null);
    } catch (err: any) {
      console.error('Error loading summary:', err);
    }
  };

  const loadTotalAvailable = async (sellerId: string) => {
    try {
      const available = await loadAvailableForPayment(sellerId);
      setTotalAvailable(parseNumericValue(available?.available_amount));
    } catch (err) {
      console.error('Error loading total available commissions:', err);
      setTotalAvailable(0);
    }
  };

  const loadAllSellersSummary = async () => {
    if (!supabase) return;

    try {
      const monthStart = getMonthStartDateString(
        currentDate.getFullYear(),
        currentDate.getMonth()
      );

      const { data, error: err } = await supabase
        .from('v_seller_commission_monthly_summary')
        .select('seller_id, generated_total, pending_total, available_total, paid_total, comodato_units, wholesale_units, conversion_count')
        .eq('month_start', monthStart);

      if (err) throw err;

      // Merge with seller names
      const enriched = (data || []).map(row => {
        const seller = sellers.find(s => s.id === row.seller_id);
        return {
          ...row,
          full_name: seller?.full_name || 'Desconocido',
        };
      });

      setAllSellers(enriched as any);
    } catch (err: any) {
      console.error('Error loading all sellers summary:', err);
    }
  };

  useEffect(() => {
    loadSellers();
  }, []);

  useEffect(() => {
    if (selectedSellerId) {
      loadSellerSummary(selectedSellerId);
      loadTotalAvailable(selectedSellerId);
    } else setTotalAvailable(0);
    loadAllSellersSummary();
  }, [currentDate, sellers, selectedSellerId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cc-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-300">Error</h3>
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  const monthName = getMonthName(currentDate);
  const statementMonthStart = getMonthStartDateString(
    currentDate.getFullYear(),
    currentDate.getMonth()
  );
  const statementMonthEndExclusive = getMonthStartDateString(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1
  );

  const handlePrevMonth = () => {
    const prev = new Date(currentDate);
    prev.setMonth(prev.getMonth() - 1);
    setCurrentDate(prev);
  };

  const handleNextMonth = () => {
    const next = new Date(currentDate);
    next.setMonth(next.getMonth() + 1);
    if (next <= new Date()) {
      setCurrentDate(next);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-cc-cream mb-2">Comisiones del equipo</h1>
        <p className="text-cc-text-muted">
          Consulta el estado de comisiones de todos los vendedores.
        </p>
      </div>

      {/* Month and Seller Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-cc-surface rounded-xl border border-white/5 p-4 flex items-center justify-between">
          <div>
            <label className="text-xs font-semibold text-cc-text-muted mb-2 block">Mes</label>
            <p className="text-lg font-bold text-cc-cream capitalize">{monthName}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrevMonth}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold text-cc-text-main transition-colors"
            >
              ‹
            </button>
            <button
              onClick={handleNextMonth}
              disabled={new Date(currentDate.getFullYear(), currentDate.getMonth() + 1) > new Date()}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold text-cc-text-main transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ›
            </button>
          </div>
        </div>
        <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
          <label className="text-xs font-semibold text-cc-text-muted mb-2 block">Vendedor</label>
          <select
            value={selectedSellerId || ''}
            onChange={e => setSelectedSellerId(e.target.value)}
            className="w-full bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50"
          >
            {sellers.map(seller => (
              <option key={seller.id} value={seller.id}>
                {seller.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected Seller Summary */}
      {selectedSellerId && summary && (
        <>
          <div>
            <h2 className="text-xl font-bold text-cc-cream mb-3">
              {sellers.find(s => s.id === selectedSellerId)?.full_name}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <CommissionSummaryCards 
                summary={summary} 
                totalAvailable={totalAvailable}
                onPendingClick={() => setShowPendingModal(true)}
                onAvailableClick={() => setShowAvailableModal(true)}
              />
            </div>
          </div>

          {/* Pending Payment Verifications */}
          <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
            <PendingPaymentVerifications
              refreshTrigger={verificationRefreshKey}
              onVerificationApproved={() => {
                setVerificationRefreshKey(prev => prev + 1);
                setRefreshKey(prev => prev + 1);
                loadAllSellersSummary();
                loadSellerSummary(selectedSellerId);
                loadTotalAvailable(selectedSellerId);
              }}
            />
          </div>

          {/* Extra Days Section - Admin Only */}
          {selectedSellerId && (
            <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
              <button
                onClick={() => setShowExtraDayModal(true)}
                className="w-full px-6 py-3 bg-cc-primary/20 border border-cc-primary text-cc-primary rounded-lg font-semibold hover:bg-cc-primary/30 hover:border-cc-primary/80 transition-all"
              >
                Pagar días extra
              </button>
            </div>
          )}

          {/* Partner Target Section - Admin Only */}
          {selectedSellerId && (
            <AdminPartnerTargetEditor
              sellerId={selectedSellerId}
              sellerName={sellers.find(s => s.id === selectedSellerId)?.full_name || ''}
              monthStart={getMonthStartDate(currentDate.getFullYear(), currentDate.getMonth())
                .toISOString()
                .split('T')[0]}
              onSaveSuccess={() => {
                setRefreshKey(prev => prev + 1);
              }}
            />
          )}

          {/* Payment Section */}
          <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
            <h3 className="text-lg font-bold text-cc-cream mb-4">Gestión de pagos</h3>
            <PayCommissionsButton
              sellerId={selectedSellerId}
              sellerName={sellers.find(s => s.id === selectedSellerId)?.full_name || ''}
              onPaymentComplete={() => {
                setRefreshKey(prev => prev + 1);
                loadAllSellersSummary();
                loadSellerSummary(selectedSellerId);
                loadTotalAvailable(selectedSellerId);
              }}
            />
          </div>

          <div>
            <h3 className="text-lg font-bold text-cc-cream mb-3">Actividad</h3>
            <ActivitySummary summary={summary} />
          </div>

          {/* Settlement History */}
          <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
            <h3 className="text-lg font-bold text-cc-cream mb-4">Historial de liquidaciones</h3>
            <CommissionSettlementHistory
              key={refreshKey}
              sellerId={selectedSellerId}
            />
          </div>
        </>
      )}

      {/* All Sellers Table */}
      <div>
        <h2 className="text-xl font-bold text-cc-cream mb-3">Resumen general</h2>
        {allSellers.length === 0 ? (
          <div className="bg-cc-surface rounded-xl border border-white/5 p-6 text-center">
            <p className="text-sm text-cc-text-muted">
              No hay datos de comisiones para este periodo.
            </p>
          </div>
        ) : (
          <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-cc-text-muted">
                      Vendedor
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                      Generado
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                      Pendiente
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                      Disponible
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-cc-text-muted">
                      Pagado
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-cc-text-muted">
                      Bolsas
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-cc-text-muted">
                      Conversiones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {allSellers.map(seller => (
                    <tr
                      key={seller.seller_id}
                      onClick={() => setSelectedSellerId(seller.seller_id)}
                      className="hover:bg-white/5 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-cc-cream">{seller.full_name}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-cc-text-main">
                        {formatCurrency(parseNumericValue(seller.generated_total))}
                      </td>
                      <td className="px-4 py-3 text-right text-yellow-400">
                        {formatCurrency(parseNumericValue(seller.pending_total))}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400 font-semibold">
                        {formatCurrency(parseNumericValue(seller.available_total))}
                      </td>
                      <td className="px-4 py-3 text-right text-blue-400">
                        {formatCurrency(parseNumericValue(seller.paid_total))}
                      </td>
                      <td className="px-4 py-3 text-center text-cc-text-main">
                        {parseNumericValue(seller.comodato_units) +
                          parseNumericValue(seller.wholesale_units)}
                      </td>
                      <td className="px-4 py-3 text-center text-cc-text-main">
                        {parseNumericValue(seller.conversion_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Pending Commissions Modal */}
      {selectedSellerId && (
        <PendingCommissionsModal
          isOpen={showPendingModal}
          onClose={() => setShowPendingModal(false)}
          sellerId={selectedSellerId}
          sellerName={sellers.find(s => s.id === selectedSellerId)?.full_name || 'Vendedor'}
          monthStart={getMonthStartDate(currentDate.getFullYear(), currentDate.getMonth()).toISOString().split('T')[0]}
          monthEnd={new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).toISOString().split('T')[0]}
          pendingTotal={summary?.pending_total || 0}
        />
      )}

      {/* Available Commissions Modal */}
      {selectedSellerId && summary && (
        <AvailableCommissionsModal
          isOpen={showAvailableModal}
          onClose={() => setShowAvailableModal(false)}
          sellerId={selectedSellerId}
          sellerName={sellers.find(s => s.id === selectedSellerId)?.full_name || 'Vendedor'}
          monthStart={statementMonthStart}
          monthEndExclusive={statementMonthEndExclusive}
          monthlySummary={summary}
        />
      )}

      {/* Extra Day Commission Modal */}
      {selectedSellerId && (
        <ExtraDayCommissionModal
          isOpen={showExtraDayModal}
          onClose={() => setShowExtraDayModal(false)}
          sellerId={selectedSellerId}
          sellerName={sellers.find(s => s.id === selectedSellerId)?.full_name || 'Vendedor'}
          currentDate={currentDate}
          onSuccess={() => {
            setRefreshKey(prev => prev + 1);
            loadAllSellersSummary();
            loadSellerSummary(selectedSellerId);
            loadTotalAvailable(selectedSellerId);
          }}
        />
      )}
      </div>
    </div>
  );
};
