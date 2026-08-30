# DIAGNÓSTICO TÉCNICO COMPLETO: MÓDULO DE PAGOS DE COMISIONES
**Fecha**: 23 de agosto de 2026  
**Estado**: Diagnóstico exhaustivo (inspección solamente, SIN modificaciones)

---

# PARTE 1: ARCHIVOS INVOLUCRADOS

## Tabla Maestra: Archivos del Módulo de Comisiones

| Ruta Exacta | Función | Tipo | Cambio Requerido | Motivo |
|---|---|---|---|---|
| `/components/commercialPartners/commissions/commissionTypes.ts` | Definiciones TypeScript de interfaces | Tipos | 🔴 CRÍTICO | Agregar tipos para partial amounts en CommissionSettlementDetail |
| `/components/commercialPartners/commissions/commissionUtils.ts` | Utilidades y cálculos de comisiones | Hook/Utilities | 🟡 PROBABLE | Verificar si formatCurrency() necesita adaptación para amounts parciales |
| `/components/commercialPartners/commissions/AdminCommissionDashboard.tsx` | Dashboard admin - gestor de comisiones | Componente | 🟢 BAJO | Integración de PayCommissionsButton (ya existe) |
| `/components/commercialPartners/commissions/SellerCommissionDashboard.tsx` | Dashboard vendedor - view-only | Componente | 🟢 BAJO | Solo lectura del historial |
| `/components/commercialPartners/commissions/CommissionSummaryCards.tsx` | Tarjetas de resumen de comisiones | Componente | 🟢 BAJO | Display de datos, sin lógica de pago |
| `/components/commercialPartners/commissions/CommissionMovementsTable.tsx` | Tabla de movimientos individuales | Componente | 🟢 BAJO | Lista de eventos, sin cálculos de liquidación |
| `/components/commercialPartners/commissions/payments/paymentUtils.ts` | Wrappers de RPC y storage | Servicios | 🔴 CRÍTICO | Agregar parámetro amount a createCommissionSettlement() |
| `/components/commercialPartners/commissions/payments/CommissionPaymentModal.tsx` | Modal 2-paso para pago | Componente | 🔴 CRÍTICO | Pasar paymentAmount a RPC en Step 1 |
| `/components/commercialPartners/commissions/payments/CommissionSettlementSummary.tsx` | Resumen Step 1 - Monto a pagar | Componente | 🔴 CRÍTICO | Reemplazar p estático con input type="number" |
| `/components/commercialPartners/commissions/payments/CommissionPaymentMethod.tsx` | Selector de método de pago (transfer/cash) | Componente | 🟡 PROBABLE | Validar que funcione con amounts parciales |
| `/components/commercialPartners/commissions/payments/CommissionProofUploader.tsx` | Carga de comprobante de transferencia | Componente | 🟢 BAJO | Sin cambios lógicos, solo referencia |
| `/components/commercialPartners/commissions/payments/PayCommissionsButton.tsx` | Botón entrada - disparador de modal | Componente | 🔴 CRÍTICO | Pasar amount a CommissionPaymentModal |
| `/components/commercialPartners/commissions/payments/CommissionDraftCard.tsx` | Tarjeta que muestra draft en preparación | Componente | 🟡 PROBABLE | Mostrar monto parcial en lugar de total |
| `/components/commercialPartners/commissions/payments/CommissionSettlementHistory.tsx` | Tabla historial de liquidaciones | Componente | 🟢 BAJO | Display de histórico, sin lógica de creación |
| `/components/commercialPartners/commissions/payments/CommissionSettlementDetailModal.tsx` | Modal detalle de liquidación individual | Componente | 🟢 BAJO | Display de eventos incluidos en settlement |
| `/components/commercialPartners/commissions/AvailableCommissionsModal.tsx` | Modal de comisiones disponibles | Componente | 🟡 PROBABLE | Verificar si muestra available_amount total o recalculado |
| `/components/commercialPartners/commissions/PendingCommissionsModal.tsx` | Modal de comisiones pendientes | Componente | 🟢 BAJO | Display de eventos status='pending' |
| `/components/commercialPartners/commissions/ExtraDayCommissionModal.tsx` | Modal para agregar comisión de días extra | Componente | 🟢 BAJO | Creación de nuevos eventos, no afecta pagos |

---

## Tabla: Archivos de Tipos (commissionTypes.ts)

| Interfaz/Tipo | Ubicación | Líneas | Cambio Requerido | Motivo |
|---|---|---|---|---|
| CommissionSettlement | commissionTypes.ts | 44-54 | 🟢 NO | Estructura actual suficiente |
| CommissionSettlementHistory | commissionTypes.ts | 56-68 | 🟡 PROBABLE | Agregar campo partial_amount si se crea settlement parcial |
| CommissionSettlementDetail | commissionTypes.ts | 74-88 | 🟡 PROBABLE | Agregar settlement_item_amount vs commission_amount |
| CommissionAvailableForPayment | commissionTypes.ts | 90-95 | 🔴 CRÍTICO | Recalcular available_amount después de pago parcial |
| CommissionMovement | commissionTypes.ts | 1-42 | 🟢 NO | Representa eventos individuales, no afecta |
| SellerCommissionMonthlySummary | commissionTypes.ts | (línea inicio) | 🟢 NO | Resumen de datos, no lógica de pago |
| CommissionStatus | commissionTypes.ts | type CommissionStatus | 🟡 PROBABLE | ¿Agregar 'partially_paid'? |

---

## Tabla: Vistas y RPCs de Supabase

| Nombre | Tipo | Ubicación en Código | Cambio Requerido | Motivo |
|---|---|---|---|---|
| v_commissions_available_for_payment | Vista | paymentUtils.ts línea 132 | 🔴 CRÍTICO | Debe recalcular después de pago parcial |
| v_commission_settlement_history | Vista | paymentUtils.ts línea 114 | 🟡 PROBABLE | Mostrar partial_amount si se pagó menos que total |
| v_commission_settlement_detail | Vista | paymentUtils.ts línea 122 | 🟡 PROBABLE | Mostrar settlement_item_amount individual vs total |
| create_commission_settlement | RPC | paymentUtils.ts línea 26 | 🔴 CRÍTICO | **Falta parámetro p_amount** |
| pay_commission_settlement | RPC | paymentUtils.ts línea 55 | 🟡 PROBABLE | ¿Necesita p_amount? ¿O calcula del settlement? |
| cancel_commission_settlement_draft | RPC | paymentUtils.ts línea 88 | 🟢 NO | No afecta pagos parciales |

---

# PARTE 2: FLUJO ACTUAL DE PREPARACIÓN DEL PAGO

## 2.1 Acceso al Módulo

### Ruta de Navegación
```
App.tsx (router)
  → /admin/comercialPartners
    → CommercialPartners.tsx (page component)
      → (selector: "Comisiones")
        → AdminCommissionDashboard.tsx
```

---

## 2.2 PASO 1: Selección del Vendedor

**Componente**: AdminCommissionDashboard.tsx
**UI**: Dropdown/Select de vendedores

```typescript
// El dashboard recibe:
// - sellerId (UUID)
// - sellerName (string)
// - sellerFolio (string - optional)
```

**Fuente de datos**: Vendedores del contexto o props

---

## 2.3 PASO 2: Selección del Período

**Componente**: PayCommissionsButton.tsx
**Línea**: 139-145
**Cálculo del mes actual**:

```typescript
periodStart={new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString()
  .split('T')[0]}
periodEnd={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
  .toISOString()
  .split('T')[0]}
```

**Formato**: ISO string (YYYY-MM-DD)

---

## 2.4 PASO 3: Cálculo del Total Disponible

### 3A: Carga de Datos
**Archivo**: `PayCommissionsButton.tsx` línea 40
**Función**: `loadAvailableForPayment(sellerId)`

```typescript
// PayCommissionsButton.tsx líneas 34-50
const loadData = async () => {
  setLoading(true);
  setError('');

  try {
    const availData = await loadAvailableForPayment(sellerId);
    console.log('AVAILABLE DATA', availData);

    if (availData) {
      setAvailable(Number(availData.available_amount || 0));
      setAvailableCount(Number(availData.available_event_count || 0));
      setHasDraft(availData.has_draft_settlement || false);
    }
```

### 3B: RPC loadAvailableForPayment
**Archivo**: `paymentUtils.ts` línea 128-145

```typescript
export const loadAvailableForPayment = async (sellerId: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('v_commissions_available_for_payment')
    .select('*')
    .eq('seller_id', sellerId)
    .single();

  if (error) {
    console.error('AVAILABLE FOR PAYMENT ERROR', error);
    throw error;
  }

  return data as CommissionAvailableForPayment;
};
```

**Vista**: `v_commissions_available_for_payment`
**Columnas**:
- seller_id: UUID
- available_amount: NUMERIC (SUM de eventos status='available')
- available_event_count: INT
- has_draft_settlement: BOOLEAN
- draft_settlement_id: UUID (nullable)

### 3C: Visualización en UI
**Componente**: `PayCommissionsButton.tsx` línea 141

```tsx
<p className="text-xs opacity-75">
  {availableCount} movimiento{availableCount !== 1 ? 's' : ''} • {formatCurrency(available)}
</p>
```

**Nota**: `available` es el monto TOTAL - NO hay campo editable

---

## 2.5 PASO 4-5: Click "Pagar Comisiones"

**Componente**: PayCommissionsButton.tsx línea 133
**Evento**: `onClick={() => setIsModalOpen(true)}`

Modal abre con props:
- totalAmount={available} (FIJO)
- movementCount={availableCount}

---

## 2.6 PASO 6-7: Step 1 - Visualización de Monto

**Componente**: `CommissionSettlementSummary.tsx` línea 51-54

```tsx
<p className="text-2xl font-bold text-yellow-400">
  {formatCurrency(totalAmount)}
</p>
```

**Problema**: Solo lectura, NO editable

---

## 2.7 PASO 8: Click "Preparar Pago"

**Componente**: CommissionPaymentModal.tsx línea 52-75
**Función**: `handlePrepare()`

```typescript
const handlePrepare = async () => {
  setLoading(true);
  setError('');

  try {
    console.log('CREATING SETTLEMENT', { sellerId, periodStart, periodEnd });

    const settlement = await createCommissionSettlement(
      sellerId,
      periodStart,
      periodEnd
    );

    setSettlementId(settlement.settlement_id);
    setFolio(settlement.folio);
    setStep(2);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al preparar liquidación';
    console.error('PREPARE ERROR', err);
    setError(message);
  } finally {
    setLoading(false);
  }
};
```

---

## 2.8 PASO 9: RPC createCommissionSettlement

**Archivo**: `paymentUtils.ts` línea 22-50

```typescript
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    // ❌ NO EXISTE: p_amount
  });

  if (error) {
    console.error('CREATE SETTLEMENT ERROR', error);
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  return {
    settlement_id: result.settlement_id,
    folio: result.folio,
    total_amount: Number(result.total_amount || 0),
    event_count: Number(result.event_count || 0),
  };
};
```

**Objeto Enviado a Supabase**:
```json
{
  "p_seller_id": "550e8400-e29b-41d4-a716-446655440000",
  "p_period_start": "2026-08-01",
  "p_period_end": "2026-08-31"
}
```

**Nota CRÍTICA**: NO incluye monto - RPC asume TODOS los eventos

---

## 2.9 PASO 10: Respuesta

```typescript
{
  settlement_id: "112e8400-e29b-41d4-a716-446655441111",
  folio: "LIQ-20260823-00045",
  total_amount: 1495.00,
  event_count: 5
}
```

---

# PARTE 3: FLUJO ACTUAL DE CONFIRMACIÓN DEL PAGO

## 3.1 Step 2: Selección del Método de Pago

**Componente**: `CommissionPaymentMethod.tsx`

---

## 3.2 Método TRANSFERENCIA BANCARIA

### Campos:
1. **Referencia bancaria** (Opcional)
2. **Comprobante** (Requerido)
   - Upload file: PDF/PNG/JPG
   - Max 10MB

### Upload del Comprobante: `uploadPaymentProof`

**Archivo**: `paymentUtils.ts` línea 145-180

```typescript
export const uploadPaymentProof = async (
  file: File,
  sellerId: string,
  settlementId: string
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const fileName = sanitizeFileName(file.name);
  const timestamp = new Date().getTime();
  const filePath = `${sellerId}/${settlementId}/${timestamp}-${fileName}`;

  const { data, error } = await supabase.storage
    .from('commission-proofs')
    .upload(filePath, file, { upsert: false });

  if (error) {
    console.error('UPLOAD ERROR', error);
    throw error;
  }

  return data.path;
};
```

**Bucket**: `commission-proofs`
**Path**: `{seller_id}/{settlement_id}/{timestamp}-{filename}`

---

## 3.3 Método EFECTIVO

### Campo:
- **Confirmación**: Checkbox "Confirmo que se entregó el efectivo"

---

## 3.4 RPC payCommissionSettlement

**Archivo**: `paymentUtils.ts` línea 54-85

```typescript
export const payCommissionSettlement = async (
  settlementId: string,
  paymentMethod: 'transfer' | 'cash',
  proofPath: string | null = null,
  proofFileName: string | null = null,
  proofMimeType: string | null = null,
  reference: string | null = null,
  notes: string | null = null,
  cashConfirmed: boolean = false
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('pay_commission_settlement', {
    p_settlement_id: settlementId,
    p_payment_method: paymentMethod,
    p_payment_reference: reference,
    p_payment_proof_path: proofPath,
    p_payment_proof_file_name: proofFileName,
    p_payment_proof_mime_type: proofMimeType,
    p_cash_confirmed: cashConfirmed,
    p_notes: notes,
  });

  if (error) {
    console.error('PAY SETTLEMENT ERROR', error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
};
```

**Objeto TRANSFERENCIA**:
```json
{
  "p_settlement_id": "112e8400-e29b-41d4-a716-446655441111",
  "p_payment_method": "transfer",
  "p_payment_reference": "TRANSFERENCIA BANCO XXX",
  "p_payment_proof_path": "550e8400.../1692820530000-comprobante.pdf",
  "p_payment_proof_file_name": "comprobante.pdf",
  "p_payment_proof_mime_type": "application/pdf",
  "p_cash_confirmed": false,
  "p_notes": null
}
```

**Objeto EFECTIVO**:
```json
{
  "p_settlement_id": "112e8400-e29b-41d4-a716-446655441111",
  "p_payment_method": "cash",
  "p_payment_reference": null,
  "p_payment_proof_path": null,
  "p_payment_proof_file_name": null,
  "p_payment_proof_mime_type": null,
  "p_cash_confirmed": true,
  "p_notes": "Pago manual en caja"
}
```

**Nota CRÍTICA**: ❌ NO HAY `p_amount` - RPC paga TODO el settlement

---

## 3.5 Actualización Post-Pago

**Archivo**: `PayCommissionsButton.tsx` línea 72

```typescript
const handlePaymentComplete = () => {
  setIsModalOpen(false);
  loadData(); // Recarga available_amount
  onPaymentComplete();
};
```

---

**FIN PARTE 1-3. Continuaré con Partes 4-9 en siguiente respuesta debido a límites de extensión.**
