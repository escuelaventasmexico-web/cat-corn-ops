# 🧪 Guía de Testing: Resumen Comercial B2B

## Pre-requisitos
- ✅ Aplicación compilada sin errores (`npm run build`)
- ✅ Acceso a la página de Socios Comerciales
- ✅ Socio con datos en comodato y/o mayoreo

## Escenarios de Testing

### Escenario 1: Validación de Carga Inicial ⏱️

**Pasos**:
1. Abrir Socios Comerciales
2. Buscar socio **CP-010726-001**
3. Click en el socio para abrir detalle
4. Verificar:
   - ✅ Drawer se abre desde la derecha
   - ✅ Información del socio visible (folio, nombre, responsable, status)
   - ✅ Pestaña "Resumen" está activa por defecto

**Resultado esperado**:
- El detalle carga sin errores
- Se ve la pestaña Resumen con Identificación, Contacto, etc.

---

### Escenario 2: Visualización de Sección B2B 🎯

**Pasos**:
1. En el detalle del socio, pestaña Resumen
2. Scroll down dentro del drawer
3. Verificar sección "Resumen comercial" aparece después de Contacto

**Resultado esperado**:
- ✅ Sección visible con título "RESUMEN COMERCIAL"
- ✅ Está entre Contacto y (Operación/Notas)
- ✅ No oculta otras secciones

---

### Escenario 3: Tarjeta "Total general B2B" 💰

**Pasos**:
1. Verificar tarjeta con título "Total general B2B"
2. Validar 3 campos:
   - "Total generado/comprado" con icono ↗
   - "Total cobrado/pagado" con icono ↘
   - "Saldo pendiente total" con icono ⚖

**Para CP-010726-001 (esperado)**:
```
Total generado/comprado: $160.00 (comodato) + $X.XX (mayoreo) = Total
Total cobrado/pagado: $0.00 (comodato) + $X.XX (mayoreo) = Total
Saldo pendiente total: $160.00 (comodato) + $X.XX (mayoreo) = Total
```

**Resultado esperado**:
- ✅ Valores en formato "$XXX.XX"
- ✅ Íconos visibles
- ✅ Si saldo > 0: alerta roja + "⚠️ Saldo pendiente"
- ✅ Si saldo = 0: texto en verde

---

### Escenario 4: Tarjeta "Comodato" 📦

**Solo si el socio tiene datos de comodato**

**Pasos**:
1. Verificar tarjeta con título "Comodato"
2. Validar 4 campos:
   - "Generado por comodato"
   - "Cobrado en comodato"
   - "Saldo pendiente comodato"
   - "Unidades en posesión"

**Para CP-010726-001 (esperado)**:
```
Generado por comodato: $160.00
Cobrado en comodato: $0.00
Saldo pendiente comodato: $160.00
Unidades en posesión: 5 uds
```

**Resultado esperado**:
- ✅ Valores coinciden con BD
- ✅ "Generado" (no "Comprado")
- ✅ Unidades en formato "N uds"

---

### Escenario 5: Tarjeta "Mayoreo" 🛍️

**Solo si el socio tiene datos de mayoreo**

**Pasos**:
1. Verificar tarjeta con título "Mayoreo"
2. Validar 6 campos:
   - "Comprado en mayoreo"
   - "Pagado en mayoreo"
   - "Saldo pendiente mayoreo"
   - "Piezas compradas"
   - "Compras realizadas"
   - "Última compra"

**Resultado esperado**:
- ✅ Valores en formato "$XXX.XX" (excepto piezas)
- ✅ "Piezas compradas" en formato "N piezas"
- ✅ "Compras realizadas" en número entero
- ✅ "Última compra" en formato "DD MMM YYYY"

---

### Escenario 6: Formateo de Moneda 💵

**Pasos**:
1. En cualquier tarjeta, verificar valores monetarios
2. Casos especiales:
   - Valor 0: debe mostrar "$0.00" (no "—")
   - Valor 160: debe mostrar "$160.00"
   - Valor 1250: debe mostrar "$1,250.00"

**Resultado esperado**:
- ✅ Formato siempre "$ X.00" con separadores de miles

---

### Escenario 7: Formateo de Fechas 📅

**Pasos**:
1. En tarjeta Mayoreo, verificar "Última compra"
2. Debe estar en formato: "01 jul 2026"

**Resultado esperado**:
- ✅ Formato "DD MMM YYYY" en español
- ✅ Si no hay fecha: "—"

---

### Escenario 8: Sin Datos 🚫

**Pasos**:
1. Buscar socio SIN operaciones en ambos esquemas
2. Abrir detalle → Resumen
3. Scroll down

**Resultado esperado**:
- ✅ Sección "Resumen comercial" NO aparece
- ✅ Solo se ven las otras secciones (Identificación, Contacto, etc.)

---

### Escenario 9: Solo Comodato 📦

**Pasos**:
1. Buscar socio con SOLO comodato (sin mayoreo)
2. Abrir detalle → Resumen
3. Scroll down

**Resultado esperado**:
- ✅ Aparece sección B2B
- ✅ Tarjeta "Total general B2B" presente
- ✅ Tarjeta "Comodato" presente
- ✅ Tarjeta "Mayoreo" AUSENTE

---

### Escenario 10: Solo Mayoreo 🛍️

**Pasos**:
1. Buscar socio con SOLO mayoreo (sin comodato)
2. Abrir detalle → Resumen
3. Scroll down

**Resultado esperado**:
- ✅ Aparece sección B2B
- ✅ Tarjeta "Total general B2B" presente
- ✅ Tarjeta "Comodato" AUSENTE
- ✅ Tarjeta "Mayoreo" presente

---

### Escenario 11: Cálculos B2B Correctos ➕

**Pasos**:
1. Anotar valores de comodato:
   - `total_due` (generado)
   - `total_paid` (cobrado)
   - `pending_balance` (pendiente)

2. Anotar valores de mayoreo:
   - `total_purchased` (comprado)
   - `total_paid` (pagado)
   - `pending_balance` (pendiente)

3. Verificar en "Total general B2B":
   - Total generado/comprado = `comodato.total_due + mayoreo.total_purchased`
   - Total cobrado/pagado = `comodato.total_paid + mayoreo.total_paid`
   - Saldo pendiente = `comodato.pending + mayoreo.pending`

**Resultado esperado**:
- ✅ Sumas coinciden exactamente

---

### Escenario 12: Alerta de Deuda 🚨

**Pasos**:
1. Con socio que tiene saldo pendiente > 0
2. En tarjeta "Total general B2B"
3. Verificar alerta

**Resultado esperado**:
- ✅ Aparece badge rojo: "⚠️ Saldo pendiente"
- ✅ Texto de "Saldo pendiente total" en color rojo: `text-red-600`

**Pasos alternos**:
1. Con socio que tiene saldo pendiente = 0
2. En tarjeta "Total general B2B"

**Resultado esperado**:
- ✅ NO aparece alerta
- ✅ Texto de "Saldo pendiente total" en color verde: `text-green-600`

---

### Escenario 13: Estilos Consistentes 🎨

**Pasos**:
1. Abrir detalle y pestaña Resumen
2. Verificar visualmente:
   - Cards tienen fondo crema (#fff8e6)
   - Bordes mostaza (#c49330)
   - Texto negro (#111111)
   - Íconos en mostaza oscuro (#7a4a0a)
   - Espaciado consistente

**Resultado esperado**:
- ✅ Estilo coincide con las otras secciones (Identificación, Contacto)
- ✅ Se ve "integrado" en el panel mostaza

---

### Escenario 14: Responsivo 📱

**Pasos**:
1. Abrir detalle en diferentes tamaños de pantalla:
   - Desktop (1920px)
   - Laptop (1366px)
   - Tablet (768px)
   - Mobile (375px)

2. En cada tamaño:
   - Scroll en el drawer
   - Verificar que tarjetas se adapten

**Resultado esperado**:
- ✅ Tarjetas se redimensionan correctamente
- ✅ Texto no se corta
- ✅ Íconos se mantienen visibles
- ✅ No hay overflow horizontal

---

### Escenario 15: Estado Cargando ⏳

**Pasos**:
1. Abrir detalle de un socio
2. Mientras carga el resumen (breve momento)

**Resultado esperado**:
- ✅ Aparece spinner rotando
- ✅ Texto: "Cargando resumen comercial..."
- ✅ Desaparece cuando carga (< 2 segundos típicamente)

---

### Escenario 16: Error en Carga ❌

**Si ocurriera una falla en Supabase** (simulado o real):

**Resultado esperado**:
- ✅ Aparece tarjeta roja con icono de alerta
- ✅ Título: "Error"
- ✅ Mensaje descriptivo del error
- ✅ El resto del detalle sigue funcionando

---

## Checklist de Validación Final

- [ ] ✅ Sección "Resumen comercial" visible
- [ ] ✅ Tarjeta B2B con 3 campos
- [ ] ✅ Tarjeta Comodato (si hay datos)
- [ ] ✅ Tarjeta Mayoreo (si hay datos)
- [ ] ✅ Formateo de moneda correcto ($0.00)
- [ ] ✅ Formateo de piezas correcto (N piezas)
- [ ] ✅ Formateo de fechas correcto (DD MMM YYYY)
- [ ] ✅ Cálculos B2B correctos
- [ ] ✅ Alerta de deuda funciona
- [ ] ✅ Estilos consistentes
- [ ] ✅ Responsivo
- [ ] ✅ Sin errores en consola
- [ ] ✅ Build sin errors TypeScript

---

## Comando para Validar Build

```bash
npm run build
```

Debe terminar con:
```
✓ built in X.XX s
```

Sin ningún error. Solo warnings de chunk size son permitidos.

---

## Notas de Testing

- Usar socio **CP-010726-001** como referencia base
- Probar con al menos 3 socios diferentes
- Verificar que NO se cambió ningún otro módulo
- Revisar consola del navegador (F12 → Console) por errores

---

**Fecha de última actualización**: 9 de julio de 2026
