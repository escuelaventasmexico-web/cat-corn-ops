import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Plus, AlertCircle, Loader2 } from 'lucide-react';
import {
  PieceSaleHistory,
  SellerCommissionMonthlySummary,
  SellerPieceStock,
} from '../../../types/pieceSales';
import { PieceSalesSummaryCards } from './PieceSalesSummaryCards';
import { NewPieceSaleModal } from './NewPieceSaleModal';
import { PieceSalesHistoryTable } from './PieceSalesHistoryTable';
import { SellerPieceStockTable } from './SellerPieceStockTable';

interface PieceSalesModuleProps {
  refreshTrigger?: number;
  isAdmin?: boolean;
  userId?: string;
}

export const PieceSalesModule = ({ refreshTrigger = 0, isAdmin = false, userId = '' }: PieceSalesModuleProps) => {
  const [summaryData, setSummaryData] = useState<SellerCommissionMonthlySummary | null>(null);
  const [history, setHistory] = useState<PieceSaleHistory[]>([]);
  const [stock, setStock] = useState<SellerPieceStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewSaleModal, setShowNewSaleModal] = useState(false);

  const loadSellerPieceMetrics = async (sellerId: string): Promise<SellerCommissionMonthlySummary | null> => {
    if (!supabase) return null;
    
    try {
      // Get current month's start and end dates
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      // Load data in parallel from three views
      const [salesRes, commissionRes, paymentsRes] = await Promise.all([
        // Monthly sales: use v_piece_sale_history
        supabase
          .from('v_piece_sale_history')
          .select('total_amount', { count: 'exact' })
          .eq('seller_id', sellerId)
          .gte('sale_date', monthStart)
          .lte('sale_date', monthEnd)
          .neq('status', 'cancelled'),
        
        // Commission movements: split pending and available
        supabase
          .from('v_seller_commission_movements')
          .select('commission_amount, status')
          .eq('seller_id', sellerId)
          .eq('source_type', 'piece_sale'),
        
        // Pending payment verifications: use submitted_by (not seller_id!)
        supabase
          .from('v_pending_payment_verifications')
          .select('amount', { count: 'exact' })
          .eq('submitted_by', sellerId)
          .eq('scheme', 'venta_pieza'),
      ]);

      // Check for errors
      if (salesRes.error) {
        console.error('Error loading monthly sales:', salesRes.error.message);
      }
      if (commissionRes.error) {
        console.error('Error loading commissions:', commissionRes.error.message);
      }
      if (paymentsRes.error) {
        console.error('Error loading payment verifications:', paymentsRes.error.message);
      }

      // Calculate monthly sales
      const salesData = salesRes.data ?? [];
      const monthlySalesAmount = salesData.reduce((sum: number, row: any) => 
        sum + (Number(row.total_amount) || 0), 0);
      const monthlySalesCount = salesRes.count ?? 0;

      // Calculate commissions (pending vs available)
      const commissionData = commissionRes.data ?? [];
      const pendingCommission = commissionData
        .filter((row: any) => row.status === 'pending')
        .reduce((sum: number, row: any) => sum + (Number(row.commission_amount) || 0), 0);
      const availableCommission = commissionData
        .filter((row: any) => row.status === 'available')
        .reduce((sum: number, row: any) => sum + (Number(row.commission_amount) || 0), 0);

      // Count pending payments under review
      const monthlyPaymentsUnderReview = paymentsRes.count ?? 0;

      return {
        monthly_sales_amount: monthlySalesAmount,
        monthly_sales_count: monthlySalesCount,
        total_commission_pending: pendingCommission,
        total_commission_available: availableCommission,
        monthly_payments_under_review: monthlyPaymentsUnderReview,
      };
    } catch (err: any) {
      console.error('Error calculating piece sale metrics:', err);
      return null;
    }
  };

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Determinar seller_id basado en si es admin o vendedor
      let filterSellerId = userId;
      
      // Si no se pasó userId (error), obtenerlo del auth
      if (!filterSellerId) {
        const authResponse = await supabase.auth.getUser();
        const userData = authResponse?.data?.user;
        if (!userData?.id) {
          throw new Error('Usuario no autenticado');
        }
        filterSellerId = userData.id;
      }

      // Para admin: mostrar TODAS las ventas (sin filtro por seller_id)
      // Para vendedor: mostrar solo sus propias ventas
      const historyQuery = supabase
        .from('v_piece_sale_history')
        .select('*')
        .order('created_at', { ascending: false });
      const stockQuery = supabase
        .from('v_seller_piece_stock')
        .select('*');

      // Si es vendedor, filtrar por su ID
      if (!isAdmin) {
        historyQuery.eq('seller_id', filterSellerId);
        stockQuery.eq('seller_id', filterSellerId);
      }

      // Load history and stock in parallel
      const [historyRes, stockRes, verificationsRes] = await Promise.all([
        historyQuery,
        stockQuery,
        // Load payment verifications for all piece sales
        supabase
          .from('partner_payment_verification_requests')
          .select('piece_sale_id, status, reviewed_at, reviewed_by, rejection_reason')
          .eq('scheme', 'venta_pieza')
          .not('piece_sale_id', 'is', null),
      ]);

      if (historyRes.error) throw historyRes.error;
      if (stockRes.error) throw stockRes.error;
      if (verificationsRes.error) throw verificationsRes.error;

      // Build verification map: piece_sale_id -> verification info
      // For sales with multiple verifications, use the most recent relevant one
      const verificationsMap = new Map<string, any>();
      const verificationsData = verificationsRes.data ?? [];
      
      for (const verification of verificationsData) {
        const saleId = verification.piece_sale_id;
        const existing = verificationsMap.get(saleId);
        
        // Keep the most recent verification for this sale
        // (could be approved or rejected depending on current status)
        if (!existing || (new Date(verification.reviewed_at || 0) > new Date(existing.reviewed_at || 0))) {
          verificationsMap.set(saleId, verification);
        }
      }

      // Enrich history with verification info
      const enrichedHistory = (historyRes.data ?? []).map((sale: any) => {
        const verification = verificationsMap.get(sale.sale_id);
        return {
          ...sale,
          verification_reviewed_at: verification?.reviewed_at ?? null,
          verification_reviewed_by_name: verification?.reviewed_by ? null : null, // Will need profile lookup if needed
          verification_rejection_reason: verification?.rejection_reason ?? null,
        };
      });

      // Load profile info for reviewed_by (batch lookup)
      const reviewedByIds = Array.from(new Set(
        Array.from(verificationsMap.values())
          .map((v: any) => v.reviewed_by)
          .filter((id: any) => id != null)
      ));

      let profilesMap = new Map<string, string>();
      if (reviewedByIds.length > 0) {
        const profilesRes = await supabase
          .from('user_profiles')
          .select('id, full_name')
          .in('id', reviewedByIds);
        
        if (profilesRes.data) {
          profilesMap = new Map(profilesRes.data.map((p: any) => [p.id, p.full_name]));
        }
      }

      // Final enrichment with reviewer names
      const finalHistory = enrichedHistory.map((sale: any) => ({
        ...sale,
        verification_reviewed_by_name: sale.sale_id && verificationsMap.get(sale.sale_id)?.reviewed_by
          ? profilesMap.get(verificationsMap.get(sale.sale_id).reviewed_by) ?? null
          : null,
      }));

      // Load summary metrics for non-admin users
      let summaryData: SellerCommissionMonthlySummary | null = null;
      if (!isAdmin) {
        summaryData = await loadSellerPieceMetrics(filterSellerId);
      }

      setHistory(finalHistory as PieceSaleHistory[]);
      setStock((stockRes.data ?? []) as SellerPieceStock[]);
      setSummaryData(summaryData);
    } catch (err: any) {
      console.error('Error loading piece sales data:', err);
      setError(err?.message || 'Error al cargar datos de venta por pieza');
      setHistory([]);
      setStock([]);
      setSummaryData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    loadData();
  }, [refreshTrigger, loadData]);

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
          <h3 className="font-semibold text-red-300">Error al cargar datos</h3>
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── SUMMARY CARDS (vendedores solo) ────────────────────────────────── */}
      {!isAdmin && <PieceSalesSummaryCards summaryData={summaryData} />}

      {/* ── BUTTON (vendedores solo) ────────────────────────────────────────── */}
      {!isAdmin && (
        <div>
          <button
            onClick={() => setShowNewSaleModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-cc-primary hover:bg-cc-primary/90 text-cc-surface rounded-xl font-semibold transition-colors"
          >
            <Plus className="w-5 h-5" />
            Nueva venta por pieza
          </button>
        </div>
      )}

      {/* ── ADMIN INFO ────────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
          <p className="text-sm text-blue-300">
            Mostrando todas las ventas por pieza de todos los vendedores. 
            Para aprobar o rechazar pagos, ve a "Gestión de pagos" filtrando por scheme='venta_pieza'.
          </p>
        </div>
      )}

      {/* ── HISTORY ────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold text-cc-text-main mb-4">Historial de ventas</h2>
        <PieceSalesHistoryTable history={history} onRefresh={loadData} isAdmin={isAdmin} />
      </div>

      {/* ── STOCK (vendedores solo) ─────────────────────────────────────── */}
      {!isAdmin && (
        <div>
          <h2 className="text-lg font-bold text-cc-text-main mb-4">Mi stock informativo</h2>
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl mb-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-300">
              Este control es informativo y no modifica el inventario general de Cat Corn.
            </p>
          </div>
          <SellerPieceStockTable stock={stock} />
        </div>
      )}

      {/* ── NEW SALE MODAL ────────────────────────────────── */}
      {showNewSaleModal && (
        <NewPieceSaleModal
          onClose={() => setShowNewSaleModal(false)}
          onSuccess={() => {
            setShowNewSaleModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};
