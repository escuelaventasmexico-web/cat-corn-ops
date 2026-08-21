# MANUAL TESTING CHECKLIST: Timezone Fix para Calendar de Finanzas

## Información del Fix
- **Fecha de Implementación**: 21 agosto 2026
- **Módulo**: Finanzas → Calendar
- **Problema Corregido**: Desalineación UTC vs America/Mexico_City en agrupación de pagos comerciales
- **Datos de Prueba**: 17, 18, 19 agosto 2026

---

## PRE-TEST SETUP

1. ✅ npm run build debe pasar sin errores TypeScript
2. ✅ Cambios confirmados en archivos:
   - `lib/dateUtils.ts` (+2 nuevos helpers)
   - `components/finance/MonthCalendar.tsx` (líneas 127, 314)
   - `services/commercialCollectionsService.ts` (líneas 90, 125, 174: .lte → .lt)

---

## TEST 1: Abrir Calendar y Navegar a Agosto 2026

**Pasos**:
1. Ir a `Finanzas` → `Calendar`
2. Navegar al mes de Agosto 2026
3. Esperar a que cargue

**Verificar**:
- [ ] Calendar se carga sin errores
- [ ] Agosto 2026 muestra los días correctamente
- [ ] No hay console errors

---

## TEST 2: Verificar Día 19 de Agosto

**Pasos**:
1. Buscar la celda del día 19 en el calendar
2. Observar el valor mostrado en la celda

**Resultado Esperado**:
| Concepto | Antes | Después | Estado |
|----------|-------|---------|--------|
| Celda (19 ago) | $675 ❌ | $885 ✅ | PASS/FAIL |

**Verificar**:
- [ ] Celda muestra `19` como número de día
- [ ] Celda muestra `$885` debajo del día
- [ ] Color de intensidad refleja $885 (no $675)

---

## TEST 3: Abrir Modal del Día 19

**Pasos**:
1. Hacer click en la celda del día 19
2. El modal debe abrirse

**Resultado Esperado - Header del Modal**:
```
miércoles, 19 de agosto de 2026

Total del día: $885 ✅
4 tickets
Promedio $101.25
```

| Campo | Antes | Después | Valor Esperado |
|-------|-------|---------|---|
| Fecha | "19 de agosto" | "19 de agosto" | ✅ |
| Total Header | $675 ❌ | $885 ✅ | $885 |
| Ticket Count | 4 | 4 | 4 |
| Avg Ticket | $101.25 | $101.25 | $101.25 |

**Verificar**:
- [ ] Header muestra la fecha correcta
- [ ] Total del día = $885
- [ ] Tickets = 4
- [ ] Promedio = $101.25 (= $405 Caja / 4 tickets)

---

## TEST 4: Verificar Tarjeta Verde (Grand Total)

**Ubicación**: Dentro del modal, sección superior (barra verde)

**Pasos**:
1. En modal abierto, buscar la sección "Total del día" con fondo verde
2. Observar el número

**Resultado Esperado**:
```
┌─────────────────────────────┐
│ Total del día               │
│        $885 ✅              │
└─────────────────────────────┘
```

| Concepto | Antes | Después | Esperado |
|----------|-------|---------|----------|
| Grand Total | $1,155 ❌ | $885 ✅ | $885 |

**Verificar**:
- [ ] Tarjeta verde muestra $885
- [ ] NO muestra $1,155
- [ ] NO muestra $675

---

## TEST 5: Verificar Desglose de Canales

**Ubicación**: Grid de 2 columnas debajo de "Total del día"

**Pasos**:
1. Scroll down en modal
2. Observar 4 tarjetas: Caja, Pedidos, Comercial, Delivery

**Resultado Esperado**:

```
┌──────────────────┐ ┌──────────────────┐
│ Ventas Caja      │ │ Ventas Pedidos   │
│ $405             │ │ $0               │
└──────────────────┘ └──────────────────┘

┌──────────────────┐ ┌──────────────────┐
│ Ventas Delivery  │ │ Socios Comercial │
│ $0               │ │ $480             │
└──────────────────┘ └──────────────────┘
```

| Canal | Antes | Después | Esperado | Breakdown |
|-------|-------|---------|----------|-----------|
| Caja | $405 ✅ | $405 ✅ | $405 | 4 transacciones |
| Pedidos | $0 ✅ | $0 ✅ | $0 | 0 transacciones |
| Delivery | $0 ✅ | $0 ✅ | $0 | 0 transacciones |
| Comercial | $750 ❌ | $480 ✅ | $480 | Solo pagos UTC 2026-08-20 |

**Verificar**:
- [ ] Caja = $405
- [ ] Pedidos = $0
- [ ] Delivery = $0
- [ ] **Comercial = $480** (CRÍTICO - antes era $750 del mes completo)

---

## TEST 6: Comercial Detail Modal

**Pasos**:
1. En modal del día 19, hacer click en tarjeta de "Socios Comerciales"
2. Debería abrirse CommercialCollectionsDetailModal
3. Observar el breakdown y total

**Resultado Esperado**:
```
Ventas Socios Comerciales
Total cobrado: $480

Breakdown (solo cobros UTC 2026-08-20):
- Comodato: $480
- Mayoreo: $0
- Venta Pieza: $0
```

| Campo | Antes | Después | Esperado |
|-------|-------|---------|----------|
| Total cobrado | $750 ❌ | $480 ✅ | $480 |
| Detalles | Todos los pagos del mes | Solo del 19 agosto | $480 comodato |

**Verificar**:
- [ ] Total cobrado = $480
- [ ] Lista de items muestra solo pagos para el 19 (UTC 2026-08-20)
- [ ] NO muestra pagos de otros días del mes

---

## TEST 7: Verificar Día 17 de Agosto

**Pasos**:
1. Cerrar modal del 19
2. Abrir modal del día 17

**Dato de Prueba**: UTC 2026-08-18 → Business date 2026-08-17, $120 comodato

**Resultado Esperado**:
```
miércoles, 17 de agosto de 2026
Total del día: Sales_17 + $120

Comercial: $120 (no $270, no $480)
```

| Campo | Valor Esperado |
|-------|---|
| Total Header | Sales + $120 |
| Comercial Total | $120 |
| Breakdown | Solo $120 comodato (UTC 18 ago) |

**Verificar**:
- [ ] Modal abre sin errores
- [ ] Comercial = $120
- [ ] NO incluye $270 ni $480

---

## TEST 8: Verificar Día 18 de Agosto

**Pasos**:
1. Cerrar modal del 17
2. Abrir modal del día 18

**Dato de Prueba**: UTC 2026-08-19 → Business date 2026-08-18, $270 comodato

**Resultado Esperado**:
```
miércoles, 18 de agosto de 2026
Total del día: Sales_18 + $270

Comercial: $270 (no $120, no $480)
```

| Campo | Valor Esperado |
|-------|---|
| Total Header | Sales + $270 |
| Comercial Total | $270 |
| Breakdown | Solo $270 comodato (UTC 19 ago) |

**Verificar**:
- [ ] Modal abre sin errores
- [ ] Comercial = $270
- [ ] NO incluye $120 ni $480

---

## TEST 9: Total Mensual (Agosto 2026)

**Ubicación**: Header o footer del calendar (sección de resumen mensual)

**Pasos**:
1. Buscar "Total del mes" o similar
2. Observar el número

**Resultado Esperado**:
- ANTES: Total subestimado por agrupación incorrecta
- DESPUÉS: Suma correcta de todos los días con rangos correctos

| Métrica | Cambio |
|---------|--------|
| Total Mes | Aumentó porque cada día ahora suma comercial correctamente |
| YoY | No afectado (comparación contra año anterior) |

**Verificar**:
- [ ] Total mensual > Total anterior (porque ahora suma comercial correctamente)
- [ ] Total = SUM(days.total_sales) donde cada día usa rangos correctos

---

## TEST 10: Otros Meses (Quick Check)

**Pasos**:
1. Navegar a otro mes (ej: Septiembre 2026 o Julio 2026)
2. Abrir un día con cobros comerciales
3. Verificar que la agrupación es correcta

**Verificar**:
- [ ] Otros meses funcionan sin problemas
- [ ] Comercial se agrupa correctamente
- [ ] NO hay "payment_date.slice(0,10)" en console logs

---

## TEST 11: Console Errors

**Pasos**:
1. Abrir DevTools (F12)
2. Console tab
3. Navegar por calendar y abrir varios modales

**Verificar**:
- [ ] NO hay errores de "getBusinessDateFromUtcTimestamp not defined"
- [ ] NO hay errores de "getBusinessDayUtcRange not defined"
- [ ] NO hay errores de timezone conversion
- [ ] NO hay NaN o undefined en cálculos

---

## TEST 12: Build and Deployment

**Pasos**:
1. Ejecutar `npm run build`
2. Verificar output

**Verificar**:
- [ ] Build completa sin errores (✓ 0 TypeScript errors)
- [ ] Dist folder generado correctamente
- [ ] Gzip size dentro de límites (~715 KB)

---

## RESUMEN DE VALIDACIÓN

### Checklist de Aprobación
- [ ] Test 1: Calendar abre sin errores
- [ ] Test 2: Celda 19 muestra $885 (no $675)
- [ ] Test 3: Header 19 muestra $885 (no $675)
- [ ] Test 4: Tarjeta verde muestra $885 (no $1,155)
- [ ] Test 5: Comercial = $480 (no $750)
- [ ] Test 6: Commercial detail modal muestra $480
- [ ] Test 7: Día 17 muestra $120 comercial
- [ ] Test 8: Día 18 muestra $270 comercial
- [ ] Test 9: Total mensual es suma correcta
- [ ] Test 10: Otros meses funcionan
- [ ] Test 11: NO hay console errors
- [ ] Test 12: Build éxito

### Status Final
- ✅ **APROBADO** si todos los checks pasan
- ❌ **FALLO** si algún check no pasa (reportar en línea correspondiente)

---

## ROLLBACK PROCEDURE (If Needed)

Si algún test falla:

1. Revert commits
2. Restaurar archivos:
   ```bash
   git checkout lib/dateUtils.ts
   git checkout components/finance/MonthCalendar.tsx
   git checkout services/commercialCollectionsService.ts
   ```
3. Ejecutar `npm run build` para confirmar
4. Reportar en Discord / Slack

---

**FIN DEL TESTING CHECKLIST**

Tester: _________________ Fecha: _________________ Hora: _________________

Firma: ________________________________________________________________________
