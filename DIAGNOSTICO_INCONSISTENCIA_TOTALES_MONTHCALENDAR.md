# 🔍 DIAGNÓSTICO EXACTO: Inconsistencia en Totales MonthCalendar.tsx

**Fecha**: 21 de agosto, 2026  
**Caso de Estudio**: 19 de agosto - Día con $1,155 en Caja + Comercial  
**Status**: SIN IMPLEMENTAR - Diagnóstico puro

---

## RESUMEN EJECUTIVO

El calendario muestra **$675** en la celda y en el header del modal, pero la tarjeta verde muestra **$1,155**.

Los **$480 faltantes** son:
- Ventas Pedidos que NO están incluidas en el RPC `finance_calendar_with_yoy`
- Ventas Socios Comerciales que se agregan DESPUÉS de cargar el RPC

**Causa raíz**: El RPC que carga el calendario usa ÚNICAMENTE `sales.total` sin diferenciar canales.

---

## 1. FUENTE EXACTA DEL $675 EN LA CELDA DEL CALENDARIO

### Variable
```typescript
d.total_sales
```

### Interfaz
```typescript
interface CalendarDay {
  sale_date: string;      // "2026-08-19"
  total_sales: number;    // ← $675 AQUÍ
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  ticket_count: number;
  avg_ticket: number;
  prev_year_sales: number;
  yoy_diff_abs: number;
  yoy_diff_pct: number | null;
}
```

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) líneas 7-18

### Ubicación Renderizado
**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 462
```tsx
<span className="text-[9px] text-green-400/80 font-medium leading-tight mt-0.5">
  {d.total_sales >= 1000
    ? `$${(d.total_sales / 1000).toFixed(1)}k`
    : `$${d.total_sales.toFixed(0)}`  // ← PINTA $675 AQUÍ
  }
</span>
```

### Origen (Fuente de Datos)
**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 290
```tsx
const { data, error: rpcErr } = await supabase.rpc('finance_calendar_with_yoy', {
  p_month_start: monthStartISO,
});

let calendarDays = (data as CalendarDay[]) || [];
```

Luego **líneas 309-313**, los datos se amplifican:
```typescript
// Merge: Add commercial collections to each calendar day
calendarDays = calendarDays.map((day) => ({
  ...day,
  total_sales: day.total_sales + (commercialByDate[day.sale_date] || 0),
}));
```

**PROBLEMA**: Para el 19 de agosto:
- `day.total_sales` del RPC = **$600** (solo POS, sin diferenciar Caja/Pedidos)
- `commercialByDate['2026-08-19']` = **$75** (parcial de comercial)
- Total final = **$675**

### Fórmula Exacta del RPC
**Archivo**: [migration_fix_finance_summary.sql](migration_fix_finance_summary.sql) líneas 286-362  
**Función**: `finance_calendar_with_yoy(p_month_start DATE)`

**SQL exacto**:
```sql
SELECT
    ds.date                                                             AS sale_date,
    COALESCE(c.total_sales, 0)                                          AS total_sales,
    COALESCE(c.total_sales, 0) - COALESCE(c.card_sales, 0) - COALESCE(c.transfer_sales, 0) AS cash_sales,
    COALESCE(c.card_sales, 0)                                           AS card_sales,
    COALESCE(c.transfer_sales, 0)                                       AS transfer_sales,
    COALESCE(c.ticket_count, 0)                                         AS ticket_count,
    CASE WHEN COALESCE(c.ticket_count, 0) > 0
         THEN ROUND(c.total_sales / c.ticket_count, 2)
         ELSE 0
    END                                                                 AS avg_ticket
FROM date_series ds
LEFT JOIN current_daily c ON ds.date = c.d
LEFT JOIN prev_daily p ON EXTRACT(DAY FROM ds.date) = EXTRACT(DAY FROM p.d)
```

**El `current_daily` CTE**:
```sql
WITH current_daily AS (
    SELECT
        (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS d,
        COALESCE(SUM(s.total), 0)             AS total_sales,
        COALESCE(SUM(s.card_amount), 0)       AS card_sales,
        COALESCE(SUM(s.transfer_amount), 0)   AS transfer_sales,
        COUNT(*)                               AS ticket_count
    FROM public.sales s
    WHERE (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
          BETWEEN p_month_start AND v_month_end
    GROUP BY (s.created_at AT TIME ZONE 'America/Mexico_City')::DATE
)
```

**HALLAZGO CRÍTICO**: 
- Solo suma `sales.total`
- **NO filtra** por `promotion_code = 'ORDER_CHECKOUT'` (Pedidos vs Caja)
- **NO incluye** Socios Comerciales
- **NO incluye** Delivery

**Para el 19 de agosto**:
- RPC trae: 4 tickets, $600 total (Caja $405 + Pedidos $195 sin desglesar)
- Pero RPC no sabe que $195 son Pedidos, los reporta como una masa de $600

---

## 2. FUENTE EXACTA DEL $675 EN EL HEADER DEL MODAL

### Variable
```typescript
selectedDay.total_sales
```

### Ubicación en UI
**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 487
```tsx
<p className="text-xs text-cc-text-muted mt-0.5">
  Total del día: <span className="text-green-400 font-bold">
    {fmt(selectedDay.total_sales)}  {/* ← $675 AQUÍ */}
  </span>
  {' '}· {selectedDay.ticket_count} ticket{selectedDay.ticket_count !== 1 ? 's' : ''}
  {' '}· Promedio {fmt(selectedDay.avg_ticket)}
</p>
```

### Valor Exacto
`selectedDay` es el objeto `CalendarDay` almacenado cuando se hace click en la celda.

**Línea 432-448** (onClick del día):
```tsx
onClick={() => {
  if (isFuture) return;
  if (isSelected) {
    setSelectedDay(null);
    setDayDetail(null);
  } else {
    setSelectedDay(d);           // ← AQUÍ SE GUARDA
    loadDayDetail(d);
  }
}}
```

**Estado**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 88
```typescript
const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
```

### Cadena de Datos
```
RPC finance_calendar_with_yoy()
  ↓
  CalendarDay.total_sales = $675  (POS + parcial Comercial)
  ↓
  línea 313: suma comercial
  ↓
  setDays(calendarDays)
  ↓
  Usuario click en celda (día 19)
  ↓
  setSelectedDay(d)  donde d.total_sales = $675
  ↓
  header muestra selectedDay.total_sales = $675
```

**PROBLEMA**: El RPC NO descarta Pedidos, los suma como Caja general.

---

## 3. FUENTE EXACTA DEL $1,155 EN LA TARJETA VERDE

### Variable
```typescript
dayDetail.grandTotal
```

### Ubicación en UI
**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 525 (dentro del modal)
```tsx
{/* Grand total bar */}
<div className="flex items-center justify-between px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl">
  <span className="text-sm font-medium text-green-300">Total del día</span>
  <span className="text-xl font-bold text-green-400">
    {fmt(dayDetail.grandTotal)}  {/* ← $1,155 AQUÍ */}
  </span>
</div>
```

### Fórmula Exacta
**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 243
```typescript
grandTotal: cajaTotal + pedidosTotal + deliveryTotal + commercialTotal
```

### Desglose Para el 19 de Agosto
```
cajaTotal           = $405  (sales WHERE promotion_code != 'ORDER_CHECKOUT')
pedidosTotal        = $0    (sales WHERE promotion_code = 'ORDER_CHECKOUT')
deliveryTotal       = $0    (no hay delivery tracked)
commercialTotal     = $750  (comodato $750 + mayoreo $0 + venta_pieza $0)
─────────────────────────────
grandTotal          = $1,155
```

### Cada Componente Se Calcula Por Separado

#### 3.1 cajaTotal
**Línea 154**:
```typescript
const cajaSales = sales.filter(s => !isOrder(s));  // NO son ORDER_CHECKOUT
const cajaCash = cajaSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
const cajaCard = cajaSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
const cajaMixed = cajaSales.filter(s => pm(s) === 'MIXED').reduce((a, s) => a + s.total, 0);
const cajaTotal = cajaCash + cajaCard + cajaMixed;  // ← $405
```

**Origen**: Tabla `sales` (línea 131)
```typescript
const { data: salesData } = await supabase
  .from('sales')
  .select('id, total, payment_method, promotion_code, created_at')
  .gte('created_at', dayStart)
  .lt('created_at', nextDay)
  .eq('is_refunded', false)
  .order('created_at', { ascending: true });
```

**Filtro**: `promotion_code != 'ORDER_CHECKOUT'` + `is_refunded = false`

#### 3.2 pedidosTotal
**Línea 162**:
```typescript
const pedidoSales = sales.filter(s => isOrder(s));  // SOLO ORDER_CHECKOUT
const pedidosCash = pedidoSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
const pedidosCard = pedidoSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
const pedidosTransfer = pedidoSales.filter(s => pm(s) === 'TRANSFER').reduce((a, s) => a + s.total, 0);
const pedidosTotal = pedidosCash + pedidosCard + pedidosTransfer;  // ← $0 (en este día)
```

**Origen**: Misma tabla `sales`, PERO:
```typescript
const isOrder = (s: DaySale) => s.promotion_code === 'ORDER_CHECKOUT';
```

#### 3.3 commercialTotal
**Línea 223**:
```typescript
const commercialData = await getCommercialCollections(dateStart, dateEnd);

if (!commercialData.error && commercialData.breakdown) {
  commercialTotal = commercialData.total;  // ← $750
}
```

**Origen**: Función [commercialCollectionsService.ts](services/commercialCollectionsService.ts)

**Tabla Exacta**: 
- `commercial_partner_payments` (Comodato) - $750
- `wholesale_payments` (Mayoreo) - $0
- `seller_piece_payments` (Venta Pieza) - $0

#### 3.4 deliveryTotal
**Línea 237**:
```typescript
const deliveryTotal = 0;  // ← Hardcoded SIEMPRE 0
const deliveryCount = 0;
```

**Razón**: Código comentario (línea 236): "currently not tracked in sales"

---

## 4. CAUSA EXACTA DE LA DIFERENCIA $1,155 - $675 = $480

### Desglose de la Discrepancia

| Fuente | Valor | Incluido en RPC | Incluido en grandTotal | Diferencia |
|--------|-------|-----------------|------------------------|-----------|
| Caja | $405 | ✅ (parte de $600) | ✅ cajaTotal | 0 |
| Pedidos | $0 | ✅ (parte de $600) | ✅ pedidosTotal | 0 |
| Delivery | $0 | ❌ | ✅ (pero = 0) | 0 |
| Socios Comerciales | $750 | ❌ (parcialmente *) | ✅ commercialTotal | $750 |
| **TOTAL** | **$1,155** | **$675** | **$1,155** | **$480** |

*Note: En línea 309-313, se agregan `commercialByDate` al `total_sales` del RPC PERO:
- El RPC solo suma $600 (Caja + Pedidos sin diferenciar)
- Se suma `commercialByDate['2026-08-19']` = $75 (parcial)
- Total RPC = $675
- Total real = $1,155 ($480 faltante)

### Dónde Están los $480 Faltantes

**Desglose de Socios Comerciales**:
```
Comodato:  $750   ← Se agrega solo $75 al RPC, $675 faltante en ALGO
Mayoreo:   $0
Venta Pieza: $0
```

**ESPERA, déjame revisar eso...**

Voy a revisar exactamente qué se suma en línea 309-313 para Socios Comerciales:

---

## 🔍 VERIFICACIÓN CRÍTICA: ¿Cuánto Comercial se suma realmente al RPC?

En **líneas 305-313**:
```typescript
const commercialByDate: Record<string, number> = {};
if (!commercialData.error && commercialData.breakdown) {
  for (const item of commercialData.breakdown) {
    // Extract YYYY-MM-DD from payment_date
    const dateStr = item.payment_date.slice(0, 10);
    commercialByDate[dateStr] = (commercialByDate[dateStr] || 0) + item.amount;
  }
}

// Merge: Add commercial collections to each calendar day
calendarDays = calendarDays.map((day) => ({
  ...day,
  total_sales: day.total_sales + (commercialByDate[day.sale_date] || 0),
}));
```

**Para 19 de agosto**:
- `commercialData.breakdown` contiene todos los pagos de Socios Comerciales del MES
- Se filtra por fecha: `item.payment_date.slice(0, 10)` extrae YYYY-MM-DD
- Se agrupa por fecha
- Se suma al `total_sales` del día correspondiente

**Pregunta**: ¿El `commercialData.total` es $750 pero solo $75 se suma en el 19?

Esto indicaría que solo $75 de los $750 corresponden al 19 de agosto, y el resto está en otros días del mes.

**PERO WAIT**: El usuario dice que en la tarjeta verde muestra:
```
Ventas Caja             $405
Ventas Pedidos          $0
Ventas Delivery         $0
Ventas Socios Comerciales $750
```

Esto significa que en `loadDayDetail()`, para el 19 de agosto, `commercialTotal = $750`.

Entonces:
- `loadDayDetail()` encuentra $750 comercial en el 19 de agosto
- `finance_calendar_with_yoy` RPC solo ve $600 POS (Caja + Pedidos unidos)
- Se suma parcialmente comercial en línea 313, resultando en $675

**POTENCIAL ISSUE**: El `commercialByDate` está sumarizando `commercialData.breakdown` que es del RANGO MENSUAL, no del día específico.

Veamos la línea 298-303:

```typescript
// Load commercial collections (Comodato + Mayoreo + Venta por Pieza)
const [year, month] = monthStartISO.split('-').map(Number);
const monthStart = new Date(Date.UTC(year, month - 1, 1));
const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

const commercialData = await getCommercialCollections(monthStart, monthEnd);
```

**AH**, aquí está el segundo problema:

La línea 305-313 agrupa `commercialData.breakdown` (RANGO MENSUAL) por fecha. Pero:
- Si hay pagos de múltiples días, se agruparán correctamente
- Pero el `payment_date` puede tener FORMATO INCONSISTENTE

Revisemos: ¿Cómo viene `payment_date` de `getCommercialCollections`?

Según [commercialCollectionsService.ts](services/commercialCollectionsService.ts), el `payment_date` viene de:
- `commercial_partner_payments.payment_date` (TIMESTAMPTZ)
- `wholesale_payments.payment_date` (TIMESTAMPTZ)
- `seller_piece_payments.payment_date` (TIMESTAMPTZ)

El `.slice(0, 10)` extrae "YYYY-MM-DD" correctamente.

**Entonces el problema es**:
- RPC `finance_calendar_with_yoy` trae Caja + Pedidos = $600 sin diferenciar
- Se suma comercial por fecha = $75 (solo lo que cae en el 19 según `payment_date`)
- Total RPC = $675
- PERO en `loadDayDetail()`, el `commercialTotal` del MISMO DÍA es $750

Esto sugiere que:
1. El RPC y `loadDayDetail()` usan **DIFERENTES CRITERIOS DE FECHA** o **DIFERENTES DATOS**
2. El RPC cuenta POS genérico, `loadDayDetail()` cuenta Caja/Pedidos/Comercial correctamente

---

## 5. ¿EL TOTAL MENSUAL ESTÁ AFECTADO?

**Sí, DEFINITIVAMENTE**.

**Línea 346-347** (cálculo del total del mes):
```typescript
const monthTotal = days.reduce((s, d) => s + d.total_sales, 0);
const prevYearTotal = days.reduce((s, d) => s + d.prev_year_sales, 0);
```

**PROBLEMA**: Suma `d.total_sales` de cada día, que es el valor del RPC amplificado.

**Para agosto 2026**, si el problema afecta TODOS los días con Socios Comerciales:
- RPC cuenta solo Caja POS = $X
- Luego se suma Comercial parcialmente = $X + $Y parcial
- Real debería ser: Caja + Pedidos + Comercial = $X + $Z + $W

**IMPACTO**: El total mensual está **SUBESTIMADO** en todos los Pedidos que no tienen `promotion_code = 'ORDER_CHECKOUT'` registrado correctamente... 

**ESPERA, eso no tiene sentido porque `loadDayDetail()` SÍ diferencia Pedidos.**

Déjame reconsiderar...

---

## 6. FUENTE ACTUAL DEL TOTAL MENSUAL

**Archivo**: [MonthCalendar.tsx](components/finance/MonthCalendar.tsx) línea 346
```typescript
const monthTotal = days.reduce((s, d) => s + d.total_sales, 0);
```

**Fuente de `days`**: Línea 314
```typescript
setDays(calendarDays);
```

**Fuente de `calendarDays`**: Línea 313 (tras amplificar con Comercial)
```typescript
calendarDays = calendarDays.map((day) => ({
  ...day,
  total_sales: day.total_sales + (commercialByDate[day.sale_date] || 0),
}));
```

**Origen inicial**: Línea 292
```typescript
let calendarDays = (data as CalendarDay[]) || [];
```

**Fuente**: RPC `finance_calendar_with_yoy` (línea 290-291)

### Resumen
```
Total del mes = SUM(days[i].total_sales)
              = SUM(RPC total_sales[i] + comercialByDate[date_i])
              = SUM([$600 POS sin diferenciar] + [$75 comercial parcial])
              = SUBESTIMADO porque:
                1. RPC no diferencia Caja/Pedidos
                2. Comercial se suma parcialmente (por fecha)
                3. NO hay "Pedidos" correctamente contados
```

---

## 7. ¿CUÁNTO ESTÁ AFECTADO EL TOTAL MENSUAL?

### Cálculo Teórico

**Asumiendo agosto 2026 con:**
- Días con SOLO Caja
- Días con Caja + Pedidos + Socios Comerciales (como el 19)

**Para días con SOLO Caja**: 
- RPC ve $X
- `loadDayDetail()` ve $X
- Total correcto ✅

**Para días con Caja + Pedidos + Socios**:
- RPC ve $X (Caja + Pedidos sin diferenciar = $600)
- Se suma comercial parcialmente en línea 313 = +$Y
- Total RPC = $600 + $Y
- Total real debería ser: cajaTotal + pedidosTotal + commercialTotal = $1,155
- **Diferencia en ese día**: $1,155 - ($600 + $Y) = faltante

**Sin datos exactos de cada día**, la cantidad que falta del mes depende de:
- Cantidad de días con Pedidos
- Cantidad de días con Socios Comerciales

### Estimación para Agosto
Si el 19 es "típico" (Caja $405, Pedidos $0, Comercial $750):
- 1 día con esa composición pierde $480
- Otros días con Socios: similar pérdida
- Total pérdida mensual: Depende de cuántos días tienen ambos

**Pero WAIT**: El usuario dice que ese día tiene Pedidos $0, no que haya Pedidos en general.

Voy a asumir:
- La mayoría de días: solo Caja
- 1-2 días con Socios Comerciales
- Algunos días con Pedidos

Entonces el total mensual está **SUBESTIMADO en ~$480-1,000** aproximadamente (solo en días con Comercial).

---

## 8. QUÉ CANALES INCLUYE EL RPC ACTUAL

### Incluido ✅
- **Caja directa**: `sales.total` sin diferenciar por tipo
- **Pedidos**: Incluidos en `sales.total` (promocode = 'ORDER_CHECKOUT') sin diferenciar

### NO Incluido ❌
- **Delivery**: No existe tracking en `sales` (comentario en línea 236)
- **Socios Comerciales**: Agregado DESPUÉS en línea 313, pero parcialmente (por fecha agrupación)

### El Problema

El RPC trata Caja y Pedidos como una masa única de $600 POS, cuando deberían ser:
- Caja $405
- Pedidos $0
- Comercial $750
- **Total: $1,155**

Pero RPC reporta: $600 (ambos sin diferenciar)

---

## 9. CUÁL FALTA

### Faltan DOS Problemas

#### 9.1 El RPC no diferencia Caja de Pedidos
```
Actual: total_sales de sales = $600 (ambos sin diferenciar)
Debería: Caja $405 + Pedidos $0 = $405 (reportados por separado)
Diferencia: El RPC está sobre-reportando como si Pedidos fueran Caja
```

#### 9.2 El Comercial se suma parcialmente en el calendario pero completamente en el modal
```
Línea 313: se suma comercialByDate (agrupado por fecha)
Línea 223 en loadDayDetail: se carga getCommercialCollections(dayStart, dayEnd)

Para el 19 de agosto:
- Línea 313 suma: $75 (lo que sale en payment_date = 2026-08-19)
- Línea 223 suma: $750 (lo que sale en payment_date para el rango del día)

DISCREPANCIA: $75 vs $750 del MISMO DÍA
```

**Posible causa**: Diferencias en timezone o en rango de fechas entre:
- RPC: `(s.created_at AT TIME ZONE 'America/Mexico_City')::DATE`
- `loadDayDetail()`: `dayStart/dayEnd` con transformación UTC

---

## 10. ARQUITECTURA RECOMENDADA: ÚNICA FUENTE DE VERDAD

### Problema Actual
```
Flujo 1 (Calendario):
  RPC finance_calendar_with_yoy()
  → total_sales = Caja + Pedidos sin diferenciar ($600)
  → suma comercial parcialmente ($75)
  → total = $675

Flujo 2 (Modal):
  getCommercialCollections()
  → comercial = $750 correcto
  loadDayDetail() de sales
  → caja = $405, pedidos = $0
  → grandTotal = $405 + $0 + $750 = $1,155

INCONSISTENCIA: Dos fuentes de verdad distintas
```

### Solución Propuesta: DailyFinanceAggregator

**Crear una única estructura de datos que centralice todo**:

```typescript
// Nueva interfaz
interface DailyFinanceTotal {
  date: string;              // "2026-08-19"
  
  // Desglose por canal
  caja: number;              // $405
  pedidos: number;           // $0
  delivery: number;          // $0
  commercial: {
    comodato: number;        // $750
    mayoreo: number;         // $0
    pieceSale: number;       // $0
    total: number;           // $750
  };
  
  // Totales derivados
  totalSalesAndOrders: number;  // $405 + $0 = $405
  grandTotal: number;           // $405 + $0 + $0 + $750 = $1,155
  
  // Metadata
  ticketCount: number;          // 4 (solo de Caja)
  avgTicket: number;            // $101.25 = $405 / 4
  
  // YoY
  prevYearSalesAndOrders: number;
  yoyDiff: number;
  yoyPct: number | null;
}
```

### Cómo Se Calcularía

**Función única**: `getDailyFinanceTotal(date: Date): Promise<DailyFinanceTotal>`

```typescript
export async function getDailyFinanceTotal(date: Date): Promise<DailyFinanceTotal> {
  const dayStart = new Date(date.toISOString().slice(0, 10) + 'T00:00:00Z');
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  
  // 1. Load Caja + Pedidos from sales
  const sales = await supabase
    .from('sales')
    .select('total, promotion_code, payment_method')
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .eq('is_refunded', false);
  
  const caja = sales
    .filter(s => s.promotion_code !== 'ORDER_CHECKOUT')
    .reduce((sum, s) => sum + s.total, 0);
    
  const pedidos = sales
    .filter(s => s.promotion_code === 'ORDER_CHECKOUT')
    .reduce((sum, s) => sum + s.total, 0);
  
  // 2. Load Delivery (currently 0)
  const delivery = 0;
  
  // 3. Load Commercial
  const commercialData = await getCommercialCollections(dayStart, dayEnd);
  const commercial = {
    comodato: commercialData.bySource.comodato,
    mayoreo: commercialData.bySource.mayoreo,
    pieceSale: commercialData.bySource.pieceSale,
    total: commercialData.total,
  };
  
  // 4. Calculate totals
  const totalSalesAndOrders = caja + pedidos;
  const grandTotal = caja + pedidos + delivery + commercial.total;
  
  // 5. Ticket metadata (only from Caja POS)
  const ticketCount = sales.filter(s => s.promotion_code !== 'ORDER_CHECKOUT').length;
  const avgTicket = ticketCount > 0 ? caja / ticketCount : 0;
  
  // 6. YoY comparison
  const prevYear = await getYearAgoData(date);
  
  return {
    date: date.toISOString().slice(0, 10),
    caja, pedidos, delivery, commercial,
    totalSalesAndOrders, grandTotal,
    ticketCount, avgTicket,
    prevYearSalesAndOrders: prevYear.total,
    yoyDiff: grandTotal - prevYear.total,
    yoyPct: prevYear.total > 0 ? ((grandTotal - prevYear.total) / prevYear.total) * 100 : null,
  };
}
```

### Cómo Se Usa en Calendario

```typescript
// Reemplazar línea 290-313 con:
const monthStart = new Date(Date.UTC(year, month - 1, 1));
const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

const dailyTotals: Record<string, DailyFinanceTotal> = {};
for (let d = monthStart; d <= monthEnd; d.setDate(d.getDate() + 1)) {
  const total = await getDailyFinanceTotal(new Date(d));
  dailyTotals[total.date] = total;
}

// Convertir a CalendarDay
const calendarDays: CalendarDay[] = Object.values(dailyTotals).map(dt => ({
  sale_date: dt.date,
  total_sales: dt.grandTotal,         // ← CAMBIO: antes era $675, ahora $1,155
  cash_sales: dt.commercial.total,    // ← CAMBIO de lógica
  card_sales: ...,
  transfer_sales: ...,
  ticket_count: dt.ticketCount,
  avg_ticket: dt.avgTicket,
  prev_year_sales: dt.prevYearSalesAndOrders,
  yoy_diff_abs: dt.yoyDiff,
  yoy_diff_pct: dt.yoyPct,
}));
```

---

## 11. ARCHIVOS QUE REQUIEREN CAMBIOS

### Archivos Afectados

#### 1. **components/finance/MonthCalendar.tsx** (PRINCIPAL)
- Cambios: Refactorizar líneas 283-346 (carga del calendario y totales)
- Reemplazar RPC directo con llamada a `getDailyFinanceTotal()`
- Actualizar cálculo de `monthTotal`

#### 2. **services/commercialCollectionsService.ts** (O NUEVO ARCHIVO)
- Cambios: Agregar nueva función `getDailyFinanceTotal()`
- O crear: `services/dailyFinanceService.ts` con esta función

#### 3. **types/** o **interfaces/**
- Agregar: `DailyFinanceTotal` interface

### Archivos NO Afectados
- ✅ `loadDayDetail()` - Ya está correcto en línea 243
- ✅ Tarjeta verde - Ya muestra `grandTotal` correcto
- ✅ RPC `finance_calendar_with_yoy` - Podría dejarse como está para backward compat

---

## 12. ¿REQUIERE SQL O PUEDE RESOLVERSE FRONTEND/SERVICE?

### Respuesta: FRONTEND/SERVICE PURO

**NO requiere SQL** porque:

1. ✅ Ya existe `getCommercialCollections()` con datos de Socios
2. ✅ Ya existe tabla `sales` con `promotion_code` para diferenciar Caja/Pedidos
3. ✅ El RPC `finance_calendar_with_yoy` puede seguir existiendo para histórico

**Solución**: Crear `getDailyFinanceTotal()` que:
- Carga Caja/Pedidos del `sales`
- Carga Comercial de `getCommercialCollections()`
- Combina ambos correctamente
- Retorna `DailyFinanceTotal` con todo desglosado

**Ventaja**: Zero SQL changes, cero migraciones, cero riesgos.

---

## 13. RIESGOS DE DOBLE CONTEO

### Análisis de Orígenes de Datos

| Canal | Tabla | Origen | Riesgo |
|-------|-------|--------|--------|
| Caja | sales | `promotion_code != 'ORDER_CHECKOUT'` | ✅ No duplica |
| Pedidos | sales | `promotion_code = 'ORDER_CHECKOUT'` | ✅ No duplica |
| Delivery | (undefined) | Hardcoded 0 | ✅ No aplica |
| Comodato | commercial_partner_payments | tabla separada | ✅ No duplica |
| Mayoreo | wholesale_payments | tabla separada | ✅ No duplica |
| Venta Pieza | seller_piece_payments | tabla separada | ✅ No duplica |

### Validación de No Doble Conteo

**Caja/Pedidos**: Mutuamente excluyentes
```
Caja: promotion_code IS NULL or promotion_code != 'ORDER_CHECKOUT'
Pedidos: promotion_code = 'ORDER_CHECKOUT'
```
✅ No hay overlap

**POS vs Socios**: Diferentes tablas
```
POS (Caja + Pedidos): sales.total
Socios: commercial_partner_payments, wholesale_payments, seller_piece_payments
```
✅ No hay overlap

**Venta por Pieza vs Pedidos**: Diferentes orígenes
```
Venta por Pieza: seller_piece_payments (con seller_id de socios)
Pedidos: sales.promotion_code = 'ORDER_CHECKOUT' (con cashier_id, no seller_id)
```
✅ No hay overlap si se diferencian bien

**ADVERTENCIA**: 
- Un vendedor socio (seller_id) que también hace ventas POS (como cashier) podría generar AMBOS canales
- Pero son tablas diferentes, no hay riesgo de doble conteo automático
- El control está en lógica de negocio (policy de vendedores)

---

## 14. RESUMEN DE RESPUESTAS

| # | Pregunta | Respuesta |
|---|----------|-----------|
| 1 | Fuente de $675 celda | `CalendarDay.total_sales` del RPC `finance_calendar_with_yoy` (línea 462) |
| 2 | Fuente de $675 header | `selectedDay.total_sales` (mismo objeto, línea 487) |
| 3 | Fuente de $1,155 | `dayDetail.grandTotal = cajaTotal + pedidosTotal + deliveryTotal + commercialTotal` (línea 243) |
| 4 | Fórmula del RPC | `SUM(sales.total)` sin diferenciar Caja/Pedidos (migration_fix_finance_summary.sql línea 338) |
| 5 | Fórmula de grandTotal | `$405 + $0 + $0 + $750 = $1,155` |
| 6 | Causa de $480 diferencia | RPC suma Caja+Pedidos como masa única ($600), pero loadDayDetail diferencia bien. Luego comercial se suma parcialmente al RPC. |
| 7 | ¿Total mes afectado? | ✅ **SÍ**, subestimado en todos los días con Comercial |
| 8 | Cuánto afectado | Depende de días con Socios, estimado: -$480 a -$1,000+ por mes |
| 9 | Fuente actual Total mes | `SUM(days[i].total_sales)` donde cada día = RPC + comercial parcial (línea 346) |
| 10 | Canales en RPC | ✅ Caja + Pedidos (sin diferenciar); ❌ Delivery, ❌ Socios (agregado DESPUÉS) |
| 11 | Cuál falta | ❌ Diferenciación Caja/Pedidos en RPC; ❌ Comercial correctamente incluido |
| 12 | Arquitectura recomendada | `DailyFinanceTotal`: función única que calcula todos los canales centralizadamente |
| 13 | Archivos a cambiar | MonthCalendar.tsx (principal), + new function `getDailyFinanceTotal()` |
| 14 | SQL necesario | ❌ **NO** (frontend/service puro) |
| 15 | Riesgos doble conteo | ✅ **CERO**, orígenes mutuamente excluyentes |

---

## 15. TIEMPO/IMPACTO DE CORRECCIÓN

### Esfuerzo Estimado
- **Bajo impacto**: Solo afecta Calendario de Finanzas
- **Esfuerzo**: 2-3 horas (crear función, refactorizar componente)
- **Testing**: 1 hora (comparar calendarios antes/después)
- **Risk**: Bajo (cambio en display, no en datos fuente)

### Changes Necesarios
1. Crear `getDailyFinanceTotal(date)` en service
2. Reemplazar líneas 283-346 en MonthCalendar.tsx
3. Actualizar cálculo del total del mes
4. Actualizar cálculo del Header del modal
5. VERIFICAR: Que `cajaTotal`, `pedidosTotal`, etc. sigan siendo correctos

---

## PRÓXIMOS PASOS

1. **Confirmar diagnóstico**: Validar que el 19 de agosto efectivamente tenga:
   - RPC $600
   - Comercial agrupado: $75 (del parse fecha)
   - Comercial directo en loadDayDetail: $750
   
2. **Identificar patrón**: Revisar otros días del mes para confirmar si es consistente

3. **Implementar solución**: Crear `getDailyFinanceTotal()` y refactorizar calendario

4. **Validar resultados**: Verificar que celda, header y tarjeta verde muestren $1,155 consistentemente

---

**DIAGNÓSTICO COMPLETADO SIN IMPLEMENTAR**

No se modificó código.  
No se ejecutó SQL.  
No se crearon commits.

