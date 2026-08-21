# 🧪 INSTRUCCIONES DE TESTING - REGRESIÓN COMERCIAL

## ANTES DE TESTEAR

1. **Build verificado**:
   ```bash
   npm run build
   # ✅ 0 TypeScript errors
   ```

2. **Dev tools listos**:
   - Abrir Chrome/Firefox DevTools
   - Console tab visible
   - Network throttling: None (velocidad normal)

3. **Datos de test confirmados**:
   - 19 agosto 2026: $405 caja + $270 comercial = $675 esperado
   - 20 agosto 2026: $335 caja + $480 comercial = $815 esperado

---

## PRUEBA 1: Celda del Calendario

### Caso 1: 19 Agosto

**Pasos**:
1. Finanzas → Calendario
2. Seleccionar mes agosto 2026
3. Localizar celda día 19
4. **VERIFICAR**: Número mostrado en celda

**Esperado**:
```
Celda 19: $675 ✅ (no $405)
Detalles visibles:
- Número grande: 19
- Texto verde debajo: $675 (o $0.7k)
- Color de fondo: Verde (hay ventas)
```

**Si FALLA**:
```
Celda 19: $405 ❌
→ Abrir Dev Tools → Console
→ Buscar logs: [MonthCalendar] Commercial collections loaded
  ├─ Si NO aparece: No se cargó comercial
  ├─ Si total=0: Rango monthStart/monthEnd fallido
  └─ Si total=750: El problema es otro
```

### Caso 2: 20 Agosto

**Pasos**:
1. En mismo calendario, localizar celda día 20
2. **VERIFICAR**: Número mostrado en celda

**Esperado**:
```
Celda 20: $815 ✅ (no $335)
```

**Si FALLA**: Investigar console logs igual que Caso 1

---

## PRUEBA 2: Header del Modal

### Caso 1: Click en Celda 19

**Pasos**:
1. Click en celda 19
2. Se abre modal con detalles del día
3. **VERIFICAR**: Texto "Total del día" en header

**Esperado**:
```
jueves, 19 de agosto de 2026

Total del día: $675 ✅
·4 tickets · Promedio $101.25
```

**Si FALLA**:
```
Total del día: $405 ❌
→ Este valor viene de selectedDay.total_sales
→ selectedDay proviene de calendarDays[index]
→ La suma de comercial no se está haciendo en MonthCalendar.tsx
```

### Caso 2: Click en Celda 20

**Pasos**:
1. Cerrar modal anterior (click X)
2. Click en celda 20
3. **VERIFICAR**: Texto "Total del día" en header

**Esperado**:
```
viernes, 20 de agosto de 2026

Total del día: $815 ✅
·??? tickets · Promedio $???
```

---

## PRUEBA 3: Tarjeta Verde (Grand Total)

### Pasos (Continuando con modal abierto, día 19)

1. En el modal del día 19, localizar tarjeta verde grande
2. **VERIFICAR**: Número en tarjeta verde

**Esperado**:
```
┌─────────────────────────────┐
│ Total del día               │
│                             │
│       $675 ✅              │
│  (texto verde, fuente grande)
└─────────────────────────────┘
```

**Nota**: Esta tarjeta usa `dayDetail.grandTotal` (calculado independientemente)
- Debe coincidir con header ($675) ✅

**Si NO coincide** (ej: header $675 pero tarjeta $815):
```
→ dayDetail.grandTotal no incluye comercial correctamente
→ Revisar línea 275-277 de MonthCalendar.tsx (loadDayDetail)
```

### Pasos (Ahora con día 20)

1. Cerrar modal día 19
2. Click en celda 20
3. **VERIFICAR**: Tarjeta verde

**Esperado**:
```
Total del día: $815 ✅
```

---

## PRUEBA 4: Desglose (Tarjetas de Abajo)

### Pasos (Modal día 19 abierto)

1. Scroll down en modal
2. Localizar secciones:
   - "Ventas Caja"
   - "Ventas Pedidos"
   - "Ventas Socios Comerciales"

**Esperado**:
```
Ventas Caja:                $405 ✅
  - Efectivo: $300
  - Tarjeta: $105

Ventas Pedidos:             $0 ✅
  (Sin compras de ordenes)

Ventas Socios Comerciales:  $270 ✅
  (Desglose clickeable)
```

**Total**: $405 + $0 + $270 = $675 ✅

### Pasos (Modal día 20)

1. Cerrar modal 19, click en celda 20
2. Scroll down, verificar desglose

**Esperado**:
```
Ventas Caja:                $335 ✅

Ventas Pedidos:             $0 ✅

Ventas Socios Comerciales:  $480 ✅
  (Desglose clickeable)

Total: $335 + $0 + $480 = $815 ✅
```

---

## PRUEBA 5: Modal de Socios Comerciales (Enriquecido)

### Pasos (Día 19, tarjeta comercial visible)

1. En modal día 19, bajar a "Ventas Socios Comerciales"
2. Localizar tarjeta con $270 de comercial
3. **VERIFICAR**: Click en tarjeta (debe ser clickeable)

**Esperado**:
```
Se abre modal "Desglose de Socios Comerciales"
Encabezado: "jueves, 19 de agosto de 2026"
MAYOREO $270.00

[Tarjeta 1]
  Mini super el nuevo paraíso
  GA-130826-001
  $120.00
  20/08/2026 ✅ (CORRECTO, no 19/08)
  [ChevronDown]

[Tarjeta 2]
  Mini super san pancho
  GA-150826-002
  $75.00
  ...

[Tarjeta 3]
  Aguas frescas
  (o solo si tiene en 19)
  $???.00

Total verificado: $270.00
```

**Si FALLA**: 
```
Modal NO abre / error al hacer click
→ Problema en CommercialCollectionsDetailModal
→ Revisar console errors
```

### Pasos (Día 20, tarjeta comercial)

1. Cerrar modal comercial 19
2. Abrir modal día 20
3. Click en tarjeta comercial $480

**Esperado**:
```
Desglose de Socios Comerciales
viernes, 20 de agosto de 2026

MAYOREO $480.00

[Tarjeta 1] Mini super el nuevo paraíso - $120 ✅
[Tarjeta 2] Mini super san pancho - $210 ✅
[Tarjeta 3] Aguas frescas - $150 ✅

Total verificado: $480.00
```

### Prueba: Expandir Cards

1. Click en [Tarjeta 1] (Mini super el nuevo paraíso)
2. Tarjeta se expande
3. **VERIFICAR**: Contenido expandido

**Esperado**:
```
Mini super el nuevo paraíso
GA-130826-001

COBRADO
$120.00

Fecha: 20/08/2026 ✅ (Correcto, no 19/08)
Método: Efectivo

Liquidación:
Michi · Clásico: 2 × $30 = $60
Michi · Sabores: 2 × $30 = $60

[ChevronUp para colapsar]
```

**Notas**:
- Fecha debe ser 20/08/2026, NO 19/08/2026
- Si muestra 19/08: timezone conversion bug aún presente
- Productos deben estar visibles

---

## PRUEBA 6: Total del Mes

### Pasos

1. En calendario (modal cerrado)
2. Localizar encabezado superior izquierda
3. Buscar texto "Total mes:"

**Esperado**:
```
Total mes: $17,xxx.xx ✅ (incluye comercial)
```

**Antes era**: $16,538.50 (sin comercial)
**Diferencia**: +Commercial Agosto = +$750 (aproximado)
**Nueva cifra**: ~$17,288.50

**Si muestra**: $16,538.50 ❌
```
→ monthTotal no incluye comercial
→ Revisar línea 391 MonthCalendar.tsx
→ monthTotal = days.reduce((s, d) => s + d.total_sales, 0)
```

---

## PRUEBA 7: Console Logs

### Pasos

1. Abrir DevTools (F12)
2. Console tab
3. En calendario, hacer refresh o click en celda
4. **VERIFICAR**: Logs aparezcan

**Esperado en Console**:
```
[MonthCalendar] Commercial collections loaded: {
  total: 750,
  itemCount: 3,
  byDateSummary: [
    ['2026-08-19', 270],
    ['2026-08-20', 480],
  ]
}
```

**Si NO aparece**:
```
→ getCommercialCollections() falló silenciosamente
→ Buscar warnings/errors
```

**Si dice error**:
```
[MonthCalendar] Commercial data error: (mensaje)
→ Hay problema en getCommercialCollections()
→ NO es regresión de boundary, es otra cosa
```

**Si dice reconciliation mismatch**:
```
[MonthCalendar] Commercial reconciliation mismatch: {
  calculatedFromByDate: 750,
  reportedByService: 748,
  difference: 2
}
→ Hay pequeña diferencia (puede ser rounding)
→ Revisar con usuario
```

---

## PRUEBA 8: Métodos de Pago

### Pasos

1. Modal día 20, desglose comercial
2. Expandir cada tarjeta
3. **VERIFICAR**: Campo "Método:"

**Esperado**:
```
Tarjeta 1: Método: Efectivo ✅
Tarjeta 2: Método: Efectivo ✅
Tarjeta 3: Método: Efectivo ✅ (o Transferencia según BD)
```

**No deben ser**:
```
Tarjeta 1: Método: [vacío] ❌
Tarjeta 2: Método: null ❌
Tarjeta 3: Método: [método incorrecto] ❌
```

---

## PRUEBA 9: Tickets y Promedio

### Pasos

1. Modal día 19, header
2. **VERIFICAR**: Número de tickets

**Esperado**:
```
Total del día: $675
·4 tickets · Promedio $101.25 ✅
```

**Explicación**:
- 4 tickets = solo Caja (no comercial)
- Promedio = $405 (caja) ÷ 4 = $101.25
- Comercial ($270) NO se cuenta como tickets

**Si muestra**:
```
·15 tickets · Promedio $45
❌ Significaría que comercial se está contando como ticket
```

---

## RESUMEN DE VALIDACIONES

| # | Prueba | Esperado | Resultado |
|----|--------|----------|-----------|
| 1 | Celda 19 | $675 | ☐ PASS ☐ FAIL |
| 2 | Celda 20 | $815 | ☐ PASS ☐ FAIL |
| 3 | Header 19 | $675 | ☐ PASS ☐ FAIL |
| 4 | Header 20 | $815 | ☐ PASS ☐ FAIL |
| 5 | Tarjeta verde 19 | $675 | ☐ PASS ☐ FAIL |
| 6 | Tarjeta verde 20 | $815 | ☐ PASS ☐ FAIL |
| 7 | Desglose 19 | $405+$270 | ☐ PASS ☐ FAIL |
| 8 | Desglose 20 | $335+$480 | ☐ PASS ☐ FAIL |
| 9 | Modal comercial | Clickeable | ☐ PASS ☐ FAIL |
| 10 | Expandir card | Productos visibles | ☐ PASS ☐ FAIL |
| 11 | Fecha en card | 20/08/2026 | ☐ PASS ☐ FAIL |
| 12 | Total mes | ~$17,xxx | ☐ PASS ☐ FAIL |
| 13 | Console logs | Commercial loaded | ☐ PASS ☐ FAIL |
| 14 | Métodos pago | Efectivo/Transfer | ☐ PASS ☐ FAIL |
| 15 | Tickets | 4 tickets | ☐ PASS ☐ FAIL |

---

## SI ALGUNA PRUEBA FALLA

1. **Reportar**: ¿Qué número de prueba falló?
2. **Screenshot**: Captura de pantalla del estado
3. **Console**: Copiar logs/errors de DevTools
4. **Paso exacto**: En qué línea de instrucciones falló

**Ejemplo**:
```
Prueba 1 FAIL: Celda 19 muestra $405 en lugar de $675
Screenshot: [imagen]
Console error: [pegado]
```

---

## SI TODAS LAS PRUEBAS PASAN

```bash
git add .
git commit -m "fix: restaurar cobros de socios comerciales en calendario"
git push origin main
```

**DONE** ✅

---

**Documentación**: Completa
**Testing**: Listo
**Esperando**: Validación visual del usuario

