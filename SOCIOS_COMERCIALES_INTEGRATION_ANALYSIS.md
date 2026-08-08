# 📊 Análisis Técnico: Integración de Cobros de Socios Comerciales

**Fecha**: 7 de agosto de 2026  
**Estado**: ANÁLISIS COMPLETO - LISTO PARA IMPLEMENTACIÓN

---

## 🎯 Objetivo

Integrar cobros reales de Socios Comerciales (comodato, mayoreo, venta por pieza) al Dashboard Operativo y a Finanzas sin doble conteo.

---

## 📍 Componentes Identificados

### 1. Dashboard Operativo
**Ubicación**: `/pages/Dashboard.tsx`
**Responsabilidad**: Mostrar ventas del día actual

**Tarjetas Actuales**:
- Venta Caja: `cajaTotal` (suma de sales donde sale_origin='pos')
- Venta Pedidos: `pedidosTotal` (suma de sales donde sale_origin='order')
- Venta Delivery: `deliveryTotal` (suma de sales donde sale_origin='delivery')
- Total del Día: `stats.salesToday` = cajaTotal + pedidosTotal + deliveryTotal
- Tickets Cobrados: contador de tickets (NO modificar)
- Alerta Inventario: conteo de stock bajo

**Nueva Tarjeta**:
- Venta Socios Comerciales: suma de cobros reales confirmados del día

### 2. Finanzas
**Ubicación**: `/pages/Finanzas.tsx`  
**Componente Principal**: `FinanceChart` → usa RPC `finance_daily_series()`

**Datos Actuales**:
- Ventas del Mes: suma de sales.total para cada día del mes
- Meta Mensual: objetivo establecido
- Proyección: (ventas_actual / día_actual) × días_mes
- Utilidad Neta: ventas - gastos

**Cambio Necesario**:
- Incluir cobros de Socios Comerciales en Ventas del Mes
- Recalcular Meta y Proyección automáticamente

---

## 💾 Fuentes de Datos Reales

### A. Comodato: `public.commercial_partner_payments`

**Campos relevantes**:
```
- id: UUID (PK)
- partner_id: UUID (referencia)
- payment_date: TIMESTAMPTZ (FECHA DE PAGO)
- amount: NUMERIC(12,2) (MONTO)
- payment_method: TEXT ('cash' | 'transfer')
- status: TEXT ('completed' | 'paid')
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

**Pago Confirmado**: `status IN ('completed', 'paid')`  
**Fecha a usar**: `payment_date`  
**Métodos**: cash, transfer

---

### B. Mayoreo: `public.wholesale_payments`

**Campos relevantes**:
```
- id: UUID (PK)
- partner_id: UUID (referencia)
- wholesale_order_id: UUID (referencia orden)
- payment_date: TIMESTAMPTZ (FECHA DE PAGO)
- amount: NUMERIC(12,2) (MONTO)
- payment_method: TEXT ('cash' | 'transfer')
- status: TEXT ('completed' | 'paid')
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

**Pago Confirmado**: `status IN ('completed', 'paid')`  
**Fecha a usar**: `payment_date`  
**Métodos**: cash, transfer

---

### C. Venta por Pieza: Flujo Especial

**No existe tabla `seller_piece_payments` separada.**  
**Usa**: `partner_payment_verification_requests` con `scheme='venta_pieza'`

**Campos relevantes**:
```
- id: UUID (PK)
- seller_id: UUID (referencia)
- scheme: TEXT ('venta_pieza')
- payment_date: TIMESTAMPTZ (FECHA CONFIRMACIÓN PAGO)
- amount: NUMERIC (MONTO A PAGAR)
- payment_method: TEXT ('cash' | 'transfer')
- status: TEXT ('draft' | 'pending_review' | 'approved' | ...)
- created_at: TIMESTAMPTZ
```

**Pago Confirmado**: `status = 'approved'`  
**Fecha a usar**: `payment_date`  
**Métodos**: cash, transfer

---

## ❌ Fuentes que NO se cuentan

1. **`partner_payment_verification_requests` con otros schemes**: Solo contar venta_pieza
2. **Solicitudes con `status != 'approved'`**: 
   - `draft` - no confirmado
   - `pending_review` - en espera
   - `rejected` - rechazado
3. **`commercial_partner_movements`**: No es ingreso confirmado (es solo liquidación)
4. **`wholesale_orders.total_amount`**: Puede estar sin pagar
5. **`seller_piece_sales.total_amount`**: Puede estar en pending_review

---

## 🚫 Evitar Doble Conteo

**Regla crítica**: 
- `partner_payment_verification_requests` es un **staging layer** que genera registros en tablas reales
- Al aprobar una venta por pieza → se crea/actualiza registro
- **Siempre leer SOLO las tablas de pago final**, no las de solicitud

**Verificación**:
- Para comodato y mayoreo: leer de `*_payments` (NOT de `*_verification_requests`)
- Para venta pieza: contar solicitud aprobada (es la fuente única en este caso)

---

## 🛠️ Solución: Helper Frontend Compartido

Se creará: `/services/commercialCollectionsService.ts`

**Función principal**:
```typescript
async function getCommercialCollections(
  startDate: Date,
  endDate: Date
): Promise<CommercialCollections>
```

**Retorna**:
```typescript
{
  total: number;           // suma de todos los cobros
  cash: number;           // suma método cash
  transfer: number;       // suma método transfer
  bySource: {
    comodato: number;
    mayoreo: number;
    pieceSale: number;
  };
  breakdown: CommercialCollectionItem[];  // detalle línea por línea
}
```

**Implementación**:
1. Consultar `commercial_partner_payments` donde `payment_date` está en rango y `status IN ('completed', 'paid')`
2. Consultar `wholesale_payments` donde `payment_date` está en rango y `status IN ('completed', 'paid')`
3. Consultar `partner_payment_verification_requests` donde `scheme='venta_pieza'` y `status='approved'` y `payment_date` en rango
4. Sumar por método y fuente
5. Retornar objeto con totales

**Ventajas**:
- ✅ No requiere cambios SQL
- ✅ Reutilizable en Dashboard y Finanzas
- ✅ Centralizado para evitar inconsistencias
- ✅ Fácil de testear

---

## 📊 Cambios en Dashboard Operativo

### Antes:
```
Venta Caja:            $720
Venta Pedidos:         $0
Venta Delivery:        $0
============================
Total del Día:         $720
```

### Después:
```
Venta Caja:            $720
Venta Pedidos:         $0
Venta Delivery:        $0
Venta Socios:          $185
  ├─ Efectivo:         $65
  └─ Transferencia:    $120
============================
Total del Día:         $905
```

**Cambios en código**:
1. Llamar `getCommercialCollections(todayStart, todayEnd)`
2. Agregar tarjeta con el total
3. Actualizar `Total del Día` = anterior + comercial
4. Agregar desglose de métodos en panel

---

## 📈 Cambios en Finanzas

### Antes:
```
Ventas del Mes:        $4,763
Meta Mensual:          $20,000
Progreso:              23.8%
Proyección:            $4,763 × (30/7) = $20,412
```

### Después:
```
Ventas Tienda:         $4,763
+ Cobros Socios:       $1,250
============================
Ventas del Mes:        $6,013
Meta Mensual:          $20,000
Progreso:              30.1%
Proyección:            $6,013 × (30/7) = $25,770
Utilidad Neta:         $6,013 - Gastos
```

**Cambios en código**:
1. Modificar `finance_daily_series()` RPC para sumar cobros de Socios Comerciales
2. O crear helper frontend que suma datos de ambas fuentes
3. Recalcular Meta y Proyección (misma fórmula, nueva base)
4. Actualizar Utilidad Neta automáticamente

---

## ⏰ Fechas Correctas

### Dashboard (día actual):
```
- Inicio: HOY a las 00:00:00 Mexico City time
- Fin: HOY a las 23:59:59 Mexico City time
- Filtro: payment_date >= inicio AND payment_date < fin_día_siguiente
```

### Finanzas (mes):
```
- Inicio: 1 del mes a las 00:00:00
- Fin: 1 del mes siguiente a las 00:00:00 (exclusiva)
- Filtro: payment_date >= mes_inicio AND payment_date < mes_siguiente_inicio
```

**Importancia**: Respetar zona horaria America/Mexico_City como el código actual

---

## 🔍 Validaciones Críticas

### 1. Evitar Doble Conteo
**Verificación**: 
- ✅ Comodato/Mayoreo solo desde tablas `*_payments` (NO de verification_requests)
- ✅ Venta pieza solo desde `partner_payment_verification_requests` con status='approved'
- ✅ No contar solicitudes pendientes como ingresos

### 2. Montos Parciales
**Ejemplo**:
```
Comodato adeuda $500
Hoy paga $200 → +$200
Mañana paga $300 → +$300 (mañana)
```
✅ Correcto: sumar solo lo efectivamente pagado hoy

### 3. Métodos de Pago
**Validación**:
```
cash + transfer = total de Socios Comerciales
```
✅ La suma de métodos debe coincidir exactamente

### 4. Totales Mensuales
**Validación**:
```
Ventas Mes (Dashboard) = Ventas Tienda + Cobros Socios
```
✅ Mismo total en todas partes

---

## 🧪 Casos de Prueba

### Caso 1: Venta Pieza Pending
```
1. seller_piece_sales creada: $65 (status='pending_review')
2. Dashboard hoy: Socios Comerciales = $0 ✅
3. Admin aprueba → partner_payment_verification_requests con status='approved'
4. Dashboard actualiza: Socios Comerciales = +$65 ✅
```

### Caso 2: Comodato Pago Parcial
```
1. commercial_partner_payments: $100 (status='completed')
2. Dashboard hoy: Socios Comerciales = +$100 ✅
3. Siguiente pago: $100 → Total = $200 ✅
```

### Caso 3: Mayoreo sin Pagar
```
1. wholesale_orders: $185 (sin pago)
2. Dashboard hoy: Socios Comerciales = $0 ✅
3. wholesale_payments creado: $185 (status='completed')
4. Dashboard actualiza: Socios Comerciales = +$185 ✅
```

### Caso 4: Suma Diaria Correcta
```
Venta Caja (sales POS): $720
Venta Pedidos (sales ORDER): $0
Venta Delivery (sales DELIVERY): $0
Socios Comerciales:
  - Comodato: $100
  - Mayoreo: $65
  - Pieza: $20
  = $185
============================
Total del Día: $905 ✅
```

---

## 📋 Resumen de Implementación

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Fuentes Dashboard** | sales.total | sales.total + cobros Socios |
| **Tarjetas Dashboard** | 5 | 6 (agrega Socios Comerciales) |
| **Total del Día** | cajaTotal + pedidosTotal + deliveryTotal | anterior + sociosterelales |
| **Fuentes Finanzas** | sales.total | sales.total + cobros Socios |
| **Meta Mensual** | ventas tienda / meta | (ventas tienda + socios) / meta |
| **Proyección** | solo tienda | tienda + socios |
| **Utilidad Neta** | ventas tienda - gastos | (ventas tienda + socios) - gastos |
| **Métodos Pagados** | Efectivo, Tarjeta, Transfer | Efectivo, Tarjeta, Transfer + desglose Socios |
| **Cambios SQL** | ❌ NINGUNO | ❌ NINGUNO |
| **Helper Compartido** | N/A | ✅ getCommercialCollections() |

---

## ✅ Checklist de Implementación

- [ ] Crear `/services/commercialCollectionsService.ts`
- [ ] Implementar `getCommercialCollections(startDate, endDate)`
- [ ] Agregar tarjeta en Dashboard.tsx
- [ ] Modificar Total del Día en Dashboard.tsx
- [ ] Agregar desglose Socios en panel de Dashboard
- [ ] Integrar getCommercialCollections en FinanceChart
- [ ] Verificar Meta Mensual usa nuevo total
- [ ] Verificar Proyección Mensual usa nuevo total
- [ ] Verificar Utilidad Neta usa nuevo total
- [ ] Testing: Caso 1 - Venta Pieza Pending
- [ ] Testing: Caso 2 - Comodato Pago Parcial
- [ ] Testing: Caso 3 - Mayoreo sin Pagar
- [ ] Testing: Caso 4 - Suma Diaria Correcta
- [ ] npm run build
- [ ] Verificar no hay errores de tipo

---

## 🚀 Próximos Pasos

1. **Revisión del análisis** - validar que este plan es correcto
2. **Crear helper** - implementar getCommercialCollections()
3. **Integrar Dashboard** - agregar tarjeta y actualizar totales
4. **Integrar Finanzas** - sumar cobros al MTD
5. **Testing** - validar con los 4 casos
6. **Build** - compilación exitosa

---

**Estado**: ✅ ANÁLISIS COMPLETO - ESPERANDO REVISIÓN Y APROBACIÓN
