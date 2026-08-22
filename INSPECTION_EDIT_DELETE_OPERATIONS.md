# 🔍 INSPECCIÓN: Edit/Delete de Operaciones Comerciales

**Fecha**: 2026-08-22
**Objetivo**: Determinar viabilidad de implementar Edit/Delete para Mayoreo + Comodato sin SQL improvisado
**Status**: INSPECTION PHASE - PRE-IMPLEMENTATION

---

## HALLAZGOS DE INSPECCIÓN - ACTUALIZADO

### 1. COMPONENTES MAYOREO

#### Archivo: [WholesaleOrderHistory.tsx](components/commercialPartners/wholesale/WholesaleOrderHistory.tsx)

**Líneas**: 1-120 (120 total)
**Propósito**: Listar pedidos mayoreo de un socio
**Estado Actual**: 
- Botón actual: `[Eye] Detalle` (línea 94-97)
- Renderiza: `WholesaleOrderDetailModal` (línea 103)
- NO tiene Edit/Delete botones

**Estructura de Renderizado**:
```
WholesaleOrderHistory
  ↓ (por cada orden)
  <Card con 4 columnas>
    - Folio (UUID slice 0:8)
    - Fecha (order_date)
    - Total (total.total_amount)
    - Pago (status badge)
    - Botón "Detalle" [Eye]
```

**Query Actual**:
- wholesale_orders (por partner_id, order by order_date DESC)
- v_wholesale_order_totals (merge by wholesale_order_id)

**Datos Cargados en Cada Card**:
```tsx
order: WholesaleOrder & { total?: WholesaleOrderTotal }
  id: string
  partner_id: string
  order_date: string
  delivery_date: string
  payment_terms_hours: number
  minimum_order_pieces: number
  order_status: string ('draft' | 'delivered' | 'cancelled')
  notes?: string | null
  total?: {
    wholesale_order_id: string
    total_amount: number
    paid_amount: number
    pending_amount: number
    computed_payment_status: string
  }
```

---

### 2. COMPONENTES COMODATO

#### Archivo: [PartnerMovementHistory.tsx](components/commercialPartners/comodato/PartnerMovementHistory.tsx)

**Líneas**: 1-396 (396 total)
**Propósito**: Timeline de movimientos + pagos de comodato
**Estado Actual**:
- Renderiza timeline unificado (movimientos + pagos)
- Movement types: 'delivery' | 'settlement' | 'withdrawal' | 'spoilage' | 'adjustment' | 'visit'
- NO tiene Edit/Delete botones

**Estructura de Renderizado**:
```
PartnerMovementHistory
  ↓ (merge movements + payments into timeline)
  <TimelineItem[] sorted by date DESC>
    - Por cada movement: Tipo, resumen, detalles expandibles
    - Por cada payment: Fecha, monto, método
```

**Query Actual**:
- commercial_partner_movements (por partner_id, order by movement_date DESC, limit 60)
  + commercial_partner_movement_items (embebido)
- commercial_partner_payments (por partner_id, order by payment_date DESC, limit 60)

**Datos de Movimiento**:
```tsx
PartnerMovement:
  id: string
  partner_id: string
  movement_type: 'delivery' | 'settlement' | 'withdrawal' | 'spoilage' | 'adjustment' | 'visit'
  movement_date: string
  status: string
  total_amount_due: number
  next_visit_date?: string | null
  next_visit_reason?: string | null
  notes?: string | null
  created_by?: string | null
  created_at: string
  commercial_partner_movement_items?: [
    {
      id: string
      movement_id: string
      product_id?: string | null
      product_name: string
      product_variant?: string | null
      product_size?: string | null
      quantity_delivered: number
      quantity_sold: number
      quantity_withdrawn: number
      quantity_spoiled: number
      price_to_catcorn: number
      suggested_retail_price?: number | null
      amount_due: number
      spoilage_absorbed_by?: string | null
      notes?: string | null
    }
  ]
```

---

## DEPENDENCIAS IDENTIFICADAS - ACTUALIZADO

### 3A. DEPENDENCIAS MAYOREO (wholesale_orders)

#### Tabla: `wholesale_payments`
**FK**: `wholesale_order_id` → `wholesale_orders(id)`
**Status Codes**: `'completed' | 'paid'`
**Cuando Existe**: Orden YA TIENE PAGO registrado
**Restricción**: ❌ NO PERMITIR DELETE si existen pagos
**Restricción**: ❌ NO PERMITIR EDITAR MONTO si existen pagos

**Query Necesario**:
```sql
SELECT COUNT(*) 
FROM wholesale_payments 
WHERE wholesale_order_id = ?
  AND status IN ('completed', 'paid')
```

#### Tabla: `commission_events`
**Relación**: `source_type='wholesale_sale'` + `source_id` = `wholesale_order_id`
**Status**: `'pending' | 'available' | 'paid' | 'cancelled'`
**Cuando Existe**: Comisión generada por venta mayoreo
**Restricción**: ❌ BLOQUEAR DELETE si comisión está en `'available'` o `'paid'`
**Restricción**: ⚠️ PERMITIR DELETE si comisión en `'pending'` (sin liberar)

**Query Necesario** (UPDATE commission eventos a cancelled si DELETE permitido):
```sql
SELECT COUNT(*) FROM commission_events 
WHERE source_type = 'wholesale_sale' 
  AND source_id = ?
  AND status IN ('available', 'paid')
```

✅ **CONFIRMADO**: No es FK explícita. Es `source_id` con `source_type` discriminador.

### 3B. DEPENDENCIAS COMODATO (commercial_partner_movements con type='delivery')

#### Tabla: `commercial_partner_payment_verification_requests`
**FK**: `movement_id` → `commercial_partner_movements(id)`
**Status**: `'draft' | 'pending_review' | 'approved' | 'rejected' | 'cancelled'`
**Cuando Existe**: Verificación de pago asociada
**Restricción**: ❌ NO PERMITIR DELETE si status en `['pending_review', 'approved']`

#### Items Vendidos / Liquidaciones
**Relación**: Datos en `commercial_partner_movement_items`
- Si item tiene `quantity_sold > 0` → hay venta/liquidación posterior
- Si item tiene `quantity_withdrawn > 0` → hay retiro
- Si item tiene `quantity_spoiled > 0` → hay merma

**Restricción**: ❌ NO PERMITIR DELETE si cualquier item tiene:
- `quantity_sold > 0` (venta registrada)
- `quantity_withdrawn > 0` (retiro registrado)
- `quantity_spoiled > 0` (merma registrada)

✅ **CONFIRMADO**: Vendidos NO en tabla separada. Están en `movement_items` como campos numéricos.

---

## TABLA DE DEPENDENCIAS RESUMIDA

| Operación | Tabla Dependiente | Campo FK | Condición Bloqueo | Query Necesaria |
|-----------|-------------------|----------|-------------------|-----------------|
| DELETE mayoreo | `wholesale_payments` | `wholesale_order_id` | Existe pago `completed/paid` | COUNT by order_id |
| DELETE mayoreo | `commission_events` | `source_id` (w/ type=wholesale_sale) | Existe comisión `available/paid` | QUERY source_id+type |
| EDIT mayoreo items | `wholesale_payments` | (pago existe?) | Si existen pagos | COUNT by order_id |
| DELETE comodato | `movement_items` | (field) | Tiene venta/merma/retiro | Campos quantity_sold/withdrawn/spoiled |
| DELETE comodato | `payment_verification` | `movement_id` | Status `pending_review/approved` | COUNT by movement_id |

---

## CONCLUSIÓN: ¿SE NECESITA SQL?

### Mayoreo DELETE
```
✅ POSIBLE SIN SQL NUEVO:
   1. Comisiones usan source_id+source_type (NO FK) → Fácil verificación
   2. Supabase permite DELETE con check de dependencias
   3. RLS actual permite admin.delete() en wholesale_orders
```

### Mayoreo EDIT
```
✅ POSIBLE SIN SQL:
   - Queries de verificación (COUNT payments) son SELECT (sin RLS new)
   - UPDATE wholesale_order + items son DML normales
   - Reutilizar WholesaleOrderForm existente
```

### Comodato DELETE
```
✅ POSIBLE SIN SQL NUEVO:
   - Validación: leer movement + items, verificar quantities
   - Validación: COUNT payment_verification_requests
   - DELETE: solo si validation pasa
   - Borrar movement_items first, luego movements (o usar cascade)
```

### Comodato EDIT
```
✅ POSIBLE SIN SQL:
   - Reutilizar PartnerMovementForm existente
   - Validar: no tiene activity posterior antes de permitir
   - UPDATE movement + movement_items
```

---

## DIAGNÓSTICO FINAL

| Área | Necesita SQL Nuevo? | Razón |
|------|-------------------|-------|
| **Mayoreo EDIT** | ❌ NO | UPDATE directo + validación SELECT |
| **Mayoreo DELETE** | ❌ NO | Validación SELECT + DELETE directo |
| **Comodato EDIT** | ❌ NO | UPDATE directo + validación SELECT |
| **Comodato DELETE** | ❌ NO | Validación local + DELETE directo |

✅ **CONCLUSIÓN**: Todo es implementable con TypeScript + Supabase RLS actual. **NO SE NECESITA SQL IMPROVISADO**

---

## SIGUIENTES PASOS - LISTO PARA IMPLEMENTACIÓN

### Fase 1: Mayoreo Edit
1. Agregar botón "Editar" en WholesaleOrderHistory
2. Abrir WholesaleOrderForm (reutilizar)
3. Cargar order + items
4. Validar: si existe pago → bloquear edición de monto
5. PATCH wholesale_order + wholesale_order_items
6. Refrescar lista

### Fase 2: Mayoreo Delete
1. Agregar botón "Eliminar" en WholesaleOrderHistory
2. Mostrar modal de confirmación
3. Validar: pagos + comisiones en estado bloqueante
4. Si OK: DELETE wholesale_order_items, luego wholesale_orders
5. Si comisión en pending: Update a cancelled (opcional)
6. Refrescar lista

### Fase 3: Comodato Edit
1. Agregar botón "Editar" en PartnerMovementHistory (solo para delivery)
2. Abrir PartnerMovementForm (reutilizar)
3. Cargar movement + items
4. Validar: si item tiene venta/merma/retiro → bloquear edit
5. PATCH movement + items
6. Refrescar lista

### Fase 4: Comodato Delete
1. Agregar botón "Eliminar" en PartnerMovementHistory (solo delivery)
2. Mostrar modal de confirmación
3. Validar: items sin venta/merma/retiro + no hay payment_verification pending
4. Si OK: DELETE items first, luego movement
5. Refrescar lista

---

**ESTADO**: ✅ INSPECTION COMPLETA - **LISTO PARA IMPLEMENTACIÓN SIN SQL NUEVO**


