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
      const summaryQuery = supabase
        .from('v_seller_commission_monthly_summary')
        .select('*');
      const historyQuery = supabase
        .from('v_piece_sale_history')
        .select('*')
        .order('sale_date', { ascending: false });
      const stockQuery = supabase
        .from('v_seller_piece_stock')
        .select('*');

      // Si es vendedor, filtrar por su ID
      if (!isAdmin) {
        summaryQuery.eq('seller_id', filterSellerId).limit(1);
        historyQuery.eq('seller_id', filterSellerId);
        stockQuery.eq('seller_id', filterSellerId);
      }

      const [summaryRes, historyRes, stockRes] = await Promise.all([
        summaryQuery,
        historyQuery,
        stockQuery,
      ]);

      if (summaryRes.error) throw summaryRes.error;
      if (historyRes.error) throw historyRes.error;
      if (stockRes.error) throw stockRes.error;

      setSummaryData(summaryRes.data?.[0] || null);
      setHistory((historyRes.data ?? []) as PieceSaleHistory[]);
      setStock((stockRes.data ?? []) as SellerPieceStock[]);
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
        <PieceSalesHistoryTable history={history} onRefresh={loadData} />
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
