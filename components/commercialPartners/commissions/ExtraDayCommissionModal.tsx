import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, AlertCircle, Loader2, Calendar, Trash2 } from 'lucide-react';
import { CommissionMovement } from './commissionTypes';
import { formatCurrency, formatDate, parseNumericValue, getStatusLabel } from './commissionUtils';

interface ExtraDayCommissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  currentDate: Date;
  onSuccess?: () => void;
}

type ModalStep = 'form' | 'confirmation' | 'cancel-confirmation';

interface FormData {
  workDate: string;
  amount: string;
  description: string;
}

interface CancelData {
  eventId: string;
  reason: string;
}

export const ExtraDayCommissionModal = ({
  isOpen,
  onClose,
  sellerId,
  sellerName,
  currentDate,
  onSuccess,
}: ExtraDayCommissionModalProps) => {
  const [step, setStep] = useState<ModalStep>('form');
  const [formData, setFormData] = useState<FormData>({
    workDate: getBusinessDateString(currentDate),
    amount: '',
    description: '',
  });
  const [cancelData, setCancelData] = useState<CancelData>({ eventId: '', reason: '' });
  const [extraDays, setExtraDays] = useState<CommissionMovement[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCancelEvent, setSelectedCancelEvent] = useState<CommissionMovement | null>(null);

  const businessDateStr = getBusinessDateString(currentDate);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('form');
      setFormData({
        workDate: businessDateStr,
        amount: '',
        description: '',
      });
      setError(null);
      setCancelData({ eventId: '', reason: '' });
      setSelectedCancelEvent(null);
    } else {
      loadExtraDays();
    }
  }, [isOpen, sellerId]);

  const loadExtraDays = async () => {
    if (!supabase) return;

    setError(null);

    try {
      const { data, error: err } = await supabase
        .from('v_seller_commission_movements')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('source_type', 'adjustment')
        .order('earned_at', { ascending: false });

      if (err) throw err;

      // Filter for extra day adjustments only
      const extraDayMovements = (data as CommissionMovement[]) || [];
      const filtered = extraDayMovements.filter(m => {
        try {
          const metadata = typeof m.metadata === 'string' ? JSON.parse(m.metadata as any) : m.metadata;
          return metadata?.adjustment_type === 'extra_day';
        } catch {
          return false;
        }
      });

      setExtraDays(filtered);
    } catch (err: any) {
      console.error('Error loading extra days:', err);
      setError('No se pudieron cargar los días extra registrados.');
    }
  };

  const handleFormChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.workDate) {
      setError('La fecha de trabajo es obligatoria');
      return false;
    }

    const amount = parseFloat(formData.amount);
    if (!formData.amount || isNaN(amount) || amount <= 0) {
      setError('El monto debe ser mayor a $0.00');
      return false;
    }

    if (amount > 9999999.99) {
      setError('El monto no puede ser mayor a $9,999,999.99');
      return false;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(formData.amount)) {
      setError('El monto no puede tener más de 2 decimales');
      return false;
    }

    if (!formData.description.trim()) {
      setError('La descripción es obligatoria');
      return false;
    }

    if (formData.description.trim().length < 3) {
      setError('La descripción debe tener al menos 3 caracteres');
      return false;
    }

    return true;
  };

  const handleProceedToConfirmation = () => {
    if (validateForm()) {
      setStep('confirmation');
      setError(null);
    }
  };

  const handleCreateExtraDay = async () => {
    if (!supabase) return;

    setSubmitting(true);
    setError(null);

    try {
      const amount = parseFloat(formData.amount);

      const { data, error: err } = await supabase.rpc('create_extra_day_commission', {
        p_seller_id: sellerId,
        p_amount: amount,
        p_work_date: formData.workDate,
        p_description: formData.description.trim(),
      });

      console.log('[CREATE_EXTRA_DAY] RPC Response:', { data, err });

      if (err) {
        console.error('[CREATE_EXTRA_DAY] RPC Error:', err);
        throw err;
      }

      // Extract result from array if needed (Supabase RPC returns array)
      const result = Array.isArray(data) ? data[0] : data;
      console.log('[CREATE_EXTRA_DAY] Parsed Result:', result);

      if (!result?.success) {
        const errorMsg = result?.error_message || 'No se pudo registrar el día extra';
        console.error('[CREATE_EXTRA_DAY] Result not success:', errorMsg);
        setError(errorMsg);
        setSubmitting(false);
        return;
      }

      // ✅ CREATE WAS SUCCESSFUL - DO NOT SHOW ERROR
      console.log('[CREATE_EXTRA_DAY] CREATE SUCCESS - commission_event_id:', result?.commission_event_id);
      
      // Reset form immediately (success state)
      setFormData({
        workDate: businessDateStr,
        amount: '',
        description: '',
      });
      setStep('form');
      
      // Show success message
      // (Note: we'll show success without waiting for refresh to complete)
      
      // Refresh data in background - don't block on failures
      console.log('[CREATE_EXTRA_DAY] Starting refresh operations...');
      try {
        console.log('[CREATE_EXTRA_DAY] Loading extra days...');
        await loadExtraDays();
        console.log('[CREATE_EXTRA_DAY] Extra days loaded OK');
      } catch (refreshErr: any) {
        console.error('[CREATE_EXTRA_DAY] Error refreshing extra days:', refreshErr);
        // Don't fail - just log it
      }

      // Call parent callback to refresh parent components
      try {
        console.log('[CREATE_EXTRA_DAY] Calling onSuccess callback...');
        onSuccess?.();
        console.log('[CREATE_EXTRA_DAY] onSuccess callback complete');
      } catch (callbackErr: any) {
        console.error('[CREATE_EXTRA_DAY] Error in onSuccess callback:', callbackErr);
        // Don't fail - just log it
      }

      console.log('[CREATE_EXTRA_DAY] All operations complete');
    } catch (err: any) {
      console.error('[CREATE_EXTRA_DAY] Outer catch - Error creating extra day:', err);
      setError(err.message || 'Error al registrar el día extra');
      setSubmitting(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelExtraDay = (movement: CommissionMovement) => {
    setSelectedCancelEvent(movement);
    setCancelData({ eventId: movement.commission_event_id, reason: '' });
    setStep('cancel-confirmation');
    setError(null);
  };

  const validateCancelForm = (): boolean => {
    if (!cancelData.reason.trim()) {
      setError('El motivo de cancelación es obligatorio');
      return false;
    }

    if (cancelData.reason.trim().length < 3) {
      setError('El motivo debe tener al menos 3 caracteres');
      return false;
    }

    return true;
  };

  const handleConfirmCancel = async () => {
    if (!supabase || !validateCancelForm()) return;

    setSubmitting(true);
    setError(null);

    try {
      const { data, error: err } = await supabase.rpc('cancel_extra_day_commission', {
        p_commission_event_id: cancelData.eventId,
        p_cancellation_reason: cancelData.reason.trim(),
      });

      console.log('[CANCEL_EXTRA_DAY] RPC Response:', { data, err });

      if (err) {
        console.error('[CANCEL_EXTRA_DAY] RPC Error:', err);
        throw err;
      }

      // Extract result from array if needed (Supabase RPC returns array)
      const result = Array.isArray(data) ? data[0] : data;
      console.log('[CANCEL_EXTRA_DAY] Parsed Result:', result);

      if (!result?.success) {
        const errorMsg = result?.error_message || 'No se pudo cancelar el día extra';
        console.error('[CANCEL_EXTRA_DAY] Result not success:', errorMsg);
        setError(errorMsg);
        setSubmitting(false);
        return;
      }

      // ✅ CANCEL WAS SUCCESSFUL
      console.log('[CANCEL_EXTRA_DAY] CANCEL SUCCESS');
      
      // Reset form immediately (success state)
      setStep('form');
      setCancelData({ eventId: '', reason: '' });
      setSelectedCancelEvent(null);

      // Refresh data in background - don't block on failures
      console.log('[CANCEL_EXTRA_DAY] Starting refresh operations...');
      try {
        console.log('[CANCEL_EXTRA_DAY] Loading extra days...');
        await loadExtraDays();
        console.log('[CANCEL_EXTRA_DAY] Extra days loaded OK');
      } catch (refreshErr: any) {
        console.error('[CANCEL_EXTRA_DAY] Error refreshing extra days:', refreshErr);
        // Don't fail - just log it
      }

      // Call parent callback to refresh parent components
      try {
        console.log('[CANCEL_EXTRA_DAY] Calling onSuccess callback...');
        onSuccess?.();
        console.log('[CANCEL_EXTRA_DAY] onSuccess callback complete');
      } catch (callbackErr: any) {
        console.error('[CANCEL_EXTRA_DAY] Error in onSuccess callback:', callbackErr);
        // Don't fail - just log it
      }

      console.log('[CANCEL_EXTRA_DAY] All operations complete');
    } catch (err: any) {
      console.error('[CANCEL_EXTRA_DAY] Outer catch - Error cancelling extra day:', err);
      setError(err.message || 'Error al cancelar el día extra');
      setSubmitting(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getMetadataDescription = (movement: CommissionMovement): string => {
    try {
      const metadata = typeof movement.metadata === 'string' ? JSON.parse(movement.metadata as any) : movement.metadata;
      return metadata?.description || '—';
    } catch {
      return '—';
    }
  };

  const renderStatusBadge = (status: string) => {
    let bgColor = 'bg-gray-500/20 text-gray-300';
    let label = getStatusLabel(status as any);

    if (status === 'available') {
      bgColor = 'bg-green-500/20 text-green-300';
    } else if (status === 'paid') {
      bgColor = 'bg-blue-500/20 text-blue-300';
    } else if (status === 'cancelled') {
      bgColor = 'bg-red-500/20 text-red-300';
    }

    return (
      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${bgColor}`}>
        {label}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111111] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/5">
        {/* Header */}
        <div className="sticky top-0 bg-[#111111] border-b border-white/5 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-cc-cream">
            {step === 'form' ? 'Pagar día extra' : step === 'confirmation' ? 'Confirmar pago de día extra' : 'Cancelar día extra'}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-cc-text-muted hover:text-cc-text-main disabled:opacity-50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* FORM STEP */}
          {step === 'form' && (
            <div className="space-y-6">
              {/* Vendedor */}
              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">Vendedor</label>
                <div className="bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-cc-text-main">
                  {sellerName}
                </div>
              </div>

              {/* Fecha trabajada */}
              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">Fecha trabajada</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="date"
                    value={formData.workDate}
                    onChange={e => handleFormChange('workDate', e.target.value)}
                    max={businessDateStr}
                    className="w-full bg-white text-black border border-gray-300 rounded-lg px-3 py-2 pl-9 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 caret-black disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <p className="text-xs text-cc-text-muted mt-1">No se permiten fechas posteriores a hoy</p>
              </div>

              {/* Monto */}
              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">Monto</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="9999999.99"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={e => handleFormChange('amount', e.target.value)}
                    className="w-full bg-white text-black border border-gray-300 rounded-lg px-3 py-2 pl-7 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 caret-black disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <p className="text-xs text-cc-text-muted mt-1">Máximo 2 decimales, mayor que $0.00</p>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">Descripción</label>
                <textarea
                  value={formData.description}
                  onChange={e => handleFormChange('description', e.target.value)}
                  placeholder="Ej: Apoyo en tienda durante turno adicional"
                  rows={3}
                  className="w-full bg-white text-black border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 caret-black resize-none disabled:bg-gray-100 disabled:text-gray-500"
                />
                <p className="text-xs text-cc-text-muted mt-1">Mínimo 3 caracteres</p>
              </div>

              {/* Days Extra List */}
              {extraDays.length > 0 && (
                <div className="border-t border-white/5 pt-6">
                  <h3 className="text-sm font-semibold text-cc-text-main mb-3">Días extra registrados</h3>
                  <div className="max-h-40 overflow-y-auto space-y-2 bg-cc-bg rounded-lg p-3">
                    {extraDays.map(day => (
                      <div
                        key={day.commission_event_id}
                        className="flex items-start justify-between text-sm bg-white/5 rounded p-2"
                      >
                        <div className="flex-1">
                          <div className="text-cc-text-main font-medium">
                            {formatDate(day.earned_at)}
                          </div>
                          <div className="text-xs text-cc-text-muted mt-0.5">
                            {getMetadataDescription(day)}
                          </div>
                          <div className="mt-1">
                            {renderStatusBadge(day.status)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-cc-primary font-bold">
                            {formatCurrency(parseNumericValue(day.commission_amount))}
                          </div>
                          {day.status === 'available' && (
                            <button
                              onClick={() => handleCancelExtraDay(day)}
                              disabled={submitting}
                              className="mt-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-4">
                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg border border-white/10 text-cc-text-main hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleProceedToConfirmation}
                  disabled={submitting || !formData.workDate || !formData.amount || !formData.description}
                  className="px-4 py-2 rounded-lg bg-cc-primary text-black font-semibold hover:bg-cc-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Continuar
                </button>
              </div>
            </div>
          )}

          {/* CONFIRMATION STEP */}
          {step === 'confirmation' && (
            <div className="space-y-6">
              <div className="bg-cc-surface rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Vendedor</span>
                  <span className="text-cc-text-main font-medium">{sellerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Fecha</span>
                  <span className="text-cc-text-main font-medium">{formatDate(formData.workDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Monto</span>
                  <span className="text-cc-primary font-bold">{formatCurrency(parseFloat(formData.amount))}</span>
                </div>
                <div className="border-t border-white/5 pt-3">
                  <span className="text-cc-text-muted block mb-2">Descripción</span>
                  <p className="text-cc-text-main text-sm">{formData.description}</p>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setStep('form')}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg border border-white/10 text-cc-text-main hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={handleCreateExtraDay}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-cc-primary text-black font-semibold hover:bg-cc-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Registrar pago extra
                </button>
              </div>
            </div>
          )}

          {/* CANCEL CONFIRMATION STEP */}
          {step === 'cancel-confirmation' && selectedCancelEvent && (
            <div className="space-y-6">
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Vendedor</span>
                  <span className="text-cc-text-main font-medium">{sellerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Fecha</span>
                  <span className="text-cc-text-main font-medium">
                    {formatDate(selectedCancelEvent.earned_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Descripción</span>
                  <span className="text-cc-text-main font-medium">
                    {getMetadataDescription(selectedCancelEvent)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Monto</span>
                  <span className="text-red-400 font-bold">
                    -{formatCurrency(parseNumericValue(selectedCancelEvent.commission_amount))}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">
                  Motivo de cancelación
                </label>
                <textarea
                  value={cancelData.reason}
                  onChange={e => setCancelData(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Ej: Captura incorrecta, aclaración con el vendedor..."
                  rows={3}
                  className="w-full bg-cc-bg border border-white/10 rounded-lg px-3 py-2 text-cc-text-main focus:outline-none focus:border-cc-primary/50 resize-none"
                />
                <p className="text-xs text-cc-text-muted mt-1">Mínimo 3 caracteres</p>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setStep('form');
                    setSelectedCancelEvent(null);
                    setCancelData({ eventId: '', reason: '' });
                  }}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg border border-white/10 text-cc-text-main hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={handleConfirmCancel}
                  disabled={submitting || !cancelData.reason.trim()}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Confirmar cancelación
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper: Get business date string in America/Mexico_City timezone
function getBusinessDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
