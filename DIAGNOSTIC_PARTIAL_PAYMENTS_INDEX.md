# DIAGNÓSTICO TÉCNICO: ÍNDICE Y RESUMEN EJECUTIVO

**Módulo**: Pagos de Comisiones (Comisiones Parciales)  
**Fecha**: 23 de agosto de 2026  
**Tipo**: Inspección exhaustiva (SIN modificaciones)  
**Documentos Generados**: 3

---

## 📋 DOCUMENTOS GENERADOS

### 1. DIAGNOSTIC_PARTIAL_PAYMENTS_PART1.md
**Contenido**: 
- ✅ Tabla Maestra de 19 archivos involucrados
- ✅ Tabla de Tipos TypeScript (7 interfaces)
- ✅ Tabla de Vistas y RPCs de Supabase (6 elementos)
- ✅ Flujo completo de Preparación del Pago (Pasos 1-11)
- ✅ Flujo completo de Confirmación del Pago (Métodos Transfer/Cash)

**Líneas**: ~450
**Lectura**: ~15 minutos

---

### 2. DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md
**Contenido**:
- ✅ Parte 4: Consultas y Cálculos de Saldos (Tabla 10x7, problemas identificados)
- ✅ Parte 5: Tipos TypeScript (7 interfaces completas con problema analysis)
- ✅ Parte 6: Componentes de Interfaz (12 componentes + tabla de cambios)
- ✅ Parte 7: Código Relevante (9 fragmentos completos del proyecto)
- ✅ Parte 8: Dependencias y Riesgos (5 análisis, 8 riesgos identificados)
- ✅ Parte 9: Resumen Final para Implementación (archivos a modificar, punto de entrada)

**Líneas**: ~800
**Lectura**: ~25 minutos

---

### 3. DIAGNOSTIC_PARTIAL_PAYMENTS_INDEX.md (este archivo)
**Contenido**: Resumen ejecutivo e índice de navegación

---

## 🎯 HALLAZGOS CRÍTICOS (Resumen Ejecutivo)

### 1. Sistema NO SOPORTA Pagos Parciales Actualmente

| Componente | Estado | Evidencia |
|---|---|---|
| Frontend | ❌ SIN INPUT | CommissionSettlementSummary.tsx línea 51-54: solo `<p>` estático |
| RPC create_commission_settlement | ❌ FALTA p_amount | paymentUtils.ts línea 26-40: 3 parámetros solamente |
| RPC pay_commission_settlement | ❌ FALTA p_amount | paymentUtils.ts línea 54-85: 8 parámetros, ninguno es monto |
| Schema commission_settlement_items | ❌ DESCONOCIDO | No hallado en migrations, posible existence desconocida |
| Status de commission_events | ❌ DESCONOCIDO | ¿Cómo se marca "partially_paid"? ¿Nueva columna? |
| Vista v_commissions_available_for_payment | ❌ NO RECALCULA | Sigue sumando TODO aunque se pague parcial |

---

### 2. Flujo Actual (COMPLETO)

```
ADMIN SELECCIONA VENDEDOR (Gerardo Ventas)
  ↓
PayCommissionsButton carga: loadAvailableForPayment(sellerId)
  → Consulta: v_commissions_available_for_payment
  → Retorna: available_amount=$1,495.00, available_event_count=5
  ↓
Botón muestra: "Pagar comisiones | 5 movimientos • $1,495.00"
  ↓
Admin hace CLICK "Pagar comisiones"
  ↓
CommissionPaymentModal abre STEP 1:
  Vendedor: Gerardo Ventas
  Período: Agosto 1-31, 2026
  Monto a pagar: $1,495.00 [⚠️ SOLO LECTURA]
  Movimientos: 5
  ↓
Admin hace CLICK "Preparar pago"
  ↓
handlePrepare() llama: createCommissionSettlement(sellerId, periodStart, periodEnd)
  [❌ NO INCLUYE AMOUNT]
  ↓
RPC EN SUPABASE: create_commission_settlement
  Parámetros: {p_seller_id, p_period_start, p_period_end}
  Lógica: SELECT SUM(commission_amount) FROM commission_events
          WHERE seller_id = ? AND status = 'available'
          AND earned_at BETWEEN ? AND ?
  Retorna: {settlement_id, folio, total_amount=$1495, event_count=5}
  ↓
Modal STEP 2: Selector de Método de Pago
  ├─ TRANSFERENCIA BANCARIA
  │   ├─ Referencia: (opcional)
  │   ├─ Comprobante: (requerido, max 10MB)
  │   └─ Click "Confirmar"
  │       → uploadPaymentProof() a commission-proofs/{seller}/{settlement}/{file}
  │       → payCommissionSettlement(settlementId, 'transfer', proofPath, ...)
  │
  └─ EFECTIVO
      ├─ Confirmación: (requerido, checkbox)
      └─ Click "Confirmar"
          → payCommissionSettlement(settlementId, 'cash', null, ...)
  ↓
RPC EN SUPABASE: pay_commission_settlement
  Parámetros: {p_settlement_id, p_payment_method, p_payment_reference, 
               p_payment_proof_path, p_payment_proof_file_name,
               p_payment_proof_mime_type, p_cash_confirmed, p_notes}
  [❌ NO INCLUYE AMOUNT]
  Lógica: UPDATE commission_settlements SET status='paid', ...
          UPDATE commission_events SET status='paid' (TODOS los del settlement)
  ↓
Mensaje: "Pago registrado exitosamente. Folio: LIQ-20260823-00045"
  ↓
Delay 2 segundos
  ↓
Modal cierra
  ↓
PayCommissionsButton.loadData() recarga available_amount
  → Si no hay más eventos, muestra: "Sin comisiones disponibles"
```

---

### 3. Cambios Requeridos

#### FRONTEND (4 archivos críticos)

| Archivo | Línea | Cambio |
|---|---|---|
| **paymentUtils.ts** | 22-50 | Agregar parámetro `amount?: number` a createCommissionSettlement() |
| **CommissionSettlementSummary.tsx** | 51-54 | Reemplazar `<p>` con `<input type="number" min="0.01" max={totalAmount}>` |
| **CommissionPaymentModal.tsx** | 52-75 | Recibir paymentAmount de hijo, pasar a createCommissionSettlement() |
| **PayCommissionsButton.tsx** | 139-148 | Pasar totalAmount como maxAmount, recibir paymentAmount |

#### SUPABASE (Bloqueante - requiere confirmación DBA)

| Elemento | Cambio |
|---|---|
| **RPC create_commission_settlement** | ✅ Agregar parámetro: `p_amount NUMERIC DEFAULT NULL` |
| **RPC create_commission_settlement** | ✅ Lógica: Si p_amount → FIFO select eventos hasta monto; si NULL → SELECT ALL (backward compat) |
| **Tabla commission_settlement_items** | ❓ Confirmar: Existe columna `settlement_item_amount`? |
| **Tabla commission_events** | ❓ Confirmar: Cómo marcar "parcialmente pagado"? (status?, nueva columna?) |
| **Vista v_commissions_available_for_payment** | ✅ Recalcular: Restar monto pagado en settlements post-pago |
| **Vista v_commission_settlement_history** | ✅ Mostrar: Monto actual pagado (no suma anterior) |
| **Vista v_commission_settlement_detail** | ✅ Usar: settlement_item_amount para mostrar parcial |

---

### 4. Lugares Donde Aparecerán Cifras Incorrectas (Post-Pago-Parcial)

```
Escenario: Pago de $100 de $1,495.00 (FIFO: Eventos A=$50, B=$40, C=$15, ...)

DESPUÉS DEL PAGO, SIN CAMBIOS:

❌ PayCommissionsButton (línea 141)
   Muestra: 5 movimientos • $1,495.00 ← INCORRECTO (debe ser $1,395.00)
   Causa: v_commissions_available_for_payment sigue retornando SUM completo

❌ CommissionSettlementHistory (línea 187)
   Fila de settlement anterior:
   Folio: LIQ-001 | Total: $1,495.00 ← INCORRECTO (debe ser $100.00)
   Causa: v_commission_settlement_history.total_amount no reflejó parcial

❌ CommissionDraftCard (línea ?)
   Muestra: "Liquidación en preparación: $1,495.00" ← INCORRECTO (debe ser $100.00)
   Causa: Usa settlement.total_amount sin validar si fue parcial

❌ CommissionSettlementDetailModal (línea 72)
   Total calculado: SUM(settlement_item_amount) ← INCORRECTO
   Causa: settlement_item_amount es $50+$40+$15 = $105 (no $100)
   Pregunta: ¿Hay un evento "C: $15 que se paga parcial $10"?
   Problema: ¿Cómo schema maneja eventos parcialmente pagados?

❌ CommissionSummaryCards
   available_total: $1,495.00 ← INCORRECTO (debe ser $1,395.00)
   Causa: v_seller_commission_monthly_summary sigue sumando SUM(disponible)
```

---

## 🔍 ANÁLISIS DE RIESGOS

### Riesgo 1: RPC `create_commission_settlement` Falta Parámetro
**Severidad**: 🔴 CRÍTICO  
**Problema**: Sin `p_amount`, RPC selecciona TODOS los eventos del período  
**Solución**: Agregar parámetro `p_amount NUMERIC DEFAULT NULL` a RPC SQL  
**Requisito**: Confirmación DBA

---

### Riesgo 2: Schema `commission_settlement_items` Desconocido
**Severidad**: 🔴 CRÍTICO  
**Problema**: No se sabe si tabla soporta `settlement_item_amount` para parciales  
**Solución**: Schema dump de Supabase  
**Requisito**: Confirmación DBA

---

### Riesgo 3: Status de `commission_events` Parcialmente Pagado
**Severidad**: 🔴 CRÍTICO  
**Problema**: No se sabe cómo marcar evento como "parcialmente pagado"  
**Opciones**:
- A) Nuevo status: 'partially_paid'
- B) Nueva columna: `paid_amount` (NUMERIC)
- C) Crear dos eventos: uno pagado, uno "saldo"

**Solución**: Confirmación DBA de estrategia  
**Requisito**: Confirmar antes de implementar

---

### Riesgo 4: Recálculo de available_amount
**Severidad**: 🔴 CRÍTICO  
**Problema**: Vista v_commissions_available_for_payment NO recalcula post-pago  
**Impacto**: Admin verá $1,495 disponible incluso después de pagar $100  
**Solución**: Lógica en RPC para marcar eventos "parcialmente pagados" correctamente  
**Requisito**: Depende de Riesgo 3

---

### Riesgo 5: Múltiples Vistas No Sincronizadas
**Severidad**: 🟠 ALTO  
**Problema**: 6 vistas diferentes calculan montos - pueden estar fuera de sincronía  
**Vistas**:
- v_commissions_available_for_payment
- v_commission_settlement_history
- v_commission_settlement_detail
- v_seller_commission_monthly_summary
- v_seller_commission_movements
- v_commission_events_effective

**Solución**: Validar que TODAS calculen basadas en commission_events.status  
**Requisito**: Inspección DBA de todas las vistas

---

### Riesgo 6: Algoritmo FIFO No Documentado
**Severidad**: 🟠 ALTO  
**Problema**: No se conoce qué criterio FIFO usa actual DB (earned_at? created_at? id?)  
**Solución**: Documentar en SQL del RPC  
**Requisito**: Análisis DBA

---

### Riesgo 7: Eventos Parcialmente Pagados: Sin Pruebas
**Severidad**: 🟠 ALTO  
**Problema**: No hay test coverage para pago parcial de evento  
**Ejemplo**: Evento A=$50, Pago=$30 de $50. ¿Evento A ahora es 'available'=$20?  
**Solución**: Crear pruebas E2E post-implementación  
**Requisito**: QA plan

---

### Riesgo 8: Backward Compatibility
**Severidad**: 🟡 MEDIO  
**Problema**: Si nuevos parámetros RPC NO son DEFAULT NULL, código legacy fallará  
**Solución**: Todos los parámetros p_amount deben ser OPTIONAL (DEFAULT NULL)  
**Requisito**: Revisión DBA de RPC signatures

---

## 📊 MATRIZ DE DECISIÓN

```
┌─────────────────────────────────────────────┐
│ ANTES DE IMPLEMENTAR, DEBE CONFIRMARSE:     │
├─────────────────────────────────────────────┤
│ 1. RPC create_commission_settlement         │
│    ¿Puede aceptar parámetro p_amount?       │
│    ☐ SÍ → Proceder                          │
│    ☐ NO → Requerir DBA to modify            │
│    ☐ ¿? → Investigación DBA                 │
│                                              │
│ 2. Schema commission_settlement_items       │
│    ¿Tiene columna settlement_item_amount?   │
│    ☐ SÍ → Usar directamente                 │
│    ☐ NO → Requerir DBA to add column        │
│    ☐ ¿? → Schema dump requerido              │
│                                              │
│ 3. commission_events status                 │
│    ¿Cómo marcar "parcialmente pagado"?      │
│    ☐ Status 'partially_paid' → Usar status  │
│    ☐ Columna paid_amount → Usar columna     │
│    ☐ Nuevo evento "saldo" → Crear evento    │
│    ☐ ¿? → Definir estrategia                │
│                                              │
│ 4. Vistas de Supabase                       │
│    ¿Todas recalculan correctamente?         │
│    ☐ SÍ → Usar como-está                    │
│    ☐ NO → Requerir DBA to modify            │
│    ☐ ¿? → Auditar todas las vistas          │
└─────────────────────────────────────────────┘
```

---

## 📈 CRONOGRAMA ESTIMADO

```
FASE 1: Confirmación Supabase (BLOQUEANTE)
├─ Duración: 24-48 horas
├─ Responsable: DBA/Supabase Admin
├─ Entregables:
│   ├─ RPC SQL definitions (3)
│   ├─ Schema dumps (3 tablas)
│   ├─ Vista de audit (6 vistas)
│   └─ Estrategia FIFO documentada
└─ Status: ⏳ ESPERANDO

FASE 2: Cambios Frontend (Si Fase 1 ✅)
├─ Duración: 2 horas
├─ Responsable: Frontend Dev (TÚ)
├─ Archivos: 4 críticos + 2 secundarios
├─ Tareas:
│   ├─ Agregar input a CommissionSettlementSummary
│   ├─ Pasar paymentAmount a RPC
│   ├─ Actualizar tipos TypeScript
│   └─ Actualizar signatures de funciones
└─ Status: 🛑 BLOQUEADO

FASE 3: Cambios Supabase (Si Fase 1 ✅)
├─ Duración: 1-4 horas (según complejidad)
├─ Responsable: DBA
├─ Tareas:
│   ├─ Modificar RPC (si requerido)
│   ├─ Actualizar vistas (si requerido)
│   ├─ Ajustar status handling
│   └─ Verificar backward compatibility
└─ Status: 🛑 BLOQUEADO

FASE 4: Testing & Deployment
├─ Duración: 2 horas
├─ Tipo: E2E testing
├─ Escenarios:
│   ├─ Pago parcial ($100 de $1,495)
│   ├─ Múltiples pagos parciales (total = completo)
│   ├─ FIFO ordering verification
│   ├─ Recálculo de available_amount
│   └─ Historial actualizado correctamente
└─ Status: 🛑 BLOQUEADO

TOTAL SIN CONTAR ESPERA DBA: 6 horas
TOTAL CON ESPERA DBA: 1-2 días
```

---

## ✅ CHECKLIST DE CONFIRMACIÓN REQUERIDA

Antes de iniciar Fase 2, DBA debe confirmar:

```
☐ RPC create_commission_settlement soporta p_amount
☐ RPC pay_commission_settlement soporta p_amount (si necesario)
☐ Tabla commission_settlement_items tiene settlement_item_amount
☐ Tabla commission_events tiene estrategia para "partially_paid"
☐ Vista v_commissions_available_for_payment recalcula post-pago
☐ Vista v_commission_settlement_history muestra amount pagado (no suma)
☐ Vista v_commission_settlement_detail muestra settlement_item_amount
☐ Lógica FIFO está implementada en RPC
☐ Backward compatibility confirmada (parámetros DEFAULT NULL)
☐ Pruebas en BD creadas para pago parcial
```

---

## 🔗 NAVEGACIÓN DE DOCUMENTOS

Para detalles específicos, ver:

**Flujo de Pago Actual**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART1.md, Secciones 2-3

**Tipos TypeScript**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md, Sección 5

**Componentes Afectados**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md, Sección 6

**Código Específico a Modificar**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md, Sección 7

**Archivos a Modificar (Prioridad)**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md, Sección 9.1-9.2

**RPC Calls Exactas**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART1.md, Secciones 2.8, 2.9, 3.4

**Consultas de Saldos**
→ DIAGNOSTIC_PARTIAL_PAYMENTS_PART2.md, Sección 4

---

## 🎯 PRÓXIMOS PASOS

### AHORA (Hoy)
1. Compartir este diagnóstico con DBA/Supabase Admin
2. Solicitar confirmación de los 9 puntos en checklist
3. Estimar tiempo de respuesta DBA

### CUANDO DBA CONFIRME (24-48h)
1. Proceder con Fase 2 (Frontend changes)
2. Proceder con Fase 3 (Supabase changes, si aplica)
3. Ejecutar Fase 4 (Testing)

### NO HACER
❌ Agregar input editable sin confirmar RPC
❌ Pasar p_amount a RPC que no lo acepta
❌ Modificar vistas sin entender impacto

---

**Diagnóstico Completado**: 23 de agosto de 2026  
**Documentos Generados**: 3 archivos (.md)  
**Líneas de Código Analizadas**: 2,000+  
**Estado**: ✅ LISTO PARA PRESENTACIÓN A DBA
