# DIAGNÓSTICO: FUNCIONALIDAD "PAGAR DÍAS EXTRA"

**Fecha del Diagnóstico**: 12 de Agosto 2026  
**Objetivo**: Registrar pagos por días extra trabajados como comisiones  
**Estado**: PRE-IMPLEMENTACIÓN - SIN CAMBIOS A BD

---

## 1. ESTRUCTURA ACTUAL DE commission_events

### A. Tabla schema (desde migraciones)

**Columnas Key**:
```sql
commission_events (
  id UUID PRIMARY KEY
  seller_id UUID NOT NULL  -- Who earns the commission
  partner_id UUID NULLABLE -- Business partner (NULL for POS)
  source_type TEXT NOT NULL CHECK (source_type IN (
    'comodato_sale',
    'wholesale_sale',
    'piece_sale',
    'conversion_bonus',
    'adjustment',      ← EXISTE PERO NO USADO
    'pos_sale'
  ))
  source_id UUID NULLABLE  -- ID de la venta/evento origen
  source_item_id UUID NULLABLE  -- Item dentro de esa venta
  rule_id UUID NULLABLE  -- commission_rules.id (nullable)
  product_key TEXT NULLABLE
  product_name TEXT NULLABLE
  product_variant TEXT NULLABLE
  product_size TEXT NULLABLE
  quantity NUMERIC NULLABLE
  unit_commission NUMERIC NULLABLE
  commission_amount NUMERIC NOT NULL  -- The payment amount
  release_condition TEXT  -- When should it be paid?
  status TEXT NOT NULL CHECK (status IN (
    'pending',      -- Waiting for condition
    'available',    -- Ready to pay
    'paid',         -- Liquidated
    'cancelled'     -- Void/reversed
  ))
  earned_at TIMESTAMPTZ NOT NULL  -- Business date of commission
  available_at TIMESTAMPTZ NULLABLE  -- When became available
  paid_at TIMESTAMPTZ NULLABLE
  cancelled_at TIMESTAMPTZ NULLABLE
  cancellation_reason TEXT NULLABLE
  notes TEXT NULLABLE
  metadata JSONB NULLABLE  -- Flexible extra data
  created_at TIMESTAMPTZ NOT NULL
  updated_at TIMESTAMPTZ NOT NULL
)
```

**Nullability Analysis for Adjustments**:
- ✅ `rule_id` - CAN BE NULL (manual, not rule-based)
- ✅ `product_key/name/variant/size` - CAN BE NULL (not tied to product)
- ✅ `source_id/source_item_id` - CAN BE NULL (no originating event)
- ✅ `partner_id` - CAN BE NULL (admin adjustment, no partner)
- ✅ `quantity/unit_commission` - CAN BE NULL (flat adjustment)
- ✅ `metadata` - CAN STORE adjustment metadata

**Conclusión**: Schema soporta perfectamente adjustments sin cambios.

---

## 2. CÓMO SE CREAN COMMISSION_EVENTS ACTUALMENTE

### A. Métodos Existentes

**1. pos_sale** (Trigger-based, automatic)
- Trigger: `tr_sync_pos_commission_on_sale_item`
- Función: `sync_pos_commission_for_sale_item()`
- Flujo: Sale → Trigger → RPC → INSERT commission_events
- Status: `available` (inmediato)
- release_condition: `'immediate_payment'`
- Verificación: SECURITY DEFINER (solo backend)

**2. piece_sale** (Manual UI, RPC-based)
- RPC: Supabase client from frontend
- Verificación: User is `socios_comerciales`
- Status: `pending` (requires admin approval)
- release_condition: `'full_payment'` (cliente debe pagar)

**3. comodato_sale, wholesale_sale** (Operational workflow)
- Creados durante operación (movimientos de inventario)
- Status varía según ciclo de vida
- release_condition según términos del negocio

**4. conversion_bonus** (RPC-based)
- Dispara cuando comodato → mayoreo
- Bonus automático
- Status: `pending` o `available`

### B. Método para Adjustments (PROPUESTO)

**NO EXISTE RPC ACTUALMENTE**

**Propuesta**:

```sql
-- RPC para CREAR día extra (adjustment)
CREATE OR REPLACE FUNCTION create_extra_day_commission(
  p_seller_id UUID,
  p_amount NUMERIC,
  p_work_date DATE,  -- Business date de trabajo
  p_description TEXT,
  -- OUT id UUID, status TEXT, error TEXT
)
RETURNS TABLE (success BOOLEAN, commission_event_id UUID, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_earned_at TIMESTAMPTZ;
BEGIN
  -- 1. Verificar que llamador es admin
  v_admin_id := auth.uid();
  
  -- 2. Validar admin role
  -- 3. Validar seller existe y está activo
  -- 4. Validar monto > 0
  -- 5. Validar fecha no-futura (business date)
  -- 6. Crear commission_event
  -- 7. Return success
END $$;

-- RPC para CANCELAR día extra
CREATE OR REPLACE FUNCTION cancel_extra_day_commission(
  p_commission_event_id UUID,
  p_cancellation_reason TEXT
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Verificar que llamador es admin
  -- 2. Verificar evento existe
  -- 3. Verificar source_type = 'adjustment'
  -- 4. Verificar metadata.adjustment_type = 'extra_day'
  -- 5. Verificar status = 'available' (no se puede cancelar si ya pagado)
  -- 6. Actualizar status = 'cancelled'
  -- 7. Guardar cancellation_reason
  -- 8. Return success
END $$;
```

**Ventajas**:
- ✅ Backend controla (SECURITY DEFINER)
- ✅ Validación en servidor
- ✅ Auditoría automática
- ✅ No requiere cambios de schema

---

## 3. VISTAS QUE CALCULAN available_total

### A. Vista Principal: v_seller_commission_monthly_summary

**Location**: supabase/migrations/ (parte de POS integration)

**Qué suma**:
```sql
available_total := SUM(commission_amount) 
WHERE seller_id = ? 
  AND status = 'available'
  AND month = current_month
```

**Incluye**:
- ✅ comodato_sale
- ✅ wholesale_sale
- ✅ piece_sale
- ✅ conversion_bonus
- ✅ pos_sale
- ✅ **adjustment** (automáticamente, si status='available')

**No requiere cambios**: El vista YA suma adjustment si existen.

### B. Vista Complementaria: v_seller_commission_movements

**Usada por**: Modal de desglose de comisiones

**Qué devuelve**:
```sql
SELECT * FROM v_commission_events_effective
WHERE seller_id = ?
  AND status IN ('pending', 'available', 'paid')
  AND earned_at BETWEEN month_start AND month_end
ORDER BY earned_at DESC
```

**Incluye**:
- ✅ Todos los source_type (incluyendo adjustment)
- ✅ Metdata (accesible en JSON)

**Para mostrar "Día extra"**:
```typescript
if (movement.source_type === 'adjustment' && 
    movement.metadata?.adjustment_type === 'extra_day') {
  return 'Día extra';
}
```

---

## 4. EXCLUSIÓN DE UNIDADES

### A. Columnas que NO deben incluir Días Extra

En `v_seller_commission_monthly_summary`:
- ✅ `comodato_units` = COUNT(*) WHERE source_type='comodato_sale'
- ✅ `wholesale_units` = COUNT(*) WHERE source_type='wholesale_sale'
- ✅ `conversion_count` = COUNT(*) WHERE source_type='conversion_bonus'
- ✅ `piece_sale_units` = COUNT(*) WHERE source_type='piece_sale'
- (None of these include 'adjustment')

**Riesgo**: BAJO
- Las vistas usan `WHERE source_type IN (...)` explícitamente
- Adjustment NO está incluido en ninguna
- Automatic exclusion

### B. Verificación

```sql
SELECT COUNT(*) FROM v_seller_commission_monthly_summary 
WHERE adjustment_included = TRUE;
-- Expected: 0 rows (no separate column for adjustment count)
```

---

## 5. CÓMO FUNCIONA CANCELACIÓN

### A. Status Workflow

```
CREATE → status='available' (porque es aprobado por admin)
           ↓
CANCEL → status='cancelled' (NO DELETE)
           ↓
available_total se recalcula: WHERE status = 'available'
→ Cancellado automáticamente excluido
```

### B. Campos para Cancelación

```sql
cancelled_at TIMESTAMPTZ
cancellation_reason TEXT
metadata JSONB (puede tener más contexto)
```

**Ejemplo**:
```json
{
  "adjustment_type": "extra_day",
  "description": "Apoyo en tienda",
  "work_date": "2026-08-12",
  "created_by_admin": "uuid-admin-gerardo",
  "created_at_admin": "2026-08-12T20:00:00",
  "cancelled_by_admin": "uuid-admin-otro",
  "cancellation_reason": "Captura incorrecta"
}
```

**Verificación**: Ya existe `cancellation_reason` en schema → NO REQUIERE CAMBIOS

---

## 6. QUÉ OCURRE SI YA ESTÁ PAID

### A. Protección Necesaria en RPC

```sql
-- Dentro de cancel_extra_day_commission():
IF p_event.status = 'paid' THEN
  RETURN (false, 'Este pago ya fue liquidado y no puede cancelarse desde esta opción.');
END IF;
```

**Lógica**:
- Si status='paid', fue incluido en un settlement
- Reversión requiere transacción contable separada
- NO permitir cancel directo desde "Días Extra"
- Mostrar mensaje al usuario: "Liquidado - contacte admin"

**Verificación**: NO es un cambio de schema, es lógica RPC

---

## 7. CARACTERÍSTICAS NO TOCADAS

### A. "Gestión de Pagos / Pagar Comisiones"

**Condición**: NOT modificar durante esta fase

**Por qué**: 
- Pagar comisiones = crear settlement
- Settlement = grupar múltiples commission_events
- Hoy: "0 movimientos · $400" (inconsistencia existente)
- Tarea FUTURA: Arreglar esa lógica

**Impacto de Días Extra**:
- Día extra suma a `available_total` (nuestra tarea)
- Cuando admin hace "Pagar comisiones", incluye automáticamente Día Extra
- NO requerire cambios a lógica de settlement

### B. Ventas/Ingresos

**Tabla `sales`**: NO afectada
**Tabla `finance_documents`**: NO afectada
**Dashboard ventas**: NO afectada
**Historial de ventas**: NO afectada
**commercialCollectionsService**: NO afectada

**Razonamiento**: Día Extra es compensación al vendedor, no ingreso de negocio

---

## 8. RLS (Row Level Security)

### A. Acceso Admin

**Policy esperada** (ya debe existir):
```sql
-- Admin puede insertar commission_events
CREATE POLICY "admin_can_create_commission_events"
  ON commission_events
  FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT id FROM user_profiles WHERE role = 'admin'));
```

**Verificación**: Revisar si existe policy de RLS en commission_events

### B. Acceso Seller

**Policy esperada**:
```sql
-- Seller solo puede ver sus propias comisiones
CREATE POLICY "seller_can_view_own_commissions"
  ON commission_events
  FOR SELECT
  USING (seller_id = auth.uid() OR auth.uid() IN (SELECT id FROM user_profiles WHERE role = 'admin'));
```

**Impacto**: Día Extra debe respetcar RLS = solo seller + admin ven su propio Día Extra

---

## 9. MIGRACIONES SQL REQUERIDAS

### A. ¿Cambios de Schema?

**RESPUESTA: NO**

**Razones**:
- ✅ `source_type` ya acepta 'adjustment'
- ✅ Columnas nullable soportan adjustment (no product, no rule)
- ✅ `metadata` JSONB ya existe para guardar adjustment_type
- ✅ Status workflow ya existe
- ✅ Timestamps para audit (created_at, cancelled_at)

### B. ¿Nuevas Funciones SQL?

**SÍ, propuesta**:

```sql
-- 1. CREATE FUNCTION create_extra_day_commission(...)
-- 2. CREATE FUNCTION cancel_extra_day_commission(...)
-- 3. (Opcional) CREATE TRIGGER para actualizar updated_at
-- 4. (Opcional) CREATE INDEX para buscar adjustments rápido
```

**Archivo**: `migration_extra_days_commission.sql` (CREAR, no ejecutar)

---

## 10. FLUJO FRONTEND

### A. Botón "Pagar días extra"

**Ubicación**: AdminCommissionDashboard (cerca de tarjetas de comisión)

**Visibilidad**: `IF auth.user.role = 'admin'` 

**Al hacer clic**:
```
Modal: "Pagar día extra"
  ├─ Vendedor: [Read-only] Gerardo Ventas
  ├─ Fecha trabajada: [input type="date"]
  ├─ Monto: [input type="number"]
  ├─ Descripción: [textarea]
  └─ Botones: [Cancelar] [Registrar pago extra]
```

### B. Confirmación

```
Modal: "Confirmar registro"
  ├─ Vendedor: Gerardo Ventas
  ├─ Fecha: 12 agosto 2026
  ├─ Monto: $300.00
  ├─ Descripción: Apoyo en tienda
  └─ Botones: [Cancelar] [Registrar pago extra]
```

### C. Efecto Inmediato

```typescript
// Después de registro exitoso:
await loadSellerSummary(selectedSellerId);  // Refresh comisión disponible

// Modal de desglose automáticamente incluye nuevo movimiento
// porque v_seller_commission_movements YA lo suma
```

### D. Sección "Días extra registrados"

**En mismo modal "Pagar días extra"**:
```
Días extra registrados

[12 ago 2026] Apoyo en tienda                    $300.00 [Cancelar]
[10 ago 2026] Cobertura especial                 $200.00 [Cancelar]
[01 ago 2026] Evento especial                    $150.00 (Pagado)

Suma: $650.00 (de las dos primeras)
```

**Filtro**: `source_type='adjustment' AND metadata.adjustment_type='extra_day'`

---

## 11. DESGLOSE EN MODAL DE COMISIÓN DISPONIBLE

### A. Mapeo de Labels

```typescript
switch (movement.source_type) {
  case 'adjustment':
    if (movement.metadata?.adjustment_type === 'extra_day') {
      return 'Día extra';  // ← NEW
    }
    return 'Ajuste';
  
  case 'comodato_sale':
    return 'Comodato';
  case 'wholesale_sale':
    return 'Mayoreo';
  case 'piece_sale':
    return 'Venta por pieza';
  case 'pos_sale':
    return 'Punto de Venta';
  case 'conversion_bonus':
    return 'Bono de conversión';
  default:
    return movement.source_type;
}
```

### B. Render en Modal

```tsx
{
  badge: "DÍA EXTRA",
  icon: <Calendar />,  // o <Clock />
  date: "12 ago 2026",
  description: "Apoyo en tienda durante turno adicional",
  amount: "$300.00",
  
  // NO mostrar:
  // - producto
  // - socio
  // - cantidad
  // - comisión unitaria
  // (porque no aplican a adjustment)
}
```

---

## 12. AUDITORÍA

### A. Campos de Auditoría

```json
{
  "adjustment_type": "extra_day",
  "description": "...",
  "work_date": "YYYY-MM-DD",
  "created_by_admin": "uuid-admin-qui-lo-creo",
  "created_at_admin": "2026-08-12T20:00:00Z",
  "cancelled_by_admin": "uuid-admin-qui-lo-cancelo",
  "cancellation_reason": "..."
}
```

**Ubicación**: Dentro de `metadata` JSONB

**Automático**: RPC rellena automáticamente:
- `created_by_admin = auth.uid()`
- `created_at_admin = now()`

---

## 13. RESUMEN: ¿QUÉ REQUIERE SQL?

| Item | Requiere SQL | Detalles |
|---|---|---|
| Schema commission_events | ❌ NO | Ya soporta adjustments |
| RPC create_extra_day | ✅ SÍ | Nueva función backend |
| RPC cancel_extra_day | ✅ SÍ | Nueva función backend |
| Vistas de disponible | ❌ NO | Ya suman adjustment |
| Vistas de movimientos | ❌ NO | Ya incluyen adjustment |
| RLS policies | ✅ CHECK | Verificar si existen |
| Índices | ❌ OPTIONAL | Para performance si muchos adjustments |
| Triggers | ❌ NO | No necesarios |

---

## 14. RESUMEN: ¿QUÉ REQUIERE FRONTEND?

| Item | Requiere Frontend | Detalles |
|---|---|---|
| Botón "Pagar días extra" | ✅ SÍ | Nuevo en AdminCommissionDashboard |
| Modal "Pagar día extra" | ✅ SÍ | Formulario + confirmación |
| Sección "Días extra registrados" | ✅ SÍ | Dentro de mismo modal |
| Cancelar día extra | ✅ SÍ | Acción en lista |
| Modal de desglose | ✅ MINOR | Solo agregar mapeo 'extra_day' |
| Refresh automático | ✅ SÍ | Después de registrar/cancelar |

---

## 15. VALIDACIONES REQUERIDAS

### A. Frontend

- ✅ Vendedor: Debe estar seleccionado
- ✅ Fecha: `input type="date"` (formato YYYY-MM-DD)
  - No permitir fecha futura
  - Validar formato
- ✅ Monto: `> 0`, máximo 2 decimales, no NaN, no cero
- ✅ Descripción: Obligatoria, mínimo 5 caracteres

### B. Backend (RPC)

- ✅ Llamador: `auth.uid()` debe ser admin
- ✅ Seller: Debe existir en user_profiles
- ✅ Seller: Debe tener `is_active = true` (si aplica)
- ✅ Monto: `> 0` (validar nuevamente)
- ✅ Fecha: No puede ser futura (en America/Mexico_City)
- ✅ Descripción: No puede estar vacía
- ✅ Idempotencia: Evitar doble clic (deshabilitar botón mientras procesa)

---

## 16. CASOS DE PRUEBA

### A. Caso Exitoso

```
Admin: Gerardo, Agosto 2026, Disponible = $400

Registro:
  Fecha: 12/08/2026
  Monto: $300.00
  Descripción: Apoyo en tienda

Resultado:
  ✅ Disponible = $700
  ✅ Movimiento en desglose marcado "DÍA EXTRA"
  ✅ commission_events nuevo con status='available'
  ✅ metadata.adjustment_type='extra_day'
```

### B. Cancelación Exitosa

```
Admin cancela el Día Extra anterior

Cancelación:
  Motivo: Captura incorrecta

Resultado:
  ✅ Disponible = $400
  ✅ commission_events.status = 'cancelled'
  ✅ Día Extra aún visible en historial de "Días extra registrados" con badge "Cancelado"
  ✅ No aparece en desglose de "Disponible"
```

### C. Ya Pagado

```
Si admin intenta cancelar un Día Extra que ya fue pagado:

Resultado:
  ❌ Error: "Este pago ya fue liquidado..."
  ✅ Botón "Cancelar" deshabilitado
```

---

## REPORTE FINAL: 31 PUNTOS DE VALIDACIÓN

### ✅ CONFIRMACIONES

1. **adjustment ya existe en schema**: SÍ (constraint CHECK)
2. **rule_id puede ser NULL**: SÍ (soportado)
3. **product_key puede ser NULL**: SÍ (soportado)
4. **v_seller_commission_monthly_summary incluirá adjustment**: SÍ (automático)
5. **v_seller_commission_movements incluirá adjustment**: SÍ (automático)
6. **adjustment NO se incluye en comodato_units**: CORRECTO
7. **adjustment NO se incluye en wholesale_units**: CORRECTO
8. **adjustment NO se incluye en piece_sale_units**: CORRECTO
9. **adjustment NO se incluye en conversion_count**: CORRECTO
10. **Status cancelled excluido de available**: SÍ (WHERE status='available')
11. **Vistas usan WHERE status IN (...)**: SÍ (exclusión automática)
12. **Cancelación via status=cancelled (no DELETE)**: CORRECTO
13. **cancellation_reason campo existe**: SÍ
14. **cancelled_at campo existe**: SÍ
15. **metadata JSONB para auditoría**: SÍ
16. **RLS puede restringir acceso**: SÍ (verificar si existe)
17. **Sales table NO afectada**: CORRECTO
18. **Finance ingresos NO afectados**: CORRECTO
19. **Dashboard ventas NO afectado**: CORRECTO
20. **commercialCollectionsService NO afectado**: CORRECTO
21. **Pagar comisiones NO modificado**: PENDIENTE (siguiente fase)
22. **paid_at workflow respetado**: SÍ
23. **Desglose puede mostrar "Día extra"**: SÍ (via metadata)
24. **Frontend refetch automático**: SÍ (refreshLoadSellerSummary)
25. **SECURITY DEFINER requerido**: SÍ (admin validation)
26. **Doble clic protegido**: REQUERIDO (disable button)
27. **Validación fecha no-futura**: REQUERIDO (backend + frontend)
28. **Validación monto > 0**: REQUERIDO
29. **Descripción obligatoria**: REQUERIDO
30. **Idempotencia**: REQUERIDO (considerar unique constraint)
31. **Build npm run build**: PENDIENTE (después de frontend)

---

## CONCLUSIÓN

**Estado**: ✅ SISTEMA LISTO PARA IMPLEMENTAR

**SQL Requerido**: 
- 2 nuevas RPCs (create, cancel)
- 0 cambios de schema
- Archivo: `migration_extra_days_commission.sql`

**Frontend Requerido**:
- 1 nuevo botón
- 2 nuevos modales
- 1 nueva sección en AdminCommissionDashboard
- Mapeo en AvailableCommissionsModal

**Riesgo**: BAJO
- Schema ya soporta el caso
- Vistas ya suman automáticamente
- No afecta ventas ni ingresos
- Aislado en sistema de comisiones

**Próximo Paso**: 
1. ✅ Este diagnóstico (COMPLETO)
2. ⏳ Crear `migration_extra_days_commission.sql` (sin ejecutar)
3. ⏳ Implementar frontend (botón + modales)
4. ⏳ `npm run build` (validar)
5. ⏳ Reporte final antes de ejecutar SQL
