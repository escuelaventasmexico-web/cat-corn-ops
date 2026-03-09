import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AlertCircle, Trash2, TrendingDown, Calendar, DollarSign } from 'lucide-react';

interface WasteEvent {
  id: string;
  type: string;
  flavor: string | null;
  quantity: number;
  unit: string;
  reason: string;
  notes: string | null;
  estimated_cost_mxn: number;
  created_at: string;
  batch_id: string | null;
}

export const Waste = () => {
  const [loading, setLoading] = useState(false);
  const [historialLoading, setHistorialLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form states
  const [type, setType] = useState<string>('PRODUCT');
  const [flavor, setFlavor] = useState<string>('SALADA');
  const [quantity, setQuantity] = useState<string>('');
  const [unit, setUnit] = useState<string>('g');
  const [reason, setReason] = useState<string>('quemado');
  const [notes, setNotes] = useState<string>('');

  // Data states
  const [wasteEvents, setWasteEvents] = useState<WasteEvent[]>([]);
  const [todayTotal, setTodayTotal] = useState<number>(0);
  const [monthTotal, setMonthTotal] = useState<number>(0);

  useEffect(() => {
    loadWasteData();
  }, []);

  const loadWasteData = async () => {
    if (!supabase) return;
    
    setHistorialLoading(true);
    try {
      // Fetch waste events
      const { data: events, error } = await supabase
        .from('waste_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setWasteEvents(events || []);

      // Calculate today's total
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const todayEvents = (events || []).filter(e => {
        const eventDate = new Date(e.created_at);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate.toISOString() === todayISO;
      });
      const todaySum = todayEvents.reduce((sum, e) => sum + (e.estimated_cost_mxn || 0), 0);
      setTodayTotal(todaySum);

      // Calculate month's total
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEvents = (events || []).filter(e => {
        const eventDate = new Date(e.created_at);
        return eventDate >= firstDayOfMonth;
      });
      const monthSum = monthEvents.reduce((sum, e) => sum + (e.estimated_cost_mxn || 0), 0);
      setMonthTotal(monthSum);

    } catch (error: any) {
      setErrorMessage('Error al cargar datos: ' + error.message);
    } finally {
      setHistorialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!supabase) {
      setErrorMessage('Supabase no está configurado');
      return;
    }

    if (!quantity || parseFloat(quantity) <= 0) {
      setErrorMessage('La cantidad debe ser mayor a 0');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { data, error } = await supabase.rpc('create_waste_event', {
        p_type: type,
        p_flavor: type === 'PRODUCT' ? flavor : null,
        p_quantity: parseFloat(quantity),
        p_unit: type === 'PRODUCT' ? 'g' : unit,
        p_reason: reason,
        p_notes: notes || null,
        p_batch_id: null
      });

      if (error) throw error;

      const costMxn = data?.estimated_cost_mxn || 0;
      setSuccessMessage(`Merma registrada: $${costMxn.toFixed(2)} MXN`);
      
      // Reset form
      setQuantity('');
      setNotes('');
      
      // Reload data
      await loadWasteData();

    } catch (error: any) {
      setErrorMessage('Error al registrar merma: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'PRODUCT':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-[#b08d57]/20 text-[#b08d57] text-xs font-bold border border-[#b08d57]/30">
            PRODUCTO
          </span>
        );
      case 'PACKAGING':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold border border-blue-500/30">
            EMPAQUE
          </span>
        );
      case 'RAW_MATERIAL':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-500/20 text-gray-400 text-xs font-bold border border-gray-500/30">
            INSUMO
          </span>
        );
      default:
        return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Trash2 size={32} className="text-[#b08d57]" />
        <h2 className="text-2xl font-bold text-[#f4c542]">Módulo de Merma</h2>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-green-400 font-medium">Éxito</p>
            <p className="text-green-300/80 text-sm">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error</p>
            <p className="text-red-300/80 text-sm">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Calendar size={24} className="text-[#b08d57]" />
            <h3 className="text-lg font-semibold text-zinc-300">Merma Hoy</h3>
          </div>
          <p className="text-3xl font-bold text-[#f4c542]">${todayTotal.toFixed(2)} MXN</p>
        </div>

        <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <TrendingDown size={24} className="text-[#b08d57]" />
            <h3 className="text-lg font-semibold text-zinc-300">Merma Este Mes</h3>
          </div>
          <p className="text-3xl font-bold text-[#f4c542]">${monthTotal.toFixed(2)} MXN</p>
        </div>
      </div>

      {/* Form Section */}
      <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6">
        <h3 className="text-lg font-semibold text-[#f4c542] mb-4 flex items-center gap-2">
          <DollarSign size={20} />
          Registrar Merma
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Select */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Tipo
            </label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                if (e.target.value === 'PRODUCT') {
                  setUnit('g');
                } else {
                  setUnit('pzas');
                }
              }}
              className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
            >
              <option value="PRODUCT">Producto</option>
              <option value="PACKAGING">Empaque</option>
              <option value="RAW_MATERIAL">Insumo</option>
            </select>
          </div>

          {/* Conditional: Flavor (only for PRODUCT) */}
          {type === 'PRODUCT' && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Sabor
              </label>
              <select
                value={flavor}
                onChange={(e) => setFlavor(e.target.value)}
                className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
              >
                <option value="SALADA">Salada</option>
                <option value="CARAMELO">Caramelo</option>
              </select>
            </div>
          )}

          {/* Conditional: Unit (only for non-PRODUCT) */}
          {type !== 'PRODUCT' && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Unidad
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                placeholder="Ej: pzas, ml, kg"
              />
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Cantidad {type === 'PRODUCT' && '(gramos)'}
            </label>
            <input
              type="number"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
              placeholder="0"
              required
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
            >
              <option value="quemado">Quemado</option>
              <option value="sobrante">Sobrante</option>
              <option value="caducado">Caducado</option>
              <option value="defecto">Defecto</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Notas (Opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none resize-none"
              placeholder="Detalles adicionales..."
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-[#b08d57] hover:bg-[#c49d67] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-semibold transition-colors shadow-lg flex items-center justify-center gap-2"
          >
            {loading ? 'Guardando...' : (
              <>
                <Trash2 size={18} />
                Guardar Merma
              </>
            )}
          </button>
        </form>
      </div>

      {/* History Section */}
      <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl overflow-hidden">
        <div className="bg-black/40 px-6 py-4 border-b border-[#b08d57]/30">
          <h3 className="text-lg font-semibold text-[#f4c542]">Historial de Merma</h3>
        </div>

        {historialLoading ? (
          <div className="p-8 text-center text-zinc-400">Cargando historial...</div>
        ) : wasteEvents.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">No hay registros de merma</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-black/40 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Tipo</th>
                  <th className="p-4">Sabor</th>
                  <th className="p-4">Cantidad</th>
                  <th className="p-4">Motivo</th>
                  <th className="p-4">Costo Estimado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#b08d57]/20">
                {wasteEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-black/20 transition-colors">
                    <td className="p-4 text-zinc-300 text-sm">
                      {formatDateTime(event.created_at)}
                    </td>
                    <td className="p-4">
                      {getTypeBadge(event.type)}
                    </td>
                    <td className="p-4 text-zinc-300">
                      {event.flavor || '-'}
                    </td>
                    <td className="p-4 text-white font-semibold">
                      {event.quantity} {event.unit}
                    </td>
                    <td className="p-4 text-zinc-400 capitalize">
                      {event.reason}
                    </td>
                    <td className="p-4 text-[#f4c542] font-bold">
                      ${event.estimated_cost_mxn.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
