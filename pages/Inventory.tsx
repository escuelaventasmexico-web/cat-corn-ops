import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AlertCircle, Plus, Edit2, Minus, X, RefreshCw } from 'lucide-react';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  minimum_stock: number;
  current_stock: number;
  category?: 'Ingrediente' | 'Empaque';
  created_at: string;
  updated_at: string;
}

type ModalMode = 'add' | 'edit' | 'adjust' | null;

// Recetario hardcodeado: consumo por tanda
const RECIPES: Record<string, Record<string, number>> = {
  SALADA_12OZ: {
    'Aceite': 90,           // ml
    'Maíz palomero': 340,   // g
    'Flavacol': 15          // g
  },
  CARAMELO_8OZ: {
    'Aceite': 60,           // ml
    'Maíz palomero': 227,   // g
    'Glaze caramelo': 113   // g
  }
};

// Calcular el requerimiento por tanda (worst-case)
const getRequiredPerBatch = (ingredientName: string): number | null => {
  const requirements: number[] = [];
  
  Object.values(RECIPES).forEach(recipe => {
    if (recipe[ingredientName] !== undefined) {
      requirements.push(recipe[ingredientName]);
    }
  });
  
  if (requirements.length === 0) return null;
  return Math.max(...requirements);
};

export const Inventory = () => {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Form states
  const [formName, setFormName] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formMinStock, setFormMinStock] = useState('');
  const [formCurrentStock, setFormCurrentStock] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');

  useEffect(() => {
    fetchMaterials();
  }, []);

  const fetchMaterials = async () => {
    if (!supabase) return;
    setLoading(true);
    setErrorMessage('');
    const { data, error } = await supabase
      .from('raw_materials')
      .select('*')
      .order('name');
    
    if (error) {
      setErrorMessage('Error al cargar insumos: ' + error.message);
    } else {
      setMaterials(data || []);
    }
    setLoading(false);
  };

  const openAddModal = () => {
    setModalMode('add');
    setFormName('');
    setFormUnit('');
    setFormMinStock('');
    setFormCurrentStock('');
    setErrorMessage('');
  };

  const openEditModal = (material: RawMaterial) => {
    setModalMode('edit');
    setSelectedMaterial(material);
    setFormName(material.name);
    setFormUnit(material.unit);
    setFormMinStock(material.minimum_stock.toString());
    setFormCurrentStock(material.current_stock.toString());
    setErrorMessage('');
  };

  const openAdjustModal = (material: RawMaterial) => {
    setModalMode('adjust');
    setSelectedMaterial(material);
    setAdjustAmount('');
    setErrorMessage('');
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedMaterial(null);
    setErrorMessage('');
  };

  const handleAddMaterial = async () => {
    if (!formName || !formUnit || !formMinStock || !formCurrentStock) {
      setErrorMessage('Todos los campos son requeridos');
      return;
    }

    const { error } = await supabase!
      .from('raw_materials')
      .insert({
        name: formName,
        unit: formUnit,
        minimum_stock: parseFloat(formMinStock),
        current_stock: parseFloat(formCurrentStock)
      });

    if (error) {
      setErrorMessage('Error al crear insumo: ' + error.message);
    } else {
      closeModal();
      fetchMaterials();
    }
  };

  const handleEditMaterial = async () => {
    if (!selectedMaterial || !formUnit || !formMinStock) {
      setErrorMessage('Unidad y stock mínimo son requeridos');
      return;
    }

    const { error } = await supabase!
      .from('raw_materials')
      .update({
        unit: formUnit,
        minimum_stock: parseFloat(formMinStock),
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedMaterial.id);

    if (error) {
      setErrorMessage('Error al actualizar insumo: ' + error.message);
    } else {
      closeModal();
      fetchMaterials();
    }
  };

  const handleAdjustStock = async (operation: 'add' | 'subtract') => {
    if (!selectedMaterial || !adjustAmount) {
      setErrorMessage('Ingrese una cantidad');
      return;
    }

    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Cantidad inválida');
      return;
    }

    const newStock = operation === 'add' 
      ? selectedMaterial.current_stock + amount
      : selectedMaterial.current_stock - amount;

    if (newStock < 0) {
      setErrorMessage('El stock no puede ser negativo');
      return;
    }

    const { error } = await supabase!
      .from('raw_materials')
      .update({
        current_stock: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedMaterial.id);

    if (error) {
      setErrorMessage('Error al ajustar stock: ' + error.message);
    } else {
      closeModal();
      fetchMaterials();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-cc-cream">Inventario de Insumos</h2>
        <div className="flex gap-2">
          <button
            onClick={fetchMaterials}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-cc-text-main flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={16} />
            Actualizar
          </button>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-cc-accent hover:bg-cc-accent/90 rounded-lg text-sm text-white font-semibold flex items-center gap-2 transition-colors"
          >
            <Plus size={16} />
            Agregar Insumo
          </button>
        </div>
      </div>

      {/* Critical Alert Banner */}
      {!loading && materials.some(m => Number(m.current_stock ?? 0) <= 0) && (
        <div className="bg-red-500/20 border-2 border-red-500/50 rounded-xl p-6 flex items-center gap-4 animate-pulse">
          <AlertCircle size={32} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 font-bold text-lg">
            ¿Cómo vas a vender pedazo de arena de gato, si no tienes insumo? PÍDELO YAAA
          </p>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && !modalMode && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error</p>
            <p className="text-red-300/80 text-sm">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Ingredientes Section */}
      <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
        <div className="bg-black/30 px-6 py-4 border-b border-white/5">
          <h3 className="text-lg font-semibold text-cc-cream">Ingredientes</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-cc-text-muted">Cargando...</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-black/20 text-cc-text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="p-4">Nombre</th>
                <th className="p-4">Unidad</th>
                <th className="p-4">Stock Mínimo</th>
                <th className="p-4">Stock Actual</th>
                <th className="p-4">Estado</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {materials.filter(m => (m.category || 'Ingrediente') === 'Ingrediente').length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-cc-text-muted">
                    No hay ingredientes registrados
                  </td>
                </tr>
              ) : (
                materials.filter(m => (m.category || 'Ingrediente') === 'Ingrediente').map((material) => {
                  const cur = Number(material.current_stock ?? 0);
                  const required_per_batch = getRequiredPerBatch(material.name);
                  const tandas = required_per_batch && required_per_batch > 0 ? cur / required_per_batch : null;

                  let status = "SIN REGLA";

                  if (cur <= 0) {
                    status = "SIN INSUMO";
                  } else if (tandas !== null && tandas < 0.5) {
                    status = "INSUMO BAJO";
                  } else if (tandas !== null && tandas < 3) {
                    status = "INSUMO BAJANDO";
                  } else if (tandas !== null && tandas >= 3) {
                    status = "EN CAPACIDAD";
                  }

                  return (
                    <tr key={material.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-medium text-cc-text-main">{material.name}</td>
                      <td className="p-4 text-cc-text-muted">{material.unit}</td>
                      <td className="p-4 text-cc-text-muted">{material.minimum_stock}</td>
                      <td className="p-4 font-bold text-lg text-cc-text-main">
                        {material.current_stock.toFixed(2)}
                      </td>
                      <td className="p-4">
                        {status === 'SIN INSUMO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/30 text-red-300 text-xs font-bold border border-red-600/50">
                            <AlertCircle size={12} /> SIN INSUMO
                          </span>
                        ) : status === 'INSUMO BAJO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/30">
                            <AlertCircle size={12} /> INSUMO BAJO
                          </span>
                        ) : status === 'INSUMO BAJANDO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold border border-yellow-500/30">
                            INSUMO BAJANDO
                          </span>
                        ) : status === 'EN CAPACIDAD' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30">
                            EN CAPACIDAD
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-500/20 text-gray-400 text-xs font-bold border border-gray-500/30">
                            SIN REGLA
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(material)}
                            className="p-2 hover:bg-white/10 rounded-lg text-cc-primary transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => openAdjustModal(material)}
                            className="px-3 py-1 bg-cc-accent/20 hover:bg-cc-accent/30 rounded-lg text-cc-accent text-sm font-medium transition-colors"
                            title="Ajustar stock"
                          >
                            +/−
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Empaques Section */}
      <div className="bg-cc-surface rounded-xl border border-white/5 overflow-hidden">
        <div className="bg-black/30 px-6 py-4 border-b border-white/5">
          <h3 className="text-lg font-semibold text-cc-cream">Empaques</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-cc-text-muted">Cargando...</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-black/20 text-cc-text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="p-4">Nombre</th>
                <th className="p-4">Unidad</th>
                <th className="p-4">Stock Mínimo</th>
                <th className="p-4">Stock Actual</th>
                <th className="p-4">Estado</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {materials.filter(m => m.category === 'Empaque').length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-cc-text-muted">
                    No hay empaques registrados
                  </td>
                </tr>
              ) : (
                materials.filter(m => m.category === 'Empaque').map((material) => {
                  const cur = Number(material.current_stock ?? 0);
                  const required_per_batch = getRequiredPerBatch(material.name);
                  const tandas = required_per_batch && required_per_batch > 0 ? cur / required_per_batch : null;

                  let status = "SIN REGLA";

                  if (cur <= 0) {
                    status = "SIN INSUMO";
                  } else if (tandas !== null && tandas < 0.5) {
                    status = "INSUMO BAJO";
                  } else if (tandas !== null && tandas < 3) {
                    status = "INSUMO BAJANDO";
                  } else if (tandas !== null && tandas >= 3) {
                    status = "EN CAPACIDAD";
                  }

                  return (
                    <tr key={material.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-medium text-cc-text-main">{material.name}</td>
                      <td className="p-4 text-cc-text-muted">{material.unit}</td>
                      <td className="p-4 text-cc-text-muted">{material.minimum_stock}</td>
                      <td className="p-4 font-bold text-lg text-cc-text-main">
                        {material.current_stock.toFixed(2)}
                      </td>
                      <td className="p-4">
                        {status === 'SIN INSUMO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/30 text-red-300 text-xs font-bold border border-red-600/50">
                            <AlertCircle size={12} /> SIN INSUMO
                          </span>
                        ) : status === 'INSUMO BAJO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/30">
                            <AlertCircle size={12} /> INSUMO BAJO
                          </span>
                        ) : status === 'INSUMO BAJANDO' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold border border-yellow-500/30">
                            INSUMO BAJANDO
                          </span>
                        ) : status === 'EN CAPACIDAD' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30">
                            EN CAPACIDAD
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-500/20 text-gray-400 text-xs font-bold border border-gray-500/30">
                            SIN REGLA
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(material)}
                            className="p-2 hover:bg-white/10 rounded-lg text-cc-primary transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => openAdjustModal(material)}
                            className="px-3 py-1 bg-cc-accent/20 hover:bg-cc-accent/30 rounded-lg text-cc-accent text-sm font-medium transition-colors"
                            title="Ajustar stock"
                          >
                            +/−
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-[#2a2316] to-[#1f1a12] border-2 border-[#b08d57] rounded-xl p-6 max-w-md w-full shadow-2xl shadow-black/50">
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-[#f4c542]">
                {modalMode === 'add' && 'Agregar Insumo'}
                {modalMode === 'edit' && 'Editar Insumo'}
                {modalMode === 'adjust' && 'Ajustar Stock'}
              </h3>
              <button
                onClick={closeModal}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-4">
              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{errorMessage}</p>
                </div>
              )}

              {modalMode === 'add' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Nombre
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                      placeholder="Ej: Maíz Premium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Unidad
                    </label>
                    <input
                      type="text"
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                      placeholder="Ej: kg, litros, piezas"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Stock Mínimo
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formMinStock}
                      onChange={(e) => setFormMinStock(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Stock Actual
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formCurrentStock}
                      onChange={(e) => setFormCurrentStock(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                      placeholder="0"
                    />
                  </div>
                  <button
                    onClick={handleAddMaterial}
                    className="w-full px-4 py-2 bg-[#b08d57] hover:bg-[#c49d67] rounded-lg text-white font-semibold transition-colors shadow-lg"
                  >
                    Agregar
                  </button>
                </>
              )}

              {modalMode === 'edit' && selectedMaterial && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Nombre
                    </label>
                    <input
                      type="text"
                      value={formName}
                      disabled
                      className="w-full bg-black/60 border border-[#b08d57]/20 rounded-lg px-4 py-2 text-zinc-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Unidad
                    </label>
                    <input
                      type="text"
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Stock Mínimo
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formMinStock}
                      onChange={(e) => setFormMinStock(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                    />
                  </div>
                  <button
                    onClick={handleEditMaterial}
                    className="w-full px-4 py-2 bg-[#b08d57] hover:bg-[#c49d67] rounded-lg text-white font-semibold transition-colors shadow-lg"
                  >
                    Guardar Cambios
                  </button>
                </>
              )}

              {modalMode === 'adjust' && selectedMaterial && (
                <>
                  <div className="bg-black/40 rounded-lg p-4 space-y-2 border border-[#b08d57]/20">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Insumo:</span>
                      <span className="text-white font-semibold">{selectedMaterial.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Stock Actual:</span>
                      <span className="text-[#f4c542] font-bold text-lg">
                        {selectedMaterial.current_stock.toFixed(2)} {selectedMaterial.unit}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Cantidad a Ajustar
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      className="w-full bg-black/40 border border-[#b08d57]/30 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#b08d57] focus:border-transparent outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAdjustStock('add')}
                      className="flex-1 px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 rounded-lg text-green-400 font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={16} />
                      Sumar
                    </button>
                    <button
                      onClick={() => handleAdjustStock('subtract')}
                      className="flex-1 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 rounded-lg text-red-400 font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      <Minus size={16} />
                      Restar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};