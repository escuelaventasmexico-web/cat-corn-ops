# 🧪 TESTING CHECKLIST - CORRECCIÓN TIMEZONE PAGOS COMERCIALES

**Fecha**: 21 agosto 2026  
**Cambios**: Agrupación de pagos comerciales por fecha literal  
**Objetivo**: Validar que 19 agosto muestre $675 y 20 agosto muestre $815

---

## PRE-TESTING SETUP

1. **Abrir la aplicación**
   - Ir a: Finanzas → Calendario
   - Mes: Agosto 2026

2. **Estado inicial esperado**
   - Calendario cargado
   - Grid de 31 días visible
   - Algunos días con números verdes (ventas)

---

## TEST 1: DÍA 19 DE AGOSTO

### Test 1.1: Celda del Calendario
```
PASO: Observar celda del día 19
ESPERADO:
  - Número "19" visible
  - Debajo debe mostrar: $675
  - Color verde (hay ventas)
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.2: Hacer Clic en Día 19
```
PASO: Click en celda 19
ESPERADO:
  - Modal se abre
  - Header muestra fecha "miércoles, 19 de agosto de 2026"
  
RESULTADO: □ PASS  □ FAIL
```

### Test 1.3: Total en Header
```
PASO: Observar header del modal
ESPERADO:
  - "Total del día: $675"
  - Debajo: "3 tickets · Promedio $..."
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.4: Tarjeta Verde "Total del día"
```
PASO: Bajar en modal a tarjeta verde
ESPERADO:
  - Fondo verde oscuro con borde verde
  - Texto: "Total del día"
  - Valor: $675
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.5: Desglose de Ventas Caja
```
PASO: Observar tarjeta "Ventas Caja"
ESPERADO:
  - Icono de tienda
  - Título: "Ventas Caja"
  - Valor: $405 (en verde)
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.6: Desglose de Ventas Pedidos
```
PASO: Observar tarjeta "Ventas Pedidos"
ESPERADO:
  - Icono de carrito
  - Título: "Ventas Pedidos"
  - Valor: $0 (en violeta/gris)
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.7: Desglose de Socios Comerciales
```
PASO: Observar tarjeta "Ventas Socios Comerciales"
ESPERADO:
  - Icono de banco/landmark
  - Título: "Ventas Socios Comerciales"
  - Valor: $270 (en verde)
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto)
```

### Test 1.8: Validar Math
```
PASO: Verificar suma manual
CAJA ($405) + PEDIDOS ($0) + COMERCIAL ($270) = ?
ESPERADO: $675
RESULTADO: □ PASS  □ FAIL
```

---

## TEST 2: DÍA 20 DE AGOSTO

### Test 2.1: Cerrar Modal y Observar Celda 20
```
PASO: Click en X o fuera modal para cerrar
       Observar celda día 20
ESPERADO:
  - Celda 20 muestra: $815 (o diferente valor)
  - Si muestra $815: ✅ CORRECTO
  - Si muestra otro: ❌ REPORTAR
  
RESULTADO: □ PASS ($815)  □ FAIL (valor: $___)
```

### Test 2.2: Hacer Clic en Día 20
```
PASO: Click en celda 20
ESPERADO:
  - Modal se abre
  - Header muestra "jueves, 20 de agosto de 2026"
  
RESULTADO: □ PASS  □ FAIL
```

### Test 2.3: Total en Header Día 20
```
PASO: Observar header
ESPERADO:
  - "Total del día: $815"
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto: $___)
```

### Test 2.4: Tarjeta Verde Día 20
```
PASO: Observar tarjeta verde
ESPERADO:
  - "Total del día"
  - Valor: $815
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto: $___)
```

### Test 2.5: Caja Día 20
```
PASO: Observar tarjeta Caja
ESPERADO:
  - Valor: $335
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto: $___)
```

### Test 2.6: Pedidos Día 20
```
PASO: Observar tarjeta Pedidos
ESPERADO:
  - Valor: $0
  
RESULTADO: □ PASS  □ FAIL (reportar valor visto: $___)
```

### Test 2.7: Comercial Día 20
```
PASO: Observar tarjeta Comercial
ESPERADO:
  - Valor: $480 ← EL VALOR CRÍTICO, ahora recuperado
  
RESULTADO: □ PASS ($480)  □ FAIL (reportar valor: $___)
```

### Test 2.8: Validar Math Día 20
```
PASO: Verificar suma
CAJA ($335) + PEDIDOS ($0) + COMERCIAL ($480) = ?
ESPERADO: $815
RESULTADO: □ PASS  □ FAIL
```

---

## TEST 3: DETALLE DE PAGOS COMERCIALES DÍA 20

### Test 3.1: Clickear Tarjeta Comercial (si es clickeable)
```
PASO: Intentar hacer click en tarjeta "Ventas Socios Comerciales"
ESPERADO:
  - Si es clickeable: Abre modal con detalle de pagos
  - Si NO es clickeable: Está ok (modal no implementado en este fix)
  
RESULTADO: □ Modal abierto  □ No clickeable (OK)
```

### Test 3.2: Si se abrió modal - Ver pagos individuales
```
PASO: Observar lista de pagos (si modal se abrió)
ESPERADO:
  Tres pagos:
  - mini super el nuevo paraíso      $120
  - Mini super san pancho            $210
  - Aguas frescas                    $150
  
  TOTAL                              $480
  
RESULTADO: □ PASS  □ FAIL
```

### Test 3.3: Validar métodos de pago
```
PASO: Observar información de pagos (si aplica)
ESPERADO:
  - Métodos: Cash o Transfer según corresponda
  
RESULTADO: □ OK  □ No verificable
```

---

## TEST 4: NAVEGACIÓN Y COHERENCIA

### Test 4.1: Ver Días Anteriores
```
PASO: Click en otros días (17, 18, etc.)
ESPERADO:
  - Totales coherentes
  - No ven $480 en días incorrectos
  - Modal se abre normalmente
  
RESULTADO: □ PASS  □ FAIL (describir problema)
```

### Test 4.2: Ver Días Posteriores
```
PASO: Click en días 21-31
ESPERADO:
  - Valores normales
  - Ninguno muestra $480 incorrectamente
  
RESULTADO: □ PASS  □ FAIL
```

### Test 4.3: Total Mensual (si visible)
```
PASO: Buscar indicador de total del mes
ESPERADO:
  - Suma de todos los días coherente
  - Incluye correctamente $480 en día 20
  
RESULTADO: □ PASS  □ FAIL
```

### Test 4.4: Verificar Sin Duplicados
```
PASO: Navegar todo el mes
ESPERADO:
  - $480 aparece UNA SOLA VEZ
  - En el día 20
  - NO aparece en día 19
  
RESULTADO: □ PASS  □ FAIL
```

---

## RESUMEN DE RESULTADOS

### Críticos (DEBE SER ✅)
- [ ] Test 1.1: Día 19 celda muestra $675
- [ ] Test 1.4: Día 19 tarjeta verde muestra $675
- [ ] Test 1.7: Día 19 comercial muestra $270
- [ ] Test 2.1: Día 20 celda muestra $815
- [ ] Test 2.4: Día 20 tarjeta verde muestra $815
- [ ] Test 2.7: Día 20 comercial muestra $480

### Validación Math
- [ ] Test 1.8: 405 + 0 + 270 = 675 ✅
- [ ] Test 2.8: 335 + 0 + 480 = 815 ✅

### Coherencia
- [ ] Test 4.1: Otros días OK
- [ ] Test 4.3: Total mes OK
- [ ] Test 4.4: Sin duplicados

---

## ACCIÓN DESPUÉS DE TESTS

### SI TODOS LOS TESTS PASAN ✅
```bash
# En terminal
cd /Users/mariana/Downloads/cat-corn-ops

git add components/finance/MonthCalendar.tsx lib/dateUtils.ts

git commit -m "fix: corregir semántica de payment_date para cobos comerciales

- payment_date es fecha de negocio literal YYYY-MM-DD
- Cambiar agrupación de comercial a slice(0,10) sin timezone
- Usar rango UTC literal [date, date+1) para payment_date
- Mantener timezone Mexico para sales.created_at

Resultados:
- Día 19: $675 (405 caja + 270 comercial)
- Día 20: $815 (335 caja + 480 comercial) - $480 recuperados"

git push origin main
```

### SI ALGÚN TEST FALLA ❌
```
1. Reportar exactamente qué valor muestra vs esperado
2. Incluir screenshot si es posible
3. NO hacer commit
4. Indicar qué tests específicos fallaron

Ejemplos de reporte:
- "Test 1.1: Día 19 muestra $400 en lugar de $675"
- "Test 2.7: Día 20 comercial muestra $300 en lugar de $480"
```

---

## NOTAS TÉCNICAS

- La corrección cambia cómo se agrupa `payment_date` (fecha de negocio)
- `sales.created_at` (instante real) sigue sin cambios
- Rango UTC para `payment_date`: [YYYY-MM-DDT00:00Z, YYYY-MM-DD+1T00:00Z)
- Rango México para `sales.created_at`: Convierte a America/Mexico_City

---

**Comenzar testing cuando esté listo. ¡Gracias!**
