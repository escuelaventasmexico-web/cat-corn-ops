# 📋 Guía de Ejecución: Migración de Sistema de Correcciones de Ventas por Pieza

## 🎯 Resumen Ejecutivo

Esta migración implementa un **sistema de auditoría completo** para correcciones de productos en ventas por pieza. 

- **Archivo:** `/supabase/migrations/20260802_piece_sale_corrections.sql`
- **Líneas:** 704 (completo y validado)
- **Tipo:** Migración Supabase
- **Seguridad:** SECURITY DEFINER RPC + RLS + Validaciones (11 checks)
- **Financiero:** Recalcula totales, comisiones, solicitudes de pago automáticamente

---

## ✅ Checklist Pre-Ejecución

Antes de ejecutar, verifica:

- [ ] El archivo existe en: `/supabase/migrations/20260802_piece_sale_corrections.sql`
- [ ] Supabase está accesible (conexión a BD)
- [ ] Tienes permisos de admin en Supabase
- [ ] Backup de BD realizado (recomendado)
- [ ] Horario de bajo tráfico (sin vendedores/admins usando sistema)
- [ ] Navegador con sesión válida en Supabase

---

## 🚀 Pasos de Ejecución

### Opción A: SQL Editor de Supabase (Recomendado)

1. Entra a **Supabase Dashboard** → Tu proyecto
2. Ve a **SQL Editor**
3. Click **New Query**
4. Copia TODO el contenido de `20260802_piece_sale_corrections.sql`
5. Pega en el editor
6. Click **Run** (esquina superior derecha)
7. Espera mensaje: `"Migration successful"` o `"Query executed successfully"`

**Tiempo estimado:** 2-5 segundos

### Opción B: CLI de Supabase (Si tienes configurada)

```bash
# En la carpeta del proyecto
supabase migration up

# O manualmente
supabase db push
```

### Opción C: Desde Terminal (Solo si tienes psql instalado)

```bash
psql "postgresql://postgres:[password]@[host]:[port]/postgres" \
  -f /Users/mariana/Downloads/cat-corn-ops/supabase/migrations/20260802_piece_sale_corrections.sql
```

---

## 🔍 Qué se Ejecuta (Orden)

### 1️⃣ Tabla: `seller_piece_sale_corrections` (Auditoría)

```
CREATE TABLE seller_piece_sale_corrections
├─ id uuid (PK)
├─ sale_id, sale_item_id, seller_id, corrected_by (FKs)
├─ correction_reason text (≥10 caracteres)
├─ before_snapshot, after_snapshot jsonb
├─ Financial tracking (4 campos)
├─ Payment tracking (2 campos)
├─ Timestamps
├─ Constraints (reason_length, positive_amounts)
├─ Foreign Keys (4)
└─ Indexes (5)
```

**Impacto:** 0 registros existentes, table nueva
**Reversible:** Sí (DROP TABLE IF EXISTS)

### 2️⃣ RPC: `correct_piece_sale_item()`

```
SECURITY DEFINER - EJECUTA COMO POSTGRES (seguro)

Parámetros:
├─ p_sale_id uuid
├─ p_sale_item_id uuid
├─ p_new_product_id uuid
├─ p_new_quantity integer
└─ p_reason text (≥10 chars)

Devuelve:
├─ sale_folio
├─ previous_total, new_total
├─ previous_commission, new_commission
├─ payment_request_status
├─ payment_request_reset boolean
└─ correction_id uuid
```

**Validaciones:** 11 checks de seguridad antes de ejecutar
**Cálculos:** TODOS internos en RPC (nunca frontend)
**Transacciones:** Atómicas (todo o nada)

### 3️⃣ Vista: `v_piece_sale_correction_history` (Nueva)

Muestra historial completo con nombres resueltos:
- Detalles de venta
- Información del vendedor
- Información del corrector
- Razón y snapshots
- Impacto financiero
- Tracking de pago

**Impacto:** 0 registros (vacia inicialmente)

### 4️⃣ Vista: `v_piece_sale_history` (Extendida)

Añade columnas al final:
- `corrections_count`
- `latest_correction_reason`
- `latest_correction_at`
- `latest_corrected_by_name`
- `has_corrections`

**Impacto:** 0 cambios a datos existentes, solo nuevas columnas
**Compatibilidad:** Hacia atrás (frontend existente no se rompe)

### 5️⃣ RLS Policies: `seller_piece_sale_corrections`

```
SELECT: Vendedor ve sus propias correcciones + Admin ve todas
INSERT: BLOQUEADO (false)
UPDATE: BLOQUEADO (false)
DELETE: BLOQUEADO (false)
```

**Impacto:** Todas las escrituras DEBEN ir por RPC
**Seguridad:** Vendedores no pueden modificar auditoría

### 6️⃣ Permisos RPC

```
GRANT EXECUTE ON correct_piece_sale_item TO authenticated
```

**Impacto:** Todos los usuarios autenticados pueden llamar RPC (validaciones internas lo controlan)

---

## 📊 Verificación Post-Ejecución

**Inmediatamente después de ejecutar**, verifica esto en SQL Editor:

### ✅ Test 1: Tabla existe

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'seller_piece_sale_corrections';
```

**Resultado esperado:** Una fila con `seller_piece_sale_corrections`

### ✅ Test 2: RPC existe y es callable

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'correct_piece_sale_item';
```

**Resultado esperado:** Una fila con `correct_piece_sale_item`

### ✅ Test 3: Vista nueva existe

```sql
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name = 'v_piece_sale_correction_history';
```

**Resultado esperado:** Una fila con `v_piece_sale_correction_history`

### ✅ Test 4: RLS está activo

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'seller_piece_sale_corrections';
```

**Resultado esperado:** `rowsecurity = true`

### ✅ Test 5: Reglas de comisión intactas

```sql
SELECT COUNT(*) as commission_rules_count
FROM public.seller_commission_rules
WHERE scheme = 'venta_pieza';
```

**Resultado esperado:** Número > 0 (mismo de antes)

---

## 🛑 Si Algo Falla

### Error: "Table already exists"
→ El archivo tiene `DROP TABLE IF EXISTS`, debería manejar esto. Si persiste:
```sql
DROP TABLE IF EXISTS public.seller_piece_sale_corrections CASCADE;
-- Luego vuelve a ejecutar la migración
```

### Error: "Function already exists"
→ El archivo recreará la función. Si falla:
```sql
DROP FUNCTION IF EXISTS public.correct_piece_sale_item(uuid, uuid, uuid, integer, text) CASCADE;
-- Luego vuelve a ejecutar la migración
```

### Error: "Foreign key constraint fails"
→ Las referencias a `seller_piece_sales`, `seller_piece_sale_items`, `user_profiles`, etc. deben existir. Verifica:
```sql
-- Verificar tablas base
SELECT COUNT(*) FROM public.seller_piece_sales;
SELECT COUNT(*) FROM public.seller_piece_sale_items;
SELECT COUNT(*) FROM public.user_profiles;
SELECT COUNT(*) FROM public.products;
SELECT COUNT(*) FROM public.seller_commission_rules WHERE scheme = 'venta_pieza';
```

### Error: "Permission denied"
→ Asegúrate de estar logueado como admin de Supabase, no con usuario de app.

---

## 🔄 Rollback (Si es Necesario)

Para revertir esta migración:

```sql
BEGIN;

-- Revertir RLS
DROP POLICY IF EXISTS prevent_select ON public.seller_piece_sale_corrections;
DROP POLICY IF EXISTS prevent_insert ON public.seller_piece_sale_corrections;
DROP POLICY IF EXISTS prevent_update ON public.seller_piece_sale_corrections;
DROP POLICY IF EXISTS prevent_delete ON public.seller_piece_sale_corrections;

-- Revertir RPC
DROP FUNCTION IF EXISTS public.correct_piece_sale_item(uuid, uuid, uuid, integer, text) CASCADE;

-- Revertir vistas
DROP VIEW IF EXISTS public.v_piece_sale_correction_history CASCADE;

-- Revertir tabla (DESTRUCTIVO)
DROP TABLE IF EXISTS public.seller_piece_sale_corrections CASCADE;

COMMIT;
```

**⚠️ Advertencia:** Esto elimina auditoría creada. Solo usar si detectas errores graves.

---

## 📝 Qué Sucede Después (ETAPA 2: Frontend)

Una vez **confirmado que la migración ejecutó correctamente**, procederé a:

1. ✅ Crear `PieceSaleItemCorrectionModal.tsx` (selector de producto, cantidad, razón)
2. ✅ Agregar botón "Corregir" a items en vista de detalle
3. ✅ Vista previa antes/después con impacto financiero
4. ✅ Integración de RPC sin actualizaciones directas a BD
5. ✅ Validaciones (status, cantidad, duplicados)
6. ✅ npm run build final

**Status del Frontend:** 🔴 BLOQUEADO hasta confirmación de Supabase

---

## ✨ Checklist Final

- [ ] Leístes esta guía
- [ ] Ejecutaste la migración en Supabase (copia/pega el SQL)
- [ ] Verifica los 5 tests post-ejecución
- [ ] Todo pasó ✅
- [ ] Confirmas a GitHub Copilot: "Migración ejecutada correctamente"
- [ ] Procedo a ETAPA 2: Frontend

---

## 📞 Soporte

Si hay dudas sobre:
- **SQL:** Revisa comentarios en el archivo `.sql`
- **Lógica RPC:** Ver sección de validaciones y cálculos
- **RLS:** Única tabla protegida, resto sin cambios
- **Frontend:** Espera hasta ETAPA 2

---

**🎯 Siguiente acción tuya:** Ejecuta la migración y confirma que pasó los 5 tests.
