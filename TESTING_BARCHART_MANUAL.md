# 🧪 Testing Manual - BarChart en Desglose Financiero

## Preparación

```bash
# 1. Verificar que el código compila (sin errores TypeScript)
cd /Users/mariana/Downloads/cat-corn-ops
npx tsc --noEmit --skipLibCheck

# Esperado: Sin output (0 errores)
```

---

## 🎯 Test Cases

### Test 1: Visual Rendering Básico

**Paso 1**: Abrir la app en navegador
```bash
npm run dev
# O si está corriendo: http://localhost:5173
```

**Paso 2**: Navegar a "Historial de Ventas"

**Paso 3**: Verificar sección "Desglose Financiero - Todos los Orígenes"

**Esperado**: 
- ✅ Aparece un gráfico de **barras** (no pastel/circular)
- ✅ Barras tienen **colores diferentes** (verde, azul, naranja, cian, violeta, etc.)
- ✅ Eje X muestra **nombres de categorías** (Caja Efectivo, Caja Tarjeta, ...)
- ✅ Eje Y muestra **montos en formato $k** ($0k, $10k, $20k, ...)
- ✅ Las **4 tarjetas de stats** (Caja, Pedidos, Delivery, Socios) están intactas a la derecha

**Fallo**: Si ves pastel, error de compilación, o stats desaparecieron

---

### Test 2: Tooltip Interactivo

**Paso 1**: Con la app abierta en Historial de Ventas

**Paso 2**: Pasar el mouse sobre UNA de las barras

**Esperado**:
- ✅ Aparece un **tooltip** (caja emergente) al pasar mouse
- ✅ Tooltip muestra:
  - Nombre de categoría (ej: "Caja Efectivo")
  - Monto en formato: `$X,XXX.XX` (ej: "$5,234.50")
- ✅ Tooltip tiene fondo oscuro (#2A2A2A) y texto claro
- ✅ Tooltip desaparece al alejar mouse

**Fallo**: Si tooltip no aparece, o muestra formato incorrecto

---

### Test 3: Filtros Funcionales

**Paso 1**: Observar gráfico actual con todos los datos

**Paso 2**: Hacer click en botón **"Hoy"** (filtro rápido)

**Esperado**:
- ✅ Las barras **cambian de altura** (se actualizan)
- ✅ Stats panels también se actualizan
- ✅ Total General Histórico se ajusta
- ✅ Los datos son menores (solo transacciones de hoy)

**Paso 3**: Hacer click en botón **"Últimos 7 días"**

**Esperado**:
- ✅ Las barras vuelven a cambiar (mayor altura, más datos)
- ✅ Stats panels actualizados
- ✅ Datos mayor que "Hoy" pero menor que sin filtro

**Paso 4**: Hacer click en botón **"Este mes"**

**Esperado**:
- ✅ Barras actualizadas nuevamente
- ✅ Stats y totales consistentes

**Paso 5**: Hacer click en botón **"Limpiar"**

**Esperado**:
- ✅ Gráfico vuelve a mostrar **TODOS LOS DATOS** (sin filtro)
- ✅ Barras vuelven a su tamaño original

**Fallo**: Si los datos no cambian al filtrar, o totales no coinciden

---

### Test 4: Rango Personalizado

**Paso 1**: Hacer click en campo de fecha "Desde"

**Paso 2**: Seleccionar una fecha (ej: 2024-12-01)

**Paso 3**: Hacer click en campo de fecha "Hasta"

**Paso 4**: Seleccionar una fecha posterior (ej: 2024-12-15)

**Esperado**:
- ✅ El gráfico se actualiza solo para ese rango
- ✅ Stats panels muestran datos del período seleccionado
- ✅ Las barras reflejan solo transacciones en ese rango

**Fallo**: Si las fechas no aplican filtro, o datos inconsistentes

---

### Test 5: Responsiveness - Desktop

**Paso 1**: Abrir app en navegador desktop (1920x1080)

**Esperado**:
- ✅ Gráfico de barras visible a la izquierda
- ✅ Stats panels a la derecha (layout 2 columnas: lg:grid-cols-2)
- ✅ Nombres en XAxis legibles (rotados -45°)
- ✅ Etiquetas no se superponen
- ✅ Todo el contenido visible sin scroll horizontal

**Fallo**: Si hay overflow horizontal, nombres superpuestos, o layout roto

---

### Test 6: Responsiveness - Tablet

**Paso 1**: Abrir DevTools (F12)

**Paso 2**: Activar device emulation (Ctrl+Shift+M)

**Paso 3**: Seleccionar tamaño "iPad" (~768px)

**Esperado**:
- ✅ Layout cambia a 1 columna (grid-cols-1)
- ✅ Gráfico completo visible
- ✅ Stats panels debajo del gráfico
- ✅ No hay scroll horizontal innecesario
- ✅ Tamaño de texto legible

**Fallo**: Si hay scroll horizontal, texto muy pequeño, o elementos cortados

---

### Test 7: Responsiveness - Mobile

**Paso 1**: DevTools abierto

**Paso 2**: Seleccionar tamaño "iPhone 12" (~390px)

**Esperado**:
- ✅ Layout sigue siendo 1 columna
- ✅ Gráfico visible completo (puede requerir pequeño scroll)
- ✅ XAxis labels: pueden estar más comprimidas pero legibles
- ✅ Stats panels debajo, apilados
- ✅ No hay cortes de contenido

**Fallo**: Si texto invisible, barras cortadas, o muy pequeñas

---

### Test 8: Datos Consistency

**Paso 1**: Mirar el valor de UNA barra (ej: Caja Efectivo)

**Paso 2**: Mirar el stat panel correspondiente en la derecha

**Esperado**:
- ✅ El valor en la barra = suma del panel (Efectivo)
- ✅ Tooltip de la barra = valor del panel

**Paso 3**: Verificar "Total General Histórico"

**Esperado**:
- ✅ Suma de todas las barras ≈ Total General Histórico
  (puede haber pequeña diferencia por redondeo, pero no significativa)

**Fallo**: Si hay discrepancias grandes entre barra y panel

---

### Test 9: Empty State

**Paso 1**: Seleccionar un rango de fechas sin transacciones (ej: enero 2020)

**Esperado**:
- ✅ El gráfico muestra mensaje: **"Sin datos para mostrar"**
- ✅ Stats panels muestran $0.00 o desaparecen
- ✅ Sin errores en consola

**Fallo**: Si hay error en consola, o gráfico se rompe

---

### Test 10: Color Accuracy

**Paso 1**: Observar las 7 barras (si hay datos de todas)

**Paso 2**: Verificar que cada barra tiene el color correcto

**Esperado**:
- ✅ Caja Efectivo: **Verde** (#4CAF50)
- ✅ Caja Tarjeta: **Azul** (#2196F3)
- ✅ Pedidos Efectivo: **Naranja claro** (#F59E0B)
- ✅ Pedidos Tarjeta: **Cian** (#06B6D4)
- ✅ Pedidos Transf.: **Violeta** (#8B5CF6)
- ✅ Delivery: **Naranja oscuro** (#FF6900)
- ✅ Socios Comerciales: **Rosa** (#EC4899)

**Fallo**: Si colores no coinciden, o hay barras grises/monócromas

---

### Test 11: Exports a CSV

**Paso 1**: Con un rango de datos activo, hacer click en botón "Exportar CSV"

**Esperado**:
- ✅ Descarga un archivo CSV
- ✅ CSV incluye columnas: Origen, Fecha, Folio, Descripción, Método de Pago, Monto, Estado
- ✅ Valores en CSV coinciden con gráfico/stats

**Fallo**: Si no descarga, o datos no coinciden

---

### Test 12: Console Errors

**Paso 1**: Abrir DevTools → Console

**Paso 2**: Navegar a Historial de Ventas

**Paso 3**: Interactuar: filtrar, hover, scroll

**Esperado**:
- ✅ **CERO errores** en consola (rojo)
- ✅ Warnings son OK (amarillo), pero preferentemente cero
- ✅ Logs informativos (azul) sin problemas

**Fallo**: Si hay errores rojos ("Cannot read property", "is not a function", etc.)

---

## 📋 Checklist de Validación Final

| Test | Resultado | Notas |
|------|-----------|-------|
| 1. Visual básico | ✅/❌ | Gráfico de barras visible |
| 2. Tooltip | ✅/❌ | Aparece con formato $X.XX |
| 3. Filtro "Hoy" | ✅/❌ | Datos se actualizan |
| 4. Filtro "Últimos 7" | ✅/❌ | Datos se actualizan |
| 5. Filtro "Este mes" | ✅/❌ | Datos se actualizan |
| 6. Limpiar filtro | ✅/❌ | Vuelve a datos completos |
| 7. Rango personalizado | ✅/❌ | Filtro funciona |
| 8. Desktop (1920px) | ✅/❌ | Layout 2 cols, legible |
| 9. Tablet (768px) | ✅/❌ | Layout 1 col, legible |
| 10. Mobile (390px) | ✅/❌ | Responsive, sin cortes |
| 11. Data consistency | ✅/❌ | Barras = Panels = CSV |
| 12. Empty state | ✅/❌ | Mensaje "Sin datos" |
| 13. Colors | ✅/❌ | 7 colores correctos |
| 14. Export CSV | ✅/❌ | Descarga correcta |
| 15. Console | ✅/❌ | 0 errores |

---

## 🚨 Problemas Conocidos y Soluciones

### Problema: Tooltip no aparece
**Causa**: Recharts necesita espacio suficiente
**Solución**: Aumentar margin.bottom en BarChart (está en 100px, debería ser suficiente)

### Problema: XAxis labels superpuestos
**Causa**: Demasiadas categorías o pantalla muy pequeña
**Solución**: Ya configurado con angle -45° y height 120px

### Problema: Barras de altura 0
**Causa**: Probablemente sin datos para esa categoría
**Solución**: Verificar que paymentChartData.filter() solo incluya items con value > 0

### Problema: Números en YAxis mal formateados
**Causa**: El formatter de YAxis no se aplica
**Solución**: Verificar que está correctamente: `tickFormatter={(value) => \`$${(value/1000).toFixed(0)}k\`}`

### Problema: Stats panels desaparecieron
**Causa**: Posible error en JSX por cambios anteriores
**Solución**: Verificar que las líneas de stats (después de línea 720) no fueron modificadas

---

## ✅ Aprobación

Una vez que **todos los tests pasen**, el cambio es válido para:

```bash
git commit -m "feat: cambiar gráfico de pastel a barras en desglose financiero"
git push origin main
```

---

**Responsable de Testing**: Usuario/QA  
**Fecha de Testing Recomendada**: Inmediatamente después de implementación  
**Tiempo Estimado**: 15-20 minutos  
**Dispositivos Testeados**: Desktop, Tablet, Mobile
