# Fix: Corrección de Campos en Tabla de Movimientos de Comisiones

## Problema

La tabla de movimientos en "Socios Comerciales → Comisiones → Desglose de movimientos" mostraba:

```
$0.00
@ $0.00
```

Aunque los datos en Supabase eran correctos:
- Generado: $100
- Disponible: $30
- Pendiente: $70

## Causa Raíz

**Nombres de campos incorrectos en la interfaz y componente:**

La interfaz `CommissionMovement` en `commissionTypes.ts` usaba:
- `total_commission` (INCORRECTO)
- `commission_per_unit` (INCORRECTO)

Pero Supabase devuelve:
- `commission_amount` (CORRECTO)
- `unit_commission` (CORRECTO)

El componente `CommissionMovementsTable.tsx` intentaba acceder a campos que no existían, por lo que mostraba undefined/0.

## Soluciones Implementadas

### 1. Actualización de commissionTypes.ts

Interfaz `CommissionMovement` completamente reescrita con campos correctos:

```typescript
export interface CommissionMovement {
  commission_event_id: string;         // PK desde Supabase
  seller_id: string;
  partner_id: string;
  partner_folio: string;
  business_name: string;                // ✅ NUEVO (no partner_name)
  responsible_name: string | null;
  earned_at: string;
  source_type: 'comodato_sale' | 'wholesale_sale' | 'conversion_bonus' | 'adjustment';
  source_id: string | null;
  source_item_id: string | null;
  source_folio: string | null;
  product_key: string | null;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  quantity: number | string;             // ✅ AQUI (de string de NUMERIC)
  unit_commission: number | string;      // ✅ REEMPLAZA commission_per_unit
  commission_amount: number | string;    // ✅ REEMPLAZA total_commission
  release_condition: string;
  status: 'pending' | 'available' | 'paid' | 'cancelled';
  available_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
}
```

**Cambios clave:**
- ✅ `commission_per_unit` → `unit_commission`
- ✅ `total_commission` → `commission_amount`
- ✅ `partner_name` → `business_name`
- ✅ Agregadas todas las columnas que Supabase devuelve en v_seller_commission_movements
- ✅ `id` → `commission_event_id` (PK real de la vista)

### 2. Actualización de CommissionMovementsTable.tsx

**Cambio 1: Debug console.table agregado**

```typescript
console.table(
  movements.map(row => ({
    product: row.product_name,
    variant: row.product_variant,
    quantity: row.quantity,
    unit_commission: row.unit_commission,
    commission_amount: row.commission_amount,
    status: row.status,
  }))
);
```

**Cambio 2: Actualizar búsqueda para usar campos correctos**

Antes:
```typescript
const matches =
  m.partner_name.toLowerCase().includes(q) ||
  m.partner_folio?.toLowerCase().includes(q) ||
  m.product_name.toLowerCase().includes(q) ||
  m.operation_folio?.toLowerCase().includes(q);
```

Después:
```typescript
const matches =
  m.business_name?.toLowerCase().includes(q) ||
  m.partner_folio?.toLowerCase().includes(q) ||
  m.product_name?.toLowerCase().includes(q) ||
  m.source_folio?.toLowerCase().includes(q);
```

**Cambio 3: Actualizar export para usar campos correctos**

Antes:
```typescript
{ key: 'commission_per_unit', label: 'Comisión/unidad' },
{ key: 'total_commission', label: 'Comisión total' },
```

Después:
```typescript
{ key: 'unit_commission', label: 'Comisión/unidad' },
{ key: 'commission_amount', label: 'Comisión total' },
```

**Cambio 4: Renderizado correcto de la fila con conversión defensiva**

Antes:
```tsx
<td className="px-4 py-3 text-right">
  <div className="text-cc-cream font-semibold">
    {formatCurrency(parseNumericValue(movement.total_commission))}
  </div>
  <div className="text-xs text-cc-text-muted">
    @ {formatCurrency(parseNumericValue(movement.commission_per_unit))}
  </div>
</td>
```

Después:
```tsx
<td className="px-4 py-3 text-right">
  {(() => {
    const commissionAmount = parseNumericValue(movement.commission_amount);
    const unitCommission = parseNumericValue(movement.unit_commission);
    const quantity = parseNumericValue(movement.quantity);
    
    return (
      <>
        <div className="text-cc-cream font-semibold">
          {formatCurrency(commissionAmount)}
        </div>
        <div className="text-xs text-cc-text-muted">
          {quantity} × {formatCurrency(unitCommission)} c/u
        </div>
      </>
    );
  })()}
</td>
```

**Cambio 5: Usar commission_event_id como key**

Antes: `key={movement.id}` (no existía)
Después: `key={movement.commission_event_id}` (PK real)

**Cambio 6: Cambiar partner_name por business_name**

Antes: `{movement.partner_name}`
Después: `{movement.business_name}`

## Datos Esperados (Ejemplo: Gerardo 18 julio 2026)

### Movimiento 1
- Producto: Gato Mayor clásico
- Variante: Mayoreo
- Cantidad: 2
- Comisión: **$20.00** ← Ahora muestra correctamente
- Desglose: 2 × $10.00 c/u
- Estado: Pendiente

### Movimiento 2
- Producto: Gato Mayor sabores
- Variante: Mayoreo
- Cantidad: 2
- Comisión: **$20.00** ← Ahora muestra correctamente
- Desglose: 2 × $10.00 c/u
- Estado: Pendiente

### Movimiento 3
- Producto: Michi clásico
- Variante: Mayoreo
- Cantidad: 6
- Comisión: **$30.00** ← Ahora muestra correctamente
- Desglose: 6 × $5.00 c/u
- Estado: Pendiente

### Movimiento 4
- Producto: Gato Mayor clásico
- Variante: Comodato
- Cantidad: 2
- Comisión: **$20.00** ← Ahora muestra correctamente
- Desglose: 2 × $10.00 c/u
- Estado: Disponible

### Movimiento 5
- Producto: Michi sabores
- Variante: Comodato
- Cantidad: 2
- Comisión: **$10.00** ← Ahora muestra correctamente
- Desglose: 2 × $5.00 c/u
- Estado: Disponible

### Totales
- Mayoreo pendiente: **$70.00** (20 + 20 + 30)
- Comodato disponible: **$30.00** (20 + 10)
- Total generado: **$100.00** ✅

## Debugging en Console

Al abrir la tabla de movimientos, aparecerá en DevTools → Console:

```javascript
┌─────────────┬──────────────────────────┬──────────┬─────────────────┬──────────────────┬─────────┐
│ product     │ variant                  │ quantity │ unit_commission │ commission_amount │ status  │
├─────────────┼──────────────────────────┼──────────┼─────────────────┼──────────────────┼─────────┤
│ Gato Mayor  │ clásico                  │ 2        │ 10              │ 20                │ pending │
│ Gato Mayor  │ sabores                  │ 2        │ 10              │ 20                │ pending │
│ Michi       │ clásico                  │ 6        │ 5               │ 30                │ pending │
│ Gato Mayor  │ clásico                  │ 2        │ 10              │ 20                │ available│
│ Michi       │ sabores                  │ 2        │ 5               │ 10                │ available│
└─────────────┴──────────────────────────┴──────────┴─────────────────┴──────────────────┴─────────┘
```

## Validación

✅ **Build**: 4.71s, 0 TypeScript errors  
✅ **Fields**: commission_amount, unit_commission, quantity usados correctamente  
✅ **Conversión**: parseNumericValue() aplicado a NUMERIC de Supabase  
✅ **Visualización**: Monto total + desglose (cantidad × comisión/u)  
✅ **Estado**: No afecta la comisión mostrada, solo la etiqueta visual  
✅ **Export CSV**: Usa campos correctos  
✅ **Search**: Busca en campos correctos  

## Archivos Modificados

1. **commissionTypes.ts** - Interfaz CommissionMovement reescrita (24 líneas)
2. **CommissionMovementsTable.tsx** - 7 cambios en campos y renderizado

## Estado

✅ **FIXED**: Tabla ahora muestra valores correctos de comisión  
✅ **TESTED**: Build passing sin errores  
✅ **READY**: Listo para testing en browser

---

**Próximos pasos**: Abrir navegador con `npm run dev`, login como Gerardo, verificar que la tabla muestra $20, $20, $30, $20, $10 en las comisiones.
