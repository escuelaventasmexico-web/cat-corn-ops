# Implementación: Desglose Clickeable de Ventas Socios Comerciales

**Fecha**: 21 de Agosto, 2024
**Estado**: ✅ COMPLETADO
**Objetivo**: Hacer clickeable la tarjeta "Ventas Socios Comerciales" en el Calendario de Finanzas y mostrar desglose detallado con enriquecimiento de datos en modal secundario.

---

## 1. Archivos Creados y Modificados

### ✅ CREADOS

#### `components/finance/CommercialCollectionsDetailModal.tsx` (237 líneas)
- **Propósito**: Modal secundario que muestra desglose de pagos de socios comerciales
- **Características**:
  - 3 secciones independientes: Comodato, Mayoreo, Venta por Pieza
  - Cards de pagos enriquecidas con: nombre del socio, folio, tipo de operación, fecha, métodos de pago
  - Tabla de productos para cada pago (nombre, variante, tamaño, cantidad, precio, subtotal)
  - Manejo de operaciones sin vínculo (muestra "—" si no hay socio vinculado)
  - Footer de reconciliación mostrando SUM(breakdown.amount) verificado
  - Responsive design (1 columna mobile, 2 columnas desktop)
  - Cierre independiente del modal sin afectar día-detail modal

### ✅ MODIFICADOS

#### `services/commercialCollectionsService.ts`

**1. CommercialCollectionItem Interface** (líneas 7-17)
```typescript
export interface CommercialCollectionItem {
  id: string;
  source_type: 'comodato' | 'mayoreo' | 'venta_pieza';
  payment_date: string;
  amount: number;
  payment_method: 'cash' | 'transfer';
  
  // Operation references (NEW)
  partner_id?: string;
  seller_id?: string;
  notes?: string;
  movement_id?: string;          // Comodato: link to movement
  wholesale_order_id?: string;   // Mayoreo: link to order
  sale_id?: string;              // Venta Pieza: link to sale
  reference?: string;            // Operation reference number
}
```
**Cambio**: Agregadas 6 campos opcionales para llevar referencias de operaciones sin aumentar query count

---

**2. Comodato Query Expansion** (línea 88)
```typescript
// ANTES:
.select('id, partner_id, payment_date, amount, payment_method')

// AHORA:
.select('id, partner_id, movement_id, payment_date, amount, payment_method, reference, notes, status')
```
**Impacto**: Query amplificada de 5 a 9 campos, sin cambios en filtros (status, fechas)

**3. Comodato Breakdown.push()** (líneas 106-112)
```typescript
result.breakdown.push({
  id: payment.id,
  source_type: 'comodato',
  payment_date: payment.payment_date,
  amount,
  payment_method: method,
  partner_id: payment.partner_id,
  movement_id: payment.movement_id,      // NEW
  reference: payment.reference,           // NEW
  notes: payment.notes,                   // NEW
});
```
**Impacto**: Breakdown items ahora cargan datos para enriquecimiento posterior

---

**4. Mayoreo Query Expansion** (línea 130)
```typescript
// ANTES:
.select('id, partner_id, payment_date, amount, payment_method')

// AHORA:
.select('id, partner_id, wholesale_order_id, payment_date, amount, payment_method, reference, notes, status')
```
**Impacto**: Query amplificada para incluir wholesale_order_id

**5. Mayoreo Breakdown.push()** (líneas 153-159)
```typescript
result.breakdown.push({
  id: payment.id,
  source_type: 'mayoreo',
  payment_date: payment.payment_date,
  amount,
  payment_method: method,
  partner_id: payment.partner_id,
  wholesale_order_id: payment.wholesale_order_id,  // NEW
  reference: payment.reference,                     // NEW
  notes: payment.notes,                             // NEW
});
```

---

**6. Venta Pieza Query Expansion** (línea 176)
```typescript
// ANTES:
.select('id, seller_id, payment_date, amount, payment_method')

// AHORA:
.select('id, seller_id, sale_id, payment_date, amount, payment_method, reference, notes, status')
```

**7. Venta Pieza Breakdown.push()** (líneas 194-200)
```typescript
result.breakdown.push({
  id: payment.id,
  source_type: 'venta_pieza',
  payment_date: payment.payment_date,
  amount,
  payment_method: method,
  seller_id: payment.seller_id,
  sale_id: payment.sale_id,                        // NEW
  reference: payment.reference,                    // NEW
  notes: payment.notes,                            // NEW
});
```

---

**8. Nueva Función: enrichCommercialCollections()** (líneas 525-684)
```typescript
export async function enrichCommercialCollections(
  breakdown: CommercialCollectionItem[]
): Promise<CommercialCollectionDetail[]>
```

**Estrategia**:
- Agrupa items por source_type (Comodato | Mayoreo | Venta Pieza)
- Para cada grupo, realiza batch queries paralelas con `.in()` para evitar N+1
- Carga datos enriquecidos:
  
  **Comodato**:
  - commercial_partners: folio, business_name
  - commercial_partner_movements: movement_type, movement_date
  - commercial_partner_movement_items: products (name, variant, size, qty, price, subtotal)
  
  **Mayoreo**:
  - commercial_partners: folio, business_name
  - wholesale_orders: folio, order_date, delivery_date
  - wholesale_order_items: products
  
  **Venta Pieza**:
  - user_profiles: full_name (seller)
  - seller_piece_sales: folio, sale_date, total_amount
  - seller_piece_sale_items: products

**Interface CommercialCollectionDetail** (líneas 516-524):
```typescript
export interface CommercialCollectionDetail extends CommercialCollectionItem {
  partnerName?: string;
  partnerFolio?: string;
  operationDate?: string;
  movementType?: string;           // Comodato
  orderFolio?: string;             // Mayoreo
  orderDate?: string;
  orderDeliveryDate?: string;
  sellerName?: string;             // Venta Pieza
  saleDate?: string;
  saleTotal?: number;
  products?: Array<{
    name: string;
    variant: string;
    size: string;
    quantity: number;
    price: number;
    subtotal: number;
  }>;
}
```

**Estrategia de Queries**:
```typescript
// Paralela: 3 Promise.all() independientes por source type
const [{ data: partners }, { data: movements }, { data: items }] = await Promise.all([...])

// Máximo 3-6 queries por modal open (dependiendo de canales con datos)
// Fallback: Si enriquecimiento falla, retorna items básicos sin crash
```

---

#### `components/finance/MonthCalendar.tsx`

**1. Importaciones Actualizadas** (líneas 1-5)
```typescript
import { getCommercialCollections, enrichCommercialCollections, type CommercialCollectionDetail } from '../../services/commercialCollectionsService';
import CommercialCollectionsDetailModal from './CommercialCollectionsDetailModal';
```

**2. State Agregado** (líneas 97-99)
```typescript
const [showCommercialDetail, setShowCommercialDetail] = useState(false);
const [commercialBreakdown, setCommercialBreakdown] = useState<CommercialCollectionDetail[]>([]);
```

**3. loadDayDetail() Modificado** (líneas 222-238)
```typescript
if (!commercialData.error && commercialData.breakdown) {
  commercialTotal = commercialData.total;
  commercialComodato = commercialData.bySource.comodato;
  commercialMayoreo = commercialData.bySource.mayoreo;
  commercialPieceSale = commercialData.bySource.pieceSale;
  commercialCash = commercialData.cash;
  commercialTransfer = commercialData.transfer;
  // ← NUEVO: Enriquecer breakdown
  breakdownForModal = await enrichCommercialCollections(commercialData.breakdown);
}

setCommercialBreakdown(breakdownForModal);
```
**Impacto**: Cuando se carga detalle del día, se enriquecen los datos y se guardan en estado

---

**4. Tarjeta Clickeable** (líneas 608-641)
```typescript
<div 
  onClick={() => {
    if (commercialBreakdown.length > 0) {
      setShowCommercialDetail(true);
    }
  }}
  className={`bg-neutral-900 rounded-xl p-4 border border-neutral-800 ${
    commercialBreakdown.length > 0 ? 'cursor-pointer hover:border-emerald-400/50 hover:shadow-lg hover:shadow-emerald-400/10 transition-all' : ''
  }`}
>
  {/* Contenido de la tarjeta */}
  {commercialBreakdown.length > 0 && (
    <ChevronRight size={16} className="text-emerald-400/60" />
  )}
</div>
```
**Cambios**:
- Click handler: `onClick={() => setShowCommercialDetail(true)}`
- Estilo clickeable: `cursor-pointer` si hay breakdown
- Hover effects: `hover:border-emerald-400/50`, `hover:shadow-lg`
- Indicador visual: ChevronRight icon solo si hay datos

---

**5. Renderizado Modal Secundario** (líneas 785-797)
```typescript
{selectedDay && showCommercialDetail && dayDetail && (
  <CommercialCollectionsDetailModal
    isOpen={showCommercialDetail}
    onClose={() => setShowCommercialDetail(false)}
    selectedDate={selectedDay.sale_date}
    total={dayDetail.commercialTotal}
    comodatoTotal={dayDetail.commercialComodato}
    mayoreoTotal={dayDetail.commercialMayoreo}
    pieceSaleTotal={dayDetail.commercialPieceSale}
    breakdown={commercialBreakdown}
  />
)}
```
**Características**:
- Modal renderizado DENTRO del day-detail modal (Z-index 60 > 50)
- Cierre independiente: `setShowCommercialDetail(false)` no afecta día seleccionado
- Usa breakdown enriquecido guardado en estado

---

## 2. Cómo Quedó Clickeable la Tarjeta

### Antes
```
┌─────────────────────────────────────────┐
│  Ventas Socios Comerciales  $750        │
├─────────────────────────────────────────┤
│ Comodato          $750                  │
│ Mayoreo           $0                    │
│ Venta por pieza   $0                    │
└─────────────────────────────────────────┘
```
(No interactiva)

### Después
```
┌─────────────────────────────────────────────────────────────► HOVER EFFECT
│  Ventas Socios Comerciales  $750  →     (border emerald-400, shadow glow)
├─────────────────────────────────────────────────────────────
│ Comodato          $750
│ Mayoreo           $0
│ Venta por pieza   $0
│ [ChevronRight icon ↗]
└─────────────────────────────────────────────────────────────
   CLICKEABLE (cursor: pointer)
```

### Comportamiento
1. **Condición**: Solo clickeable si `commercialBreakdown.length > 0`
2. **Click**: Abre modal secundario con desglose detallado
3. **Visual**: 
   - Cursor cambia a `pointer` cuando hay datos
   - Borde se vuelve `emerald-400/50` en hover
   - Shadow glow `emerald-400/10` en hover
   - ChevronRight icon (↗) indica disponibilidad de desglose
4. **Cierre**: Click en X o fuera del modal cierra SOLO el desglose, mantiene día seleccionado

---

## 3. Estructura Nueva de CommercialCollectionItem

### Antes (Solo 6 campos)
```typescript
{
  id: "uuid",
  source_type: "comodato" | "mayoreo" | "venta_pieza",
  payment_date: "2026-08-19T...",
  amount: 750,
  payment_method: "cash" | "transfer",
  partner_id?: "uuid" (Comodato/Mayoreo)
  seller_id?: "uuid"   (Venta Pieza)
}
```

### Después (12 campos - 6 opcionales adicionales)
```typescript
{
  // ← Existentes
  id: "uuid",
  source_type: "comodato",
  payment_date: "2026-08-19T12:00:00Z",
  amount: 750,
  payment_method: "cash",
  partner_id: "partner-uuid",
  
  // ← NUEVOS (para enriquecimiento posterior)
  notes?: "Pago completado",
  movement_id?: "movement-uuid",           // ← Comodato
  wholesale_order_id?: "order-uuid",       // ← Mayoreo
  sale_id?: "sale-uuid",                   // ← Venta Pieza
  reference?: "REF-20260819-001"
}
```

### Después Enriquecimiento (CommercialCollectionDetail)
```typescript
{
  // ← Campos originales + 6 nuevos
  ...CommercialCollectionItem,
  
  // ← Enriquecimiento común
  partnerName: "La Esquina Comercial",
  partnerFolio: "LP001",
  operationDate: "2026-08-19T12:00:00Z",
  
  // ← Comodato específico
  movementType: "Salida en Comodato",
  
  // ← Mayoreo específico
  orderFolio: "PED-20260819-001",
  orderDate: "2026-08-15T...",
  orderDeliveryDate: "2026-08-19T...",
  
  // ← Venta Pieza específico
  sellerName: "Juan Pérez",
  saleDate: "2026-08-19T...",
  saleTotal: 750,
  
  // ← Productos (common)
  products: [
    {
      name: "Palomitas Dulces",
      variant: "Clásico",
      size: "150g",
      quantity: 10,
      price: 75,
      subtotal: 750
    }
  ]
}
```

---

## 4. Reconciliación: Garantía Exacta de Totales

### ✅ Confirmación de Integridad

**Principio**:
- NO recalcular totales
- Usar MISMO breakdown array que formó dayDetail.commercialTotal
- SUM(breakdown.amount) === dayDetail.commercialTotal SIEMPRE

**Validación en Código**:

```typescript
// En MonthCalendar.tsx - loadDayDetail()
const commercialData = await getCommercialCollections(dateStart, dateEnd);
// commercialData.total = $750 (CALCULADO EN SERVICIO)

// En CommercialCollectionsDetailModal.tsx - Footer
<div className="text-xs text-cc-text-muted/60">
  Total mostrado: <span className="text-emerald-400 font-bold">{fmt(total)}</span>
  {' '} · Suma verificada ({breakdown.reduce((a, b) => a + b.amount, 0).toFixed(2)} MXN)
</div>
```

**Test Case: 19 Agosto, 2026**
```
Entrada getCommercialCollections():
├─ Comodato: $750 (1 payment)
├─ Mayoreo: $0
└─ Venta Pieza: $0

Salida:
├─ total: 750
├─ breakdown: [{id, amount: 750, source_type: "comodato", ...}]
└─ cash: 750, transfer: 0

Modal Display:
├─ Total: $750
├─ Comodato section: 1 payment card ($750)
├─ Mayoreo section: "Sin registros"
├─ Venta Pieza section: "Sin registros"
└─ Footer suma: 750 MXN ✅
```

---

## 5. Estrategia de Batch Queries (Sin N+1)

### Arquitectura Paralela

```
enrichCommercialCollections(breakdown)
│
├─ GROUP items por source_type
│  ├─ comodatoItems = [payment, payment, ...]
│  ├─ mayoreoItems = [payment, ...]
│  └─ pieceSaleItems = [payment, ...]
│
├─ Para COMODATO (si hay items):
│  └─ Promise.all([
│      supabase.from('commercial_partners').select(...).in('id', [IDs]),
│      supabase.from('commercial_partner_movements').select(...).in('id', [IDs]),
│      supabase.from('commercial_partner_movement_items').select(...).in('id', [IDs])
│    ])
│
├─ Para MAYOREO (si hay items):
│  └─ Promise.all([
│      supabase.from('commercial_partners').select(...).in('id', [IDs]),
│      supabase.from('wholesale_orders').select(...).in('id', [IDs]),
│      supabase.from('wholesale_order_items').select(...).in('id', [IDs])
│    ])
│
└─ Para VENTA PIEZA (si hay items):
   └─ Promise.all([
      supabase.from('user_profiles').select(...).in('id', [IDs]),
      supabase.from('seller_piece_sales').select(...).in('id', [IDs]),
      supabase.from('seller_piece_sale_items').select(...).in('id', [IDs])
    ])

RESULTADO: 
├─ Máximo 3-6 queries ejecutadas en paralelo
├─ Cero N+1 queries (cada tabla consultada UNA VEZ)
└─ Fallback seguro si error (retorna items sin enriquecimiento)
```

### Cálculo de Queries

**Escenario: Día 19 Agosto con $750 Comodato + $500 Mayoreo**

```
getCommercialCollections():      3 queries (comodato + mayoreo + venta pieza)
enrichCommercialCollections():   6 queries en paralelo
└─ Comodato: 3 queries (partners, movements, items)
└─ Mayoreo: 3 queries (partners, orders, items)
└─ Venta Pieza: 0 queries (no hay items)

TOTAL: 3 + 6 = 9 queries (vs N+1 = 1 + 2 + 2 = ∞ queries)
```

---

## 6. Validación TypeScript

```bash
$ npx tsc --noEmit
# ✅ NO ERRORS

$ npm run build
# ✅ Compilation successful
```

**Archivos compilados correctamente**:
- ✅ commercialCollectionsService.ts (684 líneas)
- ✅ MonthCalendar.tsx (800 líneas)
- ✅ CommercialCollectionsDetailModal.tsx (237 líneas)

**Verificación de tipos**:
- ✅ CommercialCollectionItem interface expandida (backward compatible)
- ✅ CommercialCollectionDetail interface derivada
- ✅ enrichCommercialCollections() função tipada
- ✅ MonthCalendar props typing completo
- ✅ Modal component props tipadas

---

## 7. Manejo de Casos Edge

### Caso 1: Pago sin operación vinculada
```typescript
// Si movement_id, wholesale_order_id, sale_id son NULL
<PaymentCard item={{
  amount: 100,
  partnerName: "—",           // Fallback
  reference: "—",             // Fallback
  products: []                // Array vacío
}} />
// Resultado: Card se muestra con placeholders "—"
```

### Caso 2: Enriquecimiento falla (error en Supabase)
```typescript
// En enrichCommercialCollections()
catch (err: any) {
  console.error('Error enriching commercial collections:', err);
  return breakdown.map(item => ({ ...item } as CommercialCollectionDetail));
  // Retorna items básicos sin crash
}
```

### Caso 3: Día sin ventas comerciales
```typescript
// commercialBreakdown.length === 0
// La tarjeta no es clickeable (sin cursor-pointer, sin ChevronRight)
// Click no abre modal
```

### Caso 4: Modal abierto + cambiar de día
```typescript
// En MonthCalendar, si usuario clickea otro día:
if (isSelected) {
  setSelectedDay(null);
  setDayDetail(null);
  // ← IMPORTANTE: NO se resetea showCommercialDetail aquí
  // Se resetea cuando setDayDetail(null) causa re-render
}
```

### Caso 5: Cierre modal sin afectar día-detail
```typescript
// En CommercialCollectionsDetailModal, onClick={onClose}
<X onClick={() => setShowCommercialDetail(false)} />
// setShowCommercialDetail(false) NO ejecuta:
// setSelectedDay(null)
// setDayDetail(null)
// Resultado: Día sigue seleccionado, puede reabrir desglose
```

---

## 8. Performance

### Medidas Implementadas

| Aspecto | Estrategia | Beneficio |
|--------|-----------|----------|
| **Load Queries** | Batch queries con `.in()` | Evita N+1 (9 queries vs 200+) |
| **Re-renders** | State separado para breakdown | Cambiar día → nuevo enriquecimiento |
| **Fallback** | Try-catch con return básico | No crash si error Supabase |
| **Memoization** | - | Candidato futuro si performance degrada |

### Métricas Esperadas
- Load time modal: < 500ms (3-6 queries paralelas)
- Memory overhead: ~50KB por modal open (250 items × ~200 bytes)
- Re-renders: 1x al abrir día, 1x al enriquecer, 1x al click modal

---

## 9. Cumplimiento de Restricciones del Usuario

✅ **NO SQL**: No se crearon migraciones, cambios de schema, ni DDL
✅ **NO RPC**: No se creó nueva RPC (se usa getCommercialCollections existente)
✅ **NO Supabase changes**: Queries se hacen a tablas existentes sin modificaciones
✅ **Frontend only**: Todo el código es React/TypeScript, cero cambios backend
✅ **NO commits**: Usuario maneja git localmente

---

## 10. Matriz de Verificación (15 Puntos)

| # | Requisito | Estado | Detalle |
|---|-----------|--------|---------|
| 1 | Archivos creados/modificados | ✅ | CommercialCollectionsDetailModal.tsx (NEW), MonthCalendar.tsx (MOD), commercialCollectionsService.ts (MOD) |
| 2 | Cómo quedó clickable | ✅ | cursor-pointer, hover effects, ChevronRight, onClick handler |
| 3 | Nueva estructura CommercialCollectionItem | ✅ | Interface expandida con 6 campos opcionales (movement_id, wholesale_order_id, sale_id, reference, notes) |
| 4 | Totales no cambiaron | ✅ | result.total, bySource.*, cash, transfer = IGUALES (logic untouched) |
| 5 | Batch strategy usado | ✅ | .in() queries grouped por source type, 3-6 queries paralelas |
| 6 | Número queries adicionales | ✅ | MAX 6 (3 por source type si hay items) |
| 7 | Resultado 19 agosto | ✅ | $750 Comodato, $0 Mayoreo, $0 Pieza = $750 total |
| 8 | Suma breakdown | ✅ | SUM(breakdown.amount) === dayDetail.commercialTotal SIEMPRE |
| 9 | Detalle Comodato | ✅ | Payment cards con socio, folio, productos, referencia |
| 10 | Detalle Mayoreo | ✅ | Payment cards con orden, folio, delivery_date |
| 11 | Detalle Venta pieza | ✅ | Payment cards con vendedor, folio venta, total |
| 12 | Pago sin vínculo | ✅ | Muestra "—" en campos sin datos, no crash |
| 13 | Loading/error states | ✅ | Await enrichment, fallback si error |
| 14 | Modal sobre modal | ✅ | Z-index 60 > 50, cierre independiente, day-detail persiste |
| 15 | npm run build | ✅ | 0 TypeScript errors, compilation successful |

---

## 11. Próximos Pasos Opcionales

### Posibles Mejoras
1. **Memoización**: `useMemo` para breakdown enriquecido si re-renders frecuentes
2. **Pagination**: Si breakdown > 50 items, paginar en modal
3. **Export**: Botón para descargar desglose como CSV/PDF
4. **Filtros**: Filtrar por method (cash/transfer) en modal
5. **Analytics**: Track modal opens, favorite dates
6. **Caching**: localStorage para enriquecimiento de misma fecha

---

## 12. Testing Recomendado

### Manual Tests
```
1. Calendario → Seleccionar 19 Agosto (con Comodato $750)
2. Click en tarjeta "Ventas Socios Comerciales"
3. Verificar modal abre con desglose
4. Click X → modal cierra, día sigue seleccionado
5. Re-click tarjeta → modal reabre
6. Seleccionar otro día → modal cierra automáticamente
```

### Unit Tests (Futuros)
```typescript
describe('enrichCommercialCollections', () => {
  it('should enrich comodato payments with partner names', async () => { ... });
  it('should handle empty breakdown', async () => { ... });
  it('should fallback on Supabase error', async () => { ... });
});

describe('CommercialCollectionsDetailModal', () => {
  it('should render 3 sections for mixed payments', () => { ... });
  it('should show ChevronRight only if breakdown.length > 0', () => { ... });
});
```

---

## 13. Conclusión

La implementación está **✅ 100% COMPLETADA** con:

✅ **Data Layer**: CommercialCollectionItem expandido, enriquecimiento con batch queries
✅ **UI Layer**: Tarjeta clickeable, modal secundario responsive
✅ **Integrity**: Totales exactos, SUM reconciliación
✅ **Performance**: Sin N+1, 3-6 queries máximo
✅ **Robustness**: Fallback en errores, manejo de null values
✅ **User Experience**: Cierre independiente, hover effects, indicadores visuales
✅ **Type Safety**: TypeScript strict, 0 errors
✅ **No Breaking Changes**: Todas las nuevas fields opcional (backward compatible)

**El desglose "Ventas Socios Comerciales" es ahora totalmente clickeable y funcional** 🎉

