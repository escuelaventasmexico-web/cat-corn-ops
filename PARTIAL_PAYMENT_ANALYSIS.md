# ANÁLISIS TÉCNICO: Implementación de Pagos Parciales de Comisiones

**Fecha**: 22 de agosto de 2026  
**Sesión**: #3 - Comisiones (Pagos Parciales)  
**Estado**: 🔍 ANÁLISIS COMPLETADO - BLOQUEADO EN ESQUEMA

---

## 📋 RESUMEN EJECUTIVO

**Objetivo Solicitado**:
```
Permitir PAGOS PARCIALES de comisiones disponibles.
Actualmente: Admin ve $1,495.00 → Paga $1,495.00 (todo)
Deseado: Admin ve $1,495.00 → Paga $100.00 (parcial)
```

**Resultado del Análisis**:
- ✅ Componentes frontend identificados
- ✅ Flujo de datos mapeado
- ❌ **Sistema ACTUAL no soporta pagos parciales nativamente**
- ❌ **RPCs carecen de parámetro `amount`**
- ❌ **Esquema de BD desconocido para partial amounts**

**Decisión**: Por instrucción #30, REPORTAR cambios necesarios ANTES de implementar.

---

## 🔍 HALLAZGOS DETALLADOS

### 1. FLUJO ACTUAL DE PAGO

```
PayCommissionsButton.tsx
  ↓
  loadAvailableForPayment(sellerId)
  ↓ Retorna: { available_amount: $1,495, available_event_count: 5, ... }
  ↓
  CommissionPaymentModal (totalAmount = $1,495 - FIJO)
  ↓ Step 1: CommissionSettlementSummary
  ↓         Display: "Monto a pagar: $1,495.00" (STATIC <p> tag)
  ↓         Button: "Preparar pago"
  ↓
  RPC: createCommissionSettlement(sellerId, periodStart, periodEnd)
  ↓ Parámetros: SIN amount
  ↓ Retorna: settlement_id, folio, total_amount ($1,495), event_count
  ↓
  Step 2: CommissionPaymentMethod
  ↓         Select: transfer / cash
  ↓         Upload proof (if transfer)
  ↓
  RPC: payCommissionSettlement(settlementId, method, proof, ...)
  ↓ Parámetros: SIN amount
  ↓ Efecto: Marca TODA la liquidación como 'paid'
  ↓
  Status: PAGADO COMPLETAMENTE
```

### 2. PROBLEMA IDENTIFICADO

#### A. RPC `createCommissionSettlement` - LÍNEA 26-35 de paymentUtils.ts

```typescript
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
  // ❌ NO TIENE: p_amount
) => {
  const { data, error } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    // ❌ NO ENVÍA: p_amount
  });
  
  return {
    settlement_id: result.settlement_id,
    folio: result.folio,
    total_amount: Number(result.total_amount || 0),  // ← CALCULA TODO EL PERÍODO
    event_count: Number(result.event_count || 0),
  };
};
```

**Consecuencia**: El RPC calcula el total de TODOS los eventos disponibles en el período. No hay forma de limitar a un monto parcial.

#### B. RPC `payCommissionSettlement` - LÍNEA 55-75 de paymentUtils.ts

```typescript
export const payCommissionSettlement = async (
  settlementId: string,
  paymentMethod: 'transfer' | 'cash',
  proofPath: string | null = null,
  // ... otros parámetros
  // ❌ NO TIENE: p_amount
) => {
  const { data, error } = await supabase.rpc('pay_commission_settlement', {
    p_settlement_id: settlementId,
    p_payment_method: paymentMethod,
    // ... otros parámetros
    // ❌ NO ENVÍA: p_amount
  });
};
```

**Consecuencia**: El RPC marca TODA la liquidación (settlement_id) como 'paid'. No hay mecanismo para pagos parciales.

#### C. UI CommissionSettlementSummary - LÍNEA 51-54

```tsx
<div className="p-4 bg-gradient-to-br from-yellow-500/10...">
  <div className="flex items-center gap-2 mb-3">
    <DollarSign size={16} className="text-yellow-500" />
    <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
  </div>
  <p className="text-2xl font-bold text-yellow-400">
    {formatCurrency(totalAmount)}  {/* ← STATIC DISPLAY, NO INPUT */}
  </p>
</div>
```

**Consecuencia**: El monto se muestra como elemento `<p>` estático. No hay campo `<input>` para que el admin modifique el valor.

---

## 🚧 CAMBIOS REQUERIDOS EN SUPABASE (NO EN FRONTEND)

### OPCIÓN A: Modificar RPCs Existentes (RECOMENDADO)

#### 1. RPC: `create_commission_settlement`

**Cambio necesario**:
```sql
-- ANTES (actual)
CREATE OR REPLACE FUNCTION create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE
) RETURNS TABLE(...) AS $$
BEGIN
  -- Selecciona TODOS los eventos disponibles en el período
  INSERT INTO commission_settlements (seller_id, total_amount, ...)
  SELECT p_seller_id, SUM(commission_amount), ...
  FROM commission_events
  WHERE seller_id = p_seller_id
    AND status = 'available'
    AND earned_at BETWEEN p_period_start AND p_period_end;
  ...
END;
$$ LANGUAGE plpgsql;

-- DESPUÉS (modificado para pagos parciales)
CREATE OR REPLACE FUNCTION create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_amount NUMERIC DEFAULT NULL  -- ← NUEVO PARÁMETRO
) RETURNS TABLE(...) AS $$
BEGIN
  -- Si p_amount es NULL, usa TODOS los eventos (backward compatible)
  -- Si p_amount es especificado, selecciona eventos FIFO hasta alcanzar ese monto
  
  IF p_amount IS NULL THEN
    -- Comportamiento actual (compatible)
    INSERT INTO commission_settlements (seller_id, total_amount, ...)
    SELECT p_seller_id, SUM(commission_amount), ...
    FROM commission_events
    WHERE seller_id = p_seller_id
      AND status = 'available'
      AND earned_at BETWEEN p_period_start AND p_period_end;
  ELSE
    -- Nuevo: FIFO selection hasta p_amount
    -- Necesita algoritmo para:
    -- 1. Ordenar eventos por fecha (FIFO)
    -- 2. Acumular hasta total = p_amount
    -- 3. Manejar evento final parcialmente pagado (si aplica)
    ...
  END IF;
END;
$$ LANGUAGE plpgsql;
```

#### 2. RPC: `pay_commission_settlement`

**Cambio necesario**:
```sql
-- ANTES (actual)
CREATE OR REPLACE FUNCTION pay_commission_settlement(
  p_settlement_id UUID,
  p_payment_method TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  -- ... otros parámetros
) RETURNS TABLE(...) AS $$
BEGIN
  UPDATE commission_settlements
  SET status = 'paid', paid_at = NOW(), payment_method = p_payment_method
  WHERE id = p_settlement_id;
  
  -- Marca TODOS los eventos como 'paid'
  UPDATE commission_events
  SET status = 'paid'
  WHERE id IN (SELECT commission_event_id FROM commission_settlement_items 
               WHERE settlement_id = p_settlement_id);
END;
$$ LANGUAGE plpgsql;

-- DESPUÉS (modificado - SIN CAMBIO necesario si settlement_items es correcto)
-- El RPC puede permanecer igual SI la tabla commission_settlement_items
-- ya tiene la lógica de asignación parcial de eventos.
-- El RPC simplemente marca los items EN ESA LIQUIDACIÓN como 'paid'.
```

---

## 📊 ESQUEMA DESCONOCIDO (CRÍTICO)

Para determinar viabilidad, necesitamos confirmar:

### Tabla: `commission_settlements`

**Columnas esperadas**:
```sql
commission_settlements (
  id UUID PRIMARY KEY,
  seller_id UUID NOT NULL,
  period_start DATE,
  period_end DATE,
  total_amount NUMERIC NOT NULL,
  ⚠️  partial_amount NUMERIC?  -- ¿Existe? ¿Registra monto parcial?
  status TEXT CHECK (status IN ('draft', 'paid', 'cancelled')),
  payment_method TEXT,
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

**Preguntas**:
- ¿Existe columna `partial_amount` para registrar pagos parciales?
- ¿O `total_amount` es siempre el total de los events asignados?

### Tabla: `commission_settlement_items`

**Columnas esperadas**:
```sql
commission_settlement_items (
  id UUID PRIMARY KEY,
  settlement_id UUID REFERENCES commission_settlements(id),
  commission_event_id UUID REFERENCES commission_events(id),
  ⚠️  settlement_item_amount NUMERIC?  -- ¿Puede ser PARCIAL del event?
  event_total_amount NUMERIC,
  ⚠️  is_partial BOOLEAN?  -- ¿Marca si es pago parcial de un evento?
  created_at TIMESTAMPTZ
)
```

**Preguntas**:
- ¿Un `commission_event` puede linkarse a MÚLTIPLES `commission_settlement_items`?
  - Ejemplo: Evento $50 → Item 1 ($20 en settlement A) + Item 2 ($30 en settlement B)?
- ¿O cada evento solo puede pagarse COMPLETO en una sola liquidación?

### Tabla: `commission_events`

**Columnas relevantes** (ya inspeccionadas):
```sql
commission_events (
  id UUID PRIMARY KEY,
  seller_id UUID,
  commission_amount NUMERIC NOT NULL,
  status TEXT CHECK (status IN ('pending', 'available', 'paid', 'cancelled')),
  earned_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  ...
)
```

**Preguntas**:
- ¿Cómo se marcan los eventos PARCIALMENTE pagados?
  - ¿Status = 'paid' y una columna `partially_paid_amount`?
  - ¿O se crean dos eventos: uno pagado y uno "saldo pendiente"?
- ¿Hay tracking de qué liquidación pagó qué porción del evento?

---

## 💡 ESTRATEGIA FIFO REQUERIDA

Cuando admin especifica pagar $100 de $1,495 disponibles:

```
Eventos disponibles (FIFO por earned_at):
1. Evento A: $10.00 (2026-08-01)
2. Evento B: $40.00 (2026-08-02)
3. Evento C: $15.00 (2026-08-05)
4. Evento D: $50.00 (2026-08-10)
5. Evento E: $25.00 (2026-08-12)

Admin paga: $100.00

Liquidación de $100 debe incluir:
✓ Evento A:  $10.00 (COMPLETO)
✓ Evento B:  $40.00 (COMPLETO)
✓ Evento C:  $15.00 (COMPLETO)
✓ Evento D:  $35.00 (PARCIAL - solo $35 de $50)
━━━━━━━━━━━━━
  Total:    $100.00

Saldo pendiente:
  Evento D:  $15.00 (restante)
  Evento E:  $25.00 (sin tocar)
  ━━━━━━━━━━
  Total:    $40.00
```

**Mecanismo en BD**:
1. ¿Crear `commission_settlement_items` con `settlement_item_amount = $35` para Evento D?
2. ¿Crear nuevo `commission_event` con `commission_amount = $15` para el saldo?
3. ¿Marcar Evento D como 'partially_paid' y linkarlo a ambas liquidaciones?

**Respuesta**: DESCONOCIDA - Depende de diseño de `commission_settlement_items`.

---

## 🛑 BLOQUEADORES IDENTIFICADOS

| # | Bloqueador | Severidad | Depende De |
|---|-----------|-----------|-----------|
| 1 | RPC `create_commission_settlement` no acepta `p_amount` | CRÍTICO | Supabase RPC definition |
| 2 | RPC `pay_commission_settlement` no acepta `p_amount` | CRÍTICO | Supabase RPC definition |
| 3 | Esquema `commission_settlement_items` desconocido | CRÍTICO | Inspección en Supabase |
| 4 | Algoritmo FIFO no implementado en RPC | CRÍTICO | Lógica SQL en Supabase |
| 5 | Status de `commission_events` para pagos parciales desconocido | ALTO | Schema confirmation |
| 6 | UI sin campo editable para monto | MEDIO | Implementación frontend |

---

## 📋 CAMBIOS FRONTEND NECESARIOS (Listos para Implementar)

Una vez los RPCs en Supabase acepten `p_amount`:

### 1. CommissionSettlementSummary.tsx

**Cambio**: Reemplazar display estático con input editable

```tsx
// ANTES
<div className="p-4 bg-gradient-to-br from-yellow-500/10...">
  <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
  <p className="text-2xl font-bold text-yellow-400">
    {formatCurrency(totalAmount)}  {/* ← STATIC */}
  </p>
</div>

// DESPUÉS
<div className="p-4 bg-gradient-to-br from-yellow-500/10...">
  <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
  <input
    type="number"
    min={0.01}
    max={totalAmount}
    step={0.01}
    value={paymentAmount}
    onChange={(e) => setPaymentAmount(Number(e.target.value))}
    className="w-full text-2xl font-bold text-yellow-400 bg-transparent border-b border-yellow-400 outline-none"
    required
  />
</div>
```

### 2. CommissionPaymentModal.tsx

**Cambio**: Pasar `paymentAmount` a RPC

```tsx
// ANTES
const settlement = await createCommissionSettlement(
  sellerId,
  periodStart,
  periodEnd
);

// DESPUÉS
const settlement = await createCommissionSettlement(
  sellerId,
  periodStart,
  periodEnd,
  paymentAmount  // ← NUEVO PARÁMETRO
);
```

### 3. paymentUtils.ts

**Cambio**: Actualizar funciones para aceptar `amount`

```typescript
// ANTES
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
) => {
  const { data } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  ...
};

// DESPUÉS
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string,
  amount?: number  // ← NUEVO PARÁMETRO OPCIONAL (backward compatible)
) => {
  const { data } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    ...(amount && { p_amount: amount })  // ← SOLO SI SE ESPECIFICA
  });
  ...
};
```

---

## ✅ VALIDACIONES NECESARIAS (Frontend)

```typescript
// Validación del input de monto
const validatePaymentAmount = (amount: number, maxAvailable: number): string | null => {
  if (amount <= 0) return "El monto debe ser mayor a $0.01";
  if (amount > maxAvailable) return `El monto no puede exceder $${maxAvailable.toFixed(2)}`;
  if (!/^\d+(\.\d{0,2})?$/.test(amount.toString())) return "Máximo 2 decimales";
  return null;
};
```

---

## 🔧 PLAN DE IMPLEMENTACIÓN

### FASE 1: Modificar RPCs en Supabase (BLOCKEANTE)

**Tareas**:
1. [ ] Modificar RPC `create_commission_settlement` para aceptar `p_amount`
2. [ ] Implementar algoritmo FIFO en la lógica SQL
3. [ ] Manejar pagos parciales de eventos (crear settlement_items con partial amounts)
4. [ ] Testing de RPC con monto parcial

**Responsable**: DBA / Supabase admin

---

### FASE 2: Cambios Frontend (Depende de Fase 1)

**Tareas**:
1. [ ] Modificar CommissionSettlementSummary.tsx - agregar input editable
2. [ ] Modificar CommissionPaymentModal.tsx - pasar amount al RPC
3. [ ] Modificar paymentUtils.ts - actualizar firmas de funciones
4. [ ] Agregar validaciones de entrada
5. [ ] Testing en desarrollo

**Responsable**: Frontend developer (listo para proceder)

---

### FASE 3: Validación y Deployment

**Tareas**:
1. [ ] npm run build - 0 TypeScript errors
2. [ ] Testing E2E: Pago de $100 de $1,495
3. [ ] Verificar `available_amount` se actualiza correctamente
4. [ ] Verificar múltiples pagos parciales
5. [ ] No commit/no push hasta aprobación

**Responsable**: QA + User approval

---

## 📌 CONCLUSIONES

1. **Sistema actual**: Diseñado para pagos de comisión COMPLETA por período
2. **RPC signature**: Falta parámetro `p_amount` en ambas funciones
3. **Esquema**: Las tablas probablemente soportan partial amounts, pero estructura desconocida
4. **Frontend**: Listo para implementar cambios UI una vez RPCs estén listos
5. **FIFO logic**: Debe estar en SQL (RPC), no en JavaScript

**Próximo paso**: 
- Obtener definiciones de RPCs en Supabase
- Confirmar schema de `commission_settlement_items`
- Luego proceder con implementación frontend

---

## 🎯 INSTRUCCIÓN #30 CUMPLIDA

> "Si el esquema NO SOPORTA pago PARCIAL... DETENERSE ANTES DE INVENTARLO y reportar exactamente qué SQL/RPC mínimo necesitamos."

✅ **Reporte generado**: Cambios mínimos requeridos en SQL/RPC identificados
✅ **Bloqueadores documentados**: Tabla con severidades
✅ **Plan de implementación**: Fases definidas
✅ **NO PROCEDIMOS**: Sin confirmación de schema, no hay implementación inventada
