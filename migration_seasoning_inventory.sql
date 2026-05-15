-- ============================================================
-- MIGRACIÓN: Inventario de Saborizantes
-- Ejecutar en Supabase Dashboard → SQL Editor
-- NO modifica raw_materials, inventory_items ni ninguna tabla existente
-- ============================================================

-- 1. Tabla maestra de saborizantes
CREATE TABLE IF NOT EXISTS public.seasoning_items (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,
  category             TEXT        NOT NULL CHECK (category IN ('sabores', 'caramelizadas')),
  active               BOOLEAN     DEFAULT true,
  min_quantity_numeric NUMERIC     NULL,
  min_unit             TEXT        NULL,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabla de conteos históricos
CREATE TABLE IF NOT EXISTS public.seasoning_counts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seasoning_item_id UUID        NOT NULL REFERENCES public.seasoning_items(id) ON DELETE CASCADE,
  count_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  quantity_text     TEXT        NOT NULL,
  quantity_numeric  NUMERIC     NULL,
  unit              TEXT        NULL,
  notes             TEXT        NULL,
  responsible       TEXT        NULL,
  needs_purchase    BOOLEAN     NOT NULL DEFAULT false,
  purchase_note     TEXT        NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Agregar columnas si la tabla ya existía sin ellas
ALTER TABLE public.seasoning_counts
  ADD COLUMN IF NOT EXISTS needs_purchase BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_note  TEXT;

-- 3. Índice de historial por saborizante
CREATE INDEX IF NOT EXISTS idx_seasoning_counts_item
  ON public.seasoning_counts(seasoning_item_id, count_date DESC);

-- 4. RLS (mismo patrón del sistema)
ALTER TABLE public.seasoning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasoning_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_seasoning_items" ON public.seasoning_items;
DROP POLICY IF EXISTS "auth_all_seasoning_counts" ON public.seasoning_counts;

CREATE POLICY "auth_all_seasoning_items" ON public.seasoning_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_seasoning_counts" ON public.seasoning_counts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- PASO A: Limpiar duplicados existentes ANTES de crear índice único
-- Agrupa por LOWER(TRIM(name)) + category para cubrir espacios/mayúsculas.
-- Conserva el registro más antiguo. Reasigna conteos antes de borrar.
-- ============================================================
DO $$
DECLARE
  r        RECORD;
  keep_id  UUID;
BEGIN
  FOR r IN
    SELECT LOWER(TRIM(name)) AS norm_name, category
    FROM public.seasoning_items
    GROUP BY LOWER(TRIM(name)), category
    HAVING COUNT(*) > 1
  LOOP
    -- Conservar el id más antiguo del grupo
    SELECT id INTO keep_id
    FROM public.seasoning_items
    WHERE LOWER(TRIM(name)) = r.norm_name AND category = r.category
    ORDER BY created_at ASC
    LIMIT 1;

    -- Reasignar conteos de duplicados al registro conservado
    UPDATE public.seasoning_counts
    SET seasoning_item_id = keep_id
    WHERE seasoning_item_id IN (
      SELECT id FROM public.seasoning_items
      WHERE LOWER(TRIM(name)) = r.norm_name AND category = r.category
        AND id <> keep_id
    );

    -- Eliminar duplicados
    DELETE FROM public.seasoning_items
    WHERE LOWER(TRIM(name)) = r.norm_name AND category = r.category
      AND id <> keep_id;
  END LOOP;
END $$;

-- ============================================================
-- PASO B: Crear índice único DESPUÉS de limpiar duplicados
-- Previene cualquier duplicado futuro por nombre+categoría activos
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_seasoning_name_category
  ON public.seasoning_items (LOWER(TRIM(name)), category)
  WHERE active = true;

-- ============================================================
-- PASO C: Seed inicial — idempotente (no inserta si ya existe)
-- Chipileta, Esquites y Pica fresa NO están en el seed (se marcan inactive)
-- ============================================================
INSERT INTO public.seasoning_items (name, category)
SELECT v.name, v.category
FROM (VALUES
  ('Flaming hot',          'sabores'),
  ('Chetos',               'sabores'),
  ('Crema y especies',     'sabores'),
  ('Salsas negras',        'sabores'),
  ('Cheddar',              'sabores'),
  ('Queso jalapeño',       'sabores'),
  ('Churrumaiz',           'sabores'),
  ('Mango hot',            'sabores'),
  ('Cheddar cremoso',      'sabores'),
  ('Doritos nachos',       'sabores'),
  ('Galleta de chocolate', 'caramelizadas'),
  ('Manzana verde',        'caramelizadas'),
  ('Caramelo',             'caramelizadas'),
  ('Cereza',               'caramelizadas'),
  ('Uva',                  'caramelizadas'),
  ('Mango dulce',          'caramelizadas')
) AS v(name, category)
WHERE NOT EXISTS (
  SELECT 1 FROM public.seasoning_items si
  WHERE LOWER(TRIM(si.name)) = LOWER(TRIM(v.name))
    AND si.category = v.category
    AND si.active = true
);

-- ============================================================
-- PASO D: Desactivar Chipileta, Esquites y Pica fresa
-- Usa active = false para conservar historial si existiera.
-- El frontend filtra active = true, así que dejan de aparecer.
-- ============================================================
UPDATE public.seasoning_items
SET active = false
WHERE category = 'sabores'
  AND LOWER(TRIM(name)) IN ('chipileta', 'esquites', 'pica fresa');
