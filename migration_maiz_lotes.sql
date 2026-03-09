-- Migration: Trazabilidad de lotes de maíz por costal
-- Objetivo: Rastrear qué costal/lote de maíz se usó en cada tanda

-- 1. Crear tabla inventory_receipts (si no existe)
CREATE TABLE IF NOT EXISTS inventory_receipts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  item_id UUID REFERENCES inventory_items(id) NOT NULL,
  lot_code TEXT NOT NULL,
  qty_in_base NUMERIC NOT NULL,
  qty_remaining_base NUMERIC NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Agregar columna maiz_receipt_id a batches
ALTER TABLE batches ADD COLUMN IF NOT EXISTS maiz_receipt_id UUID REFERENCES inventory_receipts(id);

-- 3. Agregar columnas lot_number y barcode_value a batches (si no existen)
ALTER TABLE batches ADD COLUMN IF NOT EXISTS lot_number TEXT;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS barcode_value TEXT;

-- 4. Índices para performance
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_item_id ON inventory_receipts(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_active ON inventory_receipts(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_batches_maiz_receipt ON batches(maiz_receipt_id);

-- 5. RLS para inventory_receipts
ALTER TABLE inventory_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read inventory_receipts" ON inventory_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert inventory_receipts" ON inventory_receipts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update inventory_receipts" ON inventory_receipts FOR UPDATE TO authenticated USING (true);

-- 6. Vista para inventario con stock (si no existe)
CREATE OR REPLACE VIEW v_inventory_items_with_stock AS
SELECT 
  ii.id,
  ii.item_key,
  ii.name,
  ii.base_unit,
  ii.active,
  ii.min_stock,
  COALESCE(ist.qty_base, 0) as stock_base,
  ist.updated_at as stock_updated_at
FROM inventory_items ii
LEFT JOIN inventory_stock ist ON ist.item_id = ii.id;

-- 7. FUNCIÓN: produce_batch_with_receipt
-- Crea una tanda descontando de inventory_stock y del lote de maíz activo
DROP FUNCTION IF EXISTS produce_batch_with_receipt(TEXT, TEXT);
CREATE OR REPLACE FUNCTION produce_batch_with_receipt(
  p_batch_type TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_batch_id UUID;
  v_maiz_item_id UUID;
  v_maiz_receipt_id UUID;
  v_maiz_required NUMERIC;
  v_maiz_available NUMERIC;
  v_aceite_required NUMERIC;
  v_flavacol_required NUMERIC := 0;
  v_glaze_required NUMERIC := 0;
  v_cheddar_required NUMERIC := 0;
  v_flaming_required NUMERIC := 0;
  v_aceite_item_id UUID;
  v_flavacol_item_id UUID;
  v_glaze_item_id UUID;
  v_cheddar_item_id UUID;
  v_flaming_item_id UUID;
  v_yield_grams NUMERIC;
BEGIN
  -- Determinar ingredientes requeridos según batch_type
  CASE p_batch_type
    WHEN 'CARAM8', 'CARAMELO_8OZ' THEN
      v_maiz_required := 227;
      v_aceite_required := 60;
      v_glaze_required := 113;
      v_yield_grams := 5500;
    WHEN 'SAL12', 'SALADA_12OZ' THEN
      v_maiz_required := 340;
      v_aceite_required := 90;
      v_flavacol_required := 15;
      v_yield_grams := 8500;
    WHEN 'CHED12', 'CHEDDAR_12OZ' THEN
      v_maiz_required := 340;
      v_aceite_required := 90;
      v_flavacol_required := 15;
      v_cheddar_required := 20;
      v_yield_grams := 8500;
    WHEN 'FLAM12', 'FLAMING_12OZ' THEN
      v_maiz_required := 340;
      v_aceite_required := 90;
      v_flavacol_required := 15;
      v_flaming_required := 20;
      v_yield_grams := 8500;
    ELSE
      RAISE EXCEPTION 'Batch type % no reconocido', p_batch_type;
  END CASE;

  -- Obtener IDs de items
  SELECT id INTO v_maiz_item_id FROM inventory_items WHERE item_key = 'maiz' LIMIT 1;
  SELECT id INTO v_aceite_item_id FROM inventory_items WHERE item_key = 'aceite' LIMIT 1;
  
  IF v_flavacol_required > 0 THEN
    SELECT id INTO v_flavacol_item_id FROM inventory_items WHERE item_key = 'flavacol' LIMIT 1;
  END IF;
  
  IF v_glaze_required > 0 THEN
    SELECT id INTO v_glaze_item_id FROM inventory_items WHERE item_key = 'glaze' LIMIT 1;
  END IF;
  
  IF v_cheddar_required > 0 THEN
    SELECT id INTO v_cheddar_item_id FROM inventory_items WHERE item_key = 'cheddar' LIMIT 1;
  END IF;
  
  IF v_flaming_required > 0 THEN
    SELECT id INTO v_flaming_item_id FROM inventory_items WHERE item_key = 'flaming' LIMIT 1;
  END IF;

  -- Buscar lote activo de maíz
  SELECT id, qty_remaining_base 
  INTO v_maiz_receipt_id, v_maiz_available
  FROM inventory_receipts
  WHERE item_id = v_maiz_item_id 
    AND active = true
    AND qty_remaining_base >= v_maiz_required
  ORDER BY received_at ASC
  LIMIT 1;

  -- Validar que hay lote activo de maíz
  IF v_maiz_receipt_id IS NULL THEN
    RAISE EXCEPTION 'No hay lote activo de maíz con suficiente cantidad. Requerido: % g', v_maiz_required;
  END IF;

  -- Validar stocks en inventory_stock
  IF NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_maiz_item_id AND qty_base >= v_maiz_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de maíz en inventario. Requerido: % g', v_maiz_required;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_aceite_item_id AND qty_base >= v_aceite_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de aceite en inventario. Requerido: % ml', v_aceite_required;
  END IF;

  IF v_flavacol_required > 0 AND NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_flavacol_item_id AND qty_base >= v_flavacol_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de flavacol en inventario. Requerido: % g', v_flavacol_required;
  END IF;

  IF v_glaze_required > 0 AND NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_glaze_item_id AND qty_base >= v_glaze_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de glaze en inventario. Requerido: % g', v_glaze_required;
  END IF;

  IF v_cheddar_required > 0 AND NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_cheddar_item_id AND qty_base >= v_cheddar_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de cheddar en inventario. Requerido: % g', v_cheddar_required;
  END IF;

  IF v_flaming_required > 0 AND NOT EXISTS (
    SELECT 1 FROM inventory_stock 
    WHERE item_id = v_flaming_item_id AND qty_base >= v_flaming_required
  ) THEN
    RAISE EXCEPTION 'Stock insuficiente de flaming hot en inventario. Requerido: % g', v_flaming_required;
  END IF;

  -- Crear el batch
  INSERT INTO batches (
    batch_type, 
    notes, 
    maiz_receipt_id,
    grams_total,
    grams_remaining,
    lot_number,
    barcode_value
  )
  VALUES (
    p_batch_type,
    p_notes,
    v_maiz_receipt_id,
    v_yield_grams,
    v_yield_grams,
    p_batch_type || '-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MI'),
    'BATCH-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS')
  )
  RETURNING id INTO v_batch_id;

  -- Descontar del lote de maíz
  UPDATE inventory_receipts
  SET qty_remaining_base = qty_remaining_base - v_maiz_required,
      updated_at = NOW()
  WHERE id = v_maiz_receipt_id;

  -- Descontar de inventory_stock
  UPDATE inventory_stock
  SET qty_base = qty_base - v_maiz_required,
      updated_at = NOW()
  WHERE item_id = v_maiz_item_id;

  UPDATE inventory_stock
  SET qty_base = qty_base - v_aceite_required,
      updated_at = NOW()
  WHERE item_id = v_aceite_item_id;

  IF v_flavacol_required > 0 THEN
    UPDATE inventory_stock
    SET qty_base = qty_base - v_flavacol_required,
        updated_at = NOW()
    WHERE item_id = v_flavacol_item_id;
  END IF;

  IF v_glaze_required > 0 THEN
    UPDATE inventory_stock
    SET qty_base = qty_base - v_glaze_required,
        updated_at = NOW()
    WHERE item_id = v_glaze_item_id;
  END IF;

  IF v_cheddar_required > 0 THEN
    UPDATE inventory_stock
    SET qty_base = qty_base - v_cheddar_required,
        updated_at = NOW()
    WHERE item_id = v_cheddar_item_id;
  END IF;

  IF v_flaming_required > 0 THEN
    UPDATE inventory_stock
    SET qty_base = qty_base - v_flaming_required,
        updated_at = NOW()
    WHERE item_id = v_flaming_item_id;
  END IF;

  RETURN v_batch_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Actualizar item_keys a versión simplificada (sin _palomero, _mantequilla, etc)
UPDATE inventory_items SET item_key = 'maiz' WHERE item_key = 'maiz_palomero';
UPDATE inventory_items SET item_key = 'aceite' WHERE item_key = 'aceite_mantequilla';
UPDATE inventory_items SET item_key = 'glaze' WHERE item_key = 'glaze_caramelo';
UPDATE inventory_items SET item_key = 'cheddar' WHERE item_key = 'cheddar_powder';
UPDATE inventory_items SET item_key = 'flaming' WHERE item_key = 'flaming_hot_powder';

-- 9. Crear un lote de maíz de ejemplo (si no existe)
DO $$
DECLARE
  v_maiz_id UUID;
BEGIN
  SELECT id INTO v_maiz_id FROM inventory_items WHERE item_key = 'maiz';
  
  IF v_maiz_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_receipts WHERE item_id = v_maiz_id AND active = true
  ) THEN
    INSERT INTO inventory_receipts (item_id, lot_code, qty_in_base, qty_remaining_base, active, notes)
    VALUES (
      v_maiz_id,
      'COSTAL-' || TO_CHAR(NOW(), 'YYYYMMDD-001'),
      20000,
      (SELECT qty_base FROM inventory_stock WHERE item_id = v_maiz_id),
      true,
      'Lote inicial de maíz'
    );
  END IF;
END $$;

-- 10. Verificar datos
SELECT 
  ii.item_key,
  ii.name,
  COALESCE(ist.qty_base, 0) as stock_base,
  ir.lot_code,
  ir.qty_remaining_base as lote_remaining
FROM inventory_items ii
LEFT JOIN inventory_stock ist ON ist.item_id = ii.id
LEFT JOIN inventory_receipts ir ON ir.item_id = ii.id AND ir.active = true
WHERE ii.item_key IN ('maiz', 'aceite', 'flavacol', 'glaze', 'cheddar', 'flaming')
ORDER BY ii.item_key;
