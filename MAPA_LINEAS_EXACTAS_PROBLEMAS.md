# 🎯 MAPA DE PROBLEMAS: Líneas Exactas en el Código

---

## PROBLEMA 1: RPC SOLO VE $600 (Caja + Pedidos sin diferenciar)

### Ubicación en el código

**Archivo**: [migration_fix_finance_summary.sql](migration_fix_finance_summary.sql) línea 338

```sql
-- ❌ PROBLEMA: No diferencia Caja de Pedidos
WITH current_daily AS (
    SELECT
        (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
        COALESCE(SUM(s.total), 0)             AS total_sales,  -- ← Suma TODO sin filtro
        COALESCE(SUM(s.card_amount), 0)       AS card_sales,
        COALESCE(SUM(s.transfer_amount), 0)   AS transfer_sales,
        COUNT(*)                               AS ticket_count
    FROM public.sales s
    WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
          BETWEEN p_month_start AND v_month_end
    GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
)
```

**Problema**: `SUM(s.total)` suma TODO (Caja + Pedidos juntos)

**Debería ser** (si se arreglara en SQL):
```sql
-- Caja
SUM(CASE WHEN s.promotion_code != 'ORDER_CHECKOUT' THEN s.total ELSE 0 END) AS caja_sales

-- Pedidos
SUM(CASE WHEN s.promotion_code = 'ORDER_CHECKOUT' THEN s.total ELSE 0 END) AS pedidos_sales
```

---

## PROBLEMA 2: Comercial se suma PARCIALMENTE en calendario

### Ubicación 1: Carga del comercial mensual

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 295-303

```typescript
// ✅ Carga comercial correcto (rango mensual)
const [year, month] = monthStartISO.split('-').map(Number);
const monthStart = new Date(Date.UTC(year, month - 1, 1));
const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

const commercialData = await getCommercialCollections(monthStart, monthEnd);
```

✅ Esto trae TODOS los socios comerciales del mes.

### Ubicación 2: Agrupación parcial por fecha

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 305-313

```typescript
// ❌ PROBLEMA: Solo suma lo que cae en payment_date exacta
const commercialByDate: Record<string, number> = {};
if (!commercialData.error && commercialData.breakdown) {
  for (const item of commercialData.breakdown) {
    // Extract YYYY-MM-DD from payment_date (handle both formats)
    const dateStr = item.payment_date.slice(0, 10);  // ← Extrae fecha
    commercialByDate[dateStr] = (commercialByDate[dateStr] || 0) + item.amount;  // ← Agrupa por fecha
  }
}

// Merge: Add commercial collections to each calendar day
calendarDays = calendarDays.map((day) => ({
  ...day,
  total_sales: day.total_sales + (commercialByDate[day.sale_date] || 0),  // ← Suma SOLO lo que coincide
}));
```

**Problema**: Si $750 comercial del mes tiene `payment_date` distribuidas:
- $75 el 2026-08-19
- $675 en otros días

Entonces para el 19, solo suma $75, dejando $675 fuera.

---

## PROBLEMA 3: Celda del calendario muestra $675

### Ubicación: Renderizado en el grid

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 455-465

```tsx
return (
  <button
    key={d.sale_date}
    onClick={() => {
      if (isFuture) return;
      if (isSelected) {
        setSelectedDay(null);
        setDayDetail(null);
      } else {
        setSelectedDay(d);
        loadDayDetail(d);
      }
    }}
    disabled={isFuture}
    className={`
      relative aspect-square rounded-lg flex flex-col items-center justify-center
      text-xs transition-all duration-150 border
    `}
    style={{
      backgroundColor: hasSales
        ? `rgba(34,197,94,${intensity * 0.35})`
        : isFuture
          ? 'transparent'
          : 'rgba(255,255,255,0.02)',
    }}
  >
    <span className={`font-semibold ${isToday ? 'text-cc-primary' : hasSales ? 'text-cc-cream' : 'text-cc-text-muted/50'}`}>
      {dayNum}  {/* "19" */}
    </span>
    {hasSales && (
      <span className="text-[9px] text-green-400/80 font-medium leading-tight mt-0.5">
        {d.total_sales >= 1000
          ? `$${(d.total_sales / 1000).toFixed(1)}k`
          : `$${d.total_sales.toFixed(0)}`  // ← ❌ Pinta $675 aquí
        }
      </span>
    )}
  </button>
);
```

**Variable usada**: `d.total_sales` (que es $675)

---

## PROBLEMA 4: Header del modal muestra $675

### Ubicación: Encabezado del modal del día

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 480-492

```tsx
{selectedDay && (
  <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { setSelectedDay(null); setDayDetail(null); }}>
    <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {/* Modal header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-cc-cream">
            {new Date(selectedDay.sale_date + 'T12:00:00').toLocaleDateString('es-MX', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </h3>
          <p className="text-xs text-cc-text-muted mt-0.5">
            Total del día: <span className="text-green-400 font-bold">
              {fmt(selectedDay.total_sales)}  {/* ← ❌ Pinta $675 aquí */}
            </span>
            {' '}· {selectedDay.ticket_count} ticket{selectedDay.ticket_count !== 1 ? 's' : ''}
            {' '}· Promedio {fmt(selectedDay.avg_ticket)}
          </p>
        </div>
        {/* ... resto del header ... */}
      </div>
```

**Variable usada**: `selectedDay.total_sales` (que es $675)

---

## ✅ CORRECTO 1: Tarjeta verde muestra $1,155

### Ubicación: Gran total en el modal

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 525-532

```tsx
{dayDetail ? (
  <>
    {/* Grand total bar */}
    <div className="flex items-center justify-between px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl">
      <span className="text-sm font-medium text-green-300">Total del día</span>
      <span className="text-xl font-bold text-green-400">
        {fmt(dayDetail.grandTotal)}  {/* ✅ Correcto: $1,155 */}
      </span>
    </div>
```

**Variable usada**: `dayDetail.grandTotal` (que es $1,155) ✅

---

## ✅ CORRECTO 2: Desglose en tarjetas de abajo

### Ubicación: Secciones de Caja, Pedidos, Comercial

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 540-605

```tsx
{/* Two-column breakdown for all sales types */}
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  {/* Caja directa */}
  <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
    <div className="flex items-center gap-2 mb-3">
      <Store size={16} className="text-cc-primary" />
      <span className="text-sm font-bold text-cc-cream">Ventas Caja</span>
      <span className="ml-auto text-lg font-bold text-cc-primary">
        {fmt(dayDetail.cajaTotal)}  {/* ✅ $405 */}
      </span>
    </div>
    {/* ... detalles ... */}
  </div>

  {/* Pedidos */}
  <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
    <div className="flex items-center gap-2 mb-3">
      <ShoppingBag size={16} className="text-violet-400" />
      <span className="text-sm font-bold text-cc-cream">Ventas Pedidos</span>
      <span className="ml-auto text-lg font-bold text-violet-400">
        {fmt(dayDetail.pedidosTotal)}  {/* ✅ $0 */}
      </span>
    </div>
    {/* ... detalles ... */}
  </div>

  {/* Delivery */}
  {/* ... $0 ... */}

  {/* Ventas Socios Comerciales */}
  <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
    <div className="flex items-center gap-2 mb-3">
      <Landmark size={16} className="text-emerald-400" />
      <span className="text-sm font-bold text-cc-cream">Ventas Socios Comerciales</span>
      <span className="ml-auto text-lg font-bold text-emerald-400">
        {fmt(dayDetail.commercialTotal)}  {/* ✅ $750 */}
      </span>
    </div>
  </div>
</div>
```

Estos valores son correctos ✅ porque vienen de `loadDayDetail()` (línea 120-243).

---

## LA RAÍZ: loadDayDetail() vs RPC

### Línea 120-130: Carga de RPC (PROBLEMA)

```typescript
const loadDayDetail = useCallback(async (day: CalendarDay) => {
  if (!supabase) return;
  setDetailLoading(true);
  try {
    // Day boundaries (Mexico City timezone stored as UTC)
    const dayStart = new Date(day.sale_date + 'T00:00:00-06:00').toISOString();
    const nextDay = new Date(new Date(day.sale_date + 'T00:00:00-06:00').getTime() + 86400000).toISOString();
    
    // ✅ Carga sales directamente (bien)
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, total, payment_method, promotion_code, created_at')
      .gte('created_at', dayStart)
      .lt('created_at', nextDay)
      .eq('is_refunded', false)
      .order('created_at', { ascending: true });
```

✅ `loadDayDetail()` carga `sales` correctamente del día.

### Línea 154-165: Diferencia Caja de Pedidos (CORRECTO)

```typescript
const isOrder = (s: DaySale) => s.promotion_code === 'ORDER_CHECKOUT';
const pm = (s: DaySale) => s.payment_method;

// Caja directa
const cajaSales = sales.filter(s => !isOrder(s));  // ✅ Sin ORDER_CHECKOUT
const cajaCash = cajaSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
const cajaCard = cajaSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
const cajaMixed = cajaSales.filter(s => pm(s) === 'MIXED').reduce((a, s) => a + s.total, 0);
const cajaTotal = cajaCash + cajaCard + cajaMixed;  // ✅ $405

// Pedidos
const pedidoSales = sales.filter(s => isOrder(s));  // ✅ SOLO ORDER_CHECKOUT
const pedidosCash = pedidoSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
const pedidosCard = pedidoSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
const pedidosTransfer = pedidoSales.filter(s => pm(s) === 'TRANSFER').reduce((a, s) => a + s.total, 0);
const pedidosTotal = pedidosCash + pedidosCard + pedidosTransfer;  // ✅ $0
```

✅ Diferencia correctamente Caja ($405) de Pedidos ($0).

### Línea 223-232: Comercial (CORRECTO)

```typescript
// 3) Commercial collections for this specific day
const dateStart = new Date(day.sale_date + 'T00:00:00Z');
const dateEnd = new Date(new Date(day.sale_date + 'T23:59:59Z').getTime() + 1000);
const commercialData = await getCommercialCollections(dateStart, dateEnd);

let commercialTotal = 0;
let commercialComodato = 0;
let commercialMayoreo = 0;
let commercialPieceSale = 0;
let commercialCash = 0;
let commercialTransfer = 0;

if (!commercialData.error && commercialData.breakdown) {
  commercialTotal = commercialData.total;  // ✅ $750
  commercialComodato = commercialData.bySource.comodato;
  // ... etc
}
```

✅ Trae comercial correcto del día ($750).

### Línea 243: Suma correcta (CORRECTO)

```typescript
setDayDetail({
  cajaCash, cajaCard, cajaMixed, cajaTotal, cajaCount: cajaSales.length,
  pedidosCash, pedidosCard, pedidosTransfer, pedidosTotal, pedidosCount: pedidoSales.length,
  deliveryTotal, deliveryCount,
  commercialTotal, commercialComodato, commercialMayoreo, commercialPieceSale, commercialCash, commercialTransfer,
  grandTotal: cajaTotal + pedidosTotal + deliveryTotal + commercialTotal,  // ✅ $405 + $0 + $0 + $750 = $1,155
  orders: orderList,
});
```

✅ `grandTotal` se calcula correctamente.

---

## EL CONFLICTO: Dos Flujos Paralelos

```
FLUJO 1: Calendario
  RPC finance_calendar_with_yoy() 
    → SUM(sales.total) = $600 (Caja + Pedidos sin diferenciar)
  + comercialByDate agrupado = $75 (solo pagos en fecha exacta)
  = total_sales = $675
  → PINTA EN CELDA y HEADER

FLUJO 2: Modal
  loadDayDetail()
    → Caja = $405 ✅
    → Pedidos = $0 ✅
    → Comercial = $750 ✅
    → grandTotal = $1,155 ✅
  → PINTA EN TARJETA VERDE

CONFLICTO: Dos valores diferentes para el MISMO día
```

---

## SOLUCIÓN: Unificar en DailyFinanceTotal

**En lugar de** tener dos flujos paralelos (RPC + loadDayDetail), crear UNO:

### Pseudocódigo

```typescript
// 1. Nueva función única
async function getDailyFinanceTotal(date: Date): Promise<DailyFinanceTotal> {
  // Caja + Pedidos de sales
  const sales = await supabase.from('sales').select(...).gte('created_at', dayStart).lt('created_at', dayEnd);
  const caja = sales.filter(s => s.promotion_code !== 'ORDER_CHECKOUT').reduce((s, x) => s + x.total, 0);
  const pedidos = sales.filter(s => s.promotion_code === 'ORDER_CHECKOUT').reduce((s, x) => s + x.total, 0);
  
  // Delivery
  const delivery = 0; // o query si existe en futuro
  
  // Comercial
  const commercialData = await getCommercialCollections(dayStart, dayEnd);
  
  // Totales
  return {
    date,
    caja, pedidos, delivery,
    commercial: commercialData.bySource,
    grandTotal: caja + pedidos + delivery + commercialData.total,
    ticketCount, avgTicket,
    prevYearSalesAndOrders: ...,
  };
}

// 2. En MonthCalendar, reemplazar línea 290-313 con:
for (let d = monthStart; d <= monthEnd; d.setDate(d.getDate() + 1)) {
  const total = await getDailyFinanceTotal(new Date(d));
  dailyTotals[total.date] = total;
}

// 3. Convertir a CalendarDay
const calendarDays: CalendarDay[] = Object.values(dailyTotals).map(dt => ({
  sale_date: dt.date,
  total_sales: dt.grandTotal,  // ← CAMBIO: ahora $1,155 en lugar de $675
  cash_sales: ...,
  // ... etc
}));
```

### Impacto
- ✅ Celda: $1,155
- ✅ Header: $1,155
- ✅ Tarjeta verde: $1,155
- ✅ Total del mes: SUM correcto

---

## RESUMEN DE LOCALIZACIONES

| Problema | Archivo | Línea | Variable | Valor |
|----------|---------|-------|----------|-------|
| RPC suma sin diferenciar | migration_fix_finance_summary.sql | 338 | `SUM(s.total)` | $600 |
| Comercial suma parcial | MonthCalendar.tsx | 313 | `commercialByDate` | $75 |
| Celda pinta mal | MonthCalendar.tsx | 462 | `d.total_sales` | $675 ❌ |
| Header pinta mal | MonthCalendar.tsx | 487 | `selectedDay.total_sales` | $675 ❌ |
| Tarjeta verde BIEN | MonthCalendar.tsx | 528 | `dayDetail.grandTotal` | $1,155 ✅ |
| Desglose BIEN | MonthCalendar.tsx | 540-605 | `cajaTotal`, `commercialTotal` | $405, $750 ✅ |

---

**FIN DEL MAPA**

Todos los problemas identificados sin implementar cambios.

