# Caso de Prueba - Sistema de Verificación de Cobros

## Datos Reales del Socio

```
Partner ID:        173e979e-79aa-48a3-ba62-89732a89a09c
Partner Folio:     CP-200726-001
Business Name:     Cliente prueba 2
Movement ID:       71e3da99-717a-414f-8989-b18f61d35168
Movement Type:     settlement
Movement Status:   completed
Total Generado:    $500.00
Total Pagado:      $0.00
Saldo Pendiente:   $500.00
```

## Pasos de Prueba

### 1. Abrir Modal "Reportar Cobro"

**Navegación:**
- Ir a Socios Comerciales
- Abrir socio "CP-200726-001 / Cliente prueba 2"
- En la pestaña "Comodato" o seción de balance
- Hacer click en botón "Pago" o "Reportar Cobro"

**Esperado:**
- ✅ Modal abre sin errores
- ✅ Muestra saldo general: "$500.00"

### 2. Verificar Carga de Liquidaciones

**En la consola del navegador (F12), buscar:**

```javascript
SETTLEMENT MOVEMENTS // Debe mostrar el movimiento 71e3da99-717a-414f-8989-b18f61d35168
SETTLEMENT ITEMS     // Debe mostrar items con amount_due > 0
SETTLEMENT PAYMENTS  // Debe mostrar pagos existentes (vacío si no hay pagos)
PENDING SETTLEMENTS  // Debe mostrar 1 settlement con pending: 500
```

**Esperado:**
- ✅ Console muestra el movimiento con ID correcto
- ✅ Total debido: $500
- ✅ Total pagado: $0
- ✅ Saldo pendiente: $500

### 3. Verificar Selector de Liquidación

**En el modal, sección "Adeudo que está pagando":**

**Esperado:**
- ✅ NO aparece mensaje de "No se encontró una liquidación pendiente"
- ✅ Selector muestra opción:
  ```
  CP-200726-001 (del 20/07/2026) — saldo pendiente $500.00
  ```
- ✅ El selector está **automáticamente seleccionado**
- ✅ Campo "Monto" está **automáticamente lleno con $500.00**
- ✅ Botón "Reportar Cobro" está **HABILITADO** (no grisado)

### 4. Reporte Parcial

**Si se quiere reportar solo $300:**

- Cambiar monto a `300`
- Fecha: `20/07/2026` (hoy)
- Método: `Efectivo`
- Click "Reportar Cobro"

**Esperado:**
- ✅ NO hay error
- ✅ Modal muestra:
  ```
  ¡Cobro Reportado!
  El pago ha sido reportado. Está en espera de revisión para liberar la comisión.
  
  Folio: COBRO-202607-00001 (o similar)
  Monto: $300.00
  Estado: Pendiente de revisión
  ```
- ✅ Modal cierra automáticamente después de 3 segundos
- ✅ Saldo en dashboard sigue mostrando $500 (no cambia hasta aprobación)
- ✅ Comisión sigue mostrando como pendiente

### 5. Verificar en Supabase

**Tabla: `partner_payment_verification_requests`**

Debe existir nuevo registro:
```
id:                    [UUID generado]
folio:                 COBRO-202607-00001
scheme:                comodato
partner_id:            173e979e-79aa-48a3-ba62-89732a89a09c
movement_id:           71e3da99-717a-414f-8989-b18f61d35168
amount:                300.00
payment_method:        cash
status:                pending_review (no 'draft')
submitted_by:          [UUID del usuario que reportó]
submitted_at:          [timestamp actual]
proof_path:            NULL (porque es efectivo)
```

### 6. Verificar Admin Dashboard (Opcional)

**Si admin dashboard está implementado:**

Ir a Socios Comerciales → Comisiones → Admin
- ✅ Debe mostrar sección "Cobros pendientes de revisión"
- ✅ Muestra badge con "1"
- ✅ Tarjeta del cobro con:
  - Socio: "CP-200726-001 Cliente prueba 2"
  - Folio: "COBRO-202607-00001"
  - Monto: "$300.00"
  - Botón: "Revisar y confirmar"

### 7. Admin Aprueba el Cobro (Opcional)

Click "Revisar y confirmar"
- Modal muestra detalles del pago
- Click "Confirmar ingreso"

**Esperado:**
- ✅ Request se actualiza a `status = 'approved'`
- ✅ Se crea pago en `commercial_partner_payments`
- ✅ Balance se actualiza: $500 - $300 = $200
- ✅ Comisión se libera

## Logs a Verificar

En la consola del navegador después de abrir el modal:

```
✅ SETTLEMENT MOVEMENTS [Array(1)]  // 1 movimiento
✅ SETTLEMENT ITEMS [Array(n)]      // items con cantidad_vendida > 0
✅ SETTLEMENT PAYMENTS []           // vacío o con pagos existentes
✅ PENDING SETTLEMENTS [Array(1)]   // 1 settlement con pending > 0
```

## Build Status

```bash
npm run build
```

**Esperado:**
- ✅ 0 TypeScript errors
- ✅ built in ~4.2s
- ⚠️ Warning sobre chunk size (normal)

## Casos de Error

### Si selector está vacío:
1. Revisar console logs
2. Verificar que movimiento tiene `status = 'completed'` en Supabase
3. Verificar que existen `commercial_partner_movement_items` con `quantity_sold > 0`
4. Revisar si hay filtros adicionales que están excluyendo el movimiento

### Si monto NO se llena automáticamente:
1. Movimiento fue encontrado pero cálculo de balance falló
2. Revisar logs: `PENDING SETTLEMENTS`
3. Verificar que `pending > 0.005`

### Si botón está deshabilitado:
1. `movements.length === 0` (ver arriba)
2. O hay un `saving = true` (indicador de procesamiento)

## Notas

- Los logs `console.log()` son temporales y pueden removerse después de pruebas
- El texto ahora muestra fecha legible en lugar de UUID
- Si hay múltiples liquidaciones, todas se muestran en selector
- Si hay exactamente 1, se selecciona automáticamente
- Si hay 0, se muestra mensaje claro en lugar de selector vacío

