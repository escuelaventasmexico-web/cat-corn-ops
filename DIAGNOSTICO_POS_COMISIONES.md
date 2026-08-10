# Diagnóstico: Comisiones POS para Socios Comerciales

**Fecha**: 9 de agosto de 2026  
**Estado**: DIAGNÓSTICO EXACTO - NO SE IMPLEMENTA  
**Próximo paso**: Esperar instrucciones de implementación

---

## 1. COMPONENTE REAL DEL POS

**Archivo**: [pages/POS.tsx](pages/POS.tsx#L326)

**Función**: `handleCheckout()`  
**Línea de inicio**: 326

**Ubicación del botón "Cobrar"**:
- Línea 1340: `onClick={() => handleCheckout()}`
- Línea 1486: Otro botón "Cobrar"
- Texto mostrado: `<ShoppingBag size={16} /> Cobrar ${cartTotal.toFixed(2)}`

---

## 2. FLUJO COMPLETO DE COBRO

### Pasos exactos (líneas 326-450):

1. **Validación inicial** (líneas 328-343):
   - Verifica carrito no vacío
   - Verifica pago suficiente
   - Verifica caja abierta (a menos que sea delivery)
   - Bloquea transferencia mixta con efectivo/tarjeta

2. **Obtener usuario autenticado** (línea 369):
   ```tsx
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) throw new Error('No auth user');
   ```
   **¿Almacena user.id?**: SÍ → en `cashier_id`

3. **Insertar en tabla `sales`** (línea 396-400):
   ```tsx
   const { data: sale, error: saleErr } = await supabase
     .from('sales')
     .insert(salePayload)
     .select('id')
     .single();
   ```
   
   **Payload enviado**:
   ```tsx
   const salePayload = {
     total: cartTotal,
     payment_method: method,          // CASH, CARD, MIXED, TRANSFER, PLATFORM
     cash_amount: calculado,
     card_amount: calculado,
     transfer_amount: calculado,
     platform_amount: calculado,
     sale_origin: 'pos' | 'delivery',  // delivery if platform, else 'pos'
     delivery_platform: platform,      // uber_eats, didi_food, rappi, null
     cashier_id: user.id,              // ← USUARIO ACTUAL
     customer_id: customer?.id || null,
     loyalty_reward_applied: boolean,
     loyalty_discount_amount: number,
     promotion_code: string | null,
     cash_session_id: sessionId        // Link a sesión de caja
   }
   ```

4. **Insertar en tabla `sale_items`** (línea 403-422):
   ```tsx
   const saleItems = cart.map(item => ({
     sale_id: sale.id,
     product_id: item.is_generic ? null : item.id,
     product_name: item.product_name || item.name || null,
     is_generic: item.is_generic ?? false,
     quantity: item.quantity,
     price: efectivePrice,             // Ya descontado
     discount_amount: disc,
     discount_reason: item.discount_reason || null,
   }));
   
   const { error: itemsErr } = await supabase
     .from('sale_items')
     .insert(saleItems);
   ```

5. **Actualizar estado de cliente** (línea 426-430):
   - Refetch customer para mostrar estampillas nuevas

6. **Limpiar interfaz** (línea 433-442):
   - Vacía carrito
   - Resetea promoción, descuentos
   - Vacía montos de pago

7. **Mostrar modal de impresión** (línea 450):
   ```tsx
   setPendingReceipt(receiptData);
   ```

### Duración total: **Transacción única con 2 inserts**

No hay transacción explícita con `BEGIN/COMMIT`, pero los 2 inserts se hacen en el mismo bloque try/catch. Si sale#1 falla, se lanza excepción y sale#2 nunca se ejecuta.

---

## 3. TABLAS MODIFICADAS AL COBRAR

### `sales` (Inserción)

**Columnas reales** (confirmadas en código):

| Columna | Tipo | Fuente | Valor actual |
|---------|------|--------|--------------|
| id | UUID | auto | gen_random_uuid() |
| total | NUMERIC | Entrada | cartTotal |
| payment_method | TEXT | Calculado | 'CASH' \| 'CARD' \| 'MIXED' \| 'TRANSFER' \| 'PLATFORM' |
| cash_amount | NUMERIC | Calculado | effectiveCash o 0 |
| card_amount | NUMERIC | Calculado | effectiveCard o 0 |
| transfer_amount | NUMERIC | Calculado | cartTotal o 0 |
| platform_amount | NUMERIC | Calculado | cartTotal o 0 |
| cashier_id | UUID | **auth.uid()** | user.id (USUARIO ACTUAL) |
| customer_id | UUID | Opcional | customer?.id o NULL |
| sale_origin | TEXT | Hardcoded | 'pos' o 'delivery' |
| delivery_platform | TEXT | Condicional | 'uber_eats' \| 'didi_food' \| 'rappi' \| NULL |
| loyalty_reward_applied | BOOLEAN | Calculado | Hay descuento LOYALTY_50_OFF_ONE_ITEM |
| loyalty_discount_amount | NUMERIC | Calculado | SUM(discount_amount) de items |
| promotion_code | TEXT | Entrada | 'PROMO_INSTAGRAM_15' o NULL |
| is_refunded | BOOLEAN | Default | false (no se modifica en POS) |
| refunded_at | TIMESTAMPTZ | Default | NULL |
| cash_session_id | UUID | Entrada | sessionId si existe |
| created_at | TIMESTAMPTZ | Default | NOW() |

**Total de columnas en sales**: Mínimo 18

### `sale_items` (Inserción)

| Columna | Tipo | Valor |
|---------|------|-------|
| id | UUID | gen_random_uuid() |
| sale_id | UUID | sale.id (FK a sales) |
| product_id | UUID \| NULL | item.id o NULL si is_generic |
| product_name | TEXT | item.product_name o item.name |
| is_generic | BOOLEAN | item.is_generic o false |
| quantity | INT | item.quantity |
| price | NUMERIC | Precio unitario **post-descuento** |
| discount_amount | NUMERIC | item.discount_amount o 0 |
| discount_reason | TEXT | 'LOYALTY_50_OFF_ONE_ITEM' o NULL |

**Total de columnas en sale_items**: 9

### No se modifica `sale_payments`

La tabla `sale_payments` **NO existe en el flujo POS actual**. Las ventas POS se marcan como "completadas" automáticamente al insertar en `sales`.

---

## 4. AUTORÍA DE VENTAS POS ACTUAL

### ✅ SÍ se guarda quién cobró

**Tabla**: `sales`  
**Columna**: `cashier_id`  
**Valor almacenado**: `auth.uid()` (UUID del usuario autenticado)  
**Mapeo**: Hace referencia a `user_profiles.id` (o `profiles.id` en schema antiguo)

**Código**:
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) throw new Error('No auth user');

const salePayload = {
  ...
  cashier_id: user.id,  // ← SE GUARDA AQUÍ
  ...
};
```

**Así se puede identificar**:
- Venta POS de ADMIN: `sales.cashier_id = admin_uuid`
- Venta POS de GERARDO (socios_comerciales): `sales.cashier_id = gerardo_uuid`

---

## 5. INFORMACIÓN GUARDADA POR PRODUCTO (sale_items)

**Columnas de `sale_items` para cada producto**:

```typescript
{
  product_id,        // UUID del catálogo (o NULL si es genérico)
  product_name,      // Nombre del producto
  quantity,          // Cantidad vendida
  price,             // Precio unitario DESPUÉS DE DESCUENTO
  discount_amount,   // Monto del descuento
  discount_reason,   // Tipo de descuento (loyalty, promo, etc)
  is_generic         // true si fue ingreso manual sin SKU
}
```

**¿Se guarda snapshot del producto?** 
- NO completamente. Solo: nombre, cantidad, precio final, descuento
- NO se guarda: sabor, tamaño, grams, SKU, imágenes, costo

**¿Se puede recalcular comisión?**
- SÍ si tenemos el `product_id` → Buscar en tabla `products` la info actual
- SÍ si guardamos producto más información (flavor, size, etc)

---

## 6. PAGO Y ESTADO "PAGADO"

### Cuándo una venta se considera PAGADA

**En POS**: **INMEDIATAMENTE al insertar en `sales`**

No hay paso intermedio. La venta queda registrada como completada de una vez.

**Indicador**: 
- Venta existe en tabla `sales` con `created_at = now()`
- `is_refunded = false`
- Nunca hay estado "pending" o "waiting for payment"

### Si después se cancela:
```typescript
// En SalesHistory.tsx
is_refunded = true
refunded_at = now()
refund_reason = "Motivo del reembolso"
```

**Efecto**: Se excluye de totales en Dashboard:
```typescript
.eq('is_refunded', false)  // Solo no reembolsadas
```

---

## 7. IDENTIFICACIÓN DEL USUARIO AUTENTICADO EN POS

### ✅ Se obtiene sin consultas adicionales

**Código**:
```typescript
const { data: { user } } = await supabase.auth.getUser();
```

**Resultado**:
- `user.id` → UUID de auth.users
- `user.email` → email
- `user.user_metadata` → Datos adicionales

**¿Se obtiene el role?** 
- **NO directamente** en handleCheckout
- El role está en `user_profiles.role`
- Se tendría que hacer query adicional O usar datos precargados del AuthContext

**En AuthContext.tsx**:
```typescript
const { profile, role } = useAuth();
// profile.role = 'admin' | 'socios_comerciales' | etc
```

Así se podría hacer:
```typescript
const { profile } = useAuth();  // Ya está disponible
const { data: { user } } = await supabase.auth.getUser();

if (profile?.role === 'socios_comerciales') {
  // Crear commission_event
}
```

---

## 8. REGLAS DE COMISIÓN REUTILIZABLES

### Funciones SQL ENCONTRADAS

En [supabase/migrations/20260802_piece_sale_corrections.sql](supabase/migrations/20260802_piece_sale_corrections.sql):

1. **`public.commission_product_key(product_name TEXT, flavor TEXT) → TEXT`**
   - Genera clave única: Ej: `gato_mayor_sabores`
   - Reutilizable para cualquier venta

2. **`public.get_commission_rule_id(type TEXT, product_key TEXT, date DATE) → UUID`**
   - Busca la regla de comisión vigente
   - Parámetro `type`: `'venta_pieza'` | `'venta_comodato'` | etc
   - Retorna ID de la regla o NULL

3. **`public.get_commission_rule_amount(type TEXT, product_key TEXT, date DATE) → NUMERIC`**
   - Calcula monto de comisión por unidad
   - Ej: si vende 5 unidades a $10 cada una → 5 × $10

### Cambios necesarios para reutilizar en POS

**Actualmente para `venta_pieza` usan**:
```typescript
v_product_key := public.commission_product_key(
  v_product_name_actual,    // nombre del producto
  v_new_product.flavor      // sabor/variante
);

v_rule_id := public.get_commission_rule_id(
  'venta_pieza'::text,
  v_product_key,
  v_sale_record.sale_date::date
);
```

**Para `pos_sale` sería idéntico**, solo cambiar tipo:
```typescript
v_rule_id := public.get_commission_rule_id(
  'pos_sale'::text,  // ← NUEVO TIPO
  v_product_key,
  sale_date::date
);
```

---

## 9. COMMISSION_EVENTS.SOURCE_TYPE

### Valores actuales permitidos

```sql
-- En commission_events table constraint
CHECK (source_type IN (
  'comodato_sale',
  'wholesale_sale',
  'piece_sale',
  'conversion_bonus',
  'adjustment'
))
```

### ¿Qué habría que cambiar?

1. **Agregar nuevo valor**:
   ```sql
   ALTER TABLE commission_events
   DROP CONSTRAINT commission_events_source_type_check;
   
   ALTER TABLE commission_events
   ADD CONSTRAINT commission_events_source_type_check
   CHECK (source_type IN (
     'comodato_sale',
     'wholesale_sale',
     'piece_sale',
     'conversion_bonus',
     'adjustment',
     'pos_sale'  -- ← NUEVO
   ));
   ```

2. **En TypeScript** (si existe):
   ```typescript
   type CommissionSourceType = 
     | 'comodato_sale'
     | 'wholesale_sale'
     | 'piece_sale'
     | 'conversion_bonus'
     | 'adjustment'
     | 'pos_sale';  // ← AGREGAR
   ```

---

## 10. CANCELACIONES Y DEVOLUCIONES ACTUALES

### ¿Permite POS cancelar?

**NO en tiempo real**. El flujo actual es:

1. **Venta se registra inmediatamente**
2. **Admin después puede marcar como refunded**:
   - Archivo: [pages/SalesHistory.tsx](pages/SalesHistory.tsx)
   - Lógica: Cambiar `is_refunded = true`

### Columnas de refund

| Columna | Tipo | Uso |
|---------|------|-----|
| is_refunded | BOOLEAN | Marca venta como deshecha |
| refunded_at | TIMESTAMPTZ | Fecha de reembolso |
| refund_reason | TEXT | Motivo |

### Efecto en comisión

**Cuando refund ocurre**:
- Venta queda excluida de Dashboard (`.eq('is_refunded', false)`)
- Pero `commission_events` **NO se elimina automáticamente**
- Si socios cobró comisión → comisión sigue "disponible" aunque venta esté refunded

**Cambios necesarios para POS con comisión**:
- Si venta POS de socios → refund → Necesitaría reversar commission_event
- Posible: Crear nuevo commission_event con `commission_amount = -$10` para contrarrestar

---

## 11. RIESGOS DE DOBLE CONTEO IDENTIFICADOS

### Riesgo 1: commercialCollectionsService

**Ubicación**: [services/commercialCollectionsService.ts](services/commercialCollectionsService.ts)

**¿Qué hace?** 
- Consulta tablas de Socios Comerciales (comodato, mayoreo, etc)
- Suma cobros reales en dinero, NO comisiones
- Se agrega a Dashboard bajo "Venta Socios Comerciales"

**Riesgo**: 
- ✅ **BAJO** → No toca tabla `sales` ni `commission_events`
- POS venta de socios NO se confunde con Venta Socios Comerciales

### Riesgo 2: Finance Dashboard

**Ubicación**: [pages/Finanzas.tsx](pages/Finanzas.tsx)

**¿Qué suma?**
```typescript
const salesToday = await supabase
  .from('sales')
  .select('total, ...')
  .eq('is_refunded', false);
```

**¿Incluye comisiones?**
- ✅ **NO** → Solo tabla `sales`, no `commission_events`
- Commission_events es tabla separada

### Riesgo 3: Conteo de "Venta Caja"

**En Dashboard.tsx**:
```typescript
const isCaja = (s: any) => s.sale_origin === 'pos' || 
  (!s.sale_origin && !isOrder(s) && !isDelivery(s));
```

**Efecto**: 
- Todas las ventas POS (admin o socios) suman en "Venta Caja"
- ✅ Correcto: No se duplican

### Riesgo 4: Comisión en Finanzas

**¿Podría sumarse comisión como ingreso?**
- ✅ **BAJO** → Finance dashboard NO lee `commission_events`
- Si admin suma comisiones en Finanzas manualmente → Ese es problema aparte

### Recomendación

**Para garantizar NO duplicación en implementación**:
1. Crear `commission_event` SOLO si `profile.role = 'socios_comerciales'`
2. NO modificar `sales.total` ni `sales` en general
3. Leer comisiones SOLO de `commission_events`, nunca de `sales`
4. Cuando refund → Crear movimiento de comisión inverso (cantidad negativa)

---

## 12. CAMBIOS NECESARIOS PARA IMPLEMENTACIÓN

### A nivel SQL (Supabase)

1. ✅ Agregar `'pos_sale'` a commission_events.source_type CHECK
2. ✅ Crear/modificar RPC `create_pos_sale_with_commission()` (si no existe)
   - O: Modificar POS para llamar RPC en vez de insert directo

### A nivel TypeScript/React

1. ✅ En handleCheckout: Después de sales+sale_items, crear commission_event si socios
2. ✅ Obtener product_key usando public.commission_product_key()
3. ✅ Obtener rule_id usando public.get_commission_rule_id()
4. ✅ Calcular commission_amount = unit_commission × quantity
5. ✅ Insertar en commission_events con source_type='pos_sale'

### A nivel Authorization (RLS)

1. ✅ Verificar si socios_comerciales puede insertar en commission_events
2. ✅ Verificar si socios_comerciales puede ver sus propias commission_events
3. ✅ Verificar si admin puede ver todas

### Migración SQL

1. ✅ Crear migration para agregar 'pos_sale' a constraint
2. ✅ NO requiere cambios en tablas sales, sale_items, commission_events
3. ✅ Solo extension de lista de valores permitidos

---

## 13. VALIDACIÓN: NO HARDCODEAR GERARDO

### Sistema actual

**Para identificar socios_comerciales**:
```typescript
// En handleCheckout:
const { profile } = useAuth();

if (profile?.role === 'socios_comerciales') {
  // Crear comisión
}
```

**Ventajas**:
- ✅ Works para cualquier futuro usuario con role='socios_comerciales'
- ✅ NO hardcoded a email o nombre
- ✅ Dinámico y escalable

---

## 14. DIAGRAMA DE FLUJO FUTURO

```
Gerardo (socios_comerciales) abre POS
        ↓
Agrega productos al carrito
        ↓
Pulsa "Cobrar"
        ↓
handleCheckout():
  1. Obtiene auth.uid() = gerardo_uuid
  2. Obtiene profile.role = 'socios_comerciales'
  3. Inserta en sales:
     - cashier_id: gerardo_uuid
     - total: $65
     - sale_origin: 'pos'
  4. Inserta en sale_items con productos
  5. NUEVO: Si role='socios_comerciales':
     - Busca commission_product_key para cada producto
     - Busca commission_rule_id vigente
     - Calcula unit_commission
     - Inserta en commission_events:
       * source_type: 'pos_sale'
       * seller_id: gerardo_uuid
       * commission_amount: $10
       * status: 'available' (o 'pending' si requiere aprobación)
        ↓
Dashboard actualiza:
  - Venta Caja: +$65 (normal)
  - Commission (en tabla separada): +$10 para Gerardo
        ↓
Finanzas muestra:
  - Venta Caja: +$65
  - (Comisiones NO se suman aquí, son del módulo de Comisiones)
        ↓
Módulo Comisiones muestra:
  - Gerardo: +$10 disponible
```

---

## RESUMEN EJECUTIVO

| Item | Respuesta |
|------|-----------|
| **¿Componente real de POS?** | pages/POS.tsx, función handleCheckout(), línea 326 |
| **¿Quién registra la venta?** | handleCheckout() llama `supabase.auth.getUser()` y guarda en `cashier_id` |
| **¿Se guarda en database?** | SÍ, en tabla `sales.cashier_id = auth.uid()` |
| **¿Cómo identificar socios?** | `auth.uid()` + `user_profiles.role = 'socios_comerciales'` |
| **¿RPC o SQL directo?** | SQL directo: `supabase.from('sales').insert()` |
| **¿Una o varias transacciones?** | Una sola: 2 inserts secuenciales en try/catch |
| **¿Se cancela después?** | SÍ, via SalesHistory: marcar `is_refunded=true` |
| **¿Funciones comisión reutilizables?** | SÍ: `commission_product_key()`, `get_commission_rule_id()`, `get_commission_rule_amount()` |
| **¿Cambios SQL necesarios?** | SÍ: Agregar `'pos_sale'` a commission_events.source_type CHECK |
| **¿Riesgo doble conteo?** | BAJO: sales ≠ commission_events, Finance no lee comisiones |
| **¿Pronto a implementar?** | NO: Esperar instrucciones. Diagnóstico SOLO. |

---

## PRÓXIMOS PASOS (Cuando autorices)

1. Diseñar RPC `create_pos_sale_with_commission()`
2. Modificar handleCheckout() para llamar RPC si socios_comerciales
3. Crear migración SQL para source_type='pos_sale'
4. Implementar lógica de aprobación de comisión (si aplica)
5. Crear tests para validar NO duplicación

---

**FIN DEL DIAGNÓSTICO**

No se ha modificado nada. Solo se ha recopilado información del flujo actual.
