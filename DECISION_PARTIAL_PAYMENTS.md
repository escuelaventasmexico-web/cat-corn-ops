# DECISIÓN DE IMPLEMENTACIÓN: Pagos Parciales de Comisiones

**Sesión**: #3 - Análisis de Pagos Parciales de Comisiones  
**Fecha**: 22 de agosto de 2026  
**Estado**: 🛑 BLOQUEADO - ESPERANDO CONFIRMACIÓN DE SUPABASE  
**Instrucción**: #30 - Detenerse antes de inventar / Reportar cambios necesarios  

---

## 📌 SITUACIÓN ACTUAL

### Lo Que Existe
✅ **Frontend**: Componentes de pago completos
- CommissionPaymentModal.tsx (2-paso)
- CommissionSettlementSummary.tsx (display de datos)
- PayCommissionsButton.tsx (entry point)
- paymentUtils.ts (RPC wrappers)

✅ **Backend (RPCs)**: Funciones existentes
- `create_commission_settlement(seller_id, period_start, period_end)`
- `pay_commission_settlement(settlement_id, method, proof, ...)`
- `cancel_commission_settlement_draft(settlement_id, reason)`

✅ **Vistas**: 
- `v_commissions_available_for_payment` → available_amount (TOTAL del período)
- `v_commission_settlement_history` → registro de liquidaciones
- `v_commission_settlement_detail` → detalle de movimientos

---

## ❌ LO QUE NO EXISTE (BLOQUEANTE)

### 1. Parámetro `p_amount` en RPC `create_commission_settlement`

**Situación Actual** (paymentUtils.ts línea 26-40):
```typescript
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
  // ❌ NO EXISTE: p_amount
) => {
  const { data } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    // ❌ NO SE ENVÍA: p_amount
  });
  // Retorna: total_amount = SUM de TODOS los eventos en período
};
```

**Requisito Para Pagos Parciales**:
```sql
-- RPC modificado
CREATE OR REPLACE FUNCTION create_commission_settlement(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_amount NUMERIC DEFAULT NULL  -- ← NUEVO: Monto a pagar (NULL = todo)
)
RETURNS TABLE (
  settlement_id UUID,
  folio TEXT,
  total_amount NUMERIC,  -- ← Será p_amount (parcial) o total (completo)
  event_count INT
)
AS $$
BEGIN
  -- Lógica: Si p_amount es NULL, usa TODOS los eventos (comportamiento actual)
  --         Si p_amount > 0, selecciona eventos FIFO hasta alcanzar ese monto
  ...
END;
$$ LANGUAGE plpgsql;
```

**Impacto**: Sin este cambio, no hay forma de crear una liquidación parcial en BD.

---

### 2. Algoritmo FIFO en SQL (Desconocido)

**Requiere**: Implementación en el RPC anterior para:
1. Ordenar `commission_events` por `earned_at` (FIFO)
2. Acumular eventos hasta que suma ≥ p_amount
3. Manejar evento final que se paga parcialmente
4. Crear `commission_settlement_items` con los amounts correctos

**Ejemplo de Lógica Necesaria** (pseudocódigo):
```sql
DECLARE
  v_running_total NUMERIC := 0;
  v_remaining_amount NUMERIC := p_amount;
  v_event RECORD;
BEGIN
  FOR v_event IN (
    SELECT id, commission_amount
    FROM commission_events
    WHERE seller_id = p_seller_id
      AND status = 'available'
      AND earned_at BETWEEN p_period_start AND p_period_end
    ORDER BY earned_at ASC  -- FIFO
  ) LOOP
    IF v_remaining_amount <= 0 THEN EXIT; END IF;
    
    -- Insertar item con amount = MIN(event_amount, remaining)
    INSERT INTO commission_settlement_items (
      settlement_id, 
      commission_event_id,
      settlement_item_amount
    ) VALUES (
      v_settlement_id,
      v_event.id,
      LEAST(v_event.commission_amount, v_remaining_amount)
    );
    
    v_remaining_amount := v_remaining_amount - LEAST(v_event.commission_amount, v_remaining_amount);
  END LOOP;
END;
```

**Impacto**: Sin esta lógica, no hay forma de distribuir eventos FIFO en la liquidación.

---

### 3. Schema de `commission_settlement_items` - DESCONOCIDO

**Preguntas Críticas**:

¿Existe columna para amount parcial?
```sql
commission_settlement_items (
  id UUID,
  settlement_id UUID,
  commission_event_id UUID,
  ⚠️  settlement_item_amount NUMERIC?  -- ¿Existe?
  ⚠️  is_partial BOOLEAN?  -- ¿Existe?
)
```

¿Puede un `commission_event` aparecer en múltiples `settlement_items`?
- Escenario: Evento $50
  - Item 1: settlement A, $30
  - Item 2: settlement B, $20
- ¿Esto es posible en el schema actual?

**Impacto**: Sin confirmar schema, no sabemos si soporta partial amounts.

---

### 4. Status de `commission_events` para Pagos Parciales - DESCONOCIDO

**Preguntas Críticas**:

¿Cómo marca la BD que un evento está parcialmente pagado?
- ¿Status = 'available' + columna `partially_paid_amount`?
- ¿Status cambia a 'partially_paid'?
- ¿Se crean dos eventos: uno pagado + uno "saldo"?

**Ejemplo**:
```
Evento original: ID=xxx, amount=$50, status='available'

Pago 1: $30
  → commission_settlement_items: settlement_A, event_id=xxx, amount=$30
  → commission_events.xxx: status='partially_paid'? O status='available' + paid_amount=30?

Pago 2: $20 (saldo)
  → commission_settlement_items: settlement_B, event_id=xxx, amount=$20
  → commission_events.xxx: status='paid', paid_amount=50
```

**Impacto**: Sin confirmar, no sabemos cómo query `available_amount` calcula el saldo después de pago parcial.

---

## 🛑 DECISIÓN SEGÚN INSTRUCCIÓN #30

> "SI EL ESQUEMA NO SOPORTA PAGO PARCIAL DE LA COMISIÓN_EVENT:
>  DETENERSE ANTES DE INVENTARLO
>  y reportar exactamente qué SQL/RPC mínimo necesitamos."

### ✅ LO QUE HICIMOS

1. ✅ **Inspección exhaustiva** del código frontend
2. ✅ **Identificación de punto de bloqueo**: Parámetro `p_amount` falta
3. ✅ **Documentación de cambios necesarios**: PARTIAL_PAYMENT_ANALYSIS.md
4. ✅ **NO procedimos** a implementar cambios inventados en frontend

### 🛑 POR QUÉ PARAMOS

1. ❌ RPC `create_commission_settlement` no acepta `p_amount`
   - **Sin esto**: Crear settlement parcial en BD es IMPOSIBLE
   - **Inventar frontend input** sería inútil (RPC la ignoraría)

2. ❌ Schema `commission_settlement_items` desconocido
   - **Sin confirmar**: No sabemos si soporta `settlement_item_amount`
   - **Inventar lógica SQL** crearía inconsistencias

3. ❌ Algoritmo FIFO no documentado
   - **Sin ver código SQL**: No sabemos cómo implementarlo
   - **Inventar en JavaScript** sería ineficiente y error-prone

4. ❌ Status tracking de eventos parcialmente pagados desconocido
   - **Sin confirmar**: No sabemos cómo recalcula `available_amount`
   - **Inventar actualizaciones** crearía deudas técnicas

---

## ✅ LO QUE REPORTAMOS

**Archivo generado**: [`PARTIAL_PAYMENT_ANALYSIS.md`](PARTIAL_PAYMENT_ANALYSIS.md)

**Contiene**:
1. ✅ Flujo actual de pagos (completo)
2. ✅ RPC signatures actuales (con parámetros faltantes marcados)
3. ✅ Cambios SQL mínimos necesarios
4. ✅ Preguntas críticas sobre schema
5. ✅ Estrategia FIFO requerida en SQL
6. ✅ Cambios frontend listos para implementar (una vez BD confirme)
7. ✅ Tabla de bloqueadores con severidades
8. ✅ Plan de implementación en 3 fases

---

## 📋 CAMBIOS MÍNIMOS REQUERIDOS EN SUPABASE

### Prioridad 1: CRÍTICO
```
[ ] RPC create_commission_settlement
    Agregar parámetro: p_amount NUMERIC DEFAULT NULL
    Lógica: Si p_amount, hacer FIFO; si NULL, usar TODOS (backward compat)

[ ] commission_settlement_items table
    Confirmar columna: settlement_item_amount NUMERIC
    (para registrar amount parcial por evento)
```

### Prioridad 2: ALTO
```
[ ] commission_events table
    Confirmar cómo marcar eventos 'partially_paid'
    O cómo recalcular available_amount post-pago-parcial

[ ] SQL FIFO algorithm
    Implementar en RPC para seleccionar eventos por earned_at order
```

### Prioridad 3: CONFIRMACIÓN
```
[ ] commission_settlement_items schema dump
    ¿Qué columnas existen?
    ¿Qué constraints?
    
[ ] commission_events schema dump
    ¿Hay columna partially_paid_amount?
    ¿Hay status 'partially_paid'?
```

---

## 🚀 PRÓXIMOS PASOS (Bloqueados)

### Paso 1: Que Supabase Admin Confirme (BLOCKEANTE)
- [ ] Proporcionar definiciones SQL de los 3 RPCs: `create_commission_settlement`, `pay_commission_settlement`, `cancel_commission_settlement_draft`
- [ ] Proporcionar schema dump de `commission_settlement_items`
- [ ] Proporcionar schema dump de `commission_events` (columnas status + amount-related)
- [ ] Confirmar: ¿Soporta BD pagos parciales de eventos?

### Paso 2: Evaluar Viabilidad (Una vez tengamos confirmación)
```
IF rpc already accepts p_amount:
  → Pasar a Paso 3 inmediatamente

ELSE IF rpc can be easily modified:
  → Crear ticket para DBA
  → Esperar 24-48 horas

ELSE IF schema doesn't support partial amounts:
  → Reportar al usuario: No es viable sin rewrite de BD
  → Proponer alternativa: Crear settlement COMPLETA, luego aplicar solo PARTE del pago
```

### Paso 3: Implementación Frontend (Después de confirmación)
- [ ] Modificar CommissionSettlementSummary.tsx - agregar `<input type="number">`
- [ ] Modificar CommissionPaymentModal.tsx - pasar `amount` a RPC
- [ ] Modificar paymentUtils.ts - actualizar firmas de funciones
- [ ] npm run build - verificar 0 TypeScript errors
- [ ] E2E testing: Pago de $100 de $1,495

### Paso 4: Validación
- [ ] Verificar `available_amount` se recalcula correctamente
- [ ] Verificar FIFO ordering se respeta
- [ ] Verificar múltiples pagos parciales suman correctamente
- [ ] Solicitar aprobación del usuario
- [ ] NO commit/NO push hasta aprobación

---

## 📊 MATRIZ DE DECISIÓN

| Escenario | Acción | Motivo |
|-----------|--------|--------|
| BD ya soporta `p_amount` | Proceder directamente a Paso 3 | Implementación rápida |
| BD puede modificarse fácilmente | Crear ticket, esperar DBA | Costo bajo |
| BD no soporta partial amounts | Rechazar feature / Proponer alternativa | No es técnicamente viable |
| Schema desconocido | No proceder | Instrucción #30 - no inventar |

---

## 🎯 RESUMEN EJECUTIVO

**Pregunta Original**: "¿Cómo implementamos pagos parciales de comisiones?"

**Respuesta**: "No podemos hasta confirmar que Supabase soporta pagos parciales a nivel BD."

**Evidencia**:
- RPC actual falta parámetro `p_amount` (encontrado en línea 26 de paymentUtils.ts)
- Schema de settlement items desconocido (no hallado en migrations)
- Algoritmo FIFO para selectionar eventos no documentado

**Próximo Paso**: Solicitar a DBA confirmación de:
1. ¿Pueden RPCs aceptar `p_amount`?
2. ¿Soporta schema `commission_settlement_items` partial amounts?
3. ¿Cómo se marcan eventos parcialmente pagados?

**Estimado**: Una vez confirmado (24h), implementación frontend sería ~2 horas.

---

## 🔗 REFERENCIAS

- **Análisis Detallado**: [PARTIAL_PAYMENT_ANALYSIS.md](PARTIAL_PAYMENT_ANALYSIS.md)
- **RPC Actual**: paymentUtils.ts línea 26-40
- **UI Actual**: CommissionSettlementSummary.tsx línea 51-54
- **Entrada de Datos**: PayCommissionsButton.tsx línea 39-50

---

**Generado**: 22 de agosto de 2026  
**Status**: 🛑 BLOQUEADO EN CONFIRMACIÓN DE SUPABASE  
**Instrucción**: #30 ✅ Cumplida (detenido antes de inventar, reporte generado)
