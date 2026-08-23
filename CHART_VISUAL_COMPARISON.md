# 📊 Comparativa Visual: PieChart vs BarChart

## Diagrama de Cambio

```
╔════════════════════════════════════════════════════════════════════╗
║           DESGLOSE FINANCIERO - TODOS LOS ORÍGENES                ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  ┌────────────────────────┐    ┌──────────────────────────────┐  ║
║  │   ANTES: PieChart      │    │    DESPUÉS: BarChart         │  ║
║  │                        │    │                              │  ║
║  │      ╱─────╲           │    │   Montos ($)                 │  ║
║  │    ╱         ╲         │    │   │                          │  ║
║  │   │  Efectivo │         │    │   │  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌──┐ │  ║
║  │   │  Tarjeta  │         │    │   │  │ │ │ │ │ │ │ │ │  │ │  ║
║  │    ╲         ╱          │    │   │  │ │ │ │ │ │ │ │ │  │ │  ║
║  │      ╲─────╱            │    │   └──┴─┴─┴─┴─┴─┴─┴─┴──┴─┘  │  ║
║  │   (Porcentajes)         │    │      Efectivo, Tarjeta, ... │  ║
║  │                        │    │                              │  ║
║  └────────────────────────┘    └──────────────────────────────┘  ║
║                                                                    ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  STATS PANELS (SIN CAMBIOS)                                │  ║
║  │  - Caja directa   (Efectivo + Tarjeta)                    │  ║
║  │  - Pedidos        (Efectivo + Tarjeta + Transf.)          │  ║
║  │  - Delivery       (Plataformas)                           │  ║
║  │  - Socios Comerciales (Comodato + Mayoreo + Venta Pieza)  │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 🎨 Especificación Técnica de BarChart

### Layout
```
┌─ BarChart Container (width: 100%, height: 100%)
│  ├─ margin: { top: 10, right: 30, left: 0, bottom: 100 }
│  │  └─ bottom: 100px para etiquetas XAxis rotadas
│  │
│  ├─ CartesianGrid
│  │  ├─ strokeDasharray: "3 3" (punteado)
│  │  └─ stroke: "#444" (gris oscuro)
│  │
│  ├─ XAxis (Categorías)
│  │  ├─ dataKey: "name"
│  │  ├─ angle: -45° (rotación)
│  │  ├─ textAnchor: "end"
│  │  ├─ height: 120px
│  │  └─ tick: { fill: '#CCCCCC', fontSize: 12 }
│  │     (Caja Efectivo, Caja Tarjeta, Pedidos Efectivo, ...)
│  │
│  ├─ YAxis (Montos)
│  │  ├─ tick: { fill: '#CCCCCC', fontSize: 12 }
│  │  └─ tickFormatter: (value) => `$${(value/1000).toFixed(0)}k`
│  │     (Ej: $0k, $10k, $20k, ...)
│  │
│  ├─ Tooltip
│  │  ├─ formatter: (value) => `$${value.toFixed(2)}`
│  │  └─ contentStyle: { backgroundColor: '#2A2A2A', border: '1px solid #444', color: '#F5F5F5' }
│  │
│  └─ Bar (Barras)
│     ├─ dataKey: "value"
│     ├─ radius: [8, 8, 0, 0] (esquinas redondeadas arriba)
│     └─ Cell[] (una por categoría)
│        ├─ fill: '#4CAF50' (Caja Efectivo - verde)
│        ├─ fill: '#2196F3' (Caja Tarjeta - azul)
│        ├─ fill: '#F59E0B' (Pedidos Efectivo - naranja)
│        ├─ fill: '#06B6D4' (Pedidos Tarjeta - cian)
│        ├─ fill: '#8B5CF6' (Pedidos Transf. - violeta)
│        ├─ fill: '#FF6900' (Delivery - naranja oscuro)
│        └─ fill: '#EC4899' (Socios Comerciales - rosa)
└─ Fin BarChart
```

---

## 🎯 Comportamiento Interactivo

### Hover (Mouse Over)
```
Usuario mueve mouse sobre una barra
    ↓
Tooltip aparece con:
  • Categoría (nombre)
  • Monto exacto: $X,XXX.XX
  Ejemplo: Caja Efectivo - $5,234.50
```

### Filtros
```
Usuario selecciona:
  • Hoy
  • Últimos 7 días
  • Este mes
  • Rango personalizado
    ↓
Datos en paymentChartData se recalculan desde RPC
    ↓
BarChart se redibuja automáticamente
```

### Responsiveness
```
Desktop (1920px)          Tablet (768px)         Mobile (375px)
┌─────────┐               ┌─────────┐             ┌─────┐
│ Chart   │ Stats panels  │ Chart   │ Stats       │ Grá│
│         │               │         │ paneles    │fico│
│         │               │ (debajo)│ (debajo)   │    │
└─────────┴───────────────┘         └─────────────────┘
 2 columns (lg:grid-cols-2)  1 column (grid-cols-1)
```

---

## 📊 Datos - Estructura y Flujo

```
┌─ sales_history_summary (RPC de Supabase)
│  └─ Retorna: {
│      gross_total, refunded_total, net_total,
│      pos_cash_total, pos_card_total,          ← Caja
│      order_cash_total, order_card_total, order_transfer_total,  ← Pedidos
│      delivery_total,                          ← Delivery
│      totals_by_origin, ...
│     }
│
└─ getCommercialCollections (para Socios Comerciales)
   └─ Retorna: {
       total, comodato, mayoreo, pieceSale, cash, transfer, ...
      }

Estos valores se transforman en paymentChartData:
┌─ paymentChartData = [
│  { name: 'Caja Efectivo',      value: posCashTotal,        color: '#4CAF50' },
│  { name: 'Caja Tarjeta',       value: posCardTotal,        color: '#2196F3' },
│  { name: 'Pedidos Efectivo',   value: orderCashTotal,      color: '#F59E0B' },
│  { name: 'Pedidos Tarjeta',    value: orderCardTotal,      color: '#06B6D4' },
│  { name: 'Pedidos Transf.',    value: orderTransferTotal,  color: '#8B5CF6' },
│  { name: 'Delivery',           value: deliveryTotalRPC,    color: '#FF6900' },
│  { name: 'Socios Comerciales', value: comercialCollections.total, color: '#EC4899' }
│].filter(item => item.value > 0)  ← Solo categorías con datos
│
└─ Pasado a: <BarChart data={paymentChartData}>
```

---

## ✅ Validación de Colores

| Categoría | Color | Hex | RGB | Visual |
|-----------|-------|-----|-----|--------|
| Caja Efectivo | Verde | #4CAF50 | rgb(76, 175, 80) | 🟩 |
| Caja Tarjeta | Azul | #2196F3 | rgb(33, 150, 243) | 🟦 |
| Pedidos Efectivo | Naranja | #F59E0B | rgb(245, 158, 11) | 🟧 |
| Pedidos Tarjeta | Cian | #06B6D4 | rgb(6, 182, 212) | 🟦 |
| Pedidos Transf. | Violeta | #8B5CF6 | rgb(139, 92, 246) | 🟪 |
| Delivery | Naranja Oscuro | #FF6900 | rgb(255, 105, 0) | 🟠 |
| Socios Comerciales | Rosa | #EC4899 | rgb(236, 72, 153) | 🟩 |

---

## 🔄 Comparativa de Funcionalidad

| Aspecto | PieChart | BarChart | Estado |
|--------|----------|----------|--------|
| Mostrar montos | Porcentaje | Valor exacto | ✅ Mejorado |
| Categorías visibles | Labels circulares | XAxis con nombres | ✅ Igual |
| Colores | Cell component | Cell component | ✅ Idéntico |
| Tooltip | Sí | Sí | ✅ Idéntico |
| Filtros | Sí | Sí | ✅ Idéntico |
| Stats panels | Sí | Sí | ✅ Idéntico |
| Responsive | Sí | Sí | ✅ Idéntico |
| Performance | Bueno | Bueno | ✅ Similar |

---

## 🎬 Secuencia de Rendering

```
1. Component monta
   └─ Estado: loadSummary() se ejecuta

2. RPC sales_history_summary retorna datos
   └─ Estado: posCashTotal, posCardTotal, ... se actualizan

3. getCommercialCollections se ejecuta
   └─ Estado: comercialCollections se actualiza

4. paymentChartData se recalcula
   └─ Array con 7 objetos { name, value, color }
   └─ Filter: solo items donde value > 0

5. Render JSX
   └─ BarChart recibe data={paymentChartData}
   └─ XAxis renderiza nombres
   └─ YAxis renderiza escala de montos
   └─ Bar renderiza con Cell colors
   └─ Stats panels renderizados a la derecha

6. User interactúa
   └─ Hover barra → Tooltip muestra $X.XX
   └─ Click filtro → vuelta al paso 2
```

---

## 🛡️ Edge Cases Manejados

```
1. Sin datos (paymentChartData vacío)
   └─ Muestra: "Sin datos para mostrar"

2. Un solo valor
   └─ Muestra una barra

3. Valores muy grandes (ej: $100,000)
   └─ YAxis ajusta escala: $100k

4. Nombres de categorías largos
   └─ XAxis angle -45° previene overlap

5. Responsive mobile
   └─ Grid pasa a 1 columna
   └─ Chart se redimensiona
```

---

## 📝 Cambios de CSS/Styling

```tsx
// ANTES (PieChart)
<div className="h-64">  // 256px height
  <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      // Sin margins explícitos

// DESPUÉS (BarChart)
<div className="h-64">  // 256px height (IGUAL)
  <ResponsiveContainer width="100%" height="100%">
    <BarChart
      margin={{ top: 10, right: 30, left: 0, bottom: 100 }}
      // bottom: 100px para XAxis rotado
```

---

## ✅ Checklist de Implementación

- [x] Imports actualizados
- [x] JSX reemplazado
- [x] BarChart properties configuradas
- [x] XAxis con angle -45° para legibilidad
- [x] YAxis con formatter de moneda
- [x] CartesianGrid agregado
- [x] Cell colors preservados
- [x] Tooltip mantiene formato $X.XX
- [x] Margin bottom configurado (100px)
- [x] Stats panels sin modificar
- [x] Grid layout (2 cols lg:) sin modificar
- [x] Filtros funcionales
- [x] Responsive config preservada
- [x] TypeScript: 0 errores
- [x] Documentación generada

---

**Nota**: El cambio es puramente visual. Todos los datos, cálculos, consultas y lógica permanecen idénticos.
