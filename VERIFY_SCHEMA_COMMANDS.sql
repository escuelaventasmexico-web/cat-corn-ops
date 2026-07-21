-- ═══════════════════════════════════════════════════════════════════════════════
-- SCRIPT DE VERIFICACIÓN: Estructura Real de Base de Datos Supabase
-- Ejecuta esto en la consola SQL de Supabase para confirmar qué tablas EXISTEN
-- ═══════════════════════════════════════════════════════════════════════════════

-- ✅ PASO 1: Listar TODAS las tablas en public schema
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- ✅ PASO 2: Inspeccionar columnas de commercial_partners (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'commercial_partners'
ORDER BY ordinal_position;

-- ✅ PASO 3: Inspeccionar columnas de commercial_partner_movements (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'commercial_partner_movements'
ORDER BY ordinal_position;

-- ✅ PASO 4: Inspeccionar columnas de commercial_partner_movement_items (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'commercial_partner_movement_items'
ORDER BY ordinal_position;

-- ✅ PASO 5: Inspeccionar columnas de commercial_partner_payments (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'commercial_partner_payments'
ORDER BY ordinal_position;

-- ✅ PASO 6: Inspeccionar columnas de wholesale_orders (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'wholesale_orders'
ORDER BY ordinal_position;

-- ✅ PASO 7: Inspeccionar columnas de wholesale_payments (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'wholesale_payments'
ORDER BY ordinal_position;

-- ✅ PASO 8: Inspeccionar columnas de wholesale_contracts (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'wholesale_contracts'
ORDER BY ordinal_position;

-- ✅ PASO 9: Inspeccionar columnas de profiles vs user_profiles
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name IN ('profiles', 'user_profiles')
ORDER BY table_name, ordinal_position;

-- ✅ PASO 10: Listar TODAS las funciones en schema public
SELECT 
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- ✅ PASO 11: Buscar funciones específicas
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('activate_wholesale_partner', 'is_commission_admin', 'generate_payment_verification_folio')
ORDER BY routine_name;

-- ✅ PASO 12: Listar TODAS las vistas en schema public
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'VIEW'
ORDER BY table_name;

-- ✅ PASO 13: Inspeccionar vista v_wholesale_order_totals (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'v_wholesale_order_totals'
ORDER BY ordinal_position;

-- ✅ PASO 14: Inspeccionar vista v_pending_payment_verifications (si existe)
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'v_pending_payment_verifications'
ORDER BY ordinal_position;

-- ✅ PASO 15: Listar relaciones de Foreign Keys
SELECT 
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- ✅ PASO 16: Contar filas en tablas principales (para validar datos)
SELECT 
  schemaname,
  tablename,
  n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- COMANDOS PARA DEPURACIÓN ESPECÍFICA
-- ═══════════════════════════════════════════════════════════════════════════════

-- Si commercial_partners EXISTE, verificar estructura exacta:
-- \d+ public.commercial_partners

-- Si la tabla existe, ver ejemplo de dato:
-- SELECT * FROM public.commercial_partners LIMIT 1;

-- Ver todas las constraints de una tabla:
-- SELECT constraint_name, constraint_type FROM information_schema.table_constraints 
-- WHERE table_name='commercial_partners';

-- Ver índices de una tabla:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'commercial_partners';

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTAS PARA LA EJECUCIÓN
-- ═══════════════════════════════════════════════════════════════════════════════

/*
INSTRUCCIONES:
1. Copia cada SELECT individual en la consola SQL de Supabase (SQL Editor)
2. Ejecuta uno por uno
3. Documenta los resultados

ESPERADOS vs REALES:
- El reporte SCHEMA_INSPECTION_REPORT.md predice que 9 tablas NO EXISTEN
- Este script confirmará si eso es verdad en tu BD viva

SI TODAS LAS TABLAS EXISTEN:
→ El schema.sql es un template incompleto
→ Las tablas reales están en Supabase pero no están documentadas en el repo
→ Necesitas hacer REVERSE ENGINEERING del esquema real

SI LAS TABLAS NO EXISTEN:
→ El proyecto está incompleto
→ Necesitas ejecutar las migraciones faltantes
→ O crear las tablas manualmente basadas en SCHEMA_INSPECTION_REPORT.md
*/
