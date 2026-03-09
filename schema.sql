-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUMS
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'cashier', 'production', 'auditor');
CREATE TYPE movement_type AS ENUM ('in_purchase', 'out_sale', 'out_waste', 'out_production', 'adj_correction');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'transfer', 'mixed');

-- 1. PROFILES (Extends Supabase Auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  role user_role DEFAULT 'cashier',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BRANCHES
CREATE TABLE branches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INGREDIENTS (Raw Materials)
CREATE TABLE ingredients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL, -- g, ml, pza
  min_stock NUMERIC DEFAULT 10,
  current_cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PRODUCTS (Sellable Items)
CREATE TABLE products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  size TEXT NOT NULL, -- Mini Michi, Michi, etc.
  price NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RECIPES (BOM)
CREATE TABLE recipes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID REFERENCES products(id) NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recipe_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL, -- Amount to deduct per product sold
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. INVENTORY MOVEMENTS (The Source of Truth for Stock)
CREATE TABLE inventory_movements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  ingredient_id UUID REFERENCES ingredients(id) NOT NULL,
  branch_id UUID REFERENCES branches(id), -- Optional for MVP single branch
  type movement_type NOT NULL,
  quantity NUMERIC NOT NULL, -- Positive for IN, Negative for OUT
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. CUSTOMERS & LOYALTY
CREATE TABLE customers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  visits_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coupons (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  code TEXT UNIQUE NOT NULL,
  discount_amount NUMERIC DEFAULT 0,
  is_redeemed BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SALES (POS)
CREATE TABLE sales (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  branch_id UUID REFERENCES branches(id),
  customer_id UUID REFERENCES customers(id),
  cashier_id UUID REFERENCES profiles(id),
  total_amount NUMERIC NOT NULL,
  payment_method payment_method NOT NULL,
  status TEXT DEFAULT 'completed', -- completed, cancelled
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL
);

-- 9. PRODUCTION BATCHES
CREATE TABLE production_batches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  batch_code TEXT NOT NULL,
  recipe_id UUID REFERENCES recipes(id), -- Optional link
  status TEXT DEFAULT 'completed',
  produced_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. CASH MANAGEMENT
CREATE TABLE cash_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  cashier_id UUID REFERENCES profiles(id),
  start_amount NUMERIC NOT NULL,
  end_amount NUMERIC,
  difference NUMERIC,
  status TEXT DEFAULT 'open', -- open, closed
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE cash_expenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES cash_sessions(id),
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. WASTE
CREATE TABLE waste_records (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL, -- Positive number representing loss
  reason TEXT NOT NULL,
  reported_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- VIEW: CURRENT STOCK
CREATE OR REPLACE VIEW view_ingredient_stock AS
SELECT 
  i.id as ingredient_id,
  i.name,
  i.unit,
  i.min_stock,
  COALESCE(SUM(m.quantity), 0) as current_stock
FROM ingredients i
LEFT JOIN inventory_movements m ON i.id = m.ingredient_id
GROUP BY i.id, i.name, i.unit, i.min_stock;

-- FUNCTION: HANDLE NEW SALE (Transaction)
-- This function is called from the frontend to ensure atomicity
-- It creates the sale, items, and deducts inventory based on recipes
CREATE OR REPLACE FUNCTION create_sale(
  p_cashier_id UUID,
  p_customer_id UUID,
  p_payment_method payment_method,
  p_items JSONB -- Array of {product_id, quantity, unit_price}
) RETURNS UUID AS $$
DECLARE
  v_sale_id UUID;
  v_item JSONB;
  v_total NUMERIC := 0;
  v_recipe_id UUID;
  v_rec_item RECORD;
BEGIN
  -- Calculate total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + ((v_item->>'quantity')::INT * (v_item->>'unit_price')::NUMERIC);
  END LOOP;

  -- Insert Sale
  INSERT INTO sales (cashier_id, customer_id, total_amount, payment_method)
  VALUES (p_cashier_id, p_customer_id, v_total, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- Process Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Insert Sale Item
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
    VALUES (
      v_sale_id,
      (v_item->>'product_id')::UUID,
      (v_item->>'quantity')::INT,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'quantity')::INT * (v_item->>'unit_price')::NUMERIC
    );

    -- DEDUCT INVENTORY
    -- Find active recipe for product
    SELECT id INTO v_recipe_id FROM recipes WHERE product_id = (v_item->>'product_id')::UUID AND is_active = TRUE LIMIT 1;
    
    IF v_recipe_id IS NOT NULL THEN
      FOR v_rec_item IN SELECT * FROM recipe_items WHERE recipe_id = v_recipe_id
      LOOP
        INSERT INTO inventory_movements (ingredient_id, type, quantity, notes, created_by)
        VALUES (
          v_rec_item.ingredient_id,
          'out_sale',
          -1 * (v_rec_item.quantity * (v_item->>'quantity')::NUMERIC),
          'Sale #' || v_sale_id,
          p_cashier_id
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Update Customer Visits
  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET visits_count = visits_count + 1 WHERE id = p_customer_id;
  END IF;

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;

-- RLS POLICIES (Simplified for MVP: Admin full access, Authenticated basic access)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Allow authenticated to read most operational tables
CREATE POLICY "Auth read products" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read ingredients" ON ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read recipes" ON recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read sales" ON sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert sales" ON sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth read items" ON sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert items" ON sale_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth read movements" ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert movements" ON inventory_movements FOR INSERT TO authenticated WITH CHECK (true);

-- SEED DATA
-- Create default ingredients
INSERT INTO ingredients (name, unit, min_stock, current_cost) VALUES 
('Maíz Mushroom', 'g', 5000, 0.05),
('Aceite de Coco', 'ml', 1000, 0.08),
('Caramelo Cat', 'g', 2000, 0.12),
('Sal de Mar', 'g', 500, 0.01),
('Bolsa Mini Michi', 'pza', 100, 2.00),
('Bolsa Gato Mayor', 'pza', 100, 5.00);

-- Create products
INSERT INTO products (name, size, price) VALUES 
('Caramelo Clásico', 'Mini Michi', 45.00),
('Caramelo Clásico', 'Gato Mayor', 85.00),
('Queso Cheddar', 'Mini Michi', 50.00),
('Mix Cat (Queso+Caramelo)', 'Jefe Felino', 120.00);

-- Create Recipes (Example: Caramelo Mini)
DO $$
DECLARE
  v_prod_id UUID;
  v_ing_corn UUID;
  v_ing_oil UUID;
  v_ing_bag UUID;
  v_recipe_id UUID;
BEGIN
  SELECT id INTO v_prod_id FROM products WHERE name = 'Caramelo Clásico' AND size = 'Mini Michi' LIMIT 1;
  SELECT id INTO v_ing_corn FROM ingredients WHERE name = 'Maíz Mushroom' LIMIT 1;
  SELECT id INTO v_ing_oil FROM ingredients WHERE name = 'Aceite de Coco' LIMIT 1;
  SELECT id INTO v_ing_bag FROM ingredients WHERE name = 'Bolsa Mini Michi' LIMIT 1;

  INSERT INTO recipes (product_id, name) VALUES (v_prod_id, 'Standard Batch') RETURNING id INTO v_recipe_id;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity) VALUES 
  (v_recipe_id, v_ing_corn, 50), -- 50g corn
  (v_recipe_id, v_ing_oil, 10), -- 10ml oil
  (v_recipe_id, v_ing_bag, 1); -- 1 bag
END $$;

-- PRODUCTION TABLES FOR BATCH SYSTEM
-- Table: batch_type_specs
CREATE TABLE IF NOT EXISTS batch_type_specs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  batch_type TEXT NOT NULL UNIQUE,
  yield_grams NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: batches
CREATE TABLE IF NOT EXISTS batches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  batch_type TEXT NOT NULL,
  grams_total NUMERIC,
  grams_remaining NUMERIC,
  produced_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  lot_number TEXT,
  barcode_value TEXT,
  maiz_receipt_id UUID
);

-- Table: inventory_receipts (lotes/costales de ingredientes)
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

-- Add FK after inventory_receipts is created
ALTER TABLE batches ADD CONSTRAINT fk_batches_maiz_receipt 
  FOREIGN KEY (maiz_receipt_id) REFERENCES inventory_receipts(id);

-- Table: raw_materials
CREATE TABLE IF NOT EXISTS raw_materials (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  min_stock NUMERIC DEFAULT 0,
  current_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: inventory_items (for production recipe system)
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  item_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_base TEXT NOT NULL, -- 'g' or 'ml'
  active BOOLEAN DEFAULT TRUE,
  min_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: inventory_stock (current stock for inventory_items)
CREATE TABLE IF NOT EXISTS inventory_stock (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty_base NUMERIC DEFAULT 0, -- stock in base unit (g or ml)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_id)
);

-- Enable RLS for new tables
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_receipts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inventory tables
CREATE POLICY "Auth read inventory_items" ON inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read inventory_stock" ON inventory_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read inventory_receipts" ON inventory_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert inventory_receipts" ON inventory_receipts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update inventory_receipts" ON inventory_receipts FOR UPDATE TO authenticated USING (true);

-- Vista para consultar inventario con stock
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

-- Seed inventory_items
INSERT INTO inventory_items (item_key, name, unit_base, min_stock) VALUES
  ('maiz', 'Maíz Palomero', 'g', 5000),
  ('aceite', 'Aceite de Mantequilla', 'ml', 1000),
  ('flavacol', 'Flavacol', 'g', 200),
  ('glaze', 'Glaze Caramelo', 'g', 500),
  ('cheddar', 'Cheddar Powder', 'g', 300),
  ('flaming', 'Flaming Hot Powder', 'g', 300)
ON CONFLICT (item_key) DO NOTHING;

-- Seed inventory_stock with initial values
INSERT INTO inventory_stock (item_id, qty_base)
SELECT id, 
  CASE 
    WHEN item_key = 'maiz' THEN 4526
    WHEN item_key = 'aceite' THEN 860
    WHEN item_key = 'flavacol' THEN 985
    WHEN item_key = 'glaze' THEN 674
    WHEN item_key = 'cheddar' THEN 400
    WHEN item_key = 'flaming' THEN 350
    ELSE 0
  END
FROM inventory_items
ON CONFLICT (item_id) DO UPDATE SET qty_base = EXCLUDED.qty_base;

-- Table: product_lots
CREATE TABLE IF NOT EXISTS product_lots (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  batch_id UUID REFERENCES batches(id),
  product_id UUID REFERENCES products(id),
  barcode_value TEXT UNIQUE NOT NULL,
  units_produced INT NOT NULL,
  units_remaining INT NOT NULL,
  lot_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add flavor, grams, and sku_code to products if not exists
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavor TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS grams INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_code TEXT;

-- Seed batch_type_specs
INSERT INTO batch_type_specs (batch_type, yield_grams) VALUES 
  ('SALADA_12OZ', 8500),
  ('CARAMELO_8OZ', 5500)
ON CONFLICT (batch_type) DO NOTHING;

-- Seed lote inicial de maíz
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
      (SELECT COALESCE(qty_base, 0) FROM inventory_stock WHERE item_id = v_maiz_id),
      true,
      'Lote inicial de maíz'
    );
  END IF;
END $$;

-- FUNCTION: produce_batch
-- Creates a new batch with corn lot traceability
CREATE OR REPLACE FUNCTION produce_batch(
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

-- FUNCTION: pack_lot
-- Packs units from a batch into a product lot
CREATE OR REPLACE FUNCTION pack_lot(
  p_batch_id UUID,
  p_product_id UUID,
  p_units INT
) RETURNS TABLE(
  barcode_value TEXT,
  units_produced INT,
  units_remaining INT,
  lot_number TEXT
) AS $$
DECLARE
  v_grams_per_unit NUMERIC;
  v_grams_needed NUMERIC;
  v_grams_remaining NUMERIC;
  v_barcode TEXT;
  v_lot_number TEXT;
  v_batch_type TEXT;
BEGIN
  -- Get batch info
  SELECT b.grams_remaining, b.batch_type INTO v_grams_remaining, v_batch_type
  FROM batches b
  WHERE b.id = p_batch_id;

  -- Check if batch has grams_remaining configured
  IF v_grams_remaining IS NULL THEN
    RAISE EXCEPTION 'Batch % no tiene grams_remaining configurado', p_batch_id;
  END IF;

  -- Get product grams
  SELECT p.grams INTO v_grams_per_unit
  FROM products p
  WHERE p.id = p_product_id;

  -- Calculate grams needed
  v_grams_needed := v_grams_per_unit * p_units;

  -- Check if enough grams available
  IF v_grams_remaining < v_grams_needed THEN
    RAISE EXCEPTION 'No hay suficientes gramos en el batch. Disponible: %, Necesario: %', v_grams_remaining, v_grams_needed;
  END IF;

  -- Generate barcode and lot number
  v_barcode := 'LOT-' || SUBSTRING(p_batch_id::TEXT, 1, 8) || '-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS');
  v_lot_number := v_batch_type || '-' || TO_CHAR(NOW(), 'YYYYMMDD');

  -- Insert product_lot
  INSERT INTO product_lots (batch_id, product_id, barcode_value, units_produced, units_remaining, lot_number)
  VALUES (p_batch_id, p_product_id, v_barcode, p_units, p_units, v_lot_number);

  -- Update batch grams_remaining
  UPDATE batches
  SET grams_remaining = grams_remaining - v_grams_needed
  WHERE id = p_batch_id;

  -- Return result
  RETURN QUERY SELECT v_barcode, p_units, p_units, v_lot_number;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: mark_batch_as_sample
-- Marks the remaining grams in a batch as sample (sets grams_remaining to 0)
CREATE OR REPLACE FUNCTION mark_batch_as_sample(
  p_batch_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Update batch to set grams_remaining to 0
  UPDATE batches
  SET grams_remaining = 0,
      notes = COALESCE(notes || ' | ', '') || 'Restante marcado como muestra ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
  WHERE id = p_batch_id;

  -- Verify batch exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % no encontrado', p_batch_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
