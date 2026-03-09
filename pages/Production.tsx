import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { ChefHat, Package, AlertCircle, CheckCircle, Box, Copy, Wheat, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';



interface TandaPosible {
  batch_type: string;
  tandas_posibles_total: number;
  insumo_limitante: string;
  alerta: string;
}

interface RawMaterial {
  name: string;
  unit: string;
  current_stock: number;
}

interface Batch {
  id: string;
  produced_at: string;
  batch_type: string;
  notes: string | null;
  grams_remaining?: number;
  grams_total?: number;
}

interface Product {
  id: string;
  sku_code: string;
  product_name?: string;
  name: string; // fallback
  category?: string;
  flavor?: string; // fallback
  weight_grams?: number;
  grams?: number; // fallback
}

interface PackResult {
  barcode_value: string;
  units_produced: number;
  units_remaining: number;
  lot_number: string;
}

interface PackRecommendation {
  product: Product;
  units: number;
  gramsPerUnit: number;
}

// Helper: Obtener gramos por unidad de un producto
function getProductGrams(product: Product): number {
  return product.weight_grams || product.grams || 0;
}

// Helper: Verificar compatibilidad batch-producto por SKU
function isProductCompatibleWithBatch(batchType: string, skuCode: string): boolean {
  const batchUpper = batchType.toUpperCase();
  const skuUpper = (skuCode || '').toUpperCase();

  if (batchUpper.includes('CARAM')) {
    return skuUpper.startsWith('CAR-') || skuUpper.startsWith('DEL-CAR-');
  }
  if (batchUpper.includes('SALAD') || batchUpper === 'SALADA_12OZ' || batchUpper.startsWith('SAL')) {
    return skuUpper.startsWith('SAL-') || skuUpper.startsWith('DEL-SAL-');
  }
  if (batchUpper.includes('SABOR')) {
    return skuUpper.startsWith('SAB-') || skuUpper.startsWith('DEL-SAB-');
  }
  if (batchUpper.includes('CHED')) {
    return skuUpper.startsWith('CHED-') || skuUpper.startsWith('DEL-CHED-');
  }
  if (batchUpper.includes('FLAM')) {
    return skuUpper.startsWith('FLAM-') || skuUpper.startsWith('DEL-FLAM-');
  }

  return false;
}

interface ProductLot {
  created_at: string;
  barcode_value: string;
  sku_code: string;
  product_name: string;
  units_remaining: number;
  batch_type: string;
}

interface Sample {
  created_at: string;
  reason: string;
  quantity: number | null;
  unit: string | null;
  batch_id: string | null;
  notes: string | null;
}

interface GiftAllocation {
  created_at: string;
  batch_id: string;
  batch_type: string;
  grams_used: number;
  gift_units: number | null;
  packaging_material_code: string | null;
  notes: string | null;
}

export const Production = () => {
  const [selectedBatchType, setSelectedBatchType] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Dynamic catalogs from Supabase
  const [batchTypeSpecs, setBatchTypeSpecs] = useState<{ batch_type: string; label?: string }[]>([]);

  // Pack section states
  const [availableBatches, setAvailableBatches] = useState<Batch[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [packUnits, setPackUnits] = useState<number>(1);
  const [packLoading, setPackLoading] = useState<boolean>(false);
  const [packError, setPackError] = useState<string>('');
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [productLots, setProductLots] = useState<ProductLot[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [giftAllocations, setGiftAllocations] = useState<GiftAllocation[]>([]);
  const [sampleSuccess, setSampleSuccess] = useState<string>('');
  const [sampleLoading, setSampleLoading] = useState<boolean>(false);
  const [packRecommendation, setPackRecommendation] = useState<PackRecommendation | null>(null);

  const [tandasPosibles, setTandasPosibles] = useState<TandaPosible[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [maizQtyByBatchType, setMaizQtyByBatchType] = useState<Record<string, number>>({});

  // Gift allocation states (separated from pack section to avoid conflicts)
  const [selectedGiftBatchId, setSelectedGiftBatchId] = useState<string>('');
  const [giftGrams, setGiftGrams] = useState<number>(0);
  const [giftUnits, setGiftUnits] = useState<number>(0);
  const [giftPackaging, setGiftPackaging] = useState<string>('');
  const [giftNotes, setGiftNotes] = useState<string>('');
  const [giftLoading, setGiftLoading] = useState<boolean>(false);
  const [giftError, setGiftError] = useState<string>('');
  const [giftSuccess, setGiftSuccess] = useState<string>('');

  // Collapse states for history sections (start collapsed to save space)
  const [showBatchHistory, setShowBatchHistory] = useState<boolean>(false);
  const [showSampleGiftHistory, setShowSampleGiftHistory] = useState<boolean>(false);
  const [showPackedLotsHistory, setShowPackedLotsHistory] = useState<boolean>(false);
  const [showProductionInventory, setShowProductionInventory] = useState<boolean>(false);

  useEffect(() => {
    loadData();
    loadPackData();
  }, []);

  // Filtered products based on selected batch type
  const selectedBatch = useMemo(
    () => availableBatches.find(b => b.id === selectedBatchId) ?? null,
    [selectedBatchId, availableBatches]
  );

  const filteredProducts = useMemo(() => {
    if (!selectedBatch) return [];
    const filtered = availableProducts.filter(p =>
      isProductCompatibleWithBatch(selectedBatch.batch_type, p.sku_code)
    );
    console.log('[PACK] selected batch type', selectedBatch.batch_type);
    console.log('[PACK] filtered products', filtered);
    return filtered;
  }, [selectedBatch, availableProducts]);

  // Reset selectedProductId when batch changes and current product is not compatible
  useEffect(() => {
    if (filteredProducts.length === 0) {
      setSelectedProductId('');
    } else if (!filteredProducts.some(p => p.id === selectedProductId)) {
      setSelectedProductId(filteredProducts[0].id);
    }
  }, [filteredProducts]);

  // Recalcular recomendación cuando cambia el batch seleccionado o los productos
  useEffect(() => {
    calculatePackRecommendation();
  }, [selectedBatchId, availableBatches, availableProducts]);

  const loadData = async () => {
    try {
      if (!supabase) return;

      // A) Batch type specs (dynamic catalog for select + labels)
      const { data: specsData, error: specsErr } = await supabase
        .from('batch_type_specs')
        .select('*')
        .order('batch_type');
      if (specsErr) console.error('Error loading batch_type_specs:', specsErr);
      const specs = specsData || [];
      setBatchTypeSpecs(specs);
      // Set default batch type from DB on first load
      if (!selectedBatchType && specs.length > 0) {
        setSelectedBatchType(specs[0].batch_type);
      }

      // B) Tandas posibles
      const { data: tandasData } = await supabase
        .from('v_tandas_posibles')
        .select('*')
        .order('batch_type');
      setTandasPosibles(tandasData || []);

      // D) Inventario de insumos
      const { data: materialsData } = await supabase
        .from('raw_materials')
        .select('name, unit, current_stock')
        .order('name');
      setRawMaterials(materialsData || []);

      // E) Load maíz qty per batch_type directly (independent of recipe cards system)
      try {
        const { data: batchRecipeRows, error: brErr } = await supabase
          .from('batch_recipes')
          .select('batch_type, qty_per_batch, raw_materials(name)')
          .order('batch_type');
        if (brErr) {
          console.error('[MAIZ] Error loading batch_recipes for maíz:', brErr);
        } else {
          const maizMap: Record<string, number> = {};
          (batchRecipeRows || []).forEach((row: { batch_type: string; qty_per_batch: number; raw_materials: { name: string }[] | { name: string } | null }) => {
            const rm = Array.isArray(row.raw_materials) ? row.raw_materials[0] : row.raw_materials;
            const rmName = (rm?.name || '').toLowerCase();
            if (rmName.includes('maíz') || rmName.includes('maiz')) {
              maizMap[row.batch_type] = Number(row.qty_per_batch || 0);
            }
          });
          setMaizQtyByBatchType(maizMap);
          console.log('[MAIZ] maizQtyByBatchType loaded:', maizMap);
        }
      } catch (e) {
        console.error('[MAIZ] Exception loading maíz recipes:', e);
      }

      // F) Historial de tandas
      const { data: batchesData } = await supabase
        .from('batches')
        .select('*')
        .order('produced_at', { ascending: false })
        .limit(25);
      setBatches(batchesData || []);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const loadPackData = async () => {
    try {
      if (!supabase) return;

      // Load available batches (only with grams_remaining > 0)
      const { data: batchesData } = await supabase
        .from('batches')
        .select('id, produced_at, batch_type, grams_remaining, grams_total, notes')
        .gt('grams_remaining', 0)
        .order('produced_at', { ascending: false })
        .limit(25);
      console.log('[BATCHES LOAD] raw rows:', batchesData);
      console.log('[BATCHES LOAD] ids:', (batchesData || []).map((b: any) => ({ id: b.id, type: typeof b.id, batch_type: b.batch_type })));
      setAvailableBatches(batchesData || []);
      if (batchesData && batchesData.length > 0) {
        setSelectedBatchId(batchesData[0].id);
      }

      // Load products with sku_code
      const { data: productsData } = await supabase
        .from('products')
        .select('id, sku_code, product_name, name, category, flavor, weight_grams, grams')
        .not('sku_code', 'is', null)
        .order('sku_code');
      setAvailableProducts(productsData || []);
      if (productsData && productsData.length > 0) {
        setSelectedProductId(productsData[0].id);
      }

      // Load product lots history
      const { data: lotsData } = await supabase
        .from('product_lots')
        .select(`
          created_at,
          barcode_value,
          units_remaining,
          products!inner(sku_code, name),
          batches!inner(batch_type)
        `)
        .order('created_at', { ascending: false })
        .limit(25);

      const formattedLots = (lotsData || []).map((lot: any) => ({
        created_at: lot.created_at,
        barcode_value: lot.barcode_value,
        sku_code: lot.products?.sku_code || '',
        product_name: lot.products?.name || '',
        units_remaining: lot.units_remaining,
        batch_type: lot.batches?.batch_type || ''
      }));
      setProductLots(formattedLots);

      // Load samples (waste_events with reason='MUESTRA')
      const { data: samplesData } = await supabase
        .from('waste_events')
        .select('created_at, reason, quantity, unit, batch_id, notes')
        .eq('reason', 'MUESTRA')
        .order('created_at', { ascending: false })
        .limit(25);
      setSamples(samplesData || []);

      // Load gift allocations history
      const { data: giftsData } = await supabase
        .from('batch_gift_allocations')
        .select('created_at, batch_id, grams_used, gift_units, packaging_material_code, notes, batches!inner(batch_type)')
        .order('created_at', { ascending: false })
        .limit(25);
      const formattedGifts: GiftAllocation[] = (giftsData || []).map((g: any) => ({
        created_at: g.created_at,
        batch_id: g.batch_id,
        batch_type: g.batches?.batch_type || '',
        grams_used: g.grams_used,
        gift_units: g.gift_units,
        packaging_material_code: g.packaging_material_code,
        notes: g.notes,
      }));
      setGiftAllocations(formattedGifts);
    } catch (error) {
      console.error('Error loading pack data:', error);
    }
  };

  const handleProduceBatch = async () => {
    setLoading(true);
    setSuccessMessage('');
    setErrorMessage('');

    try {
      if (!supabase) {
        throw new Error('Supabase no está configurado');
      }

      const { data, error } = await supabase.rpc('produce_batch', {
        p_batch_type: selectedBatchType,
        p_notes: notes || null
      });

      if (error) {
        // Mejorar mensaje de error para lotes de maíz
        if (error.message.includes('No hay lote activo de maíz')) {
          throw new Error('❌ No hay costal activo de maíz. Necesitas registrar un nuevo costal en el inventario antes de producir tandas.');
        } else if (error.message.includes('Stock insuficiente')) {
          throw new Error('❌ ' + error.message);
        } else {
          throw error;
        }
      }

      setSuccessMessage(`¡Tanda producida exitosamente! ID: ${data}`);
      setNotes('');
      await loadData();
      await loadPackData(); // Refresh batches list
    } catch (error: any) {
      setErrorMessage(error.message || 'Error al producir tanda');
    } finally {
      setLoading(false);
    }
  };

  const handlePackLot = async () => {
    setPackLoading(true);
    setPackError('');
    setPackResult(null);

    try {
      if (!supabase) {
        throw new Error('Supabase no está configurado');
      }

      if (!selectedBatchId || !selectedProductId || packUnits <= 0) {
        throw new Error('Por favor completa todos los campos');
      }

      const { data, error } = await supabase.rpc('pack_lot', {
        p_batch_id: selectedBatchId,
        p_product_id: selectedProductId,
        p_units: packUnits
      });

      if (error) throw error;

      // Debug: Ver qué retorna la RPC (RETURNS TABLE devuelve array)
      console.log('PACK_RESULT raw data:', data);
      console.log('PACK_RESULT type:', typeof data, 'isArray:', Array.isArray(data));

      // RETURNS TABLE en Postgres siempre devuelve array, tomar primer elemento
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('No se recibió respuesta del servidor al empacar el lote');
      }

      const row = Array.isArray(data) ? data[0] : data;
      console.log('PACK_RESULT row:', row);
      
      // Validar que tiene barcode_value
      if (!row || !row.barcode_value) {
        console.error('ERROR: El resultado no contiene barcode_value:', row);
        throw new Error('Error: El servidor no generó el código de barras');
      }

      // Mapear explícitamente los campos (la función SQL usa snake_case)
      const packResult: PackResult = {
        barcode_value: row.barcode_value,
        units_produced: row.units_produced || 0,
        units_remaining: row.units_remaining || 0,
        lot_number: row.lot_number || ''
      };

      console.log('PACK_RESULT normalizado:', packResult);
      console.log('Código de barras a mostrar:', packResult.barcode_value);

      setPackResult(packResult);
      setPackUnits(1);
      await loadPackData(); // Refresh product lots history
    } catch (error: any) {
      setPackError(error.message || 'Error al empacar lote');
    } finally {
      setPackLoading(false);
    }
  };

  const copyToClipboard = async (text: string | undefined) => {
    // Validar que hay texto para copiar
    if (!text || text.trim() === '' || text === 'undefined' || text === 'null') {
      console.error('No hay código para copiar. Valor recibido:', text);
      console.error('Pack result completo:', packResult);
      alert('❌ Error: No hay código para copiar');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      console.log('Código copiado exitosamente:', text);
      alert('✅ Código copiado al portapapeles');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      alert('❌ Error al copiar al portapapeles');
    }
  };

  const handleAllocateGift = async () => {
    setGiftLoading(true);
    setGiftError('');
    setGiftSuccess('');

    try {
      if (!supabase) {
        throw new Error('Supabase no está configurado');
      }

      // Validaciones
      if (!selectedGiftBatchId) {
        throw new Error('Debe seleccionar una tanda');
      }

      // Validar que el UUID seleccionado realmente existe en la lista actual
      const matchedBatch = availableBatches.find(b => b.id === selectedGiftBatchId);
      if (!matchedBatch) {
        throw new Error('La tanda seleccionada ya no está disponible. Recarga la página.');
      }

      if (giftGrams <= 0) {
        throw new Error('Los gramos deben ser mayor a 0');
      }

      if (giftUnits < 0) {
        throw new Error('Las unidades no pueden ser negativas');
      }

      // Debug: verificar el UUID que se enviará
      console.log('[GIFT] selected batch id:', selectedGiftBatchId);
      console.log('[GIFT] matched batch:', matchedBatch);
      console.log('[GIFT] params:', { p_batch_id: selectedGiftBatchId, p_grams_used: giftGrams, p_gift_units: giftUnits });

      // Llamar al RPC
      const { error } = await supabase.rpc('allocate_batch_gift', {
        p_batch_id: selectedGiftBatchId,
        p_grams_used: giftGrams,
        p_gift_units: giftUnits || 0,
        p_packaging_material_code: giftPackaging || null,
        p_notes: giftNotes || null
      });

      if (error) throw error;

      // Mostrar éxito
      setGiftSuccess(`Regalo registrado exitosamente. ${giftGrams}g descontados de la tanda.`);

      // Limpiar formulario completo (incluyendo tanda seleccionada)
      setSelectedGiftBatchId('');
      setGiftGrams(0);
      setGiftUnits(0);
      setGiftPackaging('');
      setGiftNotes('');

      // Refrescar datos
      await loadPackData();
      await loadData();
    } catch (error: any) {
      setGiftError(error.message || 'Error al registrar regalo');
    } finally {
      setGiftLoading(false);
    }
  };

  const handleMarkAsSample = async () => {
    setSampleLoading(true);
    setSampleSuccess('');
    setPackError('');

    console.log('[handleMarkAsSample] selectedBatchId:', selectedBatchId);
    console.log('[handleMarkAsSample] availableBatches.length ANTES:', availableBatches.length);

    // Validación: debe haber una tanda seleccionada
    if (!selectedBatchId) {
      setPackError('No hay tanda seleccionada');
      setSampleLoading(false);
      return;
    }

    if (!supabase) {
      setPackError('Supabase no está configurado');
      setSampleLoading(false);
      return;
    }

    // Llamar el RPC
    const { data, error: rpcError } = await supabase.rpc('mark_batch_as_sample', {
      p_batch_id: selectedBatchId
    });

    console.log('[handleMarkAsSample] RPC response - data:', data, 'error:', rpcError);

    // Si hay error, NO mostrar éxito
    if (rpcError) {
      console.error('[handleMarkAsSample] ERROR en RPC:', rpcError);
      setPackError(rpcError.message || 'Error al marcar como muestra');
      setSampleLoading(false);
      return;
    }

    // ÉXITO: Mostrar mensaje
    setSampleSuccess('Restante registrado como muestra');

    const batchIdMarked = selectedBatchId;

    // Recargar lista de tandas desde DB (esto trae solo batches con grams_remaining > 0)
    await loadPackData();

    // loadPackData es async y actualiza el state, necesitamos usar una callback después del state update
    // Para hacerlo correctamente, usamos queueMicrotask o verificamos en el próximo render
    // Como alternativa más robusta, re-query directo:
    const { data: refreshedBatches } = await supabase
      .from('batches')
      .select('id, produced_at, batch_type, grams_remaining, grams_total, notes')
      .gt('grams_remaining', 0)
      .order('produced_at', { ascending: false })
      .limit(25);

    console.log('[handleMarkAsSample] Batches DESPUÉS del refresh:', refreshedBatches?.length || 0);

    // Verificar si la tanda marcada todavía existe
    const stillExists = refreshedBatches?.some(b => b.id === batchIdMarked) || false;
    
    if (!stillExists) {
      // La tanda ya no existe (grams_remaining=0), limpiar selectedBatchId y recomendaciones
      setSelectedBatchId('');
      setPackRecommendation(null);
      console.log('[handleMarkAsSample] Tanda marcada ya no existe, selectedBatchId limpiado');
    }

    // Limpiar mensaje después de 3 segundos
    setTimeout(() => setSampleSuccess(''), 3000);

    setSampleLoading(false);
  };

  // Calcular recomendación de empacado basada en batch seleccionado
  const calculatePackRecommendation = () => {
    const selectedBatch = availableBatches.find(b => b.id === selectedBatchId);
    if (!selectedBatch || !selectedBatch.grams_remaining || selectedBatch.grams_remaining <= 0) {
      setPackRecommendation(null);
      return;
    }

    const gramsRemaining = selectedBatch.grams_remaining;
    const batchType = selectedBatch.batch_type;

    // Filtrar productos compatibles con el batch
    const compatibleProducts = availableProducts.filter(product => 
      isProductCompatibleWithBatch(batchType, product.sku_code)
    );

    if (compatibleProducts.length === 0) {
      setPackRecommendation(null);
      return;
    }

    // Calcular unidades posibles por producto
    const options = compatibleProducts
      .map(product => {
        const gramsPerUnit = getProductGrams(product);
        if (gramsPerUnit <= 0) return null;
        
        const possibleUnits = Math.floor(gramsRemaining / gramsPerUnit);
        if (possibleUnits <= 0) return null;

        return {
          product,
          units: possibleUnits,
          gramsPerUnit
        };
      })
      .filter((opt): opt is PackRecommendation => opt !== null);

    if (options.length === 0) {
      setPackRecommendation(null);
      return;
    }

    // Escoger el producto que consume más gramos por unidad (optimiza empacado)
    const bestOption = options.reduce((best, current) => 
      current.gramsPerUnit > best.gramsPerUnit ? current : best
    );

    // Limitar a máximo 10 unidades para la recomendación
    setPackRecommendation({
      ...bestOption,
      units: Math.min(bestOption.units, 10)
    });
  };

  // Aplicar recomendación automáticamente
  const handleUseRecommendation = () => {
    if (!packRecommendation) return;
    
    setSelectedProductId(packRecommendation.product.id);
    setPackUnits(packRecommendation.units);
    
    // Scroll suave al formulario
    setTimeout(() => {
      document.querySelector('[data-section="pack-form"]')?.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest' 
      });
    }, 100);
  };

  const getBatchTypeLabel = (type: string): string => {
    const spec = batchTypeSpecs.find(s => s.batch_type === type);
    return spec?.label || type;
  };

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ChefHat size={32} className="text-cc-primary" />
        <h2 className="text-3xl font-bold text-cc-cream">Producción (Tandas)</h2>
      </div>

      {/* A) Tandas Posibles – moved to top */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <h3 className="text-lg font-semibold text-cc-cream mb-4 flex items-center gap-2">
          <Wheat size={20} className="text-cc-primary" />
          Tandas Posibles
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tipo</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Maíz disponible</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tandas por maíz</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tandas Posibles (total)</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Insumo Limitante</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Alerta</th>
              </tr>
            </thead>
            <tbody>
              {tandasPosibles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-cc-text-muted">
                    No hay datos disponibles
                  </td>
                </tr>
              ) : (
                tandasPosibles.map((tanda, index) => {
                  // Maíz stock from rawMaterials (raw_materials.current_stock)
                  const maizMaterial = rawMaterials.find(m =>
                    (m.name || '').toLowerCase().includes('maíz') ||
                    (m.name || '').toLowerCase().includes('maiz')
                  );
                  const maizStock = Number(maizMaterial?.current_stock ?? 0);

                  // Maíz qty per tanda from dedicated batch_recipes load
                  const maizQtyPerTanda = maizQtyByBatchType[tanda.batch_type] ?? 0;
                  const tandasPorMaiz = maizQtyPerTanda > 0 ? Math.floor(maizStock / maizQtyPerTanda) : null;

                  console.log('[MAIZ FIX] maizeStock', maizStock);
                  console.log('[MAIZ FIX] maizeQtyPerBatch', maizQtyPerTanda);
                  console.log('[MAIZ FIX] maizeBatchesPossible', tandasPorMaiz);

                  return (
                    <tr key={index} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main">{getBatchTypeLabel(tanda.batch_type)}</td>
                      <td className="py-3 px-4 text-cc-text-main">
                        {maizStock > 0 && maizQtyPerTanda > 0 ? (
                          <span>{maizStock}g <span className="text-cc-text-muted text-xs">({maizQtyPerTanda}g/tanda)</span></span>
                        ) : (
                          <span className="text-cc-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {tandasPorMaiz !== null ? (
                          <span className={`font-semibold ${tandasPorMaiz <= 2 ? 'text-red-400' : 'text-cc-primary'}`}>
                            {tandasPorMaiz}
                          </span>
                        ) : (
                          <span className="text-cc-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main font-semibold">{tanda.tandas_posibles_total}</td>
                      <td className="py-3 px-4 text-cc-text-main">{tanda.insumo_limitante}</td>
                      <td className="py-3 px-4">
                        {tanda.alerta && (
                          <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded">
                            {tanda.alerta}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Producir Tanda Form */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <h3 className="text-lg font-semibold text-cc-cream mb-4 flex items-center gap-2">
          <Package size={20} className="text-cc-primary" />
          Producir Nueva Tanda
        </h3>

        <div className="space-y-4">
          {/* Select Batch Type */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Tipo de Tanda
            </label>
            <select
              value={selectedBatchType}
              onChange={(e) => setSelectedBatchType(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={loading}
            >
              {batchTypeSpecs.length === 0 ? (
                <option value="">Cargando tipos...</option>
              ) : (
                batchTypeSpecs.map(spec => (
                  <option key={spec.batch_type} value={spec.batch_type}>
                    {spec.label || spec.batch_type}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Notes Textarea */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Notas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Lote producido turno matutino..."
              rows={3}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none resize-none"
              disabled={loading}
            />
          </div>

          {/* Produce Button */}
          <button
            onClick={handleProduceBatch}
            disabled={loading || !selectedBatchType}
            className="w-full px-6 py-3 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>Produciendo...</>
            ) : (
              <>
                <ChefHat size={20} />
                Producir Tanda
              </>
            )}
          </button>

          {/* Success Message */}
          {successMessage && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
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
        </div>
      </div>

      {/* Empacar Lote Section */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <h3 className="text-lg font-semibold text-cc-cream mb-4 flex items-center gap-2">
          <Box size={20} className="text-cc-primary" />
          Empacar Lote
        </h3>

        <div className="space-y-4" data-section="pack-form">
          {/* Select Batch */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Tanda
            </label>
            <select
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={packLoading}
            >
              {availableBatches.length === 0 ? (
                <option value="">No hay tandas disponibles</option>
              ) : (
                availableBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {getBatchTypeLabel(batch.batch_type)} - {formatDateTime(batch.produced_at)} ({batch.grams_remaining?.toFixed(0) || 0}g disponibles)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Recommendation Block - Solo si hay recomendación */}
          {packRecommendation && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-3">
                <CheckCircle size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-blue-400 font-medium mb-1">Recomendación</p>
                  <p className="text-blue-300/80 text-sm">
                    Empacar <strong>{packRecommendation.units}</strong> unidades de{' '}
                    <strong>{packRecommendation.product.sku_code}</strong> ({packRecommendation.product.product_name || packRecommendation.product.name})
                    {' '}para avanzar/terminar esta tanda.
                  </p>
                </div>
              </div>
              <button
                onClick={handleUseRecommendation}
                className="w-full px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/50 rounded-lg text-blue-200 transition-colors font-medium"
              >
                Usar recomendación
              </button>
            </div>
          )}

          {/* Sample Suggestion - Solo si NO hay recomendación pero sí hay gramos */}
          {!packRecommendation && selectedBatchId && (() => {
            const selectedBatch = availableBatches.find(b => b.id === selectedBatchId);
            const gramsRemaining = selectedBatch?.grams_remaining || 0;
            
            // No mostrar si grams_remaining <= 0
            if (gramsRemaining <= 0) return null;

            return (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-3">
                  <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-yellow-400 font-medium mb-1">No alcanza para ningún empaque</p>
                    <p className="text-yellow-300/80 text-sm">La tanda tiene {gramsRemaining.toFixed(0)}g restantes. Sugerencia: registrar como MUESTRA.</p>
                  </div>
                </div>
                <button
                  onClick={handleMarkAsSample}
                  disabled={sampleLoading || gramsRemaining <= 0}
                  className="w-full px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 rounded-lg text-yellow-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sampleLoading ? 'Marcando...' : 'Marcar restante como muestra'}
                </button>
              </div>
            );
          })()}

          {/* Sample Success */}
          {sampleSuccess && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-green-400 font-medium">Éxito</p>
                <p className="text-green-300/80 text-sm">{sampleSuccess}</p>
              </div>
            </div>
          )}

          {/* Select Product (filtered by selected batch type) */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Producto
            </label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={packLoading || !selectedBatchId}
            >
              {filteredProducts.length === 0 ? (
                <option value="">{selectedBatchId ? 'No hay productos compatibles' : 'Selecciona una tanda primero'}</option>
              ) : (
                filteredProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku_code} - {product.product_name || product.name} {product.category || product.flavor} {product.weight_grams || product.grams}g
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Units Input */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Unidades
            </label>
            <input
              type="number"
              min="1"
              value={packUnits}
              onChange={(e) => setPackUnits(parseInt(e.target.value) || 1)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={packLoading}
            />
          </div>

          {/* Pack Button */}
          <button
            onClick={handlePackLot}
            disabled={packLoading || availableBatches.length === 0 || availableProducts.length === 0}
            className="w-full px-6 py-3 bg-cc-accent text-white rounded-lg hover:bg-cc-accent/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {packLoading ? (
              <>Empacando...</>
            ) : (
              <>
                <Box size={20} />
                Empacar
              </>
            )}
          </button>

          {/* Pack Error */}
          {packError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium">Error</p>
                <p className="text-red-300/80 text-sm">{packError}</p>
              </div>
            </div>
          )}

          {/* Pack Result */}
          {packResult && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-4">
                <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-green-400 font-medium mb-2">¡Lote empacado exitosamente!</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-cc-text-muted">Código de barras:</span>
                      <span className="text-cc-text-main font-mono font-semibold">
                        {packResult.barcode_value || '(no generado)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cc-text-muted">Unidades producidas:</span>
                      <span className="text-cc-text-main font-semibold">{packResult.units_produced}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cc-text-muted">Unidades restantes:</span>
                      <span className="text-cc-text-main font-semibold">{packResult.units_remaining}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cc-text-muted">Número de lote:</span>
                      <span className="text-cc-text-main font-mono">
                        {packResult.lot_number || '(no generado)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  console.log('Intentando copiar:', packResult.barcode_value);
                  copyToClipboard(packResult.barcode_value);
                }}
                disabled={!packResult.barcode_value}
                className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-cc-text-main transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy size={16} />
                Copiar código
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Registrar Regalo Manual Section */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <h3 className="text-lg font-semibold text-cc-cream mb-2 flex items-center gap-2">
          <Package size={20} className="text-cc-primary" />
          Registrar regalo manual
        </h3>
        <p className="text-sm text-cc-text-muted mb-4">
          Usa esta opción para registrar restos convertidos a regalo y descontarlos manualmente de la tanda.
        </p>

        <div className="space-y-4" data-section="gift-form">
          {/* Select Batch for Gift */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Tanda
            </label>
            <select
              value={selectedGiftBatchId}
              onChange={(e) => {
                const val = e.target.value;
                console.log('[GIFT SELECTED BATCH ID]', val, 'type:', typeof val);
                setSelectedGiftBatchId(val);
                setGiftError('');
                setGiftSuccess('');
              }}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={giftLoading}
            >
              <option value="">Seleccionar tanda...</option>
              {availableBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {getBatchTypeLabel(batch.batch_type)} - {formatDateTime(batch.produced_at)} ({batch.grams_remaining?.toFixed(0) || 0}g disponibles)
                </option>
              ))}
            </select>
          </div>

          {/* Grams Input */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Gramos a descontar
            </label>
            <input
              type="number"
              min="1"
              value={giftGrams || ''}
              onChange={(e) => {
                setGiftGrams(parseInt(e.target.value) || 0);
                setGiftError('');
                setGiftSuccess('');
              }}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={giftLoading}
              placeholder="Ej: 250"
            />
          </div>

          {/* Gift Units Input */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Unidades de regalo / bolsitas
            </label>
            <input
              type="number"
              min="0"
              value={giftUnits || ''}
              onChange={(e) => {
                setGiftUnits(parseInt(e.target.value) || 0);
                setGiftError('');
                setGiftSuccess('');
              }}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={giftLoading}
              placeholder="Ej: 10"
            />
          </div>

          {/* Packaging Material Select */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Empaque regalo (opcional)
            </label>
            <select
              value={giftPackaging}
              onChange={(e) => setGiftPackaging(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={giftLoading}
            >
              <option value="">Sin empaque especificado</option>
              <option value="STU-17x25">STU-17x25</option>
              <option value="CEL-20x30">CEL-20x30</option>
              <option value="CEL-25x35">CEL-25x35</option>
              <option value="CEL-30x40">CEL-30x40</option>
              <option value="KRF-24x16x7">KRF-24x16x7</option>
            </select>
          </div>

          {/* Notes Textarea */}
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">
              Notas (opcional)
            </label>
            <textarea
              value={giftNotes}
              onChange={(e) => setGiftNotes(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              disabled={giftLoading}
              rows={2}
              placeholder="Ej: Convertido de restos para eventos"
            />
          </div>

          {/* Register Gift Button */}
          <button
            onClick={handleAllocateGift}
            disabled={giftLoading || !selectedGiftBatchId || giftGrams <= 0 || availableBatches.length === 0}
            className="w-full px-6 py-3 bg-cc-primary text-white rounded-lg hover:bg-cc-primary/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {giftLoading ? (
              <>Registrando...</>
            ) : (
              <>
                <Package size={20} />
                Registrar regalo
              </>
            )}
          </button>

          {/* Gift Error */}
          {giftError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium">Error</p>
                <p className="text-red-300/80 text-sm">{giftError}</p>
              </div>
            </div>
          )}

          {/* Gift Success */}
          {giftSuccess && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-green-400 font-medium">Éxito</p>
                <p className="text-green-300/80 text-sm">{giftSuccess}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* B) Inventario de Insumos */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <button
          onClick={() => setShowProductionInventory(!showProductionInventory)}
          className="w-full flex items-center justify-between group"
        >
          <h3 className="text-lg font-semibold text-cc-cream flex items-center gap-2">
            Inventario de Insumos
          </h3>
          <div className="flex items-center gap-2">
            {!showProductionInventory && (
              <span className="text-xs text-cc-text-muted">{rawMaterials.length} insumos</span>
            )}
            {showProductionInventory ? (
              <ChevronDown size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            ) : (
              <ChevronRight size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            )}
          </div>
        </button>
        {showProductionInventory && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Nombre</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Unidad</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Stock Actual</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterials.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-cc-text-muted">
                      No hay insumos registrados
                    </td>
                  </tr>
                ) : (
                  rawMaterials.map((material, index) => (
                    <tr key={index} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main">{material.name}</td>
                      <td className="py-3 px-4 text-cc-text-muted">{material.unit}</td>
                      <td className="py-3 px-4 text-cc-text-main font-semibold">
                        {material.current_stock.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* C) Historial de Tandas */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <button
          onClick={() => setShowBatchHistory(!showBatchHistory)}
          className="w-full flex items-center justify-between group"
        >
          <h3 className="text-lg font-semibold text-cc-cream flex items-center gap-2">
            Historial de Tandas (últimas 25)
          </h3>
          <div className="flex items-center gap-2">
            {!showBatchHistory && (
              <span className="text-xs text-cc-text-muted">{batches.length} registros</span>
            )}
            {showBatchHistory ? (
              <ChevronDown size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            ) : (
              <ChevronRight size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            )}
          </div>
        </button>
        {showBatchHistory && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Fecha</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tipo</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Notas</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">ID</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-cc-text-muted">
                      No hay tandas registradas
                    </td>
                  </tr>
                ) : (
                  batches.map((batch) => (
                    <tr key={batch.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {formatDateTime(batch.produced_at)}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main">{getBatchTypeLabel(batch.batch_type)}</td>
                      <td className="py-3 px-4 text-cc-text-muted text-sm">
                        {batch.notes || '-'}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted font-mono text-xs">
                        {batch.id.substring(0, 8)}...
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D) Historial de Muestras / Regalos */}
      <div className="bg-cc-surface p-6 rounded-xl border border-yellow-500/20">
        <button
          onClick={() => setShowSampleGiftHistory(!showSampleGiftHistory)}
          className="w-full flex items-center justify-between group"
        >
          <h3 className="text-lg font-semibold text-yellow-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
            Historial de Muestras / Regalos (últimos 25)
          </h3>
          <div className="flex items-center gap-2">
            {!showSampleGiftHistory && (
              <span className="text-xs text-yellow-400/60">{samples.length + giftAllocations.length} registros</span>
            )}
            {showSampleGiftHistory ? (
              <ChevronDown size={18} className="text-yellow-400/60 group-hover:text-yellow-400 transition-colors" />
            ) : (
              <ChevronRight size={18} className="text-yellow-400/60 group-hover:text-yellow-400 transition-colors" />
            )}
          </div>
        </button>

        {showSampleGiftHistory && (<div className="mt-4">

        {/* Subsección: Muestras */}
        <h4 className="text-sm font-semibold text-yellow-300/80 mb-2">Muestras</h4>
        <div className="overflow-x-auto mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-yellow-500/20">
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Fecha</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Tipo</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Cantidad</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Batch ID</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Notas</th>
              </tr>
            </thead>
            <tbody>
              {samples.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-cc-text-muted">
                    No hay muestras registradas
                  </td>
                </tr>
              ) : (
                samples.map((sample, index) => (
                  <tr key={index} className="border-b border-yellow-500/10 hover:bg-yellow-500/5">
                    <td className="py-3 px-4 text-yellow-200/90 text-sm">
                      {formatDateTime(sample.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded text-xs font-bold text-yellow-300">
                        MUESTRA
                      </span>
                    </td>
                    <td className="py-3 px-4 text-yellow-200/90 font-semibold">
                      {sample.quantity || 0} {sample.unit || 'g'}
                    </td>
                    <td className="py-3 px-4 text-yellow-200/70 font-mono text-xs">
                      {sample.batch_id ? sample.batch_id.substring(0, 8).toUpperCase() : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-yellow-200/70 text-sm">
                      {sample.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Subsección: Regalos manuales */}
        <h4 className="text-sm font-semibold text-yellow-300/80 mb-2">Regalos manuales</h4>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-yellow-500/20">
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Fecha</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Tipo</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Cantidad</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Batch ID</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-yellow-300">Notas</th>
              </tr>
            </thead>
            <tbody>
              {giftAllocations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-cc-text-muted">
                    No hay regalos manuales registrados
                  </td>
                </tr>
              ) : (
                giftAllocations.map((gift, index) => (
                  <tr key={index} className="border-b border-yellow-500/10 hover:bg-yellow-500/5">
                    <td className="py-3 px-4 text-yellow-200/90 text-sm">
                      {formatDateTime(gift.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-purple-500/20 border border-purple-500/40 rounded text-xs font-bold text-purple-300">
                        REGALO
                      </span>
                      {gift.batch_type && (
                        <span className="ml-2 text-yellow-200/70 text-xs">
                          {getBatchTypeLabel(gift.batch_type)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-yellow-200/90 font-semibold">
                      {gift.grams_used} g{gift.gift_units && gift.gift_units > 0 ? ` / ${gift.gift_units} bolsitas` : ''}
                    </td>
                    <td className="py-3 px-4 text-yellow-200/70 font-mono text-xs">
                      {gift.batch_id ? gift.batch_id.substring(0, 8).toUpperCase() : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-yellow-200/70 text-sm">
                      {gift.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>)}
      </div>

      {/* E) Historial de Lotes Empacados */}
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <button
          onClick={() => setShowPackedLotsHistory(!showPackedLotsHistory)}
          className="w-full flex items-center justify-between group"
        >
          <h3 className="text-lg font-semibold text-cc-cream flex items-center gap-2">
            Historial de Lotes Empacados (últimos 25)
          </h3>
          <div className="flex items-center gap-2">
            {!showPackedLotsHistory && (
              <span className="text-xs text-cc-text-muted">{productLots.length} registros</span>
            )}
            {showPackedLotsHistory ? (
              <ChevronDown size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            ) : (
              <ChevronRight size={18} className="text-cc-text-muted group-hover:text-cc-cream transition-colors" />
            )}
          </div>
        </button>
        {showPackedLotsHistory && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Fecha</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Código de Barras</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">SKU</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Producto</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Unidades Restantes</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-cc-text-muted">Tipo de Tanda</th>
                </tr>
              </thead>
              <tbody>
                {productLots.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-cc-text-muted">
                      No hay lotes empacados registrados
                    </td>
                  </tr>
                ) : (
                  productLots.map((lot, index) => (
                    <tr key={index} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-cc-text-main text-sm">
                        {formatDateTime(lot.created_at)}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main font-mono text-sm">
                        {lot.barcode_value}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted font-mono text-sm">
                        {lot.sku_code}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main">
                        {lot.product_name}
                      </td>
                      <td className="py-3 px-4 text-cc-text-main font-semibold">
                        {lot.units_remaining}
                      </td>
                      <td className="py-3 px-4 text-cc-text-muted">
                        {getBatchTypeLabel(lot.batch_type)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};