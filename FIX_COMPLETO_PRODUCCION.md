# Fix Completo: Tandas Posibles + Trazabilidad Lotes de Maíz

## ✅ OBJETIVO 1: Arreglar "Tandas Posibles"

### Problema
Las tarjetas mostraban stock 0.00 a pesar de haber stock real en Supabase.

### Solución Implementada

**1. Vista `v_inventory_items_with_stock` creada:**
```sql
CREATE OR REPLACE VIEW v_inventory_items_with_stock AS
SELECT 
  ii.id, ii.item_key, ii.name, ii.base_unit, ii.active,
  COALESCE(ist.qty_base, 0) as stock_base
FROM inventory_items ii
LEFT JOIN inventory_stock ist ON ist.item_id = ii.id;
```

**2. Frontend actualizado ([Production.tsx](pages/Production.tsx)):**
- ✅ Consulta directa a `v_inventory_items_with_stock`
- ✅ Construcción correcta de `stockByKey` usando `item_key`
- ✅ Keys simplificadas: `maiz`, `aceite`, `flavacol`, `glaze`, `cheddar`, `flaming`
- ✅ Logs de debug temporales para verificar matching

**3. Recetas actualizadas:**
- Caramelo 8 oz: maiz (227g), aceite (60ml), glaze (113g)
- Salada 12 oz: maiz (340g), aceite (90ml), flavacol (15g)
- Cheddar 12 oz: + cheddar (20g)
- Flaming Hot 12 oz: + flaming (20g)

## ✅ OBJETIVO 2: Trazabilidad Lotes de Maíz

### Implementación

**1. Tabla `inventory_receipts` creada:**
```sql
CREATE TABLE inventory_receipts (
  id UUID PRIMARY KEY,
  item_id UUID REFERENCES inventory_items(id),
  lot_code TEXT,
  qty_in_base NUMERIC,
  qty_remaining_base NUMERIC,
  received_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE
);
```

**2. Columna `maiz_receipt_id` agregada a `batches`:**
```sql
ALTER TABLE batches ADD COLUMN maiz_receipt_id UUID REFERENCES inventory_receipts(id);
```

**3. Función `produce_batch` actualizada:**

La función ahora:
1. ✅ Busca lote activo de maíz (`active = true`)
2. ✅ Valida que `qty_remaining_base >= maiz_requerido`
3. ✅ Descuenta del lote: `qty_remaining_base -= maiz_requerido`
4. ✅ Guarda referencia en `batches.maiz_receipt_id`
5. ✅ Descuenta de `inventory_stock` (stock general)
6. ✅ Genera `lot_number` y `barcode_value` automáticamente
7. ✅ Lanza excepción si no hay lote activo: "No hay lote activo de maíz con suficiente cantidad"

**4. Frontend maneja errores específicos:**
```typescript
if (error.message.includes('No hay lote activo de maíz')) {
  throw new Error('❌ No hay costal activo de maíz. Necesitas registrar un nuevo costal...');
}
```

## 📁 Archivos Modificados

### SQL
1. **[schema.sql](schema.sql)**
   - Tabla `inventory_receipts` agregada
   - Tabla `batches` actualizada (+ maiz_receipt_id, lot_number, barcode_value)
   - Vista `v_inventory_items_with_stock` creada
   - Función `produce_batch` completamente reescrita
   - Item keys simplificados (maiz, aceite, glaze, cheddar, flaming)
   - Seed de lote inicial de maíz

2. **[migration_maiz_lotes.sql](migration_maiz_lotes.sql)**
   - Script de migración completo y standalone
   - Incluye UPDATE para cambiar keys antiguos
   - Crea lote de ejemplo automáticamente
   - Query de verificación al final

### Frontend
3. **[Production.tsx](pages/Production.tsx)**
   - Función `fetchInventoryStockMap()` usa vista
   - Keys de recetas actualizadas
   - Manejo de errores mejorado
   - Logs de debug temporales agregados

## 🚀 Instrucciones de Aplicación

### 1. Ejecutar Migración en Supabase

**Opción A: Usar schema.sql completo (recomendado para DB nueva)**
```bash
# Copiar todo schema.sql y ejecutar en SQL Editor de Supabase
```

**Opción B: Solo migración (para DB existente)**
```bash
# Copiar migration_maiz_lotes.sql y ejecutar en SQL Editor
```

### 2. Verificar Datos

Ejecuta este query en Supabase:

```sql
-- Ver inventario con stock
SELECT * FROM v_inventory_items_with_stock
ORDER BY item_key;

-- Ver lotes activos de maíz
SELECT 
  ir.lot_code,
  ir.qty_in_base,
  ir.qty_remaining_base,
  ir.active,
  ii.item_key,
  ii.name
FROM inventory_receipts ir
JOIN inventory_items ii ON ii.id = ir.item_id
WHERE ii.item_key = 'maiz' AND ir.active = true;

-- Ver últimas tandas con trazabilidad
SELECT 
  b.id,
  b.batch_type,
  b.lot_number,
  b.produced_at,
  ir.lot_code as maiz_costal
FROM batches b
LEFT JOIN inventory_receipts ir ON ir.id = b.maiz_receipt_id
ORDER BY b.produced_at DESC
LIMIT 10;
```

### 3. Probar en Frontend

1. Abre `/production` en el navegador
2. Abre la consola del navegador (F12)
3. Verifica los logs:
   ```
   [DEBUG] Rows from v_inventory_items_with_stock: [...]
   stockByItemKey {maiz: 4526, aceite: 860, ...}
   recipe Caramelo 8 oz requires [...]
   ```
4. Verifica que las tarjetas muestran números > 0
5. Intenta producir una tanda
6. Si no hay lote activo, debe mostrar error claro

### 4. Limpiar Logs

Después de verificar, busca y elimina todas las líneas con:
```typescript
// TODO: remove debug logs
```

## 📊 Cálculos Esperados (Stocks Iniciales)

| Item Key | Stock | Caramelo 8oz | Salada 12oz | Cheddar 12oz | Flaming 12oz |
|----------|-------|--------------|-------------|--------------|--------------|
| maiz     | 4526g | 227g ✓       | 340g ✓      | 340g ✓       | 340g ✓       |
| aceite   | 860ml | 60ml ✓       | 90ml ✓      | 90ml ✓       | 90ml ✓       |
| glaze    | 674g  | 113g ✓       | -           | -            | -            |
| flavacol | 985g  | -            | 15g ✓       | 15g ✓        | 15g ✓        |
| cheddar  | 400g  | -            | -           | 20g ✓        | -            |
| flaming  | 350g  | -            | -           | -            | 20g ✓        |

**Tandas Posibles:**
- Caramelo 8 oz: **5** (limitado por glaze: 674/113)
- Salada 12 oz: **9** (limitado por aceite: 860/90)
- Cheddar 12 oz: **9** (limitado por aceite)
- Flaming Hot 12 oz: **9** (limitado por aceite)

## 🔒 Reglas de Negocio Implementadas

1. ✅ Solo puede haber 1 lote activo por `item_key='maiz'`
2. ✅ Al producir tanda, se valida stock en ambos lados:
   - `inventory_stock.qty_base` (stock general)
   - `inventory_receipts.qty_remaining_base` (costal específico)
3. ✅ Si no hay lote activo, producción bloqueada
4. ✅ Trazabilidad completa: `batches.maiz_receipt_id` → costal usado
5. ✅ RLS habilitado en todas las tablas
6. ✅ No se modificó POS ni historial

## ⚠️ Notas Importantes

- **Item Keys Simplificados**: Cambiados de `maiz_palomero` a `maiz`, etc.
- **Migration incluye UPDATE**: Los keys antiguos se actualizan automáticamente
- **Lote Inicial**: Se crea automáticamente con 20kg si no existe
- **Batch Types**: Soporta tanto `CARAM8` como `CARAMELO_8OZ` (backwards compatible)
- **Logs Temporales**: Recuerda eliminarlos después de verificar

## 🐛 Debugging

Si algo no funciona:

1. **Ver logs en consola del navegador**
2. **Verificar que la vista existe:**
   ```sql
   SELECT * FROM v_inventory_items_with_stock LIMIT 5;
   ```
3. **Verificar item_keys:**
   ```sql
   SELECT item_key, name FROM inventory_items ORDER BY item_key;
   ```
4. **Verificar lote activo:**
   ```sql
   SELECT * FROM inventory_receipts WHERE active = true;
   ```
5. **Probar función manualmente:**
   ```sql
   SELECT produce_batch('SALADA_12OZ', 'Test manual');
   ```

## ✨ Próximos Pasos (Opcional)

1. Agregar UI para gestionar lotes de maíz (registrar nuevos costales)
2. Mostrar en UI qué costal está activo
3. Alertar cuando un costal esté por terminarse
4. Extender trazabilidad a otros ingredientes
5. Reportes de consumo por lote
