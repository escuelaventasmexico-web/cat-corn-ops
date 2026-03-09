-- Migration: Add inventory_items and inventory_stock tables
-- This creates the inventory system used by the Production page recipe cards

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

-- RLS Policies for inventory tables
CREATE POLICY "Auth read inventory_items" ON inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth read inventory_stock" ON inventory_stock FOR SELECT TO authenticated USING (true);

-- Seed inventory_items
INSERT INTO inventory_items (item_key, name, unit_base, min_stock) VALUES
  ('maiz_palomero', 'Maíz Palomero', 'g', 5000),
  ('aceite_mantequilla', 'Aceite de Mantequilla', 'ml', 1000),
  ('flavacol', 'Flavacol', 'g', 200),
  ('glaze_caramelo', 'Glaze Caramelo', 'g', 500),
  ('cheddar_powder', 'Cheddar Powder', 'g', 300),
  ('flaming_hot_powder', 'Flaming Hot Powder', 'g', 300)
ON CONFLICT (item_key) DO NOTHING;

-- Seed inventory_stock with test values (matching what you see in the UI)
INSERT INTO inventory_stock (item_id, qty_base)
SELECT id, 
  CASE 
    WHEN item_key = 'maiz_palomero' THEN 4526
    WHEN item_key = 'aceite_mantequilla' THEN 860
    WHEN item_key = 'flavacol' THEN 985
    WHEN item_key = 'glaze_caramelo' THEN 674
    WHEN item_key = 'cheddar_powder' THEN 400
    WHEN item_key = 'flaming_hot_powder' THEN 350
    ELSE 0
  END
FROM inventory_items
ON CONFLICT (item_id) DO UPDATE SET qty_base = EXCLUDED.qty_base;

-- Verify data
SELECT 
  ii.item_key,
  ii.name,
  ii.unit_base,
  COALESCE(ist.qty_base, 0) as stock
FROM inventory_items ii
LEFT JOIN inventory_stock ist ON ist.item_id = ii.id
ORDER BY ii.item_key;
