import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { ShoppingCart, CreditCard } from 'lucide-react';
import { WholesaleSummary, BUTTON_PRIMARY_CLS } from './types';
import WholesaleSummaryCards from './WholesaleSummaryCards';
import WholesaleOrderHistory from './WholesaleOrderHistory';
import WholesalePaymentHistory from './WholesalePaymentHistory';
import WholesaleOrderForm from './WholesaleOrderForm';
import WholesalePaymentForm from './WholesalePaymentForm';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

const CommercialPartnerWholesale: React.FC<Props> = ({ partnerId, refreshKey = 0 }) => {
  const [summary, setSummary] = useState<WholesaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<'order' | 'payment' | null>(null);
  const [internalRefresh, setInternalRefresh] = useState(0);

  useEffect(() => {
    loadSummary();
  }, [partnerId, refreshKey, internalRefresh]);

  const loadSummary = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('v_commercial_partner_wholesale_summary')
        .select('*')
        .eq('partner_id', partnerId)
        .single();

      if (queryError) {
        if (queryError.code === 'PGRST116') {
          // No data found
          setSummary(null);
        } else {
          throw queryError;
        }
      } else {
        setSummary(data as WholesaleSummary);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar resumen mayoreo');
    } finally {
      setLoading(false);
    }
  };

  const handleSaved = () => {
    setActiveModal(null);
    setInternalRefresh(r => r + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <WholesaleSummaryCards summary={summary} loading={loading} />

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveModal('order')}
          className={`${BUTTON_PRIMARY_CLS} flex items-center gap-2`}
        >
          <ShoppingCart size={16} />
          Registrar Venta
        </button>
        <button
          onClick={() => setActiveModal('payment')}
          className={`${BUTTON_PRIMARY_CLS} flex items-center gap-2`}
        >
          <CreditCard size={16} />
          Registrar Pago
        </button>
      </div>

      {/* Order History */}
      <div>
        <h3 className="text-lg font-semibold text-[#111111] mb-3">Historial de Compras</h3>
        <WholesaleOrderHistory 
          partnerId={partnerId} 
          refreshKey={internalRefresh}
          onOrderDeleted={() => {
            // Refresh summary and order history after successful deletion
            setInternalRefresh(r => r + 1);
          }}
        />
      </div>

      {/* Payment History */}
      <div>
        <h3 className="text-lg font-semibold text-[#111111] mb-3">Historial de Pagos</h3>
        <WholesalePaymentHistory partnerId={partnerId} refreshKey={internalRefresh} />
      </div>

      {/* Modals */}
      {activeModal === 'order' && (
        <WholesaleOrderForm
          partnerId={partnerId}
          onClose={() => setActiveModal(null)}
          onSaved={handleSaved}
        />
      )}

      {activeModal === 'payment' && (
        <WholesalePaymentForm
          partnerId={partnerId}
          onClose={() => setActiveModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

export default CommercialPartnerWholesale;
