# Fix de Cálculo de Tandas Posibles - Producción

## Problema Identificado

Las tarjetas de recetas en la página de Producción mostraban **0 tandas posibles** e "INVENTARIO BAJO" a pesar de que el cuadro "Inventario de Insumos" mostraba stock disponible.

### Causa Raíz

La consulta SQL estaba intentando hacer un JOIN incorrecto entre `inventory_items` e `inventory_stock`. 

**Estructura Real en Supabase:**
- `inventory_items`: `id`, `item_key`, `name`, `base_unit`, `active`
- `inventory_stock`: `item_id` (FK → inventory_items.id), `qty_base`

**Problema:** El código intentaba usar `select('item_key, inventory_stock!inner(qty_base)')` pero esto no funcionaba correctamente con la relación por `item_id`.

## Solución Implementada

### 1. Consulta Corregida en Dos Pasos

```typescript
// Paso 1: Obtener todos los items
const { data: items } = await supabase
  .from('inventory_items')
  .select('id, item_key, name, base_unit')
  .eq('active', true);

// Paso 2: Obtener todos los stocks
const { data: stocks } = await supabase
  .from('inventory_stock')
  .select('item_id, qty_base');

// Paso 3: Mapear stock por item_id
const stockByItemId = {};
stocks.forEach(stock => {
  stockByItemId[stock.item_id] = stock.qty_base;
});

// Paso 4: Construir mapa final por item_key
const stockMap = {};
items.forEach(item => {
  stockMap[item.item_key] = stockByItemId[item.id] || 0;
});
```

### 2. Item Keys Esperados

Las recetas usan los siguientes `item_key` (deben coincidir exactamente con los de `inventory_items`):

| item_key en Código      | Alternativas Posibles    | Usado en Recetas       |
|-------------------------|--------------------------|------------------------|
| `maiz_palomero`         | `maiz`                   | Todas                  |
| `aceite_mantequilla`    | `aceite`                 | Todas                  |
| `flavacol`              | `flavacol`               | Salada, Cheddar, Flaming |
| `glaze_caramelo`        | `glaze_caramelo`, `glaze`| Caramelo              |
| `cheddar_powder`        | `cheddar`                | Cheddar               |
| `flaming_hot_powder`    | `flaming_hot`            | Flaming Hot           |

**⚠️ IMPORTANTE:** Si en Supabase los `item_key` son diferentes (ej: `maiz` en vez de `maiz_palomero`), actualiza las recetas en [Production.tsx](pages/Production.tsx#L100-L145) para que coincidan.

### 3. Logs de Debug

Los logs mostrarán:
```
[DEBUG] Inventory items: [{id, item_key, name, base_unit}, ...]
[DEBUG] Inventory stocks: [{item_id, qty_base}, ...]
[DEBUG] Mapping: maiz_palomero (Maíz Palomero) = 4526 g
[DEBUG] Final stockMap: {maiz_palomero: 4526, aceite_mantequilla: 860, ...}
[DEBUG] Calculating tandas for recipe: Caramelo 8 oz
[DEBUG]   - Maíz (maiz_palomero): stock=4526, qty=227, tandas=19
```

## Verificación en Supabase

Ejecuta este query para ver los `item_key` reales:

```sql
SELECT 
  ii.item_key,
  ii.name,
  ii.base_unit,
  COALESCE(ist.qty_base, 0) as stock
FROM inventory_items ii
LEFT JOIN inventory_stock ist ON ist.item_id = ii.id
WHERE ii.active = true
ORDER BY ii.item_key;
```

## Cálculos Esperados

Ejemplo con stocks de prueba:

### Receta: Caramelo 8 oz
| Ingrediente            | Requerido | Stock | Tandas |
|------------------------|-----------|-------|--------|
| maiz_palomero          | 227 g     | 4526 g| 19     |
| aceite_mantequilla     | 60 ml     | 860 ml| 14     |
| glaze_caramelo         | 113 g     | 674 g | **5**  |

**Resultado: 5 tandas** (limitado por Glaze)

### Receta: Salada 12 oz
| Ingrediente            | Requerido | Stock | Tandas |
|------------------------|-----------|-------|--------|
| maiz_palomero          | 340 g     | 4526 g| 13     |
| aceite_mantequilla     | 90 ml     | 860 ml| **9**  |
| flavacol               | 15 g      | 985 g | 65     |

**Resultado: 9 tandas** (limitado por Aceite)

## Pasos para Aplicar

1. **El código ya está actualizado** en [Production.tsx](pages/Production.tsx)

2. **Verifica los item_key en Supabase:**
   - Ejecuta el query SQL de verificación arriba
   - Si los `item_key` son diferentes, actualiza las recetas

3. **Refresca la página de Producción:**
   - Abre la consola del navegador (F12)
   - Busca los logs `[DEBUG]`
   - Verifica que las keys coincidan

4. **Si hay mismatch:**
   - Opción A: Actualiza `item_key` en Supabase para que coincidan con el código
   - Opción B: Actualiza las recetas en el código para que coincidan con Supabase

5. **Limpia los logs** después de verificar (busca `// TODO: remove debug logs`)

## Código Afectado

- ✅ [Production.tsx](pages/Production.tsx#L34-L88) - `fetchInventoryStockMap()` corregido
- ✅ [Production.tsx](pages/Production.tsx#L148-L167) - `calculateTandasPosibles()` con logs
- ✅ [Production.tsx](pages/Production.tsx#L100-L145) - Recetas con keys actualizados

## Notas

- No se modificó el resto de Producción (Producir Tanda, Empacar Lote, Historial)
- No se modificó el cuadro "Inventario de Insumos" (sigue usando `raw_materials`)
- La solución NO usa mocks, lee datos reales de Supabase
- TypeScript compile sin errores
