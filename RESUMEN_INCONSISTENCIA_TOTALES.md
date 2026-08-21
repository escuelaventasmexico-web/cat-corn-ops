# 🚨 RESUMEN EJECUTIVO: Inconsistencia de Totales

**Caso**: 19 de agosto muestra $675 en calendario pero $1,155 en modal

---

## LA INCONSISTENCIA EN 3 PUNTOS

```
1. CELDA DEL CALENDARIO:    $675
2. HEADER DEL MODAL:        $675
3. TARJETA VERDE:           $1,155
4. DESGLOSE CORRECTO:       Caja $405 + Pedidos $0 + Comercial $750 = $1,155
```

**Diferencia**: $480 faltantes = Comercial NO está completamente en calendario

---

## CAUSA RAÍZ

### El Problema
1. **RPC `finance_calendar_with_yoy`** (línea 290-291 MonthCalendar.tsx):
   - Solo ve tabla `sales`: SUM($600) = Caja + Pedidos sin diferenciar
   - Fórmula: `SELECT SUM(s.total) FROM sales` (migration_fix_finance_summary.sql línea 338)

2. **Línea 313 intenta sumar comercial**:
   ```typescript
   total_sales: day.total_sales + (commercialByDate[day.sale_date] || 0)
   ```
   - Pero solo suma $75 (lo que sale en `payment_date = 2026-08-19`)
   - Debería ser $750

3. **En `loadDayDetail()` (línea 243)** se calcula CORRECTAMENTE:
   ```typescript
   grandTotal: cajaTotal + pedidosTotal + deliveryTotal + commercialTotal
   = $405 + $0 + $0 + $750 = $1,155
   ```

### Por Qué $480 Faltan

| Componente | Calendr RPC | loadDayDetail | Falta |
|-----------|------------|---------------|--------|
| Caja | $600 (no diferenciado) | $405 | - |
| Pedidos | (incluido en $600) | $0 | - |
| Comercial | $75 (suma parcial) | $750 | $675 |
| **Total** | **$675** | **$1,155** | **$480** |

El Comercial de $750 se divide:
- $75 suma en calendario (parcial)
- $675 NO suma (discrepancia de fechas o timezone)

---

## IMPACTO: TOTAL DEL MES TAMBIÉN ESTÁ MAL

**Línea 346**:
```typescript
const monthTotal = days.reduce((s, d) => s + d.total_sales, 0);
```

Suma `total_sales` de cada día (que es RPC + comercial parcial).

**Resultado**: Total del mes está **SUBESTIMADO** en ~$480+ por cada día con Socios Comerciales.

---

## SOLUCIÓN RECOMENDADA

### Cambio: Crear DailyFinanceTotal Única

**En lugar de**:
- RPC → Calendario
- Manual en loadDayDetail → Modal

**Hacer**:
- Nueva función: `getDailyFinanceTotal(date)` que calcula:
  ```typescript
  {
    date: "2026-08-19",
    caja: 405,           // FROM sales WHERE promotion_code != 'ORDER_CHECKOUT'
    pedidos: 0,          // FROM sales WHERE promotion_code = 'ORDER_CHECKOUT'
    delivery: 0,
    commercial: {
      comodato: 750,     // FROM commercial_partner_payments
      mayoreo: 0,
      pieceSale: 0,
      total: 750
    },
    grandTotal: 1155,    // caja + pedidos + delivery + commercial.total
    ticketCount: 4,      // solo de Caja
    avgTicket: 101.25,   // caja / ticketCount
  }
  ```

### Cambios de Código

| Archivo | Cambio |
|---------|--------|
| MonthCalendar.tsx (línea 290-313) | Reemplazar RPC directo + suma parcial comercial con `getDailyFinanceTotal()` |
| MonthCalendar.tsx (línea 346) | Suma de `grandTotal` en lugar de `total_sales` |
| Service nuevo o existente | Agregar función `getDailyFinanceTotal()` |

### Ventajas
✅ **Una sola fuente de verdad**  
✅ **Celda, header y tarjeta verde muestran lo mismo**  
✅ **Total del mes correcto**  
✅ **Zero SQL changes**  
✅ **Zero breaking changes**

---

## VERIFICACIÓN RÁPIDA: ¿Por qué $75 en vez de $750?

La suma en línea 313:
```typescript
const dateStr = item.payment_date.slice(0, 10);  // "2026-08-19"
commercialByDate[dateStr] += item.amount;
```

Agrupa breakdown del RANGO MENSUAL por fecha.

**Posible explicación**:
- De los $750 de Comercial en el mes, solo $75 tienen `payment_date = 2026-08-19`
- El resto cae en otros días del mes
- O hay discrepancia entre timezone del RPC (`America/Mexico_City`) vs `payment_date` (UTC)

**Para confirmar**: Ver breakdown completo de `getCommercialCollections(monthStart, monthEnd)` para agosto.

---

## CHECKLIST: QUÉ ESTÁ BIEN, QUÉ ESTÁ MAL

✅ **Está bien**:
- `loadDayDetail()` calcula correctamente
- Tarjeta verde muestra $1,155 correcto
- `dayDetail.grandTotal` fórmula es correcta
- Ticket count y promedio de Caja son correctos

❌ **Está mal**:
- RPC suma Caja + Pedidos sin diferenciar
- Comercial se suma parcialmente en calendario
- Celda del calendario muestra $675 (subestimado)
- Header del modal muestra $675 (subestimado)
- Total del mes está subestimado

---

## SIN CAMBIOS

❌ No se modificó código  
❌ No se ejecutó SQL  
❌ No se crearon commits  
❌ No se hizo push  

Esto es **DIAGNÓSTICO PURO**.

