# 🔧 Plan de Modificaciones: Integración de Socios Comerciales

**Objetivo**: Documentar exactamente qué cambios se realizarían en Dashboard.tsx y Finanzas.tsx

**Estado**: PRE-IMPLEMENTACIÓN (esperando aprobación)

---

## 📝 CAMBIO 1: Dashboard.tsx - Agregar Helper

**Ubicación**: `/pages/Dashboard.tsx`

**Línea 1-5 (imports)**:
```tsx
// AGREGAR IMPORT:
import { getCommercialCollections, CommercialCollections } from '../services/commercialCollectionsService';
```

**En estado (line 18-22)**:
```tsx
// AGREGAR AL ESTADO:
const [commercialCollections, setCommercialCollections] = useState<CommercialCollections>({
  total: 0,
  cash: 0,
  transfer: 0,
  bySource: { comodato: 0, mayoreo: 0, pieceSale: 0 },
  breakdown: [],
});
```

**En loadDashboardData() - DESPUÉS de cargar salesToday (line 60)**:
```tsx
// AGREGAR DESPUÉS de const totalToday = ...
// Load commercial collections for today
const todayDate = new Date(todayStr);
const tomorrowDate = new Date(tomorrowStr);
const commercialData = await getCommercialCollections(todayDate, tomorrowDate);
setCommercialCollections(commercialData);

// Update breakdown to include commercial collections
const commercialCash = commercialData.cash;
const commercialTransfer = commercialData.transfer;
```

**En el breakdown object (line 108-109)**:
```tsx
// CAMBIAR DE:
// const breakdownSummary = { cajaTotal, cajaCash, cajaCard, cajaMixed, pedidosTotal, pedidosCash, pedidosCard, pedidosTransfer, deliveryTotal, deliveryUber, deliveryDidi, deliveryRappi };

// A:
const commercialTotal = commercialData.total;
const breakdownSummary = { 
  cajaTotal, cajaCash, cajaCard, cajaMixed, 
  pedidosTotal, pedidosCash, pedidosCard, pedidosTransfer, 
  deliveryTotal, deliveryUber, deliveryDidi, deliveryRappi,
  commercialTotal, commercialCash, commercialTransfer  // ADD THESE
};
```

**En setStats (line 278-282)**:
```tsx
// CAMBIAR DE:
// setStats({
//   salesToday: totalToday,
//   ...

// A:
setStats({
  salesToday: totalToday + commercialData.total,  // INCLUDE COMMERCIAL COLLECTIONS
  ...
```

---

## 📝 CAMBIO 2: Dashboard.tsx - Agregar Tarjeta Socios Comerciales

**Ubicación**: `/pages/Dashboard.tsx` línea 340-355 (donde están las tarjetas)

**AGREGAR NUEVA TARJETA después de StatCard para "Venta Delivery"**:

```tsx
<StatCard 
  title="Venta Socios Comerciales" 
  value={`$${breakdown.commercialTotal.toFixed(2)}`} 
  icon={ShoppingBag}  // or could use a different icon like Users, Building2, etc
  color="bg-blue-500"
/>
```

---

## 📝 CAMBIO 3: Dashboard.tsx - Agregar Desglose Socios en Panel

**Ubicación**: `/pages/Dashboard.tsx` línea 378-410 (en el panel "Desglose de ventas del día")

**AGREGAR NUEVA SECCIÓN después del panel "Rappi"**:

```tsx
{/* Socios Comerciales */}
{breakdown.commercialTotal > 0 && (
  <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
    <div className="flex items-center gap-2 mb-3">
      <ShoppingBag size={16} className="text-blue-400" />
      <span className="text-sm font-bold text-cc-cream">Socios Comerciales</span>
      <span className="ml-auto text-lg font-bold text-blue-400">${breakdown.commercialTotal.toFixed(2)}</span>
    </div>
    <div className="space-y-2">
      {breakdown.commercialCash > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-cc-text-muted">Efectivo</span>
          <span className="text-cc-cream font-semibold">${breakdown.commercialCash.toFixed(2)}</span>
        </div>
      )}
      {breakdown.commercialTransfer > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-cc-text-muted">Transferencia</span>
          <span className="text-cc-cream font-semibold">${breakdown.commercialTransfer.toFixed(2)}</span>
        </div>
      )}
    </div>
  </div>
)}
```

---

## 📝 CAMBIO 4: FinanceChart.tsx - Incluir Cobros Socios

**Ubicación**: `/components/finance/FinanceChart.tsx`

**Opción A: Modificar Frontend (Recomendado - sin SQL)**

**En loadChartData() - DESPUÉS de obtener seriesData**:

```tsx
// Enrich series data with commercial collections for each day
const enrichedData = seriesData.map(async (day) => {
  try {
    // Parse day from format "01", "02", etc
    const dayNum = parseInt(day.day, 10);
    const dayStart = new Date(monthStart);
    dayStart.setDate(dayNum);
    dayStart.setHours(0, 0, 0, 0);
    
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    
    const collections = await getCommercialCollections(dayStart, dayEnd);
    
    return {
      ...day,
      sales_mxn: Number(day.sales_mxn) + collections.total,  // Add commercial collections to sales
      commercial_collections_mxn: collections.total
    };
  } catch (err) {
    console.error(`Error getting collections for day ${day.day}:`, err);
    return day;  // Return unchanged if error
  }
});

const enrichedSeries = await Promise.all(enrichedData);
setData(enrichedSeries);
```

**Important**: Add import at top:
```tsx
import { getCommercialCollections } from '../../services/commercialCollectionsService';
```

---

## 📝 CAMBIO 5: Finanzas.tsx - Usar New Total

**Ubicación**: `/pages/Finanzas.tsx`

Este archivo usa `FinanceChart`, que ya está enriquecida. Los cambios principales serían en componentes que usan las métricas (Meta Mensual, Proyección, etc).

**En componentes que leen `sales_mxn` del chart data**:
- Automáticamente usarán el nuevo total combinado
- NO requieren cambios si usan datos de FinanceChart

---

## 📝 CAMBIO 6: dashboard.tsx State Type Fix

**Ubicación**: `/pages/Dashboard.tsx` línea 27 (interface breakdown)

**CAMBIAR DE**:
```tsx
const [breakdown, setBreakdown] = useState({ 
  cajaTotal: 0, cajaCash: 0, cajaCard: 0, cajaMixed: 0, 
  pedidosTotal: 0, pedidosCash: 0, pedidosCard: 0, pedidosTransfer: 0, 
  deliveryTotal: 0, deliveryUber: 0, deliveryDidi: 0, deliveryRappi: 0 
});
```

**A**:
```tsx
const [breakdown, setBreakdown] = useState({ 
  cajaTotal: 0, cajaCash: 0, cajaCard: 0, cajaMixed: 0, 
  pedidosTotal: 0, pedidosCash: 0, pedidosCard: 0, pedidosTransfer: 0, 
  deliveryTotal: 0, deliveryUber: 0, deliveryDidi: 0, deliveryRappi: 0,
  commercialTotal: 0, commercialCash: 0, commercialTransfer: 0  // ADD THESE
});
```

---

## 🔍 Cambios a Métodos de Pago (Desglose en Finanzas)

Si Finanzas muestra desglose por método (Efectivo, Tarjeta, Transferencia), se debe actualizar:

**Lógica actual** (hipotética):
```tsx
Efectivo: sumaVentasEfectivo
Tarjeta: sumaVentasTarjeta
Transferencia: sumaVentasTransferencia
```

**Nueva lógica**:
```tsx
Efectivo: sumaVentasEfectivo + comercialCollections.cash
Tarjeta: sumaVentasTarjeta + 0  // Socios no usan tarjeta en esta fase
Transferencia: sumaVentasTransferencia + comercialCollections.transfer
```

**Verificación**: cash + transfer debe igualar comercialCollections.total

---

## 📊 Resumen de Archivos Modificados

| Archivo | Cambios | Líneas Aprox |
|---------|---------|-------------|
| `pages/Dashboard.tsx` | 6 cambios | +30 líneas |
| `components/finance/FinanceChart.tsx` | 2 cambios | +25 líneas |
| `services/commercialCollectionsService.ts` | CREAR | 200 líneas |
| `pages/Finanzas.tsx` | 0-1 cambios | 0-5 líneas |
| SQL migrations | 0 | 0 |

**Total**: +250 líneas de código, 100% frontend, 0 cambios SQL

---

## ✅ Validaciones Post-Cambios

Después de implementar, validar:

1. ✅ Dashboard carga sin errores
2. ✅ Tarjeta "Venta Socios Comerciales" visible
3. ✅ Total del Día = Caja + Pedidos + Delivery + Socios
4. ✅ Desglose muestra métodos correctamente
5. ✅ Finanzas incluye cobros en ventas diarias
6. ✅ Meta Mensual y Proyección usan nuevo total
7. ✅ npm run build sin errores
8. ✅ TypeScript types correctos

---

## ⏸️ ESTADO: ESPERANDO APROBACIÓN

Este documento describe EXACTAMENTE qué cambios se harían.

**Próximos pasos**:
1. ✅ Revisar análisis (SOCIOS_COMERCIALES_INTEGRATION_ANALYSIS.md)
2. ✅ Revisar este plan de cambios
3. ✅ Confirmar que es correcto
4. ⏳ Proceder a implementación

**No se harán cambios hasta que confirmes que el plan es correcto.**
