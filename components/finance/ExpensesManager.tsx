import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../supabase';
import { CreditCard, X, Plus, Edit2, Trash2, AlertCircle, FileDown, Calendar, Lock } from 'lucide-react';
import { ExpenseFormModal } from './ExpenseFormModal.tsx';
import { exportExpensesToExcel } from '../../lib/exportExpenses';
import {
  EXPENSE_CONCEPT_OPTIONS,
  EXPENSE_REPORT_DESTINATION_OPTIONS,
  PAYROLL_REPORT_GROUP,
  filterExpensesByClassification,
  getExpenseBudgetDestination,
  getExpenseCommissionOrigin,
  getExpenseConceptLabel,
  getExpenseConceptGroupLabel,
  getExpenseDestinationLabel,
  sumExpensesOnce,
  type ExpenseConceptCode,
  type ExpenseConceptFilter,
  type ExpenseDestinationScope,
} from '../../lib/expenseClassification.js';
import type { ExpenseLiquidityTreatment, ExpensePaymentInstrument } from '../../lib/availableFunds.js';

interface Expense {
  id: string;
  expense_date: string;
  amount_mxn: number;
  type: 'FIXED' | 'VARIABLE' | 'OTHER';
  vendor: string | null;
  has_invoice: boolean;
  payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  notes: string | null;
  fixed_cost_id: string | null;
  is_unbudgeted_fixed?: boolean;
  fixed_cost_unbudgeted_reason?: string | null;
  commission_settlement_id?: string | null;
  concept_code?: ExpenseConceptCode | null;
  destination_scope?: ExpenseDestinationScope | null;
  commission_origin_scope?: ExpenseDestinationScope | null;
  classification_status?: 'CLASSIFIED' | 'SYSTEM' | null;
  liquidity_treatment?: ExpenseLiquidityTreatment | null;
  payment_instrument?: ExpensePaymentInstrument | null;
  credit_card_id?: string | null;
  liquidity_adjusted?: boolean;
  liquidity_adjustment_reason?: string | null;
  created_at: string;
}

interface ExpensesManagerProps {
  onClose: () => void;
}

// Helper: today as YYYY-MM-DD
const toISO = (d: Date) => d.toISOString().split('T')[0];

// Helper: safely format YYYY-MM-DD string to DD/MM/YYYY without timezone shifts
const formatDateOnly = (dateString: string): string => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}/${year}`;
};

export const ExpensesManager = ({ onClose }: ExpensesManagerProps) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [dateError, setDateError] = useState<string>('');
  const [conceptFilter, setConceptFilter] = useState<ExpenseConceptFilter>('ALL');
  const [destinationFilter, setDestinationFilter] = useState<ExpenseDestinationScope | 'ALL' | 'PENDING'>('ALL');

  // Date range state — default: current month
  const now = new Date();
  const [fromDate, setFromDate] = useState<string>(
    toISO(new Date(now.getFullYear(), now.getMonth(), 1))
  );
  const [toDate, setToDate] = useState<string>(
    toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  );

  const loadExpenses = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError('');
    try {
      if (!supabase) throw new Error('Supabase no configurado');
      const { data, error: dbError } = await supabase
        .from('expenses')
        .select('*')
        .gte('expense_date', from)
        .lte('expense_date', to)
        .order('expense_date', { ascending: false });
      if (dbError) throw dbError;
      const expenseRows = (data || []) as Expense[];
      if (expenseRows.length === 0) {
        setExpenses([]);
        return;
      }
      const { data: adjustmentData, error: adjustmentError } = await supabase
        .from('finance_expense_liquidity_adjustments')
        .select('expense_id,liquidity_treatment,payment_instrument,reason,created_at,id')
        .in('expense_id', expenseRows.map(expense => expense.id))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (adjustmentError) throw adjustmentError;
      const latestByExpense = new Map<string, any>();
      for (const adjustment of adjustmentData || []) {
        if (!latestByExpense.has(adjustment.expense_id)) latestByExpense.set(adjustment.expense_id, adjustment);
      }
      setExpenses(expenseRows.map(expense => {
        const adjustment = latestByExpense.get(expense.id);
        return adjustment ? {
          ...expense,
          liquidity_treatment: adjustment.liquidity_treatment,
          payment_instrument: adjustment.payment_instrument,
          liquidity_adjusted: true,
          liquidity_adjustment_reason: adjustment.reason,
        } : expense;
      }));
    } catch (err: any) {
      console.error('Error loading expenses:', err);
      setError(err.message || 'Error al cargar gastos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExpenses(fromDate, toDate);
  }, [fromDate, toDate, loadExpenses]);

  // Validate and update fromDate
  const handleFromChange = (val: string) => {
    setFromDate(val);
    setDateError(val > toDate ? 'La fecha inicial no puede ser mayor que la fecha final' : '');
  };
  // Validate and update toDate
  const handleToChange = (val: string) => {
    setToDate(val);
    setDateError(fromDate > val ? 'La fecha inicial no puede ser mayor que la fecha final' : '');
  };

  // Quick filters
  const applyQuickFilter = (preset: 'today' | 'last7' | 'month' | 'prevMonth' | 'clear') => {
    const n = new Date();
    setDateError('');
    if (preset === 'today') {
      const t = toISO(n); setFromDate(t); setToDate(t);
    } else if (preset === 'last7') {
      const from = new Date(n); from.setDate(n.getDate() - 6);
      setFromDate(toISO(from)); setToDate(toISO(n));
    } else if (preset === 'month') {
      setFromDate(toISO(new Date(n.getFullYear(), n.getMonth(), 1)));
      setToDate(toISO(new Date(n.getFullYear(), n.getMonth() + 1, 0)));
    } else if (preset === 'prevMonth') {
      setFromDate(toISO(new Date(n.getFullYear(), n.getMonth() - 1, 1)));
      setToDate(toISO(new Date(n.getFullYear(), n.getMonth(), 0)));
    } else {
      setFromDate(''); setToDate('');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
      if (!supabase) throw new Error('Supabase no configurado');
      const { error: dbError } = await supabase.from('expenses').delete().eq('id', id);
      if (dbError) throw dbError;
      await loadExpenses(fromDate, toDate);
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
    loadExpenses(fromDate, toDate);
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

  const getLiquidityLabel = (expense: Expense) => {
    if (expense.liquidity_treatment === 'CREDIT') return 'Compra a crédito';
    if (expense.liquidity_treatment === 'IMMEDIATE') return 'Salida inmediata';
    return 'Liquidez pendiente de clasificar';
  };

  const filteredExpenses = filterExpensesByClassification(expenses, conceptFilter, destinationFilter);
  const totalExpenses = sumExpensesOnce(filteredExpenses);

  const handleExport = () => {
    const rangeLabel = fromDate && toDate ? `${fromDate}_a_${toDate}` : fromDate || toDate || 'rango';
    exportExpensesToExcel(filteredExpenses, rangeLabel);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard size={32} className="text-cc-primary" />
          <div>
            <h2 className="text-3xl font-bold text-cc-cream">Gastos por Periodo</h2>
            <p className="text-cc-text-muted">Total: ${totalExpenses.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={filteredExpenses.length === 0}
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
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>
      </div>

      {/* ── Date range filters ── */}
      <div className="bg-cc-surface border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-cc-text-muted">
          <Calendar size={16} />
          Filtros por fecha
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-cc-text-muted">Desde</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFromChange(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream focus:ring-2 focus:ring-cc-primary/40 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-cc-text-muted">Hasta</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => handleToChange(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream focus:ring-2 focus:ring-cc-primary/40 outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2 pb-0.5">
            {([
              { key: 'today',     label: 'Hoy' },
              { key: 'last7',     label: 'Últimos 7 días' },
              { key: 'month',     label: 'Este mes' },
              { key: 'prevMonth', label: 'Mes anterior' },
              { key: 'clear',     label: 'Limpiar' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => applyQuickFilter(key)}
                className="px-3 py-2 text-xs rounded-lg bg-white/5 border border-white/10 text-cc-text-muted hover:bg-white/10 hover:text-cc-cream transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {dateError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle size={12} /> {dateError}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-white/10">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-cc-text-muted">Concepto</label>
            <select
              value={conceptFilter}
              onChange={(event) => setConceptFilter(event.target.value as ExpenseConceptFilter)}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream"
            >
              <option value="ALL">Todos los conceptos</option>
              <option value="PENDING">Pendientes de clasificar</option>
              <option value={PAYROLL_REPORT_GROUP}>Nómina (fija + comisiones)</option>
              {EXPENSE_CONCEPT_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-cc-text-muted">Destino</label>
            <select
              value={destinationFilter}
              onChange={(event) => setDestinationFilter(event.target.value as ExpenseDestinationScope | 'ALL' | 'PENDING')}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream"
            >
              <option value="ALL">Todos los destinos</option>
              <option value="PENDING">Pendientes de clasificar</option>
              {EXPENSE_REPORT_DESTINATION_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
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
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Conciliación fija</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tipo</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Concepto</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Destino</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Proveedor</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-cc-text-muted">Monto</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Pago</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Factura</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-cc-text-muted">
                      No hay gastos que coincidan con los filtros
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {formatDateOnly(expense.expense_date)}
                      </td>
                      <td className="py-3 px-4 text-xs text-cc-text-muted">
                        {expense.type !== 'FIXED' ? '—' : expense.fixed_cost_id ? 'Vinculado' : expense.is_unbudgeted_fixed ? 'No presupuestado' : 'Sin conciliación'}
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
                        <p>{getExpenseConceptLabel(expense.concept_code)}</p>
                        <p className="text-[11px] text-cc-text-muted">Grupo: {getExpenseConceptGroupLabel(expense.concept_code)}</p>
                      </td>
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        <p>{getExpenseDestinationLabel(getExpenseBudgetDestination(expense))}</p>
                        {expense.concept_code === 'COMMISSIONS' && (
                          <p className="text-[11px] text-cc-text-muted">Origen: {getExpenseDestinationLabel(getExpenseCommissionOrigin(expense))}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {expense.vendor || '-'}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-primary font-semibold">
                        ${Number(expense.amount_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted text-sm">
                        <p>{getPaymentMethodLabel(expense.payment_method)}</p>
                        <p className={`text-[11px] ${expense.liquidity_treatment ? 'text-cc-text-muted' : 'text-amber-300'}`}>
                          {getLiquidityLabel(expense)}
                        </p>
                        {expense.liquidity_adjusted && (
                          <p className="text-[11px] text-cyan-300" title={expense.liquidity_adjustment_reason || undefined}>Ajuste auditado</p>
                        )}
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
                          {expense.commission_settlement_id ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300"
                              title="Gasto automático protegido por su liquidación de comisiones"
                            >
                              <Lock size={13} />
                              Automático
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(expense)}
                                className="p-1 hover:bg-blue-500/20 rounded text-blue-400"
                                aria-label="Editar gasto"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDelete(expense.id)}
                                className="p-1 hover:bg-red-500/20 rounded text-red-400"
                                aria-label="Eliminar gasto"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
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
