import { useState } from 'react';
import { supabase } from '../../supabase';
import { X, Save } from 'lucide-react';

interface Expense {
  id: string;
  expense_date: string;
  amount_mxn: number;
  type: 'FIXED' | 'VARIABLE' | 'OTHER';
  category: string | null;
  vendor: string | null;
  has_invoice: boolean;
  payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  notes: string | null;
  fixed_cost_id: string | null;
}

interface ExpenseFormModalProps {
  expense: Expense | null;
  onClose: () => void;
}

export const ExpenseFormModal = ({ expense, onClose }: ExpenseFormModalProps) => {
  const [formData, setFormData] = useState({
    expense_date: expense?.expense_date || new Date().toISOString().split('T')[0],
    amount_mxn: expense?.amount_mxn || 0,
    type: expense?.type || 'VARIABLE' as const,
    category: expense?.category || '',
    vendor: expense?.vendor || '',
    has_invoice: expense?.has_invoice || false,
    payment_method: expense?.payment_method || 'CASH' as const,
    notes: expense?.notes || '',
    fixed_cost_id: expense?.fixed_cost_id || null
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const payload = {
        ...formData,
        category: formData.category || null,
        vendor: formData.vendor || null,
        notes: formData.notes || null,
      };

      if (expense) {
        // Update
        const { error } = await supabase
          .from('expenses')
          .update(payload)
          .eq('id', expense.id);

        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('expenses')
          .insert([payload]);

        if (error) throw error;
      }

      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar gasto');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-cc-surface rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h3 className="text-2xl font-bold text-cc-cream">
            {expense ? 'Editar Gasto' : 'Nuevo Gasto'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Fecha *
              </label>
              <input
                type="date"
                value={formData.expense_date}
                onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Monto (MXN) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount_mxn}
                onChange={(e) => setFormData({ ...formData, amount_mxn: parseFloat(e.target.value) || 0 })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Tipo *
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="VARIABLE">Variable</option>
                <option value="FIXED">Fijo</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Método de Pago *
              </label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as any })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              >
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Categoría
              </label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                placeholder="Ej: Insumos, Servicios, etc."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Proveedor
              </label>
              <input
                type="text"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                placeholder="Nombre del proveedor"
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.has_invoice}
                  onChange={(e) => setFormData({ ...formData, has_invoice: e.target.checked })}
                  className="w-4 h-4 rounded border-white/10 bg-black/20 text-cc-primary focus:ring-2 focus:ring-cc-primary"
                />
                <span className="text-sm text-cc-text-muted">¿Tiene factura?</span>
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Notas
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                rows={3}
                placeholder="Información adicional..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-cc-text-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium disabled:opacity-50"
            >
              <Save size={20} />
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
