import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { WholesalePayment, fmtCurrency, fmtDate, PAYMENT_METHOD_LABELS, CARD_CLS } from './types';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

const WholesalePaymentHistory: React.FC<Props> = ({ partnerId, refreshKey = 0 }) => {
  const [payments, setPayments] = useState<WholesalePayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPayments();
  }, [partnerId, refreshKey]);

  const loadPayments = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('wholesale_payments')
        .select('*')
        .eq('partner_id', partnerId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (err) {
      console.error('Error loading payments:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className={`${CARD_CLS} text-center py-4`}>Cargando...</div>;
  }

  if (payments.length === 0) {
    return <div className={`${CARD_CLS} text-center py-4 text-[#6b7280]`}>Sin pagos registrados</div>;
  }

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="space-y-3">
      {payments.map(payment => (
        <div key={payment.id} className={CARD_CLS}>
          <div className="grid grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-xs text-[#6b7280]">Fecha</p>
              <p className="font-semibold text-[#111111]">{fmtDate(payment.payment_date)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Monto</p>
              <p className="font-semibold text-green-700">{fmtCurrency(payment.amount || 0)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Método</p>
              <p className="font-semibold text-[#111111]">{PAYMENT_METHOD_LABELS[payment.payment_method as keyof typeof PAYMENT_METHOD_LABELS] || payment.payment_method}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Referencia</p>
              <p className="text-[#111111]">{payment.reference || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Notas</p>
              <p className="text-[#111111] truncate">{payment.notes || '—'}</p>
            </div>
          </div>
        </div>
      ))}

      <div className={`${CARD_CLS} bg-green-50 border-green-300`}>
        <p className="text-sm font-semibold text-green-900">
          Total Pagado: <span className="text-lg">{fmtCurrency(totalPaid)}</span>
        </p>
      </div>
    </div>
  );
};

export default WholesalePaymentHistory;
