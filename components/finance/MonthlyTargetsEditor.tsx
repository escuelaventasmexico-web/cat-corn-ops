import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { Target, X, Save, AlertCircle } from 'lucide-react';

interface MonthlyTarget {
  id: string;
  month_start: string;
  sales_target_mxn: number;
  notes: string | null;
}

interface MonthlyTargetsEditorProps {
  onClose: () => void;
}

export const MonthlyTargetsEditor = ({ onClose }: MonthlyTargetsEditorProps) => {
  const [targets, setTargets] = useState<MonthlyTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    month_start: currentMonth,
    sales_target_mxn: 0,
    notes: ''
  });

  useEffect(() => {
    loadTargets();
  }, []);

  const loadTargets = async () => {
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const { data, error: dbError } = await supabase
        .from('monthly_targets')
        .select('*')
        .order('month_start', { ascending: false })
        .limit(12);

      if (dbError) throw dbError;

      setTargets(data || []);

      // Check if current month exists
      const currentExists = data?.find(t => t.month_start === currentMonth);
      if (currentExists) {
        setFormData({
          month_start: currentExists.month_start,
          sales_target_mxn: currentExists.sales_target_mxn,
          notes: currentExists.notes || ''
        });
      }
    } catch (err: any) {
      console.error('Error loading targets:', err);
      setError(err.message || 'Error al cargar metas');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const payload = {
        month_start: formData.month_start,
        sales_target_mxn: formData.sales_target_mxn,
        notes: formData.notes || null,
      };

      // Check if already exists
      const existing = targets.find(t => t.month_start === formData.month_start);

      if (existing) {
        const { error } = await supabase
          .from('monthly_targets')
          .update(payload)
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('monthly_targets')
          .insert([payload]);

        if (error) throw error;
      }

      await loadTargets();
      alert('Meta guardada exitosamente');
    } catch (err: any) {
      alert(err.message || 'Error al guardar meta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target size={32} className="text-cc-primary" />
          <h2 className="text-3xl font-bold text-cc-cream">Meta Mensual de Ventas</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-cc-text-muted" />
        </button>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
          <h3 className="text-lg font-bold text-cc-cream mb-4">Configurar Meta</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Mes *
              </label>
              <input
                type="month"
                value={formData.month_start.substring(0, 7)}
                onChange={(e) => setFormData({ ...formData, month_start: e.target.value + '-01' })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Meta de Ventas (MXN) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.sales_target_mxn}
                onChange={(e) => setFormData({ ...formData, sales_target_mxn: parseFloat(e.target.value) || 0 })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-cc-text-muted mb-2">
                Notas
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
                rows={3}
                placeholder="Objetivos, estrategias, etc."
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium disabled:opacity-50"
            >
              <Save size={20} />
              {saving ? 'Guardando...' : 'Guardar Meta'}
            </button>
          </form>
        </div>

        {/* Historical Targets */}
        <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
          <h3 className="text-lg font-bold text-cc-cream mb-4">Histórico de Metas</h3>
          {loading ? (
            <div className="text-center text-cc-text-muted py-8">Cargando...</div>
          ) : targets.length === 0 ? (
            <div className="text-center text-cc-text-muted py-8">No hay metas configuradas</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {targets.map((target) => (
                <div key={target.id} className="p-4 bg-black/20 rounded-lg border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-cc-text-muted">
                      {new Date(target.month_start).toLocaleDateString('es-MX', { year: 'numeric', month: 'long' })}
                    </span>
                    <span className="text-lg font-bold text-cc-primary">
                      ${target.sales_target_mxn.toLocaleString('es-MX')}
                    </span>
                  </div>
                  {target.notes && (
                    <p className="text-xs text-cc-text-muted">{target.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
