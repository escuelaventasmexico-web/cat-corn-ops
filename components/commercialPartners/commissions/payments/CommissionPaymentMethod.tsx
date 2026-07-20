/* ── Commission Payment Method ───────────────────────────────────────── */

import React, { useState } from 'react';
import { CommissionProofUploader } from './CommissionProofUploader';
import { FileText, DollarSign } from 'lucide-react';

type PaymentMethod = 'transfer' | 'cash';

interface CommissionPaymentMethodProps {
  totalAmount: number;
  onSubmit: (method: PaymentMethod, details: PaymentMethodDetails) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export interface PaymentMethodDetails {
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  proofFile?: File;
  cashConfirmed?: boolean;
}

export const CommissionPaymentMethod: React.FC<CommissionPaymentMethodProps> = ({
  totalAmount,
  onSubmit,
  onCancel,
  loading = false,
}) => {
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);

    try {
      // Validate inputs
      if (method === 'transfer') {
        if (!reference.trim()) {
          setError('Ingresa la referencia de transferencia');
          setSubmitting(false);
          return;
        }
        if (!proofFile) {
          setError('Sube el comprobante de transferencia');
          setSubmitting(false);
          return;
        }
      }

      if (method === 'cash') {
        if (!cashConfirmed) {
          setError('Confirma que el efectivo fue entregado');
          setSubmitting(false);
          return;
        }
      }

      const details: PaymentMethodDetails = {
        method,
        reference: method === 'transfer' ? reference : undefined,
        notes: notes || undefined,
        proofFile: method === 'transfer' ? proofFile || undefined : undefined,
        cashConfirmed: method === 'cash' ? cashConfirmed : undefined,
      };

      await onSubmit(method, details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar pago');
      setSubmitting(false);
    }
  };

  const isValid =
    method === 'transfer'
      ? reference.trim() && proofFile
      : method === 'cash'
        ? cashConfirmed
        : false;

  return (
    <div className="space-y-6">
      {/* Method Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-neutral-300">Método de pago</label>

        <div className="space-y-2">
          {/* Transfer Option */}
          <label
            className={`
              flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer
              transition-all duration-200
              ${
                method === 'transfer'
                  ? 'border-yellow-500 bg-yellow-500/5'
                  : 'border-neutral-700 bg-neutral-950 hover:border-neutral-600'
              }
            `}
          >
            <input
              type="radio"
              name="payment_method"
              value="transfer"
              checked={method === 'transfer'}
              onChange={(e) => {
                setMethod(e.target.value as PaymentMethod);
                setError('');
              }}
              disabled={loading || submitting}
              className="mt-1"
            />
            <div className="flex-1">
              <p className="font-medium text-neutral-200 flex items-center gap-2">
                <FileText size={16} />
                Transferencia bancaria
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Requiere comprobante (imagen o PDF)
              </p>
            </div>
          </label>

          {/* Cash Option */}
          <label
            className={`
              flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer
              transition-all duration-200
              ${
                method === 'cash'
                  ? 'border-yellow-500 bg-yellow-500/5'
                  : 'border-neutral-700 bg-neutral-950 hover:border-neutral-600'
              }
            `}
          >
            <input
              type="radio"
              name="payment_method"
              value="cash"
              checked={method === 'cash'}
              onChange={(e) => {
                setMethod(e.target.value as PaymentMethod);
                setError('');
              }}
              disabled={loading || submitting}
              className="mt-1"
            />
            <div className="flex-1">
              <p className="font-medium text-neutral-200 flex items-center gap-2">
                <DollarSign size={16} />
                Efectivo
              </p>
              <p className="text-xs text-neutral-500 mt-1">Solo requiere confirmación</p>
            </div>
          </label>
        </div>
      </div>

      {/* Transfer Details */}
      {method === 'transfer' && (
        <div className="space-y-4 p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          {/* Reference Input */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Referencia de transferencia
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej: 001234567"
              disabled={loading || submitting}
              className="
                w-full px-3 py-2 bg-neutral-800 border border-neutral-700
                rounded-lg text-neutral-200 placeholder-neutral-600
                focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/20
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            />
          </div>

          {/* Notes Input */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Notas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Agrega detalles adicionales..."
              rows={2}
              disabled={loading || submitting}
              className="
                w-full px-3 py-2 bg-neutral-800 border border-neutral-700
                rounded-lg text-neutral-200 placeholder-neutral-600
                focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/20
                disabled:opacity-50 disabled:cursor-not-allowed
                resize-none
              "
            />
          </div>

          {/* File Uploader */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Comprobante de transferencia
            </label>
            <CommissionProofUploader
              onFileSelected={setProofFile}
              disabled={loading || submitting}
              maxSizeMB={10}
            />
          </div>
        </div>
      )}

      {/* Cash Confirmation */}
      {method === 'cash' && (
        <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={cashConfirmed}
              onChange={(e) => setCashConfirmed(e.target.checked)}
              disabled={loading || submitting}
              className="mt-1"
            />
            <span className="text-sm text-neutral-300">
              Confirmo que el efectivo fue entregado al vendedor en la cantidad de{' '}
              <span className="font-semibold text-yellow-400">${totalAmount.toLocaleString('es-MX', { maximumFractionDigits: 2 })}</span>
            </span>
          </label>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end pt-4 border-t border-neutral-800">
        <button
          onClick={onCancel}
          disabled={loading || submitting}
          className="
            px-4 py-2 rounded-lg text-neutral-300
            bg-neutral-900 border border-neutral-700
            hover:bg-neutral-800 hover:border-neutral-600
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={!isValid || loading || submitting}
          className="
            px-6 py-2 rounded-lg font-medium
            bg-yellow-500 text-black
            hover:bg-yellow-400
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {submitting ? 'Procesando...' : `Confirmar pago $${totalAmount.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`}
        </button>
      </div>
    </div>
  );
};
