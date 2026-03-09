import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { Receipt, X, Plus, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { FixedCostFormModal } from './FixedCostFormModal.tsx';

interface FixedCost {
  id: string;
  name: string;
  amount_mxn: number;
  active: boolean;
  notes: string | null;
  created_at: string;
}

interface FixedCostsManagerProps {
  onClose: () => void;
}

export const FixedCostsManager = ({ onClose }: FixedCostsManagerProps) => {
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<FixedCost | null>(null);

  useEffect(() => {
    loadFixedCosts();
  }, []);

  const loadFixedCosts = async () => {
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const { data, error: dbError } = await supabase
        .from('fixed_costs')
        .select('*')
        .order('name');

      if (dbError) throw dbError;

      setFixedCosts(data || []);
    } catch (err: any) {
      console.error('Error loading fixed costs:', err);
      setError(err.message || 'Error al cargar gastos fijos');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este gasto fijo?')) return;

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const { error: dbError } = await supabase
        .from('fixed_costs')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      await loadFixedCosts();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar gasto fijo');
    }
  };

  const handleEdit = (cost: FixedCost) => {
    setEditingCost(cost);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingCost(null);
    loadFixedCosts();
  };

  const totalActive = fixedCosts
    .filter(c => c.active)
    .reduce((sum, c) => sum + Number(c.amount_mxn), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Receipt size={32} className="text-cc-primary" />
          <div>
            <h2 className="text-3xl font-bold text-cc-cream">Gastos Fijos</h2>
            <p className="text-cc-text-muted">Total Activos: ${totalActive.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium"
          >
            <Plus size={20} />
            Nuevo Gasto Fijo
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
          Cargando gastos fijos...
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-black/20">
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Nombre</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-cc-text-muted">Monto</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Estado</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Notas</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-cc-text-muted">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {fixedCosts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-cc-text-muted">
                      No hay gastos fijos configurados
                    </td>
                  </tr>
                ) : (
                  fixedCosts.map((cost) => (
                    <tr key={cost.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main font-medium">
                        {cost.name}
                      </td>
                      <td className="py-3 px-4 text-right text-cc-primary font-semibold">
                        ${Number(cost.amount_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {cost.active ? (
                          <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded">Activo</span>
                        ) : (
                          <span className="text-xs px-2 py-1 bg-gray-500/20 text-gray-400 rounded">Inactivo</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted text-sm">
                        {cost.notes || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEdit(cost)}
                            className="p-1 hover:bg-blue-500/20 rounded text-blue-400"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(cost.id)}
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
        <FixedCostFormModal
          fixedCost={editingCost}
          onClose={handleFormClose}
        />
      )}
    </div>
  );
};
