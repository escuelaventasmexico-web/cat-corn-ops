# Item Key Reference - Cat Corn OPS

## Propósito

Este documento lista todos los `item_key` usados en las recetas para facilitar el ajuste si los nombres en Supabase son diferentes.

## Keys Actuales en el Código

Las recetas en `Production.tsx` usan estos `item_key`:

```typescript
'maiz_palomero'       // Usado en todas las recetas
'aceite_mantequilla'  // Usado en todas las recetas
'flavacol'            // Usado en: Salada, Cheddar, Flaming Hot
'glaze_caramelo'      // Usado en: Caramelo
'cheddar_powder'      // Usado en: Cheddar
'flaming_hot_powder'  // Usado en: Flaming Hot
```

## Verificación en Supabase

Ejecuta este query para ver los `item_key` reales en tu base de datos:

```sql
SELECT 
  item_key,
  name,
  base_unit,
  active
FROM inventory_items
WHERE active = true
ORDER BY item_key;
```

## Variantes Posibles

Si en Supabase los `item_key` son diferentes, aquí están las variantes comunes:

| Código Actual       | Variantes Posibles              |
|---------------------|---------------------------------|
| `maiz_palomero`     | `maiz`, `maiz_mushroom`, `corn` |
| `aceite_mantequilla`| `aceite`, `butter_oil`, `oil`   |
| `flavacol`          | `flavacol`, `salt_seasoning`    |
| `glaze_caramelo`    | `glaze`, `caramel_glaze`        |
| `cheddar_powder`    | `cheddar`, `queso_cheddar`      |
| `flaming_hot_powder`| `flaming_hot`, `flaming`, `hot` |

## Cómo Ajustar si Hay Diferencias

### Opción A: Actualizar el Código (Recomendado)

Si en Supabase tienes `maiz` en vez de `maiz_palomero`, actualiza las recetas:

```typescript
// En Production.tsx, línea ~107
{ item_key: 'maiz', qty: 227, unit: 'g', label: 'Maíz', icon: Wheat },
```

### Opción B: Actualizar Supabase

Si prefieres mantener el código, actualiza los `item_key` en Supabase:

```sql
UPDATE inventory_items 
SET item_key = 'maiz_palomero' 
WHERE item_key = 'maiz';

UPDATE inventory_items 
SET item_key = 'aceite_mantequilla' 
WHERE item_key = 'aceite';

-- Etc...
```

## Recetas Completas

### Caramelo 8 oz
```typescript
items: [
  { item_key: 'maiz_palomero', qty: 227, unit: 'g', label: 'Maíz' },
  { item_key: 'aceite_mantequilla', qty: 60, unit: 'ml', label: 'Aceite' },
  { item_key: 'glaze_caramelo', qty: 113, unit: 'g', label: 'Glaze' },
]
```

### Salada 12 oz
```typescript
items: [
  { item_key: 'maiz_palomero', qty: 340, unit: 'g', label: 'Maíz' },
  { item_key: 'aceite_mantequilla', qty: 90, unit: 'ml', label: 'Aceite' },
  { item_key: 'flavacol', qty: 15, unit: 'g', label: 'Flavacol' },
]
```

### Cheddar 12 oz
```typescript
items: [
  { item_key: 'maiz_palomero', qty: 340, unit: 'g', label: 'Maíz' },
  { item_key: 'aceite_mantequilla', qty: 90, unit: 'ml', label: 'Aceite' },
  { item_key: 'flavacol', qty: 15, unit: 'g', label: 'Flavacol' },
  { item_key: 'cheddar_powder', qty: 20, unit: 'g', label: 'Cheddar' },
]
```

### Flaming Hot 12 oz
```typescript
items: [
  { item_key: 'maiz_palomero', qty: 340, unit: 'g', label: 'Maíz' },
  { item_key: 'aceite_mantequilla', qty: 90, unit: 'ml', label: 'Aceite' },
  { item_key: 'flavacol', qty: 15, unit: 'g', label: 'Flavacol' },
  { item_key: 'flaming_hot_powder', qty: 20, unit: 'g', label: 'Flaming Hot' },
]
```

## Debug: Encontrar Mismatches

Los logs de debug mostrarán si hay mismatches:

```
[DEBUG] Final stockMap keys: ['maiz', 'aceite', 'flavacol']
[DEBUG] Calculating tandas for recipe: Salada 12 oz
[DEBUG] Recipe ingredients keys: ['maiz_palomero', 'aceite_mantequilla', 'flavacol']
[DEBUG]   ⚠️ Missing ingredient: maiz_palomero not found in stockMap
```

Si ves este tipo de advertencias, significa que los `item_key` no coinciden.
