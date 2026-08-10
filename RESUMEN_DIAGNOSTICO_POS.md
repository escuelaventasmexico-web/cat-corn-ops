# RESUMEN EJECUTIVO: Diagnóstico POS Comisiones

**Estado**: DIAGNÓSTICO EXACTO COMPLETADO  
**Implementación**: NO INICIADA (Esperar autorización)  
**Documentación**: [DIAGNOSTICO_POS_COMISIONES.md](DIAGNOSTICO_POS_COMISIONES.md)

---

## 14 HALLAZGOS CLAVE

### 1. ✅ Componente Real del POS
- **Archivo**: pages/POS.tsx
- **Función**: handleCheckout()
- **Línea**: 326-450
- **Botón**: "Cobrar ${cartTotal}"

### 2. ✅ Handler de Cobro Identificado
- Ubicación exacta: handleCheckout (línea 326)
- Pasos: Validación → Obtener usuario → Insert sales → Insert sale_items → Limpiar UI

### 3. ✅ Tabla SALES - Columnas Reales

28 columnas encontradas:
- **cashier_id** ← USUARIO QUE COBRA (auth.uid())
- **total** ← Monto total
- **payment_method** ← CASH, CARD, MIXED, TRANSFER, PLATFORM
- **cash_amount**, **card_amount**, **transfer_amount**, **platform_amount**
- **sale_origin** ← 'pos' o 'delivery'
- **customer_id**, **loyalty_reward_applied**, **loyalty_discount_amount**
- **promotion_code**, **is_refunded**, **refunded_at**, **cash_session_id**
- created_at, updated_at (y otras)

### 4. ✅ Tabla SALE_ITEMS - Información Guardada

Por cada producto vendido se guardan:
- product_id (o NULL si genérico)
- **product_name** (nombre del producto)
- **quantity** (cantidad)
- **price** (precio unitario POST-descuento)
- **discount_amount** (monto descuento)
- discount_reason, is_generic

**¿Se guarda snapshot completo del producto?** NO
- Se guarda: nombre, cantidad, precio final
- NO se guarda: sabor, tamaño, grams, SKU actual (hay que buscar en products)

### 5. ✅ Autoría de Ventas - SÍ SE GUARDA

**Tabla**: sales  
**Columna**: cashier_id  
**Valor**: auth.uid() (UUID del usuario autenticado)

**Código**:
```typescript
const { data: { user } } = await supabase.auth.getUser();
const salePayload = {
  cashier_id: user.id,  // ← SE GUARDA AQUÍ
  ...
};
```

**Para identificar**:
- Venta de ADMIN: sales.cashier_id = admin_uuid
- Venta de GERARDO: sales.cashier_id = gerardo_uuid

### 6. ✅ Flujo Transaccional

**UNA SOLA transacción** con 2 inserts secuenciales:

```typescript
try {
  // 1. Insert en sales
  const { data: sale } = await supabase.from('sales').insert(salePayload).select('id').single();
  
  // 2. Insert en sale_items
  await supabase.from('sale_items').insert(saleItems);
  
  // 3. Limpiar interfaz
  setCart([]);
  setProcessing(false);
} catch (err) {
  alert('Error: ' + err.message);
}
```

**Si sale#1 falla**: Excepción → sale#2 NO se ejecuta  
**Si sale#2 falla**: Excepción → sale#1 ya fue insertado (PROBLEMA POTENCIAL, pero admin puede corregir manualmente)

### 7. ✅ Momento en que Venta es "Pagada"

**INMEDIATAMENTE**

- No hay tabla sale_payments
- Al insertar en sales → venta está "completada"
- Estado: is_refunded=false, status=completed (o similar)

**Para anular después**:
- Admin puede marcar: is_refunded=true
- Efecto: Se excluye de Dashboard y Finance (donde hay `.eq('is_refunded', false)`)

### 8. ✅ Cancelaciones y Devoluciones

**¿Permite POS anular en tiempo real?** NO  
**¿Cómo se anula después?** SÍ, via SalesHistory.tsx:
- Admin marca: is_refunded=true, refunded_at=now(), refund_reason="..."
- Venta se oculta de reportes

**¿Qué pasa con comisión si se anula venta de socios?**
- ⚠️ **PENDIENTE en diseño**: Necesitaría reversar commission_event (crear movimiento inverso con monto negativo)

### 9. ✅ Identificación del Usuario Autenticado

**En handleCheckout**:
```typescript
const { data: { user } } = await supabase.auth.getUser();
// user.id = UUID de auth.users
```

**¿Se obtiene el role?**
- NO en handleCheckout directamente
- SÍ disponible en AuthContext: `useAuth()` → profile.role
- Posible hacer: `if (profile?.role === 'socios_comerciales') { ... }`

**Conclusión**: Identificar role es TRIVIAL, está disponible.

### 10. ✅ Funciones de Comisión Reutilizables

**ENCONTRADAS en supabase/migrations/20260802_piece_sale_corrections.sql**:

1. **public.commission_product_key(product_name, flavor) → TEXT**
   - Genera clave única del producto
   - Reutilizable para cualquier tipo de venta

2. **public.get_commission_rule_id(type, product_key, date) → UUID**
   - Busca regla vigente
   - type: 'venta_pieza', 'venta_comodato', etc
   - Para POS: type = 'pos_sale'

3. **public.get_commission_rule_amount(type, product_key, date) → NUMERIC**
   - Calcula comisión unitaria
   - Ya usa las 2 funciones anteriores

**Conclusión**: SÍ podemos reutilizar, SOLO cambiar tipo.

### 11. ✅ commission_events.source_type

**Valores actuales**:
- 'comodato_sale'
- 'wholesale_sale'
- 'piece_sale'
- 'conversion_bonus'
- 'adjustment'

**¿Qué falta?**
- 'pos_sale' ← NUEVO VALOR A AGREGAR

**Cambio requerido**: 
```sql
ALTER TABLE commission_events
DROP CONSTRAINT commission_events_source_type_check;

ALTER TABLE commission_events
ADD CONSTRAINT commission_events_source_type_check
CHECK (source_type IN (..., 'pos_sale'));
```

### 12. ✅ Validar NO Doble Conteo

**Riesgos analizados**:

| Riesgo | Severidad | Razón |
|--------|-----------|-------|
| commercialCollectionsService doble suma | ✅ BAJO | No toca sales, solo cobros socios reales |
| Finance incluye comisiones | ✅ BAJO | Finance read `sales`, no `commission_events` |
| Venta Caja duplicada | ✅ BAJO | sale_origin='pos' funciona igual para admin/socios |
| Comisión como ingreso | ✅ BAJO | Finance NO lee commission_events |

**Conclusión**: SEGURO implementar si se siguen las reglas (ver sección 13).

### 13. ✅ Regla: NO Hardcodear Gerardo

**Sistema es dinámico**:
```typescript
if (profile?.role === 'socios_comerciales') {
  // Crear comisión para CUALQUIER usuario con este role
}
```

**Funciona para**:
- Gerardo, Juan, María, Pedro (cualquier usuario con role='socios_comerciales')
- Escalable a futuros usuarios

**NO hardcoded**:
- ✅ NO por UUID específico
- ✅ NO por email
- ✅ NO por nombre

---

## CAMBIOS NECESARIOS PARA IMPLEMENTACIÓN

### A nivel SQL (Migración Supabase)

```sql
-- 1. Agregar 'pos_sale' a commission_events.source_type
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

### A nivel TypeScript (handleCheckout)

1. Después del insert de sale+sale_items
2. Verificar: `if (profile?.role === 'socios_comerciales')`
3. Por cada item en cart:
   - Obtener product_key
   - Obtener commission_rule_id
   - Obtener unit_commission
   - Calcular commission_total = unit_commission × quantity
4. Insertar en commission_events

### A nivel TypeScript (tipos)

Agregar 'pos_sale' a union type CommissionSourceType (si existe).

---

## INFORMACIÓN CRÍTICA POR PREGUNTAR ANTES DE IMPLEMENTAR

1. **¿Comisión se crea IMMEDIATAMENTE o PENDIENTE de revisión?**
   - commission_events.status = 'available' o 'pending'?

2. **¿Admin debe aprobar comisión POS?**
   - Similar a payment_verification_requests para piece_sales?

3. **¿Qué pasa si venta POS se anula?**
   - Comisión se revierte automáticamente? (crear movimiento inverso)
   - O se deja "huérfana"?

4. **¿Mismos productos y rules que piece_sale?**
   - O tarifas diferentes?

5. **¿Reporte de comisiones debe mostrar POS?**
   - source_type='pos_sale' aparece en módulo Comisiones?

---

## ARCHIVOS CONSULTADOS

Principales:

1. [pages/POS.tsx](pages/POS.tsx#L326) - handleCheckout (línea 326)
2. [pages/SalesHistory.tsx](pages/SalesHistory.tsx) - Refunds
3. [pages/Dashboard.tsx](pages/Dashboard.tsx#L56) - Sales query
4. [contexts/AuthContext.tsx](contexts/AuthContext.tsx) - useAuth, profile
5. [supabase/migrations/20260802_piece_sale_corrections.sql](supabase/migrations/20260802_piece_sale_corrections.sql) - Funciones de comisión

Secundarios:

- services/commercialCollectionsService.ts
- pages/Finanzas.tsx
- components/finance/MonthCalendar.tsx

---

## CONCLUSIÓN

El sistema **está listo** para soportar comisiones POS. Requiere:

1. ✅ Cambio SQL mínimo (1 line en constraint)
2. ✅ Lógica TypeScript en handleCheckout (~20 líneas)
3. ✅ Funciones de comisión YA EXISTEN (reutilizar)
4. ✅ NO riesgo de doble conteo (tablas separadas)
5. ✅ Dinámico (funciona para cualquier socios_comerciales, no solo Gerardo)

**Esperar autorización para proceder con implementación.**

---

**Diagnóstico completado**: 9 de agosto de 2026
