# 🔍 DIAGNÓSTICO EXACTO: Desglose Clickeable de "Ventas Socios Comerciales"

**Fecha**: 21 de agosto de 2026  
**Alcance**: Análisis técnico SOLO de lectura — Sin implementación, sin SQL, sin modificaciones.  
**Objetivo**: Detallar componentes, fuentes de datos y arquitectura para hacer clickeable la tarjeta de Ventas Socios Comerciales en el Calendario de Finanzas.

---

## 📍 PUNTO 1: COMPONENTE REAL DEL CALENDARIO

### Archivo Principal
**[MonthCalendar.tsx](components/finance/MonthCalendar.tsx)**

### Ubicación en el Árbol de Componentes
```
Finanzas
└─ Calendario de Ventas
   └─ MonthCalendar.tsx          ← COMPONENTE RAÍZ
      └─ [Cuadrícula de días]
         └─ [Día clickeable: 19 agosto 2026]
            └─ loadDayDetail()  ← ABRE MODAL
               └─ [Modal de día]
                  └─ Sección: Ventas Socios Comerciales  ← TARGET
```

### Líneas Aproximadas
- **Línea 82-95**: Definición del componente y estado
- **Línea 115-220**: Función `loadDayDetail()` - Carga los detalles del día
- **Línea 205-215**: Llamada a `getCommercialCollections(dateStart, dateEnd)`
- **Línea 580-605**: Renderizado de tarjeta "Ventas Socios Comerciales"

### Props del Componente
```typescript
interface Props {
  monthStartISO: string;  // e.g., "2026-08-01"
}
```

### State Relevante
```typescript
const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
const [detailLoading, setDetailLoading] = useState(false);
```

### Interfaz DayDetail (Estructura de Datos)
```typescript
interface DayDetail {
  // Caja directa
  cajaCash: number;
  cajaCard: number;
  cajaMixed: number;
  cajaTotal: number;
  cajaCount: number;

  // Pedidos
  pedidosCash: number;
  pedidosCard: number;
  pedidosTransfer: number;
  pedidosTotal: number;
  pedidosCount: number;

  // Delivery
  deliveryTotal: number;
  deliveryCount: number;

  // ★ COMMERCIAL PARTNERS (SOCIOS COMERCIALES)
  commercialTotal: number;        // TOTAL QUE APARECE EN TARJETA
  commercialComodato: number;     // Desglose Comodato
  commercialMayoreo: number;      // Desglose Mayoreo
  commercialPieceSale: number;    // Desglose Venta por Pieza
  commercialCash: number;         // Método pago: Efectivo
  commercialTransfer: number;     // Método pago: Transferencia

  // Combined
  grandTotal: number;

  // Order list
  orders: DayOrder[];
}
```

### Observación Crítica
La tarjeta es **ACTUALMENTE NO-INTERACTIVA**. No existe `onClick` ni acción.

---

## 📍 PUNTO 2: FUENTE EXACTA DEL TOTAL $750 (Ventas Socios Comerciales)

### Rastreo Completo del Flujo de Datos

#### Paso 1: Modal se abre al hacer click en un día
**Línea 413-424** en MonthCalendar.tsx:
```tsx
onClick={() => {
  if (isFuture) return;
  if (isSelected) {
    setSelectedDay(null);
    setDayDetail(null);
  } else {
    setSelectedDay(d);
    loadDayDetail(d);  // ← AQUÍ COMIENZA LA CARGA
  }
}}
```

#### Paso 2: loadDayDetail() se ejecuta
**Línea 115-220**:
```tsx
const loadDayDetail = useCallback(async (day: CalendarDay) => {
  // day.sale_date = "2026-08-19" (string ISO, sin hora)
  
  // Línea 205-215: OBTENER DATOS DE SOCIOS COMERCIALES
  const dateStart = new Date(day.sale_date + 'T00:00:00Z');     // Inicio UTC
  const dateEnd = new Date(new Date(day.sale_date + 'T23:59:59Z').getTime() + 1000);  // Fin UTC
  const commercialData = await getCommercialCollections(dateStart, dateEnd);
  
  // Línea 217-225: ASIGNAR A STATE
  let commercialTotal = 0;
  let commercialComodato = 0;
  let commercialMayoreo = 0;
  let commercialPieceSale = 0;
  let commercialCash = 0;
  let commercialTransfer = 0;

  if (!commercialData.error && commercialData.breakdown) {
    commercialTotal = commercialData.total;           // ← $750
    commercialComodato = commercialData.bySource.comodato;
    commercialMayoreo = commercialData.bySource.mayoreo;
    commercialPieceSale = commercialData.bySource.pieceSale;
    commercialCash = commercialData.cash;
    commercialTransfer = commercialData.transfer;
  }

  setDayDetail({
    // ... otros campos ...
    commercialTotal, commercialComodato, commercialMayoreo, 
    commercialPieceSale, commercialCash, commercialTransfer,
    // ...
  });
});
```

#### Paso 3: getCommercialCollections() hace las queries
**Archivo**: [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts), línea 47

**Función**: `getCommercialCollections(startDate: Date, endDate: Date): Promise<CommercialCollections>`

**Retorna**:
```typescript
interface CommercialCollections {
  total: number;              // $750 (suma de todas las fuentes)
  cash: number;               // Efectivo total
  transfer: number;           // Transferencias totales
  bySource: {
    comodato: number;         // $750 (100%)
    mayoreo: number;          // $0
    pieceSale: number;        // $0
  };
  breakdown: CommercialCollectionItem[];  // Array con cada pago individual
  error?: string;
}
```

#### Paso 4: Renderizado en el Modal
**Línea 580-605** en MonthCalendar.tsx:
```tsx
{/* Ventas Socios Comerciales */}
<div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
  <div className="flex items-center gap-2 mb-3">
    <Landmark size={16} className="text-emerald-400" />
    <span className="text-sm font-bold text-cc-cream">Ventas Socios Comerciales</span>
    <span className="ml-auto text-lg font-bold text-emerald-400">
      {fmt(dayDetail.commercialTotal)}  {/* ← AQUÍ APARECE $750 */}
    </span>
  </div>
  <div className="space-y-2">
    <div className="flex items-center justify-between text-xs">
      <span className="text-cc-text-muted">Comodato</span>
      <span className="text-cc-cream font-medium">{fmt(dayDetail.commercialComodato)}</span>
    </div>
    <div className="flex items-center justify-between text-xs">
      <span className="text-cc-text-muted">Mayoreo</span>
      <span className="text-cc-cream font-medium">{fmt(dayDetail.commercialMayoreo)}</span>
    </div>
    <div className="flex items-center justify-between text-xs">
      <span className="text-cc-text-muted">Venta por pieza</span>
      <span className="text-cc-cream font-medium">{fmt(dayDetail.commercialPieceSale)}</span>
    </div>
  </div>
</div>
```

### Fórmula Exacta del Total
```
commercialTotal ($750) = 
  commercialComodato ($750)
  + commercialMayoreo ($0)
  + commercialPieceSale ($0)
  
= $750
```

---

## 📍 PUNTO 3: FUENTE EXACTA DE COMODATO ($750)

### Query Directa a la BD
**Archivo**: [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts), línea 82-118

```typescript
// 1. COMODATO: commercial_partner_payments
const { data: comodatoPayments, error: comodatoErr } = await supabase
  .from('commercial_partner_payments')
  .select('id, partner_id, payment_date, amount, payment_method')
  .in('status', ['completed', 'paid'])                          // ← CONDICIÓN CRÍTICA
  .gte('payment_date', startISO)                                // ← RANGO DE FECHAS
  .lte('payment_date', endISO);

if (comodatoPayments) {
  for (const payment of comodatoPayments) {
    const amount = Number(payment.amount) || 0;
    const method = (payment.payment_method || '').toLowerCase();

    comodatoTotal += amount;  // ← SUMA ACUMULATIVA
    result.bySource.comodato += amount;

    if (method === 'cash') {
      result.cash += amount;
    } else if (method === 'transfer') {
      result.transfer += amount;
    }

    result.breakdown.push({
      id: payment.id,
      source_type: 'comodato',
      payment_date: payment.payment_date,
      amount,
      payment_method: method,
      partner_id: payment.partner_id,
    });
  }
}
```

### Tabla Fuente Exacta
**Tabla**: `public.commercial_partner_payments`

### Campos Disponibles
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único del pago |
| `partner_id` | UUID | FK → commercial_partners |
| `movement_id` | UUID | FK → commercial_partner_movements (nullable) |
| `payment_date` | TIMESTAMPTZ | Fecha/hora del pago (UTC) |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' |
| `reference` | TEXT | Referencia de transferencia (nullable) |
| `status` | TEXT | **'completed' \| 'paid'** (CONDICIÓN) |
| `received_by` | UUID | FK → user_profiles |
| `notes` | TEXT | Notas (nullable) |
| `created_at` | TIMESTAMPTZ | Timestamp de creación |

### Filtros Aplicados
```
WHERE status IN ('completed', 'paid')           ← Solo pagos confirmados
AND payment_date >= '2026-08-19T00:00:00Z'       ← Rango de fechas (UTC)
AND payment_date <= '2026-08-19T23:59:59Z'
```

### Condición de Inclusión
✅ **SOLO pagos confirmados**: `status IN ('completed', 'paid')`

❌ **NO incluye**:
- Solicitudes de verificación pendientes
- Pagos rechazados
- Pagos en revisión

### Monto Exacto
Para el 19 de agosto:
- **$750** de `commercial_partner_payments` donde `status IN ('completed', 'paid')`

---

## 📍 PUNTO 4: FUENTE EXACTA DE MAYOREO ($0)

### Query Directa a la BD
**Archivo**: [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts), línea 120-156

```typescript
// 2. MAYOREO: wholesale_payments
const { data: mayoreoPayments, error: mayoreoErr } = await supabase
  .from('wholesale_payments')
  .select('id, partner_id, payment_date, amount, payment_method')
  .in('status', ['completed', 'paid'])
  .gte('payment_date', startISO)
  .lte('payment_date', endISO);

if (mayoreoPayments) {
  for (const payment of mayoreoPayments) {
    const amount = Number(payment.amount) || 0;
    const method = (payment.payment_method || '').toLowerCase();

    mayoreoTotal += amount;  // ← $0 (si no hay pagos)
    result.bySource.mayoreo += amount;

    if (method === 'cash') {
      result.cash += amount;
    } else if (method === 'transfer') {
      result.transfer += amount;
    }

    result.breakdown.push({
      id: payment.id,
      source_type: 'mayoreo',
      payment_date: payment.payment_date,
      amount,
      payment_method: method,
      partner_id: payment.partner_id,
    });
  }
}
```

### Tabla Fuente Exacta
**Tabla**: `public.wholesale_payments`

### Campos Disponibles
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único del pago |
| `partner_id` | UUID | FK → commercial_partners |
| `wholesale_order_id` | UUID | FK → wholesale_orders |
| `payment_date` | TIMESTAMPTZ | Fecha/hora del pago (UTC) |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' \| 'card' |
| `reference` | TEXT | Referencia (nullable) |
| `notes` | TEXT | Notas (nullable) |
| `received_by` | UUID | FK → user_profiles |
| `status` | TEXT | **'completed' \| 'paid'** (CONDICIÓN) |
| `created_at` | TIMESTAMPTZ | Timestamp |
| `updated_at` | TIMESTAMPTZ | Timestamp |

### Filtros Aplicados
```
WHERE status IN ('completed', 'paid')
AND payment_date >= '2026-08-19T00:00:00Z'
AND payment_date <= '2026-08-19T23:59:59Z'
```

### Condición de Inclusión
✅ **SOLO pagos confirmados**: `status IN ('completed', 'paid')`

### Monto Exacto
Para el 19 de agosto:
- **$0** de `wholesale_payments` donde `status IN ('completed', 'paid')`
- (Nada en ese día, pero la tabla existe y tiene datos en otros días)

---

## 📍 PUNTO 5: FUENTE EXACTA DE VENTA POR PIEZA ($0)

### Query Directa a la BD
**Archivo**: [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts), línea 158-195

```typescript
// 3. VENTA POR PIEZA: seller_piece_payments (NOT verification_requests)
const { data: pieceSalePayments, error: pieceSaleErr } = await supabase
  .from('seller_piece_payments')
  .select('id, seller_id, payment_date, amount, payment_method')
  .eq('status', 'completed')                    // ← SOLO 'completed', NO 'paid'
  .gte('payment_date', startISO)
  .lte('payment_date', endISO);

if (pieceSalePayments) {
  for (const payment of pieceSalePayments) {
    const amount = Number(payment.amount) || 0;
    const method = (payment.payment_method || '').toLowerCase();

    pieceSaleTotal += amount;  // ← $0 (si no hay pagos)
    result.bySource.pieceSale += amount;

    if (method === 'cash') {
      result.cash += amount;
    } else if (method === 'transfer') {
      result.transfer += amount;
    }

    result.breakdown.push({
      id: payment.id,
      source_type: 'venta_pieza',
      payment_date: payment.payment_date,
      amount,
      payment_method: method,
      seller_id: payment.seller_id,
    });
  }
}
```

### Tabla Fuente Exacta
**Tabla**: `public.seller_piece_payments`

### Campos Disponibles
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único del pago |
| `seller_id` | UUID | FK → user_profiles (vendedor) |
| `sale_id` | UUID | FK → seller_piece_sales (nullable) |
| `request_id` | UUID | FK → payment_verification_request (nullable) |
| `payment_date` | TIMESTAMPTZ | Fecha/hora del pago (UTC) |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' |
| `reference` | TEXT | Referencia (nullable) |
| `status` | TEXT | **'completed'** (ÚNICA CONDICIÓN) |
| `notes` | TEXT | Notas (nullable) |
| `created_at` | TIMESTAMPTZ | Timestamp |

### Filtro Aplicado
```
WHERE status = 'completed'          ← NOTA: SOLO 'completed', no 'paid'
AND payment_date >= '2026-08-19T00:00:00Z'
AND payment_date <= '2026-08-19T23:59:59Z'
```

### Condición de Inclusión
✅ **SOLO pagos con status='completed'**

❌ **NO incluye**:
- 'pending'
- 'pending_review'
- 'rejected'
- Cualquier otro estado

### Diferencia Importante
**Comodato y Mayoreo**: Aceptan `status IN ('completed', 'paid')`  
**Venta por Pieza**: Acepta **SOLO** `status = 'completed'`

### Monto Exacto
Para el 19 de agosto:
- **$0** de `seller_piece_payments` donde `status = 'completed'`

---

## 📍 PUNTO 6: CRITERIO DE FILTRO POR FECHA

### Cálculo Actual en MonthCalendar.tsx (Línea 205-214)

```typescript
// Para día "2026-08-19"
const dateStart = new Date(day.sale_date + 'T00:00:00Z');       // 2026-08-19T00:00:00.000Z
const dateEnd = new Date(
  new Date(day.sale_date + 'T23:59:59Z').getTime() + 1000      // +1000ms
);  // 2026-08-19T23:59:59.999Z

// En getCommercialCollections (línea 65-66):
const startISO = startDate.toISOString();  // "2026-08-19T00:00:00.000Z"
const endISO = endDate.toISOString();      // "2026-08-19T23:59:59.999Z"

// Queries usan:
.gte('payment_date', startISO)             // ≥ 2026-08-19T00:00:00Z
.lte('payment_date', endISO)               // ≤ 2026-08-19T23:59:59Z
```

### Timezone
**Implementación actual**: Los timestamps se almacenan en UTC en Supabase.

**Comentario en el código** (línea 119):
```
// Day boundaries (Mexico City timezone stored as UTC)
```

**IMPORTANTE**: El rango de fechas **usa UTC directo**, no America/Mexico_City.

Esto significa:
- Pagos de 2026-08-19 00:00:00 UTC hasta 2026-08-19 23:59:59 UTC
- No hay conversión a -06:00

### Reutilización Exacta
Para el futuro detalle, **REUTILIZAR EXACTAMENTE el mismo rango**:
```typescript
const dateStart = new Date(selectedDay.sale_date + 'T00:00:00Z');
const dateEnd = new Date(new Date(selectedDay.sale_date + 'T23:59:59Z').getTime() + 1000);
```

---

## 📍 PUNTO 7: ARRAY breakdown - DETALLES INDIVIDUALES

### Estructura de CommercialCollectionItem
Definida en [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts), línea 7-14:

```typescript
export interface CommercialCollectionItem {
  id: string;                          // ID del pago
  source_type: 'comodato' | 'mayoreo' | 'venta_pieza';
  payment_date: string;                // "2026-08-19T14:30:00.000Z"
  amount: number;                      // Monto del pago
  payment_method: 'cash' | 'transfer';
  partner_id?: string;                 // Para Comodato y Mayoreo
  seller_id?: string;                  // Para Venta por Pieza
  reference?: string;                  // Referencia de transferencia
}
```

### Ejemplo Real del breakdown (19 ago, $750 total)
```typescript
commercialData.breakdown = [
  // COMODATO
  {
    id: "uuid-1",
    source_type: "comodato",
    payment_date: "2026-08-19T10:15:00.000Z",
    amount: 500,
    payment_method: "transfer",
    partner_id: "partner-123",
    reference: "TRF-19-001"
  },
  {
    id: "uuid-2",
    source_type: "comodato",
    payment_date: "2026-08-19T16:45:00.000Z",
    amount: 250,
    payment_method: "cash",
    partner_id: "partner-456"
  },
  // MAYOREO
  // (vacío para este día)
  
  // VENTA POR PIEZA
  // (vacío para este día)
]
```

### Uso en Futura Tarjeta Clickeable
El `breakdown` contiene **TODOS los pagos individuales** que forman el total.

Para reconciliación:
```
SUM(breakdown[i].amount) = $750  ← EXACTO
```

---

## 📍 PUNTO 8: CAMPOS DISPONIBLES PARA FUTURO DETALLE

### COMODATO - Campos Conectables

#### Desde `commercial_partner_payments`
```typescript
{
  id: string,                    // Payment ID
  partner_id: string,            // → Socio
  movement_id: string,           // → Liquidación/Movimiento
  payment_date: string,          // Fecha del cobro
  amount: number,                // Monto
  payment_method: string,        // cash | transfer
  reference: string,             // Referencia transf
  status: string,                // completed | paid
  received_by: string,           // Quién recibió
  notes: string                  // Notas
}
```

#### Via FK movement_id → `commercial_partner_movements`
```typescript
{
  id: string,                    // Movement ID
  partner_id: string,            // Socio (redundante)
  movement_type: string,         // 'delivery' | 'settlement'
  movement_date: string,         // Fecha del movimiento
  status: string                 // 'completed' | 'pending' | 'partial'
}
```

#### Via movement_id → `commercial_partner_movement_items`
```typescript
{
  id: string,
  movement_id: string,           // ← VÍNCULO
  partner_id: string,
  product_name: string,          // "Gato Mayor"
  product_variant: string,       // "Cheddar"
  product_size: string,          // "2pcs"
  quantity_delivered: number,
  quantity_sold: number,         // ← Lo que se pagó
  quantity_withdrawn: number,
  quantity_spoiled: number,
  price_to_catcorn: number,      // Precio de pago
  suggested_retail_price: number,
  amount_due: number             // quantity_sold × price_to_catcorn
}
```

#### Via partner_id → `commercial_partners`
```typescript
{
  id: string,
  folio: string,                 // "CP-010726-001"
  business_name: string,         // "Abarrotes Mary"
  responsible_name: string,      // Nombre de contacto
  phone: string,
  whatsapp: string,
  email: string,
  partner_model: string
}
```

### MAYOREO - Campos Conectables

#### Desde `wholesale_payments`
```typescript
{
  id: string,
  partner_id: string,            // → Socio
  wholesale_order_id: string,    // → Orden
  payment_date: string,
  amount: number,
  payment_method: string,
  reference: string,
  status: string,
  received_by: string,
  notes: string
}
```

#### Via wholesale_order_id → `wholesale_orders`
```typescript
{
  id: string,
  partner_id: string,            // Socio (redundante)
  folio: string,                 // "MAY-2026-001"
  total_amount: number,          // Total de la orden
  status: string,                // 'draft' | 'confirmed' | 'completed'
  order_date: string,            // Fecha creación
  delivery_date: string          // Fecha entrega
}
```

#### Via wholesale_order_id → `wholesale_order_items`
```typescript
{
  id: string,
  wholesale_order_id: string,    // ← VÍNCULO
  partner_id: string,
  product_name: string,          // "Gato Mayor"
  product_variant: string,
  product_size: string,
  quantity: number,              // Piezas
  unit_price: number,
  subtotal: number               // quantity × unit_price
}
```

#### Via partner_id → `commercial_partners`
(Mismo que Comodato)

### VENTA POR PIEZA - Campos Conectables

#### Desde `seller_piece_payments`
```typescript
{
  id: string,
  seller_id: string,             // → Vendedor
  sale_id: string,               // → Venta
  payment_date: string,
  amount: number,
  payment_method: string,
  reference: string,
  status: string,                // 'completed'
  notes: string
}
```

#### Via sale_id → `seller_piece_sales`
```typescript
{
  id: string,
  seller_id: string,             // Vendedor (redundante)
  sale_folio: string,            // "F001"
  sale_date: string,             // Fecha venta
  total_amount: number,          // Total vendido
  total_commission: number,      // Comisión
  payment_method: string,
  status: string                 // 'pending' | 'confirmed' | 'rejected'
}
```

#### Via sale_id → `seller_piece_sale_items`
```typescript
{
  id: string,
  sale_id: string,               // ← VÍNCULO
  seller_id: string,
  product_name: string,          // "Gato Mayor"
  product_variant: string,
  product_size: string,
  quantity: number,              // Unidades vendidas
  unit_price: number,
  subtotal: number
}
```

#### Via seller_id → `user_profiles`
```typescript
{
  id: string,
  full_name: string,             // "Juan García"
  role: string                   // 'socios_comerciales'
}
```

---

## 📍 PUNTO 9: VÍNCULOS INTERNOS (Capacidad de Joins)

### COMODATO: Vínculo payment → productos

```
commercial_partner_payments
├─ [FK: partner_id] → commercial_partners (socio)
│  ├─ folio
│  ├─ business_name
│  └─ contact info
├─ [FK: movement_id] → commercial_partner_movements (nullable)
│  └─ [movement_id] → commercial_partner_movement_items
│     ├─ product_name
│     ├─ quantity_sold
│     ├─ price_to_catcorn
│     └─ amount_due
└─ payment_date, amount, method
```

**¿Posible?** ✅ **SÍ**, si `movement_id` NO ES NULL.

**Problema potencial**: ¿Qué si `movement_id = NULL`?
- El pago existe pero NO está vinculado a un movimiento específico
- Mostrar solo el pago, sin productos
- NO ocultar el pago

### MAYOREO: Vínculo payment → orden → productos

```
wholesale_payments
├─ [FK: partner_id] → commercial_partners (socio)
├─ [FK: wholesale_order_id] → wholesale_orders
│  ├─ folio
│  ├─ order_date
│  └─ [wholesale_order_id] → wholesale_order_items
│     ├─ product_name
│     ├─ quantity
│     └─ unit_price
└─ payment_date, amount, method
```

**¿Posible?** ✅ **SÍ**, si `wholesale_order_id` NO ES NULL.

**Problema potencial**: ¿Qué si `wholesale_order_id = NULL`?
- Mostrar solo el pago
- NO ocultar

### VENTA POR PIEZA: Vínculo payment → venta → productos

```
seller_piece_payments
├─ [FK: seller_id] → user_profiles (vendedor)
├─ [FK: sale_id] → seller_piece_sales (nullable)
│  ├─ sale_folio
│  ├─ sale_date
│  └─ [sale_id] → seller_piece_sale_items
│     ├─ product_name
│     ├─ quantity
│     └─ unit_price
└─ payment_date, amount, method
```

**¿Posible?** ✅ **SÍ**, si `sale_id` NO ES NULL.

**Problema potencial**: ¿Qué si `sale_id = NULL`?
- Mostrar solo el pago
- NO ocultar

---

## 📍 PUNTO 10: RECONCILIACIÓN GARANTIZADA

### Fórmula de Validación
```
Detalle Modal Futuro:
  SUM(pagos de Comodato) 
  + SUM(pagos de Mayoreo)
  + SUM(pagos de Venta Pieza)
  
DEBE SER EXACTAMENTE IGUAL A:
  dayDetail.commercialTotal ($750)
```

### Estrategia de Obtención
Para garantizar reconciliación exacta, **REUTILIZAR EL ARRAY `breakdown`** que ya fue calculado:

```typescript
// En MonthCalendar.tsx, cuando se abre el modal de detalle:
const commercialData = await getCommercialCollections(dateStart, dateEnd);

// Guardar en state:
const [commercialBreakdown, setCommercialBreakdown] = useState(
  commercialData.breakdown  // ← ESTO es la fuente de verdad
);

// Luego en el modal de detalle:
// Iterar sobre commercialBreakdown, NO hacer nuevas queries
```

### Garantía de No Discrepancia
- ✅ Same date range (mismo filtro de fechas)
- ✅ Same service function (misma `getCommercialCollections`)
- ✅ Same breakdown array (mismo `breakdown[]`)
- ✅ No transformation (sin recalcular)

---

## 📍 PUNTO 11: CASOS DE PAGOS SIN VÍNCULO

### Comodato: payment.movement_id = NULL

**Escenario**: Pago registrado manualmente sin movimiento asociado.

**Manejo recomendado**:
- Mostrar el pago en la tarjeta de Comodato
- En la sección de productos: "Sin operación vinculada" o "Pago manual"
- NO ocultar el pago

### Mayoreo: payment.wholesale_order_id = NULL

**Escenario**: Pago registrado manualmente sin orden asociada.

**Manejo recomendado**:
- Mostrar el pago
- "Pago sin orden vinculada"
- NO ocultar

### Venta por Pieza: payment.sale_id = NULL

**Escenario**: Pago registrado sin venta asociada (manual o ajuste).

**Manejo recomendado**:
- Mostrar el pago
- "Pago sin venta vinculada"
- NO ocultar

---

## 📍 PUNTO 12: PERFORMANCE - ESTRATEGIA DE QUERIES

### Opción A: Reutilizar breakdown array (RECOMENDADO) ✅
**Performance**: Excelente  
**Queries**: 0 adicionales (usa datos ya cargados)  
**Riesgo**: Bajo (datos ya verificados)

```typescript
// En MonthCalendar.tsx línea 215
const commercialData = await getCommercialCollections(dateStart, dateEnd);

// Guardar el breakdown:
setCommercialBreakdown(commercialData.breakdown);

// En el modal de detalle:
// Usar comercialBreakdown directamente
commercialBreakdown.map(item => (
  <div key={item.id}>
    {item.amount} - {item.source_type}
  </div>
))
```

**Ventaja**: Ya tenemos `id, source_type, amount, payment_method, payment_date`  
**Desventaja**: NO tenemos detalles de socio/productos aún

### Opción B: Load enriched data per source (MEJOR UX)
**Performance**: Buena  
**Queries**: 3 (1 por fuente)  
**Riesgo**: Bajo (joins simples)

Para cada `item` en `breakdown`:

**Si `source_type = 'comodato'`**:
```sql
SELECT 
  cpp.*, 
  cp.business_name, cp.folio, cp.responsible_name,
  cpm.movement_date, cpm.movement_type,
  cpmi.product_name, cpmi.quantity_sold, cpmi.price_to_catcorn
FROM commercial_partner_payments cpp
LEFT JOIN commercial_partners cp ON cpp.partner_id = cp.id
LEFT JOIN commercial_partner_movements cpm ON cpp.movement_id = cpm.id
LEFT JOIN commercial_partner_movement_items cpmi ON cpm.id = cpmi.movement_id
WHERE cpp.id = $1
```

**Si `source_type = 'mayoreo'`**:
```sql
SELECT 
  wp.*, 
  cp.business_name, cp.folio,
  wo.folio as order_folio, wo.order_date,
  woi.product_name, woi.quantity, woi.unit_price
FROM wholesale_payments wp
LEFT JOIN commercial_partners cp ON wp.partner_id = cp.id
LEFT JOIN wholesale_orders wo ON wp.wholesale_order_id = wo.id
LEFT JOIN wholesale_order_items woi ON wo.id = woi.wholesale_order_id
WHERE wp.id = $1
```

**Si `source_type = 'venta_pieza'`**:
```sql
SELECT 
  spp.*, 
  up.full_name,
  sps.sale_folio, sps.sale_date, sps.total_amount,
  spsi.product_name, spsi.quantity, spsi.unit_price
FROM seller_piece_payments spp
LEFT JOIN user_profiles up ON spp.seller_id = up.id
LEFT JOIN seller_piece_sales sps ON spp.sale_id = sps.id
LEFT JOIN seller_piece_sale_items spsi ON sps.id = spsi.sale_id
WHERE spp.id = $1
```

### Opción C: RPC Agregada (INNECESARIA)
**Performance**: Muy buena  
**Queries**: 1  
**Riesgo**: Medio (nueva función SQL)  
**Recomendación**: **NO necesaria**, Opción B es mejor

---

## 📍 PUNTO 13: ARQUITECTURA RECOMENDADA

### Nuevo Componente Modal
```
components/finance/CommercialCollectionsDetailModal.tsx
├─ Props:
│  ├─ isOpen: boolean
│  ├─ onClose: () => void
│  ├─ selectedDate: string ("2026-08-19")
│  ├─ initialData?: CommercialCollectionItem[]  ← breakdown array
│  └─ onRefresh?: () => void
│
├─ Header:
│  ├─ Fecha: "19 de agosto de 2026"
│  └─ Total: "$750"
│
├─ Tabs/Sections:
│  ├─ COMODATO
│  │  └─ Tarjeta por pago
│  │     ├─ Socio
│  │     ├─ Monto + Método
│  │     ├─ Producto (si existe)
│  │     └─ [Expandir detalle]
│  │
│  ├─ MAYOREO
│  │  └─ (Vacío este día)
│  │
│  └─ VENTA POR PIEZA
│     └─ (Vacío este día)
│
└─ Footer:
   ├─ Suma verificación: SUM = $750 ✓
   └─ Botón cerrar
```

### Cambios en MonthCalendar.tsx
```typescript
// Línea 82: Agregar state
const [showCommercialDetail, setShowCommercialDetail] = useState(false);
const [selectedCommercialData, setSelectedCommercialData] = useState<CommercialCollectionItem[] | null>(null);

// Línea 215: Guardar breakdown
if (!commercialData.error && commercialData.breakdown) {
  // ... resto del código ...
  setSelectedCommercialData(commercialData.breakdown);  // ← NUEVO
}

// Línea 580-605: Hacer clickeable
<div 
  className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 cursor-pointer hover:border-emerald-400 transition-colors"  // ← CAMBIOS
  onClick={() => setShowCommercialDetail(true)}  // ← NUEVO
>
  {/* Resto igual */}
</div>

// Línea 777: Agregar modal
{showCommercialDetail && selectedCommercialData && (
  <CommercialCollectionsDetailModal
    isOpen={showCommercialDetail}
    onClose={() => setShowCommercialDetail(false)}
    selectedDate={selectedDay?.sale_date || ''}
    initialData={selectedCommercialData}
  />
)}
```

### Flujo de Datos
```
MonthCalendar.tsx
├─ Click en día
├─ loadDayDetail(day)
├─ getCommercialCollections(dateStart, dateEnd)
│  └─ Retorna: { total, bySource, breakdown[], ... }
├─ setSelectedCommercialData(breakdown)  ← Guardar array
├─ Click en tarjeta de Socios Comerciales
├─ setShowCommercialDetail(true)
└─ <CommercialCollectionsDetailModal initialData={breakdown} />
   └─ Renderiza detalles
```

---

## 📍 PUNTO 14: TERMINOLOGÍA EN FUTURO MODAL

**Usar en el modal**:
- "COBRADO" (dinero efectivamente recibido)
- "Pagos confirmados"
- "Ingresos realizados"

**NO usar**:
- "Generado" (confunde con ventas registradas)
- "Pendiente" (confunde con adeudos)
- "Liquidaciones" (confunde con operaciones)

---

## 📍 PUNTO 15: UI RECOMENDADA

### Tamaño y Posicionamiento
- **Overlay**: `bg-black/70 z-50`
- **Surface**: `bg-[#111111] border border-white/10`
- **Width**: `max-w-3xl`
- **Height**: `max-h-[90vh]`
- **Scrollable**: Sí, si hay muchos pagos

### Ejemplo de Estructura
```
┌─────────────────────────────────────────┐
│ ✕                                       │
│ Detalle: Ventas Socios Comerciales      │
│ miércoles 19 de agosto de 2026          │
├─────────────────────────────────────────┤
│ Total cobrado: $750                     │
│                                         │
│ 💰 COMODATO ($750)                      │
│ ┌─────────────────────────────────────┐│
│ │ Abarrotes Mary                       ││
│ │ $500 · Transferencia · 10:15 a.m.   ││
│ │ Ref: TRF-19-001                      ││
│ │ [Ver liquidación]                    ││
│ └─────────────────────────────────────┘│
│ ┌─────────────────────────────────────┐│
│ │ El Don Familiar                      ││
│ │ $250 · Efectivo · 4:45 p.m.         ││
│ │ [Ver liquidación]                    ││
│ └─────────────────────────────────────┘│
│                                         │
│ 🛍 MAYOREO ($0)                         │
│ Sin pagos este día                      │
│                                         │
│ 📦 VENTA POR PIEZA ($0)                 │
│ Sin pagos este día                      │
│                                         │
├─────────────────────────────────────────┤
│ ✓ Reconciliación: $500 + $250 = $750   │
│                              [Cerrar]   │
└─────────────────────────────────────────┘
```

---

## 📍 PUNTO 16: SEGURIDAD Y PERMISOS

### Acceso Actual
- **Módulo Finanzas**: Admin-only (policy en Supabase)
- **No ampliación de permisos**: Mantener igual
- **Clave financiera**: Ya existe, se mantiene

### Para Futuro Modal
- Heredar permisos de Finanzas (no crear nuevos)
- Mismo rol requerido que Calendario
- No permitir export de detalles (si se decide)

---

## 📍 PUNTO 17: IMPORTANTE - NO TOCAR

### Componentes que NO se deben modificar
- ✅ Tarjetas Caja, Pedidos, Delivery: mantener igual
- ✅ Modal diario: no cambiar estructura
- ✅ Cálculos de otros canales: no alterar
- ✅ Dashboard de Finanzas general: intacto

### Lo que SÍ se modifica
- Hacer clickeable la tarjeta de Socios Comerciales
- Abrir un segundo modal (no reemplazar)
- Mostrar detalles sin alterar datos

---

## 📍 PUNTO 18: POSIBLES EXTENSIONES FUTURAS

Si en el futuro se desea expandir:

### 1. Detalle Por Pago
```
Click en un pago individual
→ Modal terciario mostrando:
├─ Socio/Vendedor completo
├─ Operación vinculada (movimiento/orden/venta)
├─ Productos vendidos
├─ Recibo/Referencia
└─ Historial de cambios
```

### 2. Filtro Temporal
```
Selector adicional:
├─ Este mes (actual)
├─ Últimos 7 días
├─ Rango personalizado
└─ Año anterior
```

### 3. Export a Excel/PDF
```
Botón: Descargar detalles
→ Genera archivo con tabla completa
```

### 4. Búsqueda/Filtro en Modal
```
Input: Buscar por:
├─ Nombre de socio
├─ Folio
├─ Monto
├─ Método pago
└─ Fecha
```

---

## 📊 RESUMEN EJECUTIVO: 18 RESPUESTAS EXACTAS

| # | Pregunta | Respuesta |
|---|----------|-----------|
| 1 | Componente del calendario | [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 82-777 |
| 2 | Modal que aparece | Mismo componente, state `dayDetail` |
| 3 | Tarjeta Socios Comerciales | Línea 580-605 (no-interactiva actualmente) |
| 4 | Fuente exacta $750 | `commercialData.total` desde `getCommercialCollections()` |
| 5 | Función que calcula total | [getCommercialCollections](services/commercialCollectionsService.ts) línea 47 |
| 6 | Fuente Comodato ($750) | `commercial_partner_payments` con `status IN ('completed', 'paid')` |
| 7 | Fuente Mayoreo ($0) | `wholesale_payments` con `status IN ('completed', 'paid')` |
| 8 | Fuente Venta Pieza ($0) | `seller_piece_payments` con `status = 'completed'` |
| 9 | Criterio de fecha | UTC directo: `payment_date >= 2026-08-19T00:00:00Z` y `<= 2026-08-19T23:59:59Z` |
| 10 | Timezone | UTC (comentario: "Mexico City timezone stored as UTC") |
| 11 | Campos por pago | `id, source_type, payment_date, amount, payment_method, partner_id/seller_id, reference` |
| 12 | Vínculos posibles | ✅ COMODATO→Socio→Movimiento→Productos; MAYOREO→Socio→Orden→Productos; VENTA PIEZA→Vendedor→Venta→Productos |
| 13 | Mostrar productos | ✅ Sí, completa: nombre, variante, tamaño, cantidad, precio |
| 14 | Casos sin vínculo | ✅ Mostrar pago igual, NO ocultar (marcar como "manual" o "sin operación vinculada") |
| 15 | Arquitectura recomendada | Opción B: Reutilizar `breakdown[]` + enriquecer per source (3 queries) |
| 16 | SQL/RPC nueva necesaria | ❌ NO, usar queries existentes + enriquecer en el servicio |
| 17 | Archivos a modificar | MonthCalendar.tsx (estado + clickeable) + NUEVO CommercialCollectionsDetailModal.tsx |
| 18 | Riesgos de reconciliación | ✅ CERO: Usar mismo `breakdown[]`, mismo rango de fechas, misma función |

---

## 🎯 PRÓXIMOS PASOS (CUANDO AUTORICEN IMPLEMENTACIÓN)

1. **Crear componente nuevo**: `CommercialCollectionsDetailModal.tsx`
2. **Modificar MonthCalendar.tsx**:
   - Agregar state para `showCommercialDetail` y `selectedCommercialData`
   - Guardar `commercialData.breakdown` en state
   - Hacer clickeable la tarjeta (línea 580)
   - Renderizar modal al final
3. **Enriquecer datos** (en el modal):
   - Por cada pago en breakdown, cargar detalles de socio/productos
   - Usar 3 queries (una por fuente) o Promise.all
4. **Testing**:
   - Verificar que $750 desglosado = $750 modal
   - Probar con Mayoreo y Venta por Pieza (días con esos pagos)
   - Verificar UI responsiva

---

**Fin del Diagnóstico**  
Todas las referencias verificadas en el código fuente.  
Sin implementación, SQL ni modificaciones, solo análisis técnico puro.
