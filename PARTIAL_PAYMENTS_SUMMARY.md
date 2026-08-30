# RESUMEN EJECUTIVO: Sesión #3 - Análisis de Pagos Parciales

**Fecha**: 22 de agosto de 2026  
**Duración**: Análisis exhaustivo  
**Status Final**: 🛑 BLOQUEADO (Esperando confirmación de Supabase)  

---

## 📌 OBJETIVO

Implementar funcionalidad para que admins paguen **comisiones parciales** en lugar de pagar el monto completo:

```
ANTES (actual):
┌─────────────────────────────────┐
│ Disponible: $1,495.00           │
│ Opción: Pagar $1,495.00 (todo)  │
└─────────────────────────────────┘

DESPUÉS (deseado):
┌─────────────────────────────────┐
│ Disponible: $1,495.00           │
│ Input: [$100.00] (parcial)      │
│ Opción: Pagar $100.00           │
│ Saldo: $1,395.00 para próx pago │
└─────────────────────────────────┘
```

---

## ✅ ANÁLISIS COMPLETADO

### 1. Componentes Identificados
- ✅ PayCommissionsButton.tsx - Entry point
- ✅ CommissionPaymentModal.tsx - 2-step modal
- ✅ CommissionSettlementSummary.tsx - Step 1 display
- ✅ CommissionPaymentMethod.tsx - Step 2 selector
- ✅ paymentUtils.ts - RPC wrappers

### 2. Flujo Actual Mapeado
```
User clicks "Pagar comisiones $1,495"
        ↓
Modal opens (totalAmount=$1,495 - FIXED)
        ↓
Step 1: CommissionSettlementSummary
        Shows: "Monto a pagar: $1,495.00" (STATIC <p> tag)
        ↓
Click "Preparar pago"
        ↓
RPC: createCommissionSettlement(seller, period_start, period_end)
        ← NO TIENE PARÁMETRO p_amount
        ↓
        Returns: total_amount=$1,495, event_count=5
        ↓
Step 2: Select payment method (transfer/cash)
        ↓
Click "Confirmar pago"
        ↓
RPC: payCommissionSettlement(settlement_id, method, proof, ...)
        ← NO TIENE PARÁMETRO p_amount
        ↓
Status: PAGADO COMPLETAMENTE (settlement_id marked as 'paid')
```

### 3. Bloqueadores Identificados
| # | Bloqueador | Ubicación | Severidad |
|---|-----------|-----------|-----------|
| 1 | RPC `createCommissionSettlement` falta `p_amount` | supabase.rpc() | 🔴 CRÍTICO |
| 2 | RPC `payCommissionSettlement` falta `p_amount` | supabase.rpc() | 🔴 CRÍTICO |
| 3 | Schema `commission_settlement_items` desconocido | Supabase BD | 🔴 CRÍTICO |
| 4 | Algoritmo FIFO no documentado | Supabase RPC | 🟠 ALTO |
| 5 | Status de `commission_events` para partial pagos | Supabase BD | 🟠 ALTO |
| 6 | UI sin input editable | CommissionSettlementSummary.tsx | 🟡 MEDIO |

---

## 🛑 DECISIÓN: NO PROCEDER (Por Instrucción #30)

### Razón
El sistema **actual NO soporta pagos parciales** a nivel de Base de Datos:

```typescript
// paymentUtils.ts línea 26
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
  // ❌ FALTA: p_amount
) => {
  const { data } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd
    // ❌ NO SE ENVÍA: p_amount
  });
  // El RPC calcula: total_amount = SUM de TODOS los eventos
  // No hay forma de limitar a monto parcial
};
```

### Instrucción #30 (Cumplida)
> "SI EL ESQUEMA NO SOPORTA PAGO PARCIAL... DETENERSE ANTES DE INVENTARLO"

✅ **Detuvimos**: No implementamos cambios sin confirmar soporte en BD  
✅ **Reportamos**: Documentamos exactamente qué SQL mínimo se necesita  
✅ **No inventamos**: No creamos cambios frontend sin soporte backend  

---

## 📋 REPORTES GENERADOS

### 1. PARTIAL_PAYMENT_ANALYSIS.md (Documento Técnico)
- ✅ Flujo actual de pagos (completo)
- ✅ RPC signatures actuales (diferencias marcadas)
- ✅ Cambios SQL mínimos necesarios
- ✅ Preguntas críticas sobre schema
- ✅ Estrategia FIFO requerida
- ✅ Cambios frontend listos (una vez BD confirme)
- ✅ Plan de implementación en 3 fases

### 2. DECISION_PARTIAL_PAYMENTS.md (Matriz de Decisión)
- ✅ Situación actual vs. requerido
- ✅ Cambios mínimos Supabase (con prioridades)
- ✅ Tabla de bloqueadores
- ✅ Próximos pasos (bloqueados)
- ✅ Matriz de escenarios

---

## 🚀 CAMBIOS REQUERIDOS EN SUPABASE

### ❌ Actualmente Falta
```sql
-- RPC create_commission_settlement
CREATE OR REPLACE FUNCTION create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE
  -- ❌ FALTA: p_amount NUMERIC DEFAULT NULL
)
```

### ✅ Debe Ser
```sql
-- RPC create_commission_settlement
CREATE OR REPLACE FUNCTION create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_amount NUMERIC DEFAULT NULL  -- ← NUEVO
)
```

### Lógica Requerida (Pseudocódigo)
```
IF p_amount IS NULL THEN
  -- Comportamiento actual (pagar TODO)
  SELECT eventos WHERE status='available' AND earned_at BETWEEN start AND end
ELSE
  -- Nuevo: FIFO hasta alcanzar p_amount
  Ordenar eventos por earned_at (FIFO)
  Acumular eventos hasta suma = p_amount
  Si hay evento final parcial:
    - Crear settlement_item con settlement_item_amount = PARTIAL
    - Evento original mantiene: commission_amount = COMPLETO
    - Evento se marca: status='partially_paid' O similar
END IF
```

---

## 📊 CAMBIOS FRONTEND (Listos para Implementar)

Una vez Supabase confirme soporte de `p_amount`:

### 1. CommissionSettlementSummary.tsx
**Cambio**: Reemplazar `<p>` estático con `<input type="number">`

```tsx
// ANTES (línea 51-54)
<p className="text-2xl font-bold text-yellow-400">
  {formatCurrency(totalAmount)}  {/* ← STATIC */}
</p>

// DESPUÉS
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
  paymentAmount  // ← NUEVO
);
```

### 3. paymentUtils.ts
**Cambio**: Actualizar firma de funciones

```typescript
// ANTES
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
) => { ... }

// DESPUÉS
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string,
  amount?: number  // ← NUEVO (opcional, backward compatible)
) => {
  const { data } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    ...(amount && { p_amount: amount })  // ← SOLO SI SE ESPECIFICA
  });
  ...
}
```

---

## ⏱️ ESTIMADOS

### Fase 1: Confirmación Supabase (BLOQUEANTE)
- ⏰ **24-48 horas** (depende de disponibilidad DBA)
- 📋 **Requerimientos**:
  - [ ] Definiciones SQL de 3 RPCs
  - [ ] Schema dump de `commission_settlement_items`
  - [ ] Confirmación: ¿Soporta partial amounts?

### Fase 2: Cambios Frontend (Si Supabase confirma)
- ⏰ **2 horas** (cambios simples)
- 📋 **Archivos a modificar**: 3
  - CommissionSettlementSummary.tsx
  - CommissionPaymentModal.tsx
  - paymentUtils.ts

### Fase 3: Testing & Deployment
- ⏰ **2 horas** (E2E + validaciones)
- 📋 **Escenarios**:
  - Pago de $100 de $1,495
  - Múltiples pagos parciales
  - FIFO ordering verification

**Total si Supabase confirma**: ~6 horas (24h de espera + 4h de desarrollo)

---

## 🎯 PRÓXIMO PASO

### Acción Inmediata
**Contactar DBA / Supabase Admin**:

```
📧 Asunto: Confirmación de Soporte para Pagos Parciales de Comisiones

Necesitamos confirmar:
1. ¿Puede RPC create_commission_settlement aceptar parámetro p_amount?
2. ¿Schema commission_settlement_items soporta settlement_item_amount?
3. ¿Cómo se marcan commission_events como parcialmente pagados?

Ver documentación: PARTIAL_PAYMENT_ANALYSIS.md (línea 110-240)
```

### Posibles Respuestas
| Respuesta | Acción |
|-----------|--------|
| "Sí, RPCs ya aceptan p_amount" | Proceder inmediatamente a Fase 2 |
| "No, pero podemos modificar en 24h" | Esperar modificación, luego Fase 2 |
| "No, requiere rewrite de BD" | Rechazar feature o proponer alternativa |
| "No sabemos / A investigar" | Validar (puede tomar semanas) |

---

## 📌 CONCLUSIÓN

✅ **Análisis completado exitosamente**  
🛑 **Implementación bloqueada por falta de soporte en Supabase**  
✅ **Cambios requeridos documentados y priorizados**  
✅ **Instrucción #30 cumplida** (no inventamos, reportamos)  

**Status**: Esperando confirmación de DBA/Supabase sobre:
- Parámetro `p_amount` en RPCs
- Schema de `commission_settlement_items` para partial amounts
- Algoritmo FIFO para seleccionar eventos

Una vez confirmado, la implementación es directa y toma ~4 horas.

---

**Documentación**: 
- [PARTIAL_PAYMENT_ANALYSIS.md](PARTIAL_PAYMENT_ANALYSIS.md) - Análisis técnico detallado
- [DECISION_PARTIAL_PAYMENTS.md](DECISION_PARTIAL_PAYMENTS.md) - Matriz de decisión

**Generado**: 22 de agosto de 2026  
**Autor**: GitHub Copilot (Claude Haiku 4.5)
