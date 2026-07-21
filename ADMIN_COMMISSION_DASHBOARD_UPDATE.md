# Implementación: "Cobros Pendientes de Revisión" en Dashboard Administrativo

## ✅ Status: Completado

### Compilación
```
npm run build
✓ Éxito sin errores TypeScript
Build time: 4.07s
2839 módulos transformados
```

## 📋 Archivos Creados/Modificados

### 1. Nuevo Componente
**[PendingPaymentVerifications.tsx](components/commercialPartners/commissions/PendingPaymentVerifications.tsx)**

**Funcionalidad:**
- Carga la vista `v_pending_payment_verifications` sin filtros
- Muestra tarjetas de cada cobro pendiente
- Modal para revisar detalles
- Interfaz para confirmar o rechazar

**Props:**
```typescript
interface Props {
  refreshTrigger?: number;
  onVerificationApproved?: () => void;
}
```

**Logs Implementados:**
```javascript
console.log('ADMIN PENDING PAYMENT VERIFICATIONS DATA', data);
console.error('ADMIN PENDING PAYMENT VERIFICATIONS ERROR', err);
```

---

### 2. Componente Modificado
**[AdminCommissionDashboard.tsx](components/commercialPartners/commissions/AdminCommissionDashboard.tsx)**

**Cambios:**
- Importado `PendingPaymentVerifications`
- Agregado estado: `verificationRefreshKey`
- Sección nueva renderizada entre "Comisiones del vendedor" y "Gestión de pagos"
- Callback `onVerificationApproved()` actualiza todos los datos:
  - `v_seller_commission_monthly_summary`
  - `v_seller_commission_movements`
  - `v_commissions_available_for_payment`

**Ubicación en pantalla:**
```
Comisiones del equipo [Header]
├─ Mes Selector + Vendedor Selector
├─ [NUEVO] Cobros Pendientes de Revisión ← AQUÍ
├─ Gestión de Pagos
├─ Actividad
└─ Historial de Liquidaciones
```

---

## 🔄 Flujo de Datos

### Carga Inicial
```typescript
// 1. Consulta la vista (sin filtros)
const { data: pendingVerifications } = await supabase
  .from('v_pending_payment_verifications')
  .select('*')
  .order('submitted_at', { ascending: false });

// 2. Muestra todas las tarjetas
setVerifications(data);

// 3. Si no hay, el componente retorna null (no visible)
if (verifications.length === 0) return null;
```

### Aprobación (Confirmar Ingreso)
```typescript
// 1. Usuario abre modal y revisa detalles
// 2. Escribe notas opcionales
// 3. Pulsa "Confirmar ingreso"

// 4. Llama RPC sin modificaciones SQL directas
const { data } = await supabase.rpc(
  'approve_partner_payment_verification_request',
  {
    p_request_id: selectedVerification.request_id,
    p_review_notes: reviewNotes || null
  }
);

// 5. RPC hace internamente:
//    - Valida balance actual vs monto
//    - Crea pago en commercial_partner_payments o wholesale_payments
//    - Actualiza partner_payment_verification_requests.status = 'approved'
//    - Genera comisión si aplica

// 6. Frontend recarga datos
await loadPendingVerifications();
await loadAllSellersSummary();
await loadSellerSummary(selectedSellerId);

// 7. Tarjeta desaparece, comisión aparece disponible si corresponde
```

### Rechazo (Rechazar Reporte)
```typescript
// 1. Usuario pulsa "Rechazar"
// 2. Modal pide motivo obligatorio
// 3. Pulsa "Confirmar rechazo"

const { data } = await supabase.rpc(
  'reject_partner_payment_verification_request',
  {
    p_request_id: selectedVerification.request_id,
    p_rejection_reason: rejectionReason
  }
);

// 4. RPC:
//    - Actualiza status = 'rejected'
//    - NO modifica saldo ni comisión
//    - Llena rejection_reason

// 5. Tarjeta desaparece del listado
```

---

## 📊 Interfaz de Usuario

### Tarjeta de Cobro Pendiente
```
┌──────────────────────────────────────────────────┐
│ Gerardo Ventas reportó $650.00 de prueba4     │
│ [COBRO-202607-00002]                            │
│                                                  │
│ Cliente: PR-200726-001                         │
│ Operación: comodato                            │
│ Método: cash                                   │
│ Saldo actual: $350.00                          │
│                                                  │
│ Reportado hace 2 horas                         │
│                                    [Revisar cobro]
└──────────────────────────────────────────────────┘
```

### Modal de Revisión
```
┌────────────────────────────────────────────────────────┐
│ Revisar cobro                                         │
│ Folio COBRO-202607-00002                              │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Vendedor: Gerardo Ventas    │ Cliente: prueba4       │
│ Folio cliente: PR-200726-001 │ Operación: comodato   │
│ Liquidación: [source_folio]  │ Monto: $650.00        │
│ Saldo actual: $350.00        │ Método: cash          │
│ Referencia: —                │                        │
│ Fecha: 20/07/2026                                     │
│                                                        │
│ Notas de revisión [textarea para admin]               │
│                                                        │
│ ¿Confirmas que Cat Corn ya recibió este dinero?       │
│ Al continuar se registrará oficialmente el pago...    │
│                                                        │
├────────────────────────────────────────────────────────┤
│ [Cancelar] [Rechazar] [Confirmar ingreso]            │
└────────────────────────────────────────────────────────┘
```

---

## 🎯 Funciones Principales

### loadPendingVerifications()
**Ubicación:** `PendingPaymentVerifications.tsx`

```typescript
const loadPendingVerifications = async () => {
  const { data, error: err } = await supabase
    .from('v_pending_payment_verifications')
    .select('*')
    .order('submitted_at', { ascending: false });

  console.log('ADMIN PENDING PAYMENT VERIFICATIONS DATA', data);
  if (err) {
    console.error('ADMIN PENDING PAYMENT VERIFICATIONS ERROR', err);
    throw err;
  }

  setVerifications(data as PendingVerification[]);
};
```

**Llamado:**
- Al montar componente (useEffect)
- Cuando `refreshTrigger` cambia
- Después de aprobar o rechazar

### handleApprove()
**Ubicación:** `PendingPaymentVerifications.tsx`

```typescript
const handleApprove = async () => {
  const { data, error: err } = await supabase!.rpc(
    'approve_partner_payment_verification_request',
    {
      p_request_id: selectedVerification.request_id,
      p_review_notes: reviewNotes || null,
    }
  );

  if (err) throw err;

  // Reload todas las vistas
  await loadPendingVerifications();
  onVerificationApproved?.();
};
```

### handleReject()
**Ubicación:** `PendingPaymentVerifications.tsx`

```typescript
const handleReject = async () => {
  const { data, error: err } = await supabase!.rpc(
    'reject_partner_payment_verification_request',
    {
      p_request_id: selectedVerification.request_id,
      p_rejection_reason: rejectionReason,
    }
  );

  if (err) throw err;

  await loadPendingVerifications();
};
```

---

## 🧪 Caso de Prueba

**Situación actual en BD:**

```
Cobro 1:
- request_id: ad6fd7f2-bce3-4c8c-9c0d-16d052deefbe
- folio: COBRO-202607-00002
- seller: Gerardo Ventas
- client: prueba4 (PR-200726-001)
- amount: $650.00
- status: pending_review

Cobro 2:
- request_id: eaf9ec1e-472f-4916-9b75-b08914dd573f
- folio: COBRO-202607-00001
- seller: Admin Cat Corn
- client: cliente prueba 3
- amount: $350.00
- status: pending_review
```

**Pasos para probar:**

1. **Entrar como admin** a Socios Comerciales → Comisiones
2. **Ver sección** "Cobros pendientes de revisión" con badge "2 pendientes"
3. **Ver tarjetas** de Gerardo y Admin Cat Corn
4. **Pulsar "Revisar cobro"** en Gerardo
5. **Modal muestra:**
   - Gerardo Ventas
   - prueba4
   - COBRO-202607-00002
   - $650.00
   - All details
6. **Escribir nota** (opcional)
7. **Pulsar "Confirmar ingreso"**
8. **Verificar:**
   - Tarjeta de Gerardo desaparece
   - Saldo de prueba4 disminuye $650
   - Comisión de Gerardo pasa a "available"
   - Queda solo 1 cobro pendiente en badge

---

## 📍 Ubicaciones en Código

| Elemento | Archivo |
|----------|---------|
| Nuevo componente | [PendingPaymentVerifications.tsx](components/commercialPartners/commissions/PendingPaymentVerifications.tsx) |
| Integración | [AdminCommissionDashboard.tsx](components/commercialPartners/commissions/AdminCommissionDashboard.tsx) (línea 217-224) |
| Consulta vista | `v_pending_payment_verifications` en Supabase |
| RPC Aprobación | `approve_partner_payment_verification_request()` |
| RPC Rechazo | `reject_partner_payment_verification_request()` |

---

## 🔄 Estados y Transiciones

```
PENDING_REVIEW
├─ Usuario: Gerardo
├─ Status en modal: "Pendiente de revisión"
├─ Botones: [Revisar cobro]
│
├─ (Click Revisar → Modal)
│  ├─ Opción A: Confirmar → APPROVED
│  │  ├─ Crea pago oficial
│  │  ├─ Actualiza saldo
│  │  ├─ Genera comisión
│  │  └─ Tarjeta desaparece
│  │
│  └─ Opción B: Rechazar → REJECTED
│     ├─ NO modifica nada
│     ├─ Llena rejection_reason
│     └─ Tarjeta desaparece
```

---

## 🚀 Próximos Pasos

1. **Verificar en navegador** que ambas tarjetas aparecen
2. **Pulsar Confirmar** en Gerardo
3. **Verificar cambios** en comisiones disponibles
4. **Ejecutar test completo** del flujo de pago

---

## 💡 Notas Técnicas

### No depende de:
- `commissionSummary` (puede ser null)
- Vendedor seleccionado (muestra todos los pending)
- Mes seleccionado (siempre pending_review actuales)
- Comisiones disponibles (independiente)

### Sí depende de:
- `v_pending_payment_verifications` (correctamente funcionando ✓)
- RLS que permite admin leer (ya validado ✓)
- RPC functions (ya en producción ✓)

### Performance:
- Una consulta inicial
- Un rpc por acción (aprobar/rechazar)
- Reload selectivo después
- No usa Realtime (polling manual)
