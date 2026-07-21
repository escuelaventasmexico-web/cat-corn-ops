# Corrección Detallada del Modal "Reportar Cobro" - Comodato

## Problema Reportado

El modal "Reportar Cobro" mostraba:
```
"No se encontró una liquidación pendiente para este socio."
```

Aunque en Supabase existía:
- **Socio**: CP-200726-001 (cliente prueba 3)
- **Partner ID**: 0b218669-4275-44f2-ae63-aeede58ba09e
- **Movement ID**: c83e2acc-105f-453b-add5-17456df1b998
- **Total Generado**: $350
- **Total Pagado**: $0
- **Saldo Pendiente**: $350

## Causa

La lógica anterior intentaba hacer **consultas anidadas complejas** (loops secuenciales async/await dentro de un map), lo que podría causar:
1. Fallos de permisos RLS silenciosos
2. Errores no capturados correctamente
3. Consultas ineficientes

## Solución Implementada

### 1. **Consultas Separadas (Batch)**

En lugar de hacer N consultas secuenciales (una por movimiento), ahora:

```typescript
// Paso 1: Obtener movimientos
const { data: movData, error: movError } = await supabase
  .from('commercial_partner_movements')
  .select('id, movement_date')
  .eq('partner_id', partnerId)
  .eq('movement_type', 'settlement')
  .eq('status', 'completed')

// Paso 2: Obtener TODOS los items en UNA consulta
const { data: items, error: itemError } = await supabase
  .from('commercial_partner_movement_items')
  .select('movement_id, amount_due, quantity_sold')
  .in('movement_id', movementIds)
  .gt('quantity_sold', 0)

// Paso 3: Obtener TODOS los pagos en UNA consulta
const { data: payments, error: payError } = await supabase
  .from('commercial_partner_payments')
  .select('movement_id, amount, status')
  .in('movement_id', movementIds)
  .in('status', ['completed', 'paid'])

// Paso 4: Calcular saldos en TYPESCRIPT
const movWithBalance = movData.map((mov) => {
  const movItems = items.filter(item => item.movement_id === mov.id)
  const movPayments = payments.filter(pay => pay.movement_id === mov.id)
  const totalDue = movItems.reduce((s, item) => s + parseFloat(item.amount_due), 0)
  const totalPaid = movPayments.reduce((s, pay) => s + parseFloat(pay.amount), 0)
  const pending = totalDue - totalPaid
  return { id: mov.id, date: mov.movement_date, pending, totalDue, totalPaid }
})
```

**Ventajas:**
- 3 consultas en lugar de N+2
- Mejor manejo de errores
- Claridad en el flujo de datos

### 2. **Filtros Exactos**

```typescript
.eq('movement_type', 'settlement')    // NO 'liquidation'
.eq('status', 'completed')             // NO 'pending' o 'partial'
```

**Importante:**
- `settlement` = liquidación registrada
- `completed` = liquidación fue procesada (pero NO significa que esté pagada)

### 3. **Mejora en Logs Temporales**

Se agregaron logs en cada paso:

```typescript
console.log('CURRENT PARTNER ID', partnerId);
console.log('SETTLEMENT MOVEMENTS', movData);     // Movimientos encontrados
console.log('SETTLEMENT MOVEMENT IDS', movementIds);
console.log('SETTLEMENT ITEMS', items);           // Items de esos movimientos
console.log('SETTLEMENT PAYMENTS', payments);     // Pagos registrados
console.log('CALCULATED PENDING SETTLEMENTS', movWithBalance);
console.log('FILTERED PENDING SETTLEMENTS', pendingSettlements);
```

Si hay error en cualquier paso:
```typescript
console.error('LOAD SETTLEMENT MOVEMENTS ERROR', movError);
console.error('LOAD SETTLEMENT ITEMS ERROR', itemError);
console.error('LOAD SETTLEMENT PAYMENTS ERROR', payError);
```

### 4. **Mejor Manejo de Errores en UI**

Antes:
- Mostraba "No se encontró..." incluso si había error de permisos

Ahora:
- Si error: muestra `"No se pudieron cargar los adeudos. Revisa la conexión o los permisos."`
- Si sin error pero vacío: muestra `"No se encontró una liquidación pendiente para este socio."`

```typescript
if (movError) {
  console.error('LOAD SETTLEMENT MOVEMENTS ERROR', movError);
  setError('No se pudieron cargar los adeudos. Revisa la conexión o los permisos.');
  setMovements([]);
  return;
}
```

### 5. **Cambios en Tipos**

```typescript
// Antes
movements: Array<{ id: string; folio: string; date: string; pending: number; ... }>

// Después
movements: Array<{ id: string; date: string; pending: number; ... }>
```

Se removió `folio` porque no era usado en la UI (se genera dinámicamente en el select).

## Flujo Completo Cuando Abre el Modal

1. **Carga balance general del socio** (resumen operacional)
2. **Consulta movimientos settlement completed**
   - Filtro: partner_id, movement_type='settlement', status='completed'
   - Resultado: [{ id, movement_date }, ...]

3. **Consulta items de esos movimientos** (batch)
   - Filtro: IN(movement_id), quantity_sold > 0
   - Resultado: [{ movement_id, amount_due }, ...]

4. **Consulta pagos de esos movimientos** (batch)
   - Filtro: IN(movement_id), status IN ('completed', 'paid')
   - Resultado: [{ movement_id, amount }, ...]

5. **Calcula saldos pendientes** (TypeScript, local)
   - Para cada movimiento: totalDue - totalPaid
   - Filtra: pending > 0.005

6. **Si 1 sola liquidación**: auto-selecciona y llena monto
   - Muestra: `"Liquidación del 21/07/2026 — saldo pendiente $350.00"`

7. **Renderiza selector** si hay movimientos
   - O mensaje de error si hubo problema de permisos/conexión
   - O mensaje de "No se encontró" si no hay saldo

## Caso de Prueba: Cliente prueba 3

**Datos en Supabase:**
```
Partner ID: 0b218669-4275-44f2-ae63-aeede58ba09e
Partner Folio: CP-200726-001
Business Name: cliente prueba 3
Movement ID: c83e2acc-105f-453b-add5-17456df1b998
Movement Type: settlement
Status: completed
Movement Date: 2026-07-21

Movement Items (quantity_sold > 0):
- 7 piezas vendidas
- amount_due: 50 x 7 = $350

Payments (status IN ('completed', 'paid')):
- NINGUNO

Pending Balance = 350 - 0 = $350
```

**Resultado esperado en modal:**
```
[Selector debe mostrar:]
Liquidación del 21/07/2026 — saldo pendiente $350.00

[Auto-selecciona:]
✓ selected: c83e2acc-105f-453b-add5-17456df1b998
✓ amount: "350.00"

[Botón Reportar Cobro debe estar habilitado]
```

## Compilación

```bash
npm run build
# ✓ Éxito sin errores TypeScript
# Build completo: 3.93s
```

## Archivos Modificados

- [PartnerPaymentForm.tsx](components/commercialPartners/comodato/PartnerPaymentForm.tsx)

## Verificación de Permisos RLS

Si después de estos cambios el modal aún no muestra movimientos, verificar:

### Tabla `commercial_partner_movement_items`
```sql
SELECT * FROM information_schema.role_table_grants 
WHERE table_name='commercial_partner_movement_items';
```

El usuario `socios_comerciales` debe tener SELECT en:
- `commercial_partner_movement_items`
- `commercial_partner_movements` 
- `commercial_partner_payments`

Para movimientos de socios asignados a ese usuario.

### RLS Policies Necesarias

Ejemplo (ya debe existir):
```sql
CREATE POLICY "vendors_can_see_their_movement_items" 
ON commercial_partner_movement_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM commercial_partner_movements m
    WHERE m.id = movement_id
    AND m.partner_id IN (
      SELECT id FROM commercial_partners
      WHERE assigned_to = auth.uid()
    )
  )
)
```

## Próximos Pasos (si sigue sin funcionar)

1. Abre DevTools → Console
2. Busca: `SETTLEMENT MOVEMENTS` y sus logs
3. Si error: copia el mensaje completo
4. Verifica que el usuario tenga role `socios_comerciales` en `user_profiles`
5. Verifica que el socio tenga `assigned_to` = user_id en `commercial_partners`
