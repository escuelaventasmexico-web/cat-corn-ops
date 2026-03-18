import { useState } from 'react';
import { supabase } from '../../supabase';
import { X, Save } from 'lucide-react';

interface FixedCost {
  id: string;
  name: string;
  amount_mxn: number;
  active: boolean;
  notes: string | null;
}

interface FixedCostFormModalProps {
  fixedCost: FixedCost | null;
  onClose: () => void;
}

export const FixedCostFormModal = ({ fixedCost, onClose }: FixedCostFormModalProps) => {
  const [formData, setFormData] = useState({
    name: fixedCost?.name || '',
    amount_mxn: fixedCost?.amount_mxn || 0,
    active: fixedCost?.active ?? true,
    notes: fixedCost?.notes || ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const payload = {
        ...formData,
        notes: formData.notes || null,
      };

      if (fixedCost) {
        const { error } = await supabase
          .from('fixed_costs')
          .update(payload)
          .eq('id', fixedCost.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('fixed_costs')
          .insert([payload]);

        if (error) throw error;
      }

      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar gasto fijo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2A2A2A] rounded-2xl border border-white/10 max-w-lg w-full overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#242424]">
          <h3 className="text-2xl font-bold text-cc-cream">
            {fixedCost ? 'Editar Gasto Fijo' : 'Nuevo Gasto Fijo'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">Nombre *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              placeholder="Ej: Renta, Luz, Internet..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">Monto (MXN) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.amount_mxn}
              onChange={(e) => setFormData({ ...formData, amount_mxn: parseFloat(e.target.value) || 0 })}
              className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              required
            />
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="w-4 h-4 rounded border-white/10 bg-[#1C1A1A] text-cc-primary focus:ring-2 focus:ring-cc-primary"
              />
              <span className="text-sm text-cc-text-muted">Activo</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">Notas</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              rows={3}
              placeholder="Información adicional..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#363636] hover:bg-[#404040] border border-white/10 rounded-lg text-cc-text-muted transition-colors"
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
