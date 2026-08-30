# DIAGNÓSTICO TÉCNICO: MÓDULO DE PAGOS - PARTE 2-9

**Continuación de DIAGNOSTIC_PARTIAL_PAYMENTS_PART1.md**

---

# PARTE 4: CONSULTAS Y CÁLCULOS DE SALDOS

## 4.1 Tabla Maestra: Todas las Consultas de Saldos

| Saldo/Cálculo | Archivo | Función | Tabla/Vista | Columnas | Filtros | Fórmula | Impacto de Pago Parcial |
|---|---|---|---|---|---|---|---|
| **Comisión disponible** | paymentUtils.ts | loadAvailableForPayment() | v_commissions_available_for_payment | available_amount | seller_id | SUM(commission_amount) WHERE status='available' | 🔴 CRÍTICO: Debe restar el monto pagado parcialmente |
| **Total por pagar** | CommissionPaymentModal.tsx | (prop totalAmount) | v_commissions_available_for_payment | available_amount | seller_id | MISMO QUE ARRIBA | 🔴 CRÍTICO: Debe ser editable |
| **Historial pagado** | CommissionSettlementHistory.tsx | loadSettlementHistory() | v_commission_settlement_history | total_amount, status | seller_id, status='paid' | SUM(total_amount) de settlements | 🟡 PROBABLE: Mostrar total_amount actual (no SUMA anterior completa) |
| **Liquidaciones en draft** | PayCommissionsButton.tsx | loadSettlementHistory() | v_commission_settlement_history | settlement_id, total_amount | seller_id, status='draft' | SUM de eventos en settlement | 🟡 PROBABLE: Mostrar monto parcial si existe |
| **Liquidaciones canceladas** | CommissionSettlementHistory.tsx | loadSettlementHistory() | v_commission_settlement_history | status='cancelled' | seller_id | COUNT(*) | 🟢 NO AFECTA |
| **Pendiente** | CommissionSummaryCards.tsx | (obtiene de interfaz) | v_seller_commission_monthly_summary | pending_total | seller_id | SUM(commission_amount) WHERE status='pending' | 🟢 NO AFECTA (eventos no pagados aún) |
| **Generado (total)** | CommissionSummaryCards.tsx | (obtiene de interfaz) | v_seller_commission_monthly_summary | generated_total | seller_id | SUM(commission_amount) de todos los eventos | 🟢 NO AFECTA (histórico) |
| **Número de movimientos** | PayCommissionsButton.tsx | loadAvailableForPayment() | v_commissions_available_for_payment | available_event_count | seller_id | COUNT(*) WHERE status='available' | 🟢 NO AFECTA (es conteo de eventos) |
| **Evento individual** | CommissionMovementsTable.tsx | (carga de vista) | v_seller_commission_movements | commission_amount | commission_event_id | Valor de cada evento | 🔴 CRÍTICO: ¿Se divide si pago parcial? |
| **Detalle de settlement** | CommissionSettlementDetailModal.tsx | loadSettlementDetail() | v_commission_settlement_detail | settlement_item_amount | settlement_id | Columna directa de settlement_items | 🔴 CRÍTICO: Debe ser < total si pago parcial |

---

## 4.2 Ubicación Exacta: Lugares Donde se Muestran Estos Saldos

### 4.2.1 Comisión Disponible (TOTAL)
**Archivo**: `/components/commercialPartners/commissions/payments/PayCommissionsButton.tsx`
**Línea**: 39-50
**Código**:
```typescript
const loadData = async () => {
  setLoading(true);
  setError('');

  try {
    const availData = await loadAvailableForPayment(sellerId);
    console.log('AVAILABLE DATA', availData);

    if (availData) {
      setAvailable(Number(availData.available_amount || 0));  // ← TOTAL
      setAvailableCount(Number(availData.available_event_count || 0));
      setHasDraft(availData.has_draft_settlement || false);
    }
```

**Mostrado en UI** (línea 141-145):
```tsx
<p className="text-xs opacity-75">
  {availableCount} movimiento{availableCount !== 1 ? 's' : ''} • {formatCurrency(available)}
</p>
```

**Problema después de pago parcial**: Si se paga $100 de $1,495, esta consulta DEBE retornar $1,395 (no $1,495)

---

### 4.2.2 Comisión Disponible (Mostrada en Modal Step 1)
**Archivo**: `/components/commercialPartners/commissions/payments/CommissionSettlementSummary.tsx`
**Línea**: 51-54

```tsx
<p className="text-2xl font-bold text-yellow-400">
  {formatCurrency(totalAmount)}
</p>
```

**Problema**: 
- totalAmount es prop FIJO (viene de PayCommissionsButton)
- NO se recalcula
- ❌ NO HAY CAMPO EDITABLE

---

### 4.2.3 Historial Pagado
**Archivo**: `/components/commercialPartners/commissions/payments/CommissionSettlementHistory.tsx`
**Línea**: 88-200

```typescript
const loadData = async () => {
  setLoading(true);
  setError('');

  try {
    const history = await loadSettlementHistory(sellerId);
    console.log('SETTLEMENT HISTORY LOADED', history);
    setSettlements(history);
```

**Tabla que muestra**:
| Folio | Período | Movimientos | Total | Estado | Acciones |
|---|---|---|---|---|---|
| LIQ-20260823-00045 | Agosto 1-31 | 5 | $1,495.00 | Pagada | Ver Detalle, Descargar |

**Código de la fila** (línea 187):
```tsx
<td className="px-4 py-3 text-right">
  <p className="text-sm font-semibold text-neutral-200">
    {formatCurrency(Number(settlement.total_amount))}
  </p>
</td>
```

**Problema después de pago parcial**: total_amount DEBE ser $100 (o monto pagado), no $1,495

---

### 4.2.4 Detalle de Settlement (Líneas de Items)
**Archivo**: `/components/commercialPartners/commissions/payments/CommissionSettlementDetailModal.tsx`
**Línea**: 54-93

```typescript
const loadData = async () => {
  setLoading(true);
  setError('');

  try {
    const data = await loadSettlementDetail(settlementId);
    console.log('SETTLEMENT DETAIL LOADED', data);
    setDetails(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar detalles';
    console.error('LOAD DETAIL ERROR', err);
    setError(message);
  } finally {
    setLoading(false);
  }
};
```

**Cálculo de Total desde Items** (línea 72):
```typescript
const totalAmount = details.reduce(
  (sum, d) => sum + Number(d.settlement_item_amount || 0),
  0
);
```

**Tabla que muestra**:
| Fecha | Socio | Producto | Cant | C/U | Total |
|---|---|---|---|---|---|
| 2026-08-03 | Gerardo Ventas | Michi Mini | 10 | $12.50 | $125.00 |
| ... | ... | ... | ... | ... | ... |

**Problema después de pago parcial**: 
- Si el evento tiene commission_amount=$50 pero solo pagamos $30
- settlement_item_amount DEBE ser $30 (no $50)

---

## 4.3 Fórmula de Cálculo Actual: available_amount

**Ubicación**: Supabase BD (vista v_commissions_available_for_payment)
**Lógica Inferida**:

```sql
SELECT 
  seller_id,
  SUM(commission_amount) as available_amount,
  COUNT(*) as available_event_count
FROM commission_events
WHERE seller_id = $1
  AND status = 'available'
  AND earned_at BETWEEN period_start AND period_end
GROUP BY seller_id;
```

**Problema CRÍTICO después de pago parcial**:

Escenario:
```
commission_events:
  A: amount=$50, status='available'
  B: amount=$40, status='available'
  C: amount=$15, status='available'
  Total disponible: $105

Admin paga: $70 (FIFO)
  → A: $50 (completo)
  → B: $20 (parcial de $40)

¿Qué sucede con B después del pago?
  ❌ DESCONOCIDO:
    - ¿status='partially_paid'? 
    - ¿status='available' + paid_amount=20?
    - ¿Se crea nuevo evento B2 con amount=$20?
```

**Sin esta definición, available_amount seguirá mostrando $105 (incorrecto)**

---

# PARTE 5: TIPOS TYPESCRIPT

## 5.1 Interfaz: CommissionAvailableForPayment

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 90-95

```typescript
export interface CommissionAvailableForPayment {
  seller_id: string;
  available_amount: number | string;
  available_event_count: number;
  has_draft_settlement: boolean;
  draft_settlement_id: string | null;
}
```

**Uso**: 
- Devuelta por `loadAvailableForPayment()`
- Almacenada en estado de `PayCommissionsButton.tsx`
- Pasada a `CommissionPaymentModal` como `totalAmount`

---

## 5.2 Interfaz: CommissionSettlementHistory

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 56-68

```typescript
export interface CommissionSettlementHistory {
  settlement_id: string;
  seller_id: string;
  folio: string;
  month_start: string;
  month_end: string;
  period_label: string;
  event_count: number;
  total_amount: number | string;
  status: 'draft' | 'paid' | 'cancelled';
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
  payment_proof_path: string | null;
  has_payment_proof: boolean;
}
```

**Uso**:
- Devuelta por `loadSettlementHistory()`
- Mostrada en tabla de liquidaciones
- Abierta en modal de detalle

---

## 5.3 Interfaz: CommissionSettlementDetail

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 74-88

```typescript
export interface CommissionSettlementDetail {
  settlement_id: string;
  commission_event_id: string;
  earned_at: string;
  business_name: string;
  partner_folio: string;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  source_type: 'comodato_sale' | 'wholesale_sale' | 'conversion_bonus' | 'adjustment' | 'pos_sale';
  quantity: number | string;
  unit_commission: number | string;
  settlement_item_amount: number | string;  // ← CRÍTICO: Amount efectivo pagado
}
```

**Campo Crítico**: `settlement_item_amount`
- Si evento original = $50
- Pago parcial = $30
- Entonces settlement_item_amount = $30

---

## 5.4 Interfaz: CommissionMovement

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 19-42

```typescript
export interface CommissionMovement {
  commission_event_id: string;
  seller_id: string;
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string | null;
  earned_at: string;
  source_type: 'comodato_sale' | 'wholesale_sale' | 'conversion_bonus' | 'adjustment' | 'pos_sale';
  source_id: string | null;
  source_item_id: string | null;
  source_folio: string | null;
  product_key: string | null;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  quantity: number | string;
  unit_commission: number | string;
  commission_amount: number | string;
  release_condition: string;
  status: 'pending' | 'available' | 'paid' | 'cancelled';
  available_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  metadata?: Record<string, any> | string | null;
}
```

**Problema después de pago parcial**:
- ¿status se mantiene 'available'?
- ¿O se cambia a 'partially_paid'?
- ¿Hay columna `paid_amount`?

---

## 5.5 Interfaz: CommissionSettlement

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 44-54

```typescript
export interface CommissionSettlement {
  id: string;
  seller_id: string;
  month_start: string;
  month_end: string;
  total_amount: number;
  status: 'draft' | 'paid' | 'cancelled';
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}
```

**Problema después de pago parcial**:
- ¿total_amount es el TOTAL del período o el MONTO pagado?
- Para pago parcial: total_amount DEBE ser $100 (no $1,495)

---

## 5.6 Tipo: CommissionStatus

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Línea**: 140

```typescript
export type CommissionStatus = 'pending' | 'available' | 'paid' | 'cancelled';
```

**Necesario para pago parcial**: ¿Agregar 'partially_paid'?

---

## 5.7 Interfaz: SellerCommissionMonthlySummary

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 1-16

```typescript
export interface SellerCommissionMonthlySummary {
  seller_id: string;
  month_start: string;
  month_end: string;
  generated_total: number;
  available_total: number;  // ← Suma de eventos 'available'
  pending_total: number;
  paid_total: number;
  comodato_units: number;
  wholesale_units: number;
  conversion_count: number;
  partners_count: number;
}
```

**Problema después de pago parcial**:
- available_total DEBE restar lo pagado parcialmente

---

# PARTE 6: COMPONENTES DE INTERFAZ AFECTADOS

## 6.1 Tabla: Componentes y Sus Responsabilidades

| Componente | Ubicación | Función | Muestra | Campo Editable | Cambio Requerido |
|---|---|---|---|---|---|
| **PayCommissionsButton** | payments/PayCommissionsButton.tsx | Entry point, carga datos | Botón con amount total | ❌ NO | 🔴 Pasar `amount` a modal |
| **CommissionPaymentModal** | payments/CommissionPaymentModal.tsx | 2-paso wizard | Steps 1-2 | ❌ NO | 🔴 Recibir `paymentAmount` |
| **CommissionSettlementSummary** | payments/CommissionSettlementSummary.tsx | Resumen paso 1 | Monto total disponible | ❌ NO (CRÍTICO) | 🔴 Hacer editable |
| **CommissionPaymentMethod** | payments/CommissionPaymentMethod.tsx | Selector método paso 2 | Transfer/Cash options | ✅ Reference (transfer) | 🟡 Validar |
| **CommissionProofUploader** | payments/CommissionProofUploader.tsx | Upload de comprobante | File input | ✅ File | 🟢 NO |
| **CommissionDraftCard** | payments/CommissionDraftCard.tsx | Muestra draft preparando | Folio, período, monto | ❌ NO | 🟡 Mostrar monto parcial |
| **CommissionSettlementHistory** | payments/CommissionSettlementHistory.tsx | Tabla histórico | Liquidaciones pasadas | ❌ NO | 🟢 Display solo |
| **CommissionSettlementDetailModal** | payments/CommissionSettlementDetailModal.tsx | Detalle de liquidación | Items del settlement | ❌ NO | 🟢 Display solo |
| **CommissionSummaryCards** | CommissionSummaryCards.tsx | Tarjetas resumen | Generado, Disponible, etc | ❌ NO | 🟡 Recalcular disponible |
| **CommissionMovementsTable** | CommissionMovementsTable.tsx | Tabla de movimientos | Eventos individuales | ❌ NO | 🟢 Display solo |
| **AdminCommissionDashboard** | AdminCommissionDashboard.tsx | Dashboard principal | Todo junto | ❌ NO | 🟢 Integración |
| **SellerCommissionDashboard** | SellerCommissionDashboard.tsx | View-only vendedor | Historial | ❌ NO | 🟢 View-only |

---

## 6.2 Campo Editable para Monto Parcial

### Ubicación ACTUAL
❌ **NO EXISTE** en CommissionSettlementSummary.tsx

### Dónde DEBE Agregarse
**Archivo**: `/components/commercialPartners/commissions/payments/CommissionSettlementSummary.tsx`
**Línea**: 51-54 (ACTUAL)

```tsx
{/* Amount Info - ACTUAL */}
<div className="p-4 bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 rounded-lg border border-yellow-500/30">
  <div className="flex items-center gap-2 mb-3">
    <DollarSign size={16} className="text-yellow-500" />
    <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
  </div>
  <p className="text-2xl font-bold text-yellow-400">{formatCurrency(totalAmount)}</p>
</div>
```

### Cómo DEBERÍA Ser
```tsx
{/* Amount Info - DESEADO */}
<div className="p-4 bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 rounded-lg border border-yellow-500/30">
  <div className="flex items-center gap-2 mb-3">
    <DollarSign size={16} className="text-yellow-500" />
    <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
    <p className="text-xs text-neutral-400 ml-auto">Máx: {formatCurrency(totalAmount)}</p>
  </div>
  <input
    type="number"
    min={0.01}
    max={totalAmount}
    step={0.01}
    value={paymentAmount}
    onChange={(e) => setPaymentAmount(Number(e.target.value))}
    className="w-full text-2xl font-bold text-yellow-400 bg-transparent border-b border-yellow-500 outline-none px-0 pb-1"
    required
    placeholder={formatCurrency(totalAmount)}
  />
</div>
```

---

# PARTE 7: CÓDIGO RELEVANTE (Fragmentos Completos)

## 7.1 RPC: createCommissionSettlement (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 22-50

```typescript
/**
 * Create commission settlement (draft)
 */
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
  });

  if (error) {
    console.error('CREATE SETTLEMENT ERROR', error);
    throw error;
  }

  // Normalize response (can be array or object)
  const result = Array.isArray(data) ? data[0] : data;

  return {
    settlement_id: result.settlement_id,
    folio: result.folio,
    total_amount: Number(result.total_amount || 0),
    event_count: Number(result.event_count || 0),
  };
};
```

---

## 7.2 RPC: payCommissionSettlement (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 54-85

```typescript
/**
 * Pay commission settlement
 */
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

---

## 7.3 Carga de Datos: loadAvailableForPayment (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 128-145

```typescript
/**
 * Load available commissions for payment
 */
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

---

## 7.4 Carga de Historico: loadSettlementHistory (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 102-113

```typescript
/**
 * Load settlement history
 */
export const loadSettlementHistory = async (sellerId: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('v_commission_settlement_history')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('SETTLEMENT HISTORY ERROR', error);
    throw error;
  }

  return (data as CommissionSettlementHistory[]) || [];
};
```

---

## 7.5 Preparar Pago: handlePrepare (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/CommissionPaymentModal.tsx`
**Líneas**: 52-75

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

    console.log('SETTLEMENT CREATED', settlement);

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

## 7.6 Confirmar Pago: handlePayment (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/CommissionPaymentModal.tsx`
**Líneas**: 77-126

```typescript
const handlePayment = async (method: 'transfer' | 'cash', details: PaymentMethodDetails) => {
  setLoading(true);
  setError('');

  try {
    let proofPath = null;
    let fileName = null;
    let mimeType = null;

    console.log('PAYMENT METHOD', method);
    console.log('DETAILS', details);

    // Upload proof if transfer
    if (method === 'transfer' && details.proofFile) {
      console.log('UPLOADING PROOF', details.proofFile.name);

      proofPath = await uploadPaymentProof(
        details.proofFile,
        sellerId,
        settlementId
      );

      fileName = details.proofFile.name;
      mimeType = details.proofFile.type;

      console.log('PROOF UPLOADED', { proofPath, fileName, mimeType });
    }

    // Call pay RPC
    console.log('CALLING PAY RPC', {
      settlementId,
      method,
      proofPath,
      fileName,
      mimeType,
      reference: details.reference,
      notes: details.notes,
      cashConfirmed: details.cashConfirmed,
    });

    await payCommissionSettlement(
      settlementId,
      method,
      proofPath,
      fileName,
      mimeType,
      details.reference || null,
      details.notes || null,
      details.cashConfirmed || false
    );

    console.log('PAYMENT SUCCESSFUL');

    setSuccessMessage(
      `Pago registrado exitosamente. Folio: ${folio}`
    );

    // Close after delay
    setTimeout(() => {
      onClose();
      onSuccess();
    }, 2000);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al procesar pago';
    console.error('PAYMENT ERROR', err);
    setError(message);
  } finally {
    setLoading(false);
  }
};
```

---

## 7.7 Upload Comprobante (COMPLETO)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 145-180

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

  console.log('FILE UPLOADED', data);

  return data.path;
};
```

---

## 7.8 Sanitize FileName (AUXILIAR)

**Archivo**: `/components/commercialPartners/commissions/payments/paymentUtils.ts`
**Líneas**: 11-20

```typescript
/**
 * Sanitize file name for storage
 */
export const sanitizeFileName = (name: string): string => {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
};
```

---

## 7.9 Tipos: CommissionAvailableForPayment (DEFINICIÓN)

**Archivo**: `/components/commercialPartners/commissions/commissionTypes.ts`
**Líneas**: 90-95

```typescript
export interface CommissionAvailableForPayment {
  seller_id: string;
  available_amount: number | string;
  available_event_count: number;
  has_draft_settlement: boolean;
  draft_settlement_id: string | null;
}
```

---

# PARTE 8: DEPENDENCIAS Y RIESGOS

## 8.1 Componentes Duplicados o Antiguos

| Nombre | Ubicación | Estado | Riesgo |
|---|---|---|---|
| CommissionPaymentModal.tsx | payments/ | ✅ Actual | Único, centralizado |
| PayCommissionsButton.tsx | payments/ | ✅ Actual | Único, centralizado |
| CommissionSettlementSummary.tsx | payments/ | ✅ Actual | Único, centralizado |
| CommissionPaymentMethod.tsx | payments/ | ✅ Actual | Único, centralizado |
| CommissionSettlementHistory.tsx | payments/ | ✅ Actual | Único, centralizado |
| CommissionSettlementDetailModal.tsx | payments/ | ✅ Actual | Único, centralizado |

**Conclusión**: NO hay duplicados, arquitectura limpia.

---

## 8.2 Múltiples Pantallas de Comisiones

| Pantalla | Ubicación | Función | Riesgo |
|---|---|---|---|
| AdminCommissionDashboard | AdminCommissionDashboard.tsx | Admin ve comisiones + botón pagar | BAJO: Integra PayCommissionsButton |
| SellerCommissionDashboard | SellerCommissionDashboard.tsx | Vendedor ve historial (view-only) | BAJO: Solo lectura |
| PendingCommissionsModal | PendingCommissionsModal.tsx | Modal de eventos pending | BAJO: No afecta pagos |
| AvailableCommissionsModal | AvailableCommissionsModal.tsx | Modal de eventos available | 🔴 CRÍTICO: Muestra amount total |

**AvailableCommissionsModal**: 
- ¿Muestra `available_amount` TOTAL?
- ¿O lo recalcula si hay draft?
- Revisar: `/components/commercialPartners/commissions/AvailableCommissionsModal.tsx`

---

## 8.3 RPC Llamadas desde Varios Lugares

| RPC | Ubicaciones de Llamada | Cantidad | Riesgo |
|---|---|---|---|
| create_commission_settlement | CommissionPaymentModal.handlePrepare() | 1 | BAJO: Una sola ubicación |
| pay_commission_settlement | CommissionPaymentModal.handlePayment() | 1 | BAJO: Una sola ubicación |
| cancel_commission_settlement_draft | (buscar referencias) | ¿? | ¿? |
| loadSettlementHistory | PayCommissionsButton.tsx + CommissionSettlementHistory.tsx | 2 | BAJO: Misma lógica |
| loadAvailableForPayment | PayCommissionsButton.tsx | 1 | BAJO: Una sola ubicación |

---

## 8.4 Cálculos Repetidos

| Cálculo | Ubicaciones | Riesgo |
|---|---|---|
| Período actual (mes) | PayCommissionsButton.tsx línea 139-145 | 🔴 CRÍTICO: Hardcoded, no reutilizable |
| Formateo de currency | commissionUtils.ts formatCurrency() | BAJO: Centralizado |
| Cálculo de total settlement items | CommissionSettlementDetailModal.tsx línea 72 | BAJO: Detail display |

---

## 8.5 Consultas que Podrían Mostrar Importe Incorrecto

| Consulta | Problema | Ubicación | Severidad |
|---|---|---|---|
| v_commissions_available_for_payment | Suma de TODOS los eventos status='available' - No resta lo pagado parcialmente | PayCommissionsButton.tsx | 🔴 CRÍTICO |
| v_commission_settlement_history | Muestra total_amount del settlement - Debe ser MONTO PAGADO, no total período | CommissionSettlementHistory.tsx | 🔴 CRÍTICO |
| v_commission_settlement_detail | Muestra settlement_item_amount - DEBE ser parcial si pago parcial | CommissionSettlementDetailModal.tsx | 🔴 CRÍTICO |
| v_seller_commission_monthly_summary | available_total debe restar lo pagado parcialmente | CommissionSummaryCards.tsx | 🔴 CRÍTICO |

---

## 8.6 Cambios de Firma RPC

| RPC Actual | Parámetros | Cambio Necesario | Impacto |
|---|---|---|---|
| create_commission_settlement | (p_seller_id, p_period_start, p_period_end) | ✅ Agregar p_amount OPCIONAL | 🟡 MEDIO: Backward compatible si DEFAULT NULL |
| pay_commission_settlement | (p_settlement_id, p_payment_method, ...) | ¿ p_amount? | ❓ DESCONOCIDO: Depende diseño BD |
| cancel_commission_settlement_draft | (p_settlement_id, p_reason) | NO REQUIERE | 🟢 BAJO |

**Impacto en Código**:
- createCommissionSettlement(): Agregar parámetro amount? opcional
- payCommissionSettlement(): Posiblemente agregar parámetro amount? opcional
- Ambos pueden ser backward-compatible con defaults

---

## 8.7 Pruebas Existentes

| Módulo | Pruebas | Ubicación | Status |
|---|---|---|---|
| paymentUtils.ts | ¿? | __tests__/ | ❓ DESCONOCIDO |
| CommissionPaymentModal.tsx | ¿? | __tests__/ | ❓ DESCONOCIDO |
| PayCommissionsButton.tsx | ¿? | __tests__/ | ❓ DESCONOCIDO |

**Recomendación**: Buscar `*.test.ts` o `*.spec.ts` en `components/commercialPartners/commissions/`

---

## 8.8 Ausencia de Pruebas Críticas

| Escenario | Importancia | Ubicación |
|---|---|---|
| Pago parcial de comisión | 🔴 CRÍTICO | CommissionPaymentModal.test.tsx (NO EXISTE) |
| Recálculo de available_amount post-pago | 🔴 CRÍTICO | PayCommissionsButton.test.tsx (NO EXISTE) |
| FIFO ordering de eventos | 🔴 CRÍTICO | Supabase RPC test (NO EXISTE) |
| Manejo de evento parcialmente pagado | 🔴 CRÍTICO | Supabase BD test (NO EXISTE) |

---

# PARTE 9: RESUMEN FINAL PARA IMPLEMENTACIÓN

## 9.1 Archivos que DEBERÁN Modificarse (Ordenados por Prioridad)

### PRIORIDAD 1: CRÍTICO (Sin estos, no funciona)

1. **`/components/commercialPartners/commissions/payments/paymentUtils.ts`**
   - Función: `createCommissionSettlement()`
   - Cambio: Agregar parámetro `amount?: number`
   - Línea: 22-50
   - Impacto: 🔴 CRÍTICO

2. **`/components/commercialPartners/commissions/payments/CommissionSettlementSummary.tsx`**
   - Cambio: Reemplazar `<p>` estático con `<input type="number">`
   - Línea: 51-54
   - Impacto: 🔴 CRÍTICO (sin input, no hay forma de capturar amount)

3. **`/components/commercialPartners/commissions/payments/CommissionPaymentModal.tsx`**
   - Cambio: Recibir `paymentAmount` de hijo (CommissionSettlementSummary)
   - Cambio: Pasar `paymentAmount` a `createCommissionSettlement()`
   - Línea: 52-75
   - Impacto: 🔴 CRÍTICO

4. **`/components/commercialPartners/commissions/payments/PayCommissionsButton.tsx`**
   - Cambio: Pasar `amount` prop a CommissionPaymentModal
   - Línea: 124-148
   - Impacto: 🔴 CRÍTICO

### PRIORIDAD 2: ALTO (Necesario para UI correcta)

5. **`/components/commercialPartners/commissions/commissionTypes.ts`**
   - Cambio: Verificar si CommissionSettlementDetail necesita campos adicionales
   - Cambio: Posiblemente agregar `partial_amount` a CommissionSettlementHistory
   - Línea: 56-88
   - Impacto: 🟡 ALTO

6. **`/components/commercialPartners/commissions/payments/CommissionDraftCard.tsx`**
   - Cambio: Mostrar monto parcial si existe
   - Impacto: 🟡 ALTO

### PRIORIDAD 3: MEDIO (Validaciones)

7. **`/components/commercialPartners/commissions/commissionUtils.ts`**
   - Verificar: ¿Necesita adaptación formatCurrency() para amounts parciales?
   - Impacto: 🟡 MEDIO

---

## 9.2 Funciones/Componentes Específicos a Modificar

```
paymentUtils.ts:
  ├─ createCommissionSettlement()
  │   └─ Agregar: amount?: number
  └─ (posiblemente) payCommissionSettlement()
      └─ Agregar: amount?: number

CommissionPaymentModal.tsx:
  ├─ handlePrepare()
  │   └─ Pasar paymentAmount a createCommissionSettlement()
  └─ Props: totalAmount → paymentAmount

CommissionSettlementSummary.tsx:
  ├─ Props: onChange callback para capturar amount
  └─ Render: <input> en lugar de <p>

PayCommissionsButton.tsx:
  ├─ Props a CommissionPaymentModal:
  │   ├─ totalAmount → maxAmount (para validación)
  │   └─ defaultAmount (para llenar input)
  └─ Recarga: loadAvailableForPayment() post-pago

CommissionDraftCard.tsx:
  └─ Mostrar: amount (si pago parcial) vs total_amount (si completo)
```

---

## 9.3 Archivos que NO Deben Tocarse

| Archivo | Razón |
|---|---|
| CommissionMovementsTable.tsx | Solo display de eventos |
| CommissionSettlementHistory.tsx | Solo display de histórico |
| CommissionSettlementDetailModal.tsx | Solo display de detalle |
| CommissionPaymentMethod.tsx | Método de pago no cambia |
| CommissionProofUploader.tsx | Upload de comprobante no cambia |
| AdminCommissionDashboard.tsx | Integración ya existe |
| SellerCommissionDashboard.tsx | View-only, no afecta |
| CommissionSummaryCards.tsx | Si se recalcula available_amount en BD, se actualiza automáticamente |
| PendingCommissionsModal.tsx | Solo display de pending |
| ExtraDayCommissionModal.tsx | Creación de nuevos eventos |
| AdminPartnerTargetEditor.tsx | Metas mensuales |
| ActivitySummary.tsx | Solo display |

---

## 9.4 Punto de Entrada Principal

**Flujo Actual**:
```
AdminCommissionDashboard.tsx
  → Vendedor seleccionado
  → PayCommissionsButton.tsx
    → loadAvailableForPayment() [CONSULTA PRINCIPAL]
    → Click → CommissionPaymentModal.tsx
      → Step 1: CommissionSettlementSummary
        → INPUT de amount [AGREGAR AQUÍ]
      → Step 2: CommissionPaymentMethod
        → Confirmar pago
      → handlePayment() → pay_commission_settlement() RPC
```

**Punto de Entrada del Módulo**: `PayCommissionsButton.tsx` (componente que contiene toda la lógica)

---

## 9.5 Fuente de Datos Principal

**Consulta que Calcula Disponible**:
```
Vista de Supabase: v_commissions_available_for_payment
  └─ Ejecutada en: paymentUtils.ts → loadAvailableForPayment()
      └─ Usada en: PayCommissionsButton.tsx → setAvailable()
```

**CRÍTICO**: Esta vista DEBE recalcular después de cada pago parcial
- Si pago $100 de $1,495
- available_amount DEBE pasar a $1,395
- available_event_count se mantiene igual (eventos, no montos)

---

## 9.6 Resumen de Cambios Necesarios

### EN FRONTEND (React/TypeScript)
```
Total: 4 archivos críticos
  1. paymentUtils.ts - Agregar parámetro amount
  2. CommissionSettlementSummary.tsx - Input editable
  3. CommissionPaymentModal.tsx - Pasar amount
  4. PayCommissionsButton.tsx - Pasar maxAmount

Total: 2 archivos secundarios
  5. commissionTypes.ts - Tipos adicionales
  6. CommissionDraftCard.tsx - Mostrar partial amount
```

### EN SUPABASE (SQL/RPCs)
```
CRÍTICO:
  1. RPC create_commission_settlement - Agregar p_amount
  2. Tabla commission_settlement_items - Verificar settlement_item_amount
  3. Tabla commission_events - Definir status 'partially_paid' o similar
  
ALTO:
  4. Vista v_commissions_available_for_payment - Recalcular post-pago
  5. Vista v_commission_settlement_history - Mostrar partial_amount
  6. Vista v_commission_settlement_detail - Usar settlement_item_amount
  
MEDIO:
  7. Lógica FIFO en RPC - Seleccionar eventos hasta monto
  8. Status management - Marcar eventos parcialmente pagados
```

---

**FIN DEL DIAGNÓSTICO TÉCNICO COMPLETO**

---

## ÍNDICE DE DOCUMENTOS GENERADOS

1. **DIAGNOSTIC_PARTIAL_PAYMENTS_PART1.md** - Archivos, flujos de preparación y confirmación
2. **DIAGNOSTIC_PARTIAL_PAYMENTS_PART2-9.md** (este) - Consultas, tipos, componentes, código, riesgos, resumen

---

**Próximo Paso**: Contactar DBA/Supabase para confirmar que:
1. RPC `create_commission_settlement` puede aceptar `p_amount`
2. Schema soporta partial amounts en `commission_settlement_items`
3. Hay plan para status='partially_paid' o similar en `commission_events`
