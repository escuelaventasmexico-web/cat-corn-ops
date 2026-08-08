# Mejora: Historial Detallado de Compras de Mayoreo

**Status**: ✅ COMPLETADO  
**Build**: ✅ Exitoso (npm run build)  
**Fecha**: 7 de agosto de 2026  

---

## 📋 Resumen Ejecutivo

Se mejoró significativamente la visualización del historial de compras de mayoreo en CommercialPartnerDetail agregando un modal con detalles completos de cada pedido, incluyendo productos, pagos asociados, notas del vendedor, y totales.

**Cambios Implementados**:
- ✅ Modal de detalle completo para cada pedido
- ✅ Visualización de todos los productos con variantes, presentaciones y precios
- ✅ Carga de pagos asociados a cada pedido
- ✅ Mostrar notas del vendedor si existen
- ✅ Totales de piezas, montos, y saldo pendiente
- ✅ Botón "Ver detalle" en cada tarjeta del historial
- ✅ Compatible con socios duales (comodato + mayoreo activo)
- ✅ Lazy loading de items y pagos
- ✅ Manejo completo de errores

---

## 🔍 LOCALIZACIÓN DEL COMPONENTE REAL

### Componente Raíz
**Archivo**: [CommercialPartnerDetail.tsx](components/commercialPartners/CommercialPartnerDetail.tsx)
- Tab: `mayoreo`
- Condición: `mayoreoAllowed && activeTab === 'mayoreo'`
- Renderiza: `<CommercialPartnerWholesale partnerId={partner.id} />`

### Historial de Compras
**Archivo**: [CommercialPartnerWholesale.tsx](components/commercialPartners/wholesale/CommercialPartnerWholesale.tsx)
- Línea 92: `<h3>Historial de Compras</h3>`
- Componente: `<WholesaleOrderHistory partnerId={partnerId} refreshKey={internalRefresh} />`

### Orden Real de Renderizado
```
CommercialPartnerDetail
  ↓ (mayoreo tab)
CommercialPartnerWholesale
  ↓ (historial section)
WholesaleOrderHistory [MODIFICADO]
  ↓ (each order card)
WholesaleOrderDetailModal [NUEVO]
```

### Función de Carga de Pedidos
**Archivo**: [WholesaleOrderHistory.tsx](components/commercialPartners/wholesale/WholesaleOrderHistory.tsx)
- Línea 19: `loadOrders()`
- Query 1: `wholesale_orders` (base order data)
- Query 2: `v_wholesale_order_totals` (calculated totals: piezas, montos, estado pago)
- Merge: Combina por `wholesale_order_id`

---

## 📊 TABLAS UTILIZADAS

### Tabla Principal: `wholesale_orders`
**Campos utilizados**:
```sql
id                      UUID PRIMARY KEY
partner_id              UUID (FK)
order_date              DATE
delivery_date           DATE
payment_terms_hours     INTEGER
minimum_order_pieces    INTEGER
order_status            TEXT ('draft' | 'delivered' | 'cancelled')
notes                   TEXT (campo donde Gerardo escribe notas)
created_at              TIMESTAMP
```

✅ **CONFIRMADO**: Las notas SÍ se guardan en `wholesale_orders.notes` durante la creación del pedido.

### Tabla Detalle: `wholesale_order_items`
**Campos encontrados**:
```sql
id                      UUID PRIMARY KEY
wholesale_order_id      UUID (FK)
partner_id              UUID
product_code            VARCHAR (SKU del producto)
product_name            VARCHAR (Ej: "Gato Mayor")
product_variant         VARCHAR (Ej: "Sabores Variados", "Limón", etc.)
product_size            VARCHAR (Ej: "Presentación Estándar", tamaño, etc.)
quantity                INTEGER (cantidad de piezas)
unit_price              NUMERIC (precio unitario)
subtotal                NUMERIC (quantity × unit_price) [calculado en UI]
notes                   TEXT | NULL (notas por producto, si existen)
```

### Vista: `v_wholesale_order_totals`
**Campos calculados**:
```sql
wholesale_order_id      UUID
partner_id              UUID
total_pieces            INTEGER (suma de quantities)
total_amount            NUMERIC (suma de subtotales)
total_paid              NUMERIC (suma de pagos)
pending_amount          NUMERIC (total_amount - total_paid)
computed_payment_status TEXT ('pending' | 'partial' | 'paid' | 'cancelled')
```

### Tabla Pagos: `wholesale_payments`
**Campos utilizados**:
```sql
id                      UUID PRIMARY KEY
partner_id              UUID
wholesale_order_id      UUID (FK) - Link a pedido específico
amount                  NUMERIC
payment_method          TEXT ('cash' | 'transfer' | 'card' | 'other')
reference               VARCHAR | NULL (ej: número de transferencia)
notes                   TEXT | NULL (notas del pago)
payment_date            DATE
created_at              TIMESTAMP
```

---

## 🎯 CAMPOS REALES ENCONTRADOS EN WHOLESALE_ORDER_ITEMS

**Estructura Confirmada** (línea 26-30 en types.ts):

| Campo | Tipo | Descripción | Mostrado en Modal |
|-------|------|-------------|-------------------|
| `id` | UUID | ID del item | ❌ No (interno) |
| `wholesale_order_id` | UUID | Relación a pedido | ❌ No (interno) |
| `partner_id` | UUID | ID del socio | ❌ No (interno) |
| `product_code` | VARCHAR | SKU | ✅ Sí (discreto) |
| `product_name` | VARCHAR | Nombre del producto | ✅ Sí (principal) |
| `product_variant` | VARCHAR | Sabor/Variante | ✅ Sí (línea 2) |
| `product_size` | VARCHAR | Presentación | ✅ Sí (línea 3) |
| `quantity` | INTEGER | Cantidad de piezas | ✅ Sí (destacado) |
| `unit_price` | NUMERIC | Precio unitario | ✅ Sí (alineado con cantidad) |
| `subtotal` | NUMERIC | quantity × unit_price | ✅ Sí (calculado en UI) |
| `notes` | TEXT \| NULL | Notas por producto | ✅ Sí (si existen) |

---

## 🔧 ARCHIVOS MODIFICADOS

### 1. [WholesaleOrderHistory.tsx](components/commercialPartners/wholesale/WholesaleOrderHistory.tsx)

**Cambios**:
- ✅ Agregado import: `Eye` icon y `WholesaleOrderDetailModal`
- ✅ Agregado state: `selectedOrderId` para controlar modal
- ✅ Modificado render: Botón "Detalle" en cada tarjeta
- ✅ Agregado: Modal condicional cuando `selectedOrderId` está set
- ✅ Grid actualizado: Ahora 5 columnas en lugar de 4 (para botón)

**Líneas clave**:
```tsx
// Línea 13: State para modal
const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

// Línea 71: Botón con icon Eye
<button
  onClick={() => setSelectedOrderId(order.id)}
  className="... px-2 py-1.5 bg-[#2d1a00] hover:bg-[#1a0f00]..."
>
  <Eye size={14} />
  Detalle
</button>

// Línea 80: Renderizado condicional del modal
{selectedOrderId && (
  <WholesaleOrderDetailModal 
    orderId={selectedOrderId} 
    onClose={() => setSelectedOrderId(null)} 
  />
)}
```

---

## 🎨 ARCHIVO CREADO

### 2. [WholesaleOrderDetailModal.tsx](components/commercialPartners/wholesale/WholesaleOrderDetailModal.tsx)

**Propósito**: Modal fullscreen con detalles completos de un pedido.

**Props**:
```typescript
interface Props {
  orderId: string      // UUID del pedido a mostrar
  onClose: () => void  // Callback para cerrar
}
```

**Estado Interno**:
```typescript
order: WholesaleOrder | null         // Datos base del pedido
items: WholesaleOrderItem[]          // Productos del pedido
total: WholesaleOrderTotal | null    // Totales calculados
payments: WholesalePayment[]         // Pagos asociados
loading: boolean                      // Estado de carga
error: string | null                 // Mensajes de error
```

**Queries Ejecutadas**:

#### Query 1: Cargar Pedido Base
```typescript
supabase
  .from('wholesale_orders')
  .select('*')
  .eq('id', orderId)
  .single()
```
**Resultado**: Obtiene todos los campos de `wholesale_orders` incluidas las notas.

#### Query 2: Cargar Productos
```typescript
supabase
  .from('wholesale_order_items')
  .select('*')
  .eq('wholesale_order_id', orderId)
  .order('id', { ascending: true })
```
**Resultado**: Todos los items con product_name, product_variant, product_size, quantity, unit_price.

#### Query 3: Cargar Totales
```typescript
supabase
  .from('v_wholesale_order_totals')
  .select('*')
  .eq('wholesale_order_id', orderId)
  .single()
```
**Resultado**: total_pieces, total_amount, total_paid, pending_amount, computed_payment_status.

#### Query 4: Cargar Pagos
```typescript
supabase
  .from('wholesale_payments')
  .select('*')
  .eq('wholesale_order_id', orderId)
  .order('payment_date', { ascending: false })
```
**Resultado**: Todos los pagos con payment_date, amount, payment_method, reference, notes.

**Lazy Loading**: ✅ Implementado
- Las queries se ejecutan SOLO cuando se abre el modal (useEffect en línea 25)
- No descarga items de todos los pedidos de antemano
- Mientras carga muestra spinner "Cargando detalle del pedido..."

**Secciones Renderizadas**:

1. **Encabezado del Pedido** (línea 96-117)
   - Folio (primeros 8 caracteres del UUID)
   - Fecha de pedido
   - Fecha de entrega
   - Estado de pago (badge con color)

2. **Sección Productos** (línea 119-164)
   - Título: "PRODUCTOS"
   - Para cada item:
     - Producto (nombre)
     - Sabor / Variante (si existe)
     - Presentación (si existe)
     - Código SKU (discreto, gris)
     - Cantidad en piezas
     - Precio unitario
     - Subtotal (verde, destacado)
   - Si no hay productos: Mensaje informativo

3. **Sección Notas** (línea 166-175)
   - Título: "NOTAS DEL VENDEDOR"
   - Contenido con formato preservado (whitespace-pre-wrap)
   - SOLO se renderiza si `order.notes` existe
   - Si no existen notas: Sección no se muestra

4. **Sección Totales** (línea 177-200)
   - Título: "TOTALES"
   - 4 columnas (responsive):
     - Total de piezas (azul)
     - Total pedido
     - Total pagado (verde)
     - Saldo pendiente (rojo)
   - Fondo azul claro para destacar

5. **Sección Pagos** (línea 202-241)
   - Título: "PAGOS"
   - Para cada pago:
     - Fecha
     - Monto (verde)
     - Método
     - Referencia
     - Notas (con truncate)
   - Si no hay pagos: "Sin pagos registrados"

**Manejo de Errores**:
```typescript
// Línea 65: Try-catch envolviendo todas las queries
// Línea 64: console.error() para debugging
// Línea 72-79: Modal de error con botón "Reintentar"
// Línea 83-91: Llamada a loadOrderDetails() en botón
```

**Diseño Responsivo**:
- Desktop: Grid de 4 columnas en totales
- Mobile: Grid de 2 columnas (línea 181: `md:grid-cols-4`)
- Overflow: `overflow-y-auto` para pedidos muy largos (línea 93)
- Padding y espaciado: Consistente con cat-corn-ops theme

**Colores y Estilos**:
- Background: `#D6A23A` (gold theme)
- Bordes: `border-[#c49330]`
- Texto principal: `#111111`
- Texto secundario: `#6b7280`
- Subtotales: `text-green-700`
- Saldo: `text-red-700`
- Fondo totales: `bg-blue-50`

---

## 📝 NOTAS: CONFIRMACIÓN DE PERSISTENCIA

**Pregunta**: ¿Las notas que Gerardo escribe se guardan realmente?

**Respuesta**: ✅ **SÍ, se guardan**

**Evidencia** (WholesaleOrderForm.tsx, línea 127):
```typescript
{
  partner_id: partnerId,
  order_date: orderDate,
  delivery_date: deliveryDate,
  payment_terms_hours: 72,
  minimum_order_pieces: MINIMUM_ORDER_PIECES,
  order_status: 'delivered',
  notes: notes || null,  // ✅ Las notas SÍ se insertan
}
```

**Flujo Completo**:
1. Gerardo escribe en textarea (línea 229 de WholesaleOrderForm.tsx)
2. Se guardan en variable `notes` (línea 24)
3. Durante `handleSave()` se envían al servidor (línea 127)
4. Se insertan en `wholesale_orders.notes` de Supabase
5. En el modal, se cargan y muestran (línea 54 de WholesaleOrderDetailModal.tsx)

---

## 🔗 DATOS DEL VENDEDOR

**Análisis**: ¿Se puede obtener quién registró la venta?

**Resultado**: ⚠️ **NO disponible sin migración**

**Razón**:
- La tabla `wholesale_orders` NO tiene campo `created_by` o `registered_by`
- Los pagos sí tienen usuarios (comisiones), pero los pedidos no
- Para agregar esto requeriría migración SQL

**Recomendación**: 
- Mantener el modal sin esta sección por ahora
- Si en el futuro se necesita, se puede agregar con una migración

---

## 💳 PAGOS: INTEGRACIÓN COMPLETA

**Carga de Pagos**: ✅ Implementada

**Query** (línea 56 de WholesaleOrderDetailModal.tsx):
```typescript
supabase
  .from('wholesale_payments')
  .select('*')
  .eq('wholesale_order_id', orderId)
  .order('payment_date', { ascending: false })
```

**Campos Mostrados en Modal**:
- payment_date → "Fecha"
- amount → "Monto" (verde, destacado)
- payment_method → "Método" (usando PAYMENT_METHOD_LABELS)
- reference → "Referencia"
- notes → "Notas"

**Comportamiento**:
- ✅ Solo lectura (NO editable)
- ✅ NO interfiere con flujo actual de "Registrar Pago"
- ✅ Mostrar "Sin pagos registrados" si no existen
- ✅ Ordenados por fecha más reciente primero

---

## 🤝 SOCIOS DUALES: COMPATIBILIDAD TOTAL

**Verificación** (CommercialPartnerDetail.tsx, línea 113):
```typescript
const mayoreoAllowed = partner.partner_model === 'mayoreo' || partner.wholesale_status === 'active';
```

✅ **FUNCIONA PARA DUALES**:
- Si `partner_model === 'comodato'` Y `wholesale_status === 'active'` → Socio dual
- Condición `mayoreoAllowed` retorna `true`
- Tab "Mayoreo" se renderiza
- Historial de compras es visible
- Modal funciona normalmente

**Ejemplo**:
```
Socio: Gerardo (Abarrotes El Don)
partner_model = 'comodato'
wholesale_status = 'active'

mayoreoAllowed = ('comodato' === 'mayoreo') || ('active' === 'active')
               = false || true
               = true ✅

→ Tab "Mayoreo" visible
→ Historial accesible
→ Modal funciona
```

---

## 📱 RESPONSIVE DESIGN

**Desktop (> 768px)**:
- Modal: `max-w-2xl` (ancho controlado)
- Encabezado: 4 columnas (Folio, Fecha, Entrega, Estado)
- Cada producto: 2 columnas (Info a izquierda, Precios a derecha)
- Totales: 4 columnas
- Pagos: 5 columnas

**Mobile (< 768px)**:
- Modal: `w-full mx-4` (ancho completo con márgenes)
- Encabezado: 2 columnas (responde automáticamente)
- Cada producto: 1 columna (stack vertical)
- Totales: 2 columnas
- Pagos: 2 columnas
- Overflow: `overflow-y-auto` para scroll vertical

**Evitado**:
- ❌ Tablas horizontales con scroll lateral
- ❌ Truncate de información importante
- ✅ Grid responsive con `md:` prefixes
- ✅ Tarjetas verticales en mobile
- ✅ Texto wrapping para referencias largas

---

## 🎯 NO MODIFICADO

**Según requisitos, mantuvimos intacto**:
- ❌ Supabase (0 migraciones)
- ❌ `commission_events`
- ❌ `commission_rules`
- ❌ `sync_conversion_bonus_for_partner`
- ❌ `activate_wholesale_partner` RPC
- ❌ `commercial_partner_movements`
- ❌ `commercial_partner_movement_items`
- ❌ `commercial_partner_payments`
- ❌ Lógica de creación de pedidos (WholesaleOrderForm)
- ❌ Lógica de comisiones
- ❌ Flujo de "Registrar Pago"

**Cambio fue de VISUALIZACIÓN solamente**.

---

## ✅ RESULTADO DE npm run build

**Status**: ✅ **EXITOSO**

```bash
$ npm run build

> cat-corn-ops@1.0.0 build
> tsc && vite build

✓ 2863 modules transformed.
dist/index.html                              1.14 kB │ gzip:   0.56 kB
dist/assets/index-BJpvT9Zs.css              16.38 kB │ gzip:   6.77 kB
dist/assets/purify.es-Csrj9YNg.js           28.14 kB │ gzip:  10.69 kB
dist/assets/index.es-w9hS9j0e.js           150.69 kB │ gzip:  51.55 kB
dist/assets/html2canvas.esm-CBrSDip1.js    201.42 kB │ gzip:  48.03 kB
dist/assets/index-BuWvJUI9.js            2,594.31 kB │ gzip: 693.58 kB

✓ built in 4.90s
```

**Verificaciones**:
- ✅ TypeScript: 0 errores de compilación
- ✅ Lint: 0 warnings (antes de build)
- ✅ Vite: 2863 módulos transformados exitosamente
- ✅ Output: Todos los assets generados correctamente
- ✅ Tiempo: 4.90 segundos

---

## 🔄 FLUJO COMPLETO DE USO

### Escenario: Gerardo quiere ver detalles de una venta de mayoreo

```
1. Gerardo abre CommercialPartnerDetail
   → Navega a tab "Mayoreo"
   
2. Ve sección "Historial de Compras"
   → Lista de tarjetas con:
     - Folio (primeros 8 chars)
     - Fecha
     - Total
     - Estado de pago
     - ✅ NUEVO: Botón "Detalle" con icon Eye
     
3. Haz click en botón "Detalle"
   → Se abre WholesaleOrderDetailModal
   → Modal muestra:
     a) Encabezado: Folio, fechas, estado pago
     b) Sección "PRODUCTOS":
        - Para cada producto:
          * Nombre (Gato Mayor)
          * Sabor (Sabores, Limón, etc.)
          * Presentación (tamaño)
          * Cantidad (piezas)
          * Precio unitario
          * Subtotal (destacado en verde)
     c) Sección "NOTAS DEL VENDEDOR" (si existen):
        - Notas completas que Gerardo escribió
     d) Sección "TOTALES":
        - Total de piezas
        - Total pedido
        - Total pagado
        - Saldo pendiente
     e) Sección "PAGOS":
        - Para cada pago registrado:
          * Fecha
          * Monto
          * Método
          * Referencia
          * Notas
          
4. Haz click "Cerrar"
   → Modal desaparece
   → Vuelves al historial
```

### Escenario: Socio Dual (Comodato + Mayoreo)

```
Socio: partner_model='comodato', wholesale_status='active'

1. En CommercialPartnerDetail:
   → mayoreoAllowed = true ✅
   → Tab "Mayoreo" aparece
   
2. Cliquea tab "Mayoreo"
   → Ve historial de compras de mayoreo
   → Funciona exactamente igual
   → Puede ver detalles de sus compras dual
```

---

## 📋 RESUMEN TÉCNICO

| Elemento | Descripción | Status |
|----------|-------------|--------|
| **Archivo Historial** | WholesaleOrderHistory.tsx | ✅ Modificado |
| **Archivo Modal** | WholesaleOrderDetailModal.tsx | ✅ Creado |
| **Tabla Principal** | wholesale_orders | ✅ Usada (sin cambios) |
| **Tabla Detalle** | wholesale_order_items | ✅ Usada (sin cambios) |
| **Vista Totales** | v_wholesale_order_totals | ✅ Usada (sin cambios) |
| **Tabla Pagos** | wholesale_payments | ✅ Usada (sin cambios) |
| **Notas Persistencia** | wholesale_orders.notes | ✅ Confirmadas |
| **Lazy Loading** | Items y pagos | ✅ Implementado |
| **Socios Duales** | Comodato + Mayoreo | ✅ Compatible |
| **Responsive** | Desktop/Mobile | ✅ Implementado |
| **Error Handling** | Try-catch + UI feedback | ✅ Completo |
| **TypeScript** | Tipado fuerte | ✅ Compilación OK |
| **Build** | npm run build | ✅ Exitoso |

---

## 🚀 PRÓXIMOS PASOS (OPCIONALES)

Si en el futuro se desea expandir:

1. **Agregar "Registrado por"**:
   - Migración: Agregar `created_by` a `wholesale_orders`
   - FK: Relacionar con `user_profiles`
   - Mostrar en modal

2. **Exportar PDF**:
   - Usar html2canvas (ya disponible en deps)
   - Generar PDF de detalle de compra

3. **Editar Notas Post-Venta**:
   - Agregar campo editable en modal
   - RPC para actualizar notas

4. **Historial de Cambios**:
   - Log de modificaciones a pedidos
   - Auditoría de quién cambió qué

5. **Filtros en Historial**:
   - Por fecha
   - Por estado de pago
   - Por monto

---

**Implementación completada sin modificar Supabase, manteniendo intacta toda la lógica de comisiones y pagos. El modal es de solo lectura y se enfoca únicamente en visualización mejorada del historial existente.**
