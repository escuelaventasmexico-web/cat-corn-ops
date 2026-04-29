import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { CreditCard, X, Plus, Edit2, Trash2, AlertCircle, FileDown } from 'lucide-react';
import { ExpenseFormModal } from './ExpenseFormModal.tsx';
import { exportExpensesToExcel } from '../../lib/exportExpenses';

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
  created_at: string;
}

interface ExpensesManagerProps {
  onClose: () => void;
}

export const ExpensesManager = ({ onClose }: ExpensesManagerProps) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data, error: dbError } = await supabase
        .from('expenses')
        .select('*')
        .gte('expense_date', monthStart.toISOString().split('T')[0])
        .lte('expense_date', monthEnd.toISOString().split('T')[0])
        .order('expense_date', { ascending: false });

      if (dbError) throw dbError;

      setExpenses(data || []);
    } catch (err: any) {
      console.error('Error loading expenses:', err);
      setError(err.message || 'Error al cargar gastos');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este gasto?')) return;

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const { error: dbError } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      await loadExpenses();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar gasto');
    }
  };

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingExpense(null);
    loadExpenses();
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      FIXED: 'Fijo',
      VARIABLE: 'Variable',
      OTHER: 'Otro'
    };
    return labels[type] || type;
  };

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      CASH: 'Efectivo',
      CARD: 'Tarjeta',
      TRANSFER: 'Transferencia',
      OTHER: 'Otro'
    };
    return labels[method] || method;
  };

  const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.amount_mxn), 0);

  const handleExport = () => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    exportExpensesToExcel(expenses, yearMonth);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard size={32} className="text-cc-primary" />
          <div>
            <h2 className="text-3xl font-bold text-cc-cream">Gastos del Mes</h2>
            <p className="text-cc-text-muted">Total: ${totalExpenses.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={expenses.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileDown size={18} />
            Exportar Excel
          </button>
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium"
          >
            <Plus size={20} />
            Nuevo Gasto
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error</p>
            <p className="text-red-300/80 text-sm">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-cc-surface p-12 rounded-xl border border-white/5 text-center text-cc-text-muted">
          Cargando gastos...
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-black/20">
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Fecha</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tipo</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Categoría</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Proveedor</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-cc-text-muted">Monto</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Pago</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Factura</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-cc-text-muted">
                      No hay gastos registrados este mes
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {new Date(expense.expense_date).toLocaleDateString('es-MX')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-1 rounded ${
                          expense.type === 'FIXED' ? 'bg-orange-500/20 text-orange-400' :
                          expense.type === 'VARIABLE' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {getTypeLabel(expense.type)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {expense.category || '-'}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {expense.vendor || '-'}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-primary font-semibold">
                        ${Number(expense.amount_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted text-sm">
                        {getPaymentMethodLabel(expense.payment_method)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {expense.has_invoice ? (
                          <span className="text-green-400">✓</span>
                        ) : (
                          <span className="text-red-400">✗</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEdit(expense)}
                            className="p-1 hover:bg-blue-500/20 rounded text-blue-400"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(expense.id)}
                            className="p-1 hover:bg-red-500/20 rounded text-red-400"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isFormOpen && (
        <ExpenseFormModal
          expense={editingExpense}
          onClose={handleFormClose}
        />
      )}
    </div>
  );
};
