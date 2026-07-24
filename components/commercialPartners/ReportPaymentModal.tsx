import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Upload, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../../supabase';
import {
  createPaymentVerificationRequest,
  submitPaymentVerificationRequest,
  uploadPaymentProof,
} from '../../lib/paymentVerificationRpcs';

interface Props {
  partnerId: string;
  scheme: 'comodato' | 'mayoreo';
  movements?: Array<{ id: string; movement_date: string; movement_type: string; total_amount_due: number }>;
  wholesaleOrders?: Array<{ id: string; order_folio?: string; total_amount: number; pending_amount?: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'select-operation' | 'payment-details' | 'proof' | 'confirmation';

const ReportPaymentModal: React.FC<Props> = ({
  partnerId,
  scheme,
  movements = [],
  wholesaleOrders = [],
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<Step>('select-operation');
  const [operationId, setOperationId] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [folio, setFolio] = useState<string | null>(null);

  // Get available operations
  const availableOperations =
    scheme === 'comodato'
      ? movements.filter(m => (m.total_amount_due ?? 0) > 0)
      : wholesaleOrders.filter(wo => (wo.pending_amount ?? 0) > 0);

  // Auto-select if only one option
  useEffect(() => {
    if (step === 'select-operation' && availableOperations.length === 1) {
      setOperationId(availableOperations[0].id);
    }
  }, [step, availableOperations]);

  const getOperationLabel = (op: any) => {
    if (scheme === 'comodato') {
      return `${op.movement_type} - ${new Date(op.movement_date).toLocaleDateString('es-MX')}`;
    }
    return `Orden ${op.order_folio || op.id.slice(0, 8)}`;
  };

  const getPendingAmount = (op: any) => {
    return scheme === 'comodato' ? op.total_amount_due : op.pending_amount;
  };

  const handleSelectOperation = () => {
    if (!operationId) {
      setError('Selecciona una operación');
      return;
    }
    setError(null);
    setStep('payment-details');
  };

  const handleProofSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Solo se aceptan: JPEG, PNG, WebP, PDF');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('El archivo no puede exceder 10 MB');
      return;
    }

    setProofFile(file);
    setError(null);
  };

  const handleProofUploadAndSubmit = async () => {
    if (!proofFile) {
      setError('Selecciona un comprobante');
      return;
    }

    if (!requestId) {
      setError('Error: ID de solicitud no disponible');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Upload proof
      if (!supabase) {
        throw new Error('Supabase no inicializado');
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        throw new Error('Usuario no autenticado');
      }

      const proofPath = await uploadPaymentProof(userId, requestId, proofFile);

      // Submit with proof
      await submitPaymentVerificationRequest(
        requestId,
        proofPath,
        proofFile.name,
        proofFile.type,
        proofFile.size
      );

      setStep('confirmation');
    } catch (err: any) {
      setError(err.message || 'Error al subir comprobante');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!operationId || !amount || !paymentDate) {
      setError('Completa todos los campos requeridos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create payment verification request (draft)
      const result = await createPaymentVerificationRequest(
        scheme,
        partnerId,
        paymentDate,
        Number(amount),
        paymentMethod,
        scheme === 'comodato' ? operationId : undefined,
        scheme === 'mayoreo' ? operationId : undefined,
        reference.trim() || undefined,
        notes.trim() || undefined
      );

      if (!result?.requestId) {
        throw new Error('No se pudo crear la solicitud');
      }

      setRequestId(result.requestId);
      setFolio(result.folio);

      // For cash: submit immediately without proof
      if (paymentMethod === 'cash') {
        await submitPaymentVerificationRequest(
          result.requestId,
          null,
          null,
          null,
          null
        );
        setStep('confirmation');
      } else {
        // For transfer: go to proof upload step
        setStep('proof');
      }
    } catch (err: any) {
      setError(err.message || 'Error al crear solicitud');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (requestId && step === 'confirmation') {
      onSuccess();
    } else if (requestId && step === 'proof' && paymentMethod === 'transfer' && !proofFile) {
      // Saved as draft, user can retry
      onClose();
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pb-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {scheme === 'comodato' ? 'Reportar Cobro - Comodato' : 'Reportar Cobro - Mayoreo'}
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Alert */}
          {step !== 'confirmation' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                El saldo y tu comisión se actualizarán cuando un administrador confirme que Cat
                Corn recibió el dinero.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-900">{error}</p>
            </div>
          )}

          {/* Step 1: Select Operation */}
          {step === 'select-operation' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selecciona la {scheme === 'comodato' ? 'liquidación' : 'orden'} *
                </label>
                <select
                  value={operationId}
                  onChange={e => setOperationId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                >
                  <option value="">Elige una opción...</option>
                  {availableOperations.map(op => (
                    <option key={op.id} value={op.id}>
                      {getOperationLabel(op)} ({getPendingAmount(op).toLocaleString('es-MX', {
                        style: 'currency',
                        currency: 'MXN',
                      })})
                    </option>
                  ))}
                </select>
                {availableOperations.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">No hay operaciones con saldo pendiente</p>
                )}
              </div>

              <button
                onClick={handleSelectOperation}
                disabled={!operationId || loading}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Continuar
              </button>
            </>
          )}

          {/* Step 2: Payment Details */}
          {step === 'payment-details' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha *</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Monto *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Método *</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value as 'cash' | 'transfer')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                >
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Referencia (opcional)
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="Ej: Folio de recibo"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notas (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>

              {paymentMethod === 'cash' && (
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cashConfirmed}
                    onChange={e => setCashConfirmed(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">
                    Confirmo que el cliente entregó este monto en efectivo *
                  </span>
                </label>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('select-operation')}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-50"
                >
                  Atrás
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    !amount ||
                    (paymentMethod === 'cash' && !cashConfirmed) ||
                    loading
                  }
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {paymentMethod === 'transfer' ? 'Continuar a Comprobante' : 'Enviar Cobro'}
                </button>
              </div>
            </>
          )}

          {/* Step 3: Upload Proof (Transfer only) */}
          {step === 'proof' && paymentMethod === 'transfer' && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  Sube el comprobante de transferencia. Se aceptan: JPEG, PNG, WebP, PDF (máx 10 MB)
                </p>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleProofSelected}
                  disabled={loading}
                  className="hidden"
                  id="proof-upload"
                />
                <label htmlFor="proof-upload" className="cursor-pointer">
                  {proofFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle size={24} className="text-green-600" />
                      <span className="text-sm font-medium text-gray-900">{proofFile.name}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload size={24} className="text-gray-400" />
                      <span className="text-sm text-gray-600">Haz clic para seleccionar</span>
                    </div>
                  )}
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('payment-details')}
                  disabled={loading}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Atrás
                </button>
                <button
                  onClick={handleProofUploadAndSubmit}
                  disabled={!proofFile || loading}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Enviar Cobro
                </button>
              </div>
            </>
          )}

          {/* Step 4: Confirmation */}
          {step === 'confirmation' && (
            <>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
                <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-green-900">Cobro enviado a revisión</p>
                  <p className="text-sm text-green-800 mt-1">
                    Folio: <span className="font-mono font-semibold">{folio}</span>
                  </p>
                  {paymentMethod === 'transfer' && (
                    <p className="text-sm text-green-800 mt-1">Comprobante: Recibido</p>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-600">
                Un administrador revisará tu reporte. El saldo y tu comisión se actualizarán cuando
                confirme el ingreso.
              </p>

              <button
                onClick={handleClose}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700"
              >
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportPaymentModal;
