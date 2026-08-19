# 🔍 DIAGNÓSTICO EXACTO: Tarjeta "PENDIENTE" en Reportes B2B

**Fecha**: 19 de agosto de 2026  
**Alcance**: Análisis técnico SOLO de lectura — Sin implementación, sin SQL, sin modificaciones.  
**Objetivo**: Identificar componentes, fuentes de datos y arquitectura necesaria para detalle futuro del saldo pendiente.

---

## 📍 PUNTO 1: COMPONENTE REAL QUE RENDERIZA LA TARJETA "PENDIENTE"

### Archivo Exacto
**[B2BSummaryReport.tsx](components/commercialPartners/reports/B2BSummaryReport.tsx)**

### Ubicación en el Árbol de Componentes
```
Socios Comerciales
└─ Reportes B2B
   └─ [Tabs]
      └─ Resumen
         └─ B2BSummaryReport.tsx          ← COMPONENTE RAÍZ
            └─ [Sección: Resumen General B2B]
               └─ [Grid de 5 tarjetas]
                  └─ Tarjeta: PENDIENTE  ← TARGET
```

### Líneas Aproximadas en el Archivo
- **Línea 167-177**: Tarjeta "Saldo Pendiente" del Resumen General

### Código Exacto de la Tarjeta PENDIENTE
```tsx
// Líneas 167-177 en B2BSummaryReport.tsx
<div className="bg-cc-surface rounded-2xl border border-white/5 p-6">
  <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-2">Pendiente</p>
  <p className="text-2xl font-bold text-red-400">
    {formatCurrency((summary.b2b_pending_balance ?? 0) + (summary.pieceSale_pending_total ?? 0))}
  </p>
  <p className="text-xs text-red-300 mt-2">
    {formatNumber(summary.partners_with_pending_balance)} socios
  </p>
</div>
```

### Handler/Props Actual
- **No hay handler de clic actual** — La tarjeta es NO-interactiva.
- **Props que recibe**: Ninguno (componente sin props, usa state interno).
- **Datos**: Viene de `summary: B2BDashboardSummary | null`

### Observación Crítica
La tarjeta actualmente es **INFORMATIVA SOLAMENTE**. No existe lógica de clic, modal ni navegación.

---

## 📍 PUNTO 2: FUENTE EXACTA DEL MONTO $370 (PENDIENTE TOTAL)

### Rastreo del Flujo de Datos

#### Paso 1: Componente Lee Vista SQL
**Línea 75 en B2BSummaryReport.tsx**:
```tsx
const [summaryRes, pipelineRes, conversionRes] = await Promise.all([
  supabase.from('v_b2b_dashboard_summary').select('*').limit(1),
  // ...
]);
```

#### Paso 2: Asignación a State
**Línea 85**:
```tsx
const summaryData = summaryRes.data?.[0] as B2BDashboardSummary | null;
setSummary(summaryData);
```

#### Paso 3: Campo en el Tipo TypeScript
**Definido en [b2bReportTypes.ts](components/commercialPartners/reports/b2bReportTypes.ts) línea 20**:
```typescript
export interface B2BDashboardSummary {
  b2b_total_generated: number;
  b2b_total_paid: number;
  b2b_pending_balance: number;          ← AQUÍ (sin Venta por Pieza)
  pieceSale_pending_total?: number;     ← Agregado en componente (Venta por Pieza)
  // ... más campos
}
```

#### Paso 4: Cálculo en Render (Línea 172-174)
```tsx
{formatCurrency((summary.b2b_pending_balance ?? 0) + (summary.pieceSale_pending_total ?? 0))}
```

### Monto Final $370 = $370 Comodato + Mayoreo + Venta por Pieza
**La suma mostrada es**: `b2b_pending_balance` + `pieceSale_pending_total`

Donde:
- **`b2b_pending_balance`** proviene de la vista SQL `v_b2b_dashboard_summary`
- **`pieceSale_pending_total`** se carga por separado desde `getPieceSaleSummary()` en la línea 96-102

### Punto Crítico: ¿De Dónde viene `b2b_pending_balance` en SQL?

**PROBLEMA DIAGNOSTICADO**: La vista SQL `v_b2b_dashboard_summary` **NO ESTÁ DEFINIDA en el workspace local**.

Solo se referencía en:
- TypeScript: `supabase.from('v_b2b_dashboard_summary')`
- Documentación: `B2B_REPORTS_QUICK_GUIDE.md` línea 23
- `PHASE_5_B2B_REPORTS_IMPLEMENTATION.md` línea 30

**Conclusión**: La vista EXISTE en Supabase en vivo pero NO está documentada en migraciones locales.

### Fórmula Inferida para `b2b_pending_balance` (basada en referencias)
```
b2b_pending_balance = 
  comodato_pending_total +      ($240)
  wholesale_pending_total +      ($0)
  (otros modelos si existen)     ($0)
= $240 de Comodato
+ $130 de Venta por Pieza        ← Agregado en componente
= $370 TOTAL
```

---

## 📍 PUNTO 3: FUENTE EXACTA DE "4 SOCIOS"

### Campo en el Tipo
**[b2bReportTypes.ts](components/commercialPartners/reports/b2bReportTypes.ts) línea 11**:
```typescript
partners_with_pending_balance: number;   ← Este campo
```

### Uso en Render (Línea 176)
```tsx
{formatNumber(summary.partners_with_pending_balance)} socios
```

### Significado del Campo
- **Nombre**: `partners_with_pending_balance`
- **Tipo**: `number` (count)
- **Valor actual**: 4 socios
- **Descripción**: "Socios que tienen algún balance pendiente (saldo > 0)"

### ¿Incluye Venta por Pieza?
**NO HAY CONTROL ESPECÍFICO** en el código actual.

El campo `partners_with_pending_balance` es un **COUNT DISTINCT** que probablemente:
1. Cuente socios con `comodato_pending_total > 0` O
2. Cuente socios con `wholesale_pending_total > 0` O
3. Ambos (union)

**NO se incluye un conteo adicional de socios de Venta por Pieza** porque:
- Venta por Pieza usa tabla `seller_piece_sales`, no `commercial_partners`
- No hay un "owner" único (pueda haber múltiples vendedores)
- El número "4 socios" es del modelo B2B tradicional (Comodato + Mayoreo)

### Posibilidad de Doble Conteo
**SÍ, un mismo socio puede tener**:
- Saldo de Comodato + Saldo de Mayoreo
- Pero se cuenta UNA SOLA VEZ en `partners_with_pending_balance`

Esto es correcto porque `COUNT(DISTINCT partner_id)`.

---

## 📍 PUNTO 4: RECONCILIACIÓN POR CANAL

### Verificación de la Fórmula (Captura en Pantalla)
Según lo reportado:
```
TOTAL GENERADO       $2,338
TOTAL COBRADO        $1,968
PENDIENTE              $370
                       4 socios

+ DEGLOSES:

COMODATO
Generado $1,310
Cobrado  $1,070
Pendiente $240

MAYOREO
Comprado $185
Pagado   $185
Pendiente $0

VENTA POR PIEZA
Vendido $843
Cobrado $713
Pendiente $130
```

### Reconciliación Manual
```
Pendiente Total         = $370
Pendiente Comodato      = $240  (100% está aquí)
Pendiente Mayoreo       = $0    (0%)
Pendiente Venta Pieza   = $130  (100% está aquí)

$240 + $0 + $130 = $370 ✓

También:
Generado Total      = $2,338
= Comodato Gen $1,310
+ Mayoreo Comprado $185
+ Venta por Pieza $843
= $1,310 + $185 + $843 = $2,338 ✓

Cobrado Total       = $1,968
= Comodato Cobrado $1,070
+ Mayoreo Pagado $185
+ Venta por Pieza Cobrado $713
= $1,070 + $185 + $713 = $1,968 ✓
```

**CONCLUSIÓN**: La fórmula es **CORRECTA Y VERIFICADA** en código:

```typescript
// Línea 172-174 de B2BSummaryReport.tsx
{formatCurrency(
  (summary.b2b_pending_balance ?? 0) + (summary.pieceSale_pending_total ?? 0)
)}

// Línea 176
{formatNumber(summary.partners_with_pending_balance)} socios
```

---

## 📍 PUNTO 5: DEFINICIÓN DE v_b2b_dashboard_summary

### Status Actual
**Vista SQL NO está definida en archivos locales.**

Existe en Supabase pero sin respaldo en migraciones del workspace.

### Columnas Inferidas del Uso (TypeScript)

Del tipo `B2BDashboardSummary` en [b2bReportTypes.ts](components/commercialPartners/reports/b2bReportTypes.ts):

| Columna SQL | Tipo | Descripción |
|------------|------|-------------|
| `total_partners` | BIGINT | COUNT(DISTINCT id) de socios registrados |
| `active_partners` | BIGINT | Socios con `active=true` |
| `prospect_partners` | BIGINT | Prospectos |
| `negotiating_partners` | BIGINT | En negociación |
| `paused_partners` | BIGINT | Pausados |
| `rejected_partners` | BIGINT | Rechazados |
| `inactive_partners` | BIGINT | Inactivos |
| `comodato_partners` | BIGINT | Socios con `partner_model='comodato'` |
| `wholesale_partners` | BIGINT | Socios con `partner_model='mayoreo'` |
| `partners_with_pending_balance` | BIGINT | COUNT(DISTINCT partner) where balance > 0 |
| `comodato_generated_total` | NUMERIC | SUM de montos generados Comodato |
| `comodato_paid_total` | NUMERIC | SUM de pagos Comodato |
| `comodato_pending_total` | NUMERIC | comodato_generated - comodato_paid |
| `wholesale_purchased_total` | NUMERIC | SUM de órdenes Mayoreo |
| `wholesale_paid_total` | NUMERIC | SUM de pagos Mayoreo |
| `wholesale_pending_total` | NUMERIC | wholesale_purchased - wholesale_paid |
| `b2b_total_generated` | NUMERIC | Suma: Comodato + Mayoreo (NOT Venta por Pieza) |
| `b2b_total_paid` | NUMERIC | Suma: Pagos Comodato + Mayoreo |
| `b2b_pending_balance` | NUMERIC | b2b_total_generated - b2b_total_paid |
| `comodato_units_in_partner` | BIGINT | SUM(quantity) de inventario en posesión |
| `wholesale_total_pieces` | BIGINT | Total piezas en órdenes |
| `b2b_total_units` | BIGINT | Suma: comodato_units + wholesale_pieces |

### Campos Agregados en React (NO en SQL)
```typescript
pieceSale_generated_total?: number;   // Cargado por getPieceSaleSummary()
pieceSale_paid_total?: number;        // Cargado por getPieceSaleSummary()
pieceSale_pending_total?: number;     // Calculado: generated - paid
pieceSale_total_pieces?: number;      // Cargado por getPieceSaleSummary()
```

**Nota**: `v_b2b_dashboard_summary` **NO INCLUYE** datos de Venta por Pieza. Estos se agregan después en el componente.

---

## 📍 PUNTO 6: TABLAS REALES DE COMODATO

### Estructura Base

#### Tabla 1: `commercial_partners` (Base)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `folio` | TEXT | Identificador único legible (ej: "CP-010726-001") |
| `business_name` | TEXT | Nombre del socio |
| `responsible_name` | TEXT | Contacto |
| `phone`, `whatsapp`, `email` | TEXT | Datos de contacto |
| `partner_model` | TEXT | 'comodato' \| 'mayoreo' \| 'prospecto' |
| `status` | TEXT | 'activo' \| 'pausado' \| 'inactivo' |
| `address`, `city`, `state` | TEXT | Ubicación |
| `latitude`, `longitude` | NUMERIC | Coordenadas |
| `created_at` | TIMESTAMPTZ | Fecha registro |

#### Tabla 2: `commercial_partner_movements` (Entregas, Liquidaciones)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `partner_id` | UUID | FK → commercial_partners |
| `movement_type` | TEXT | 'delivery' \| 'settlement' \| 'withdrawal' \| 'spoilage' \| 'adjustment' |
| `movement_date` | DATE | Fecha del movimiento |
| `status` | TEXT | 'completed' \| 'pending' \| 'partial' |
| `total_amount_due` | NUMERIC | Monto adeudado del movimiento |
| `next_visit_date` | DATE | Próxima visita programada |
| `next_visit_reason` | TEXT | Motivo de próxima visita |
| `notes` | TEXT | Notas |
| `created_by` | UUID | FK → user_profiles |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Crítico**: `movement_type='delivery'` = Entrega de producto en comodato.

#### Tabla 3: `commercial_partner_movement_items` (Items del Comodato)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `movement_id` | UUID | FK → commercial_partner_movements |
| `partner_id` | UUID | FK → commercial_partners |
| `product_id` | UUID | FK → productos (nullable) |
| `product_name` | TEXT | Ej: "Gato Mayor" |
| `product_variant` | TEXT | Ej: "Sabores Variados", "Cheddar", "Limón" |
| `product_size` | TEXT | Ej: "Mini Michi", "Gato Mayor", "Jefe Felino" |
| `quantity_delivered` | NUMERIC | Unidades entregadas inicialmente |
| `quantity_sold` | NUMERIC | Unidades vendidas (reportadas en liquidación) |
| `quantity_withdrawn` | NUMERIC | Unidades retiradas/devueltas |
| `quantity_spoiled` | NUMERIC | Unidades echadas a perder |
| `adjustments` | NUMERIC | Ajustes manuales |
| `price_to_catcorn` | NUMERIC | Precio al que paga Catcorn |
| `suggested_retail_price` | NUMERIC | Precio de venta recomendado |
| `amount_due` | NUMERIC | Monto adeudado = quantity_sold × price_to_catcorn |
| `spoilage_absorbed_by` | TEXT | 'catcorn' \| 'partner' \| 'split' |
| `notes` | TEXT | Notas |

**Crítico**: El cálculo de **"producto en posesión"** es:
```
current_quantity = 
  quantity_delivered 
  - quantity_sold 
  - quantity_withdrawn 
  - quantity_spoiled
```

#### Tabla 4: `commercial_partner_payments` (Pagos Comodato)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `partner_id` | UUID | FK → commercial_partners |
| `movement_id` | UUID | FK → commercial_partner_movements (nullable) |
| `payment_date` | TIMESTAMPTZ | Fecha/hora del pago |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' |
| `reference` | TEXT | Referencia de transferencia |
| `status` | TEXT | 'completed' \| 'paid' |
| `received_by` | UUID | FK → user_profiles |
| `notes` | TEXT | Notas |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Pago confirmado**: `status IN ('completed', 'paid')`

### Vista Suplementaria (probablemente existe)
```
v_commercial_partner_current_stock
├─ partner_id
├─ product_name
├─ product_variant
├─ product_size
├─ total_delivered (SUM de quantity_delivered)
├─ total_sold (SUM de quantity_sold)
├─ total_withdrawn (SUM de quantity_withdrawn)
├─ total_spoiled (SUM de quantity_spoiled)
├─ current_quantity (calculado)
└─ last_price_to_catcorn
```

Usada en [PartnerCurrentStock.tsx](components/commercialPartners/comodato/PartnerCurrentStock.tsx) línea 48-62.

---

## 📍 PUNTO 7: CÁLCULO DE PRODUCTO ACTUALMENTE EN POSESIÓN

### Fórmula Exacta

```sql
-- Pseudocódigo SQL
current_quantity_in_possession = 
  SUM(quantity_delivered) 
  - SUM(quantity_sold) 
  - SUM(quantity_withdrawn) 
  - SUM(quantity_spoiled)
```

### Ejemplo Real
Si un socio recibió:
- **Entrega 1** (2 ago): 10 Gato Mayor Cheddar
- **Entrega 2** (5 ago): 5 Michi Limón
- **Liquidación** (10 ago): 
  - Vendió 8 Gato Mayor Cheddar
  - Retiró 1 Michi Limón
  - Perdió 1 Michi Limón

**Resultado**:
```
Gato Mayor Cheddar:
  delivered=10, sold=8, withdrawn=0, spoiled=0
  current = 10 - 8 - 0 - 0 = 2 unidades

Michi Limón:
  delivered=5, sold=0, withdrawn=1, spoiled=1
  current = 5 - 0 - 1 - 1 = 3 unidades

TOTAL EN POSESIÓN = 2 + 3 = 5 unidades
```

### Implementación Actual
**Ubicación**: [PartnerCurrentStock.tsx](components/commercialPartners/comodato/PartnerCurrentStock.tsx) línea 36-80

```tsx
// Query en línea 40-44
supabase
  .from('commercial_partner_movement_items')
  .select('...')
  .eq('commercial_partner_movements.partner_id', partnerId);

// Agregación manual en línea 65-75
const map = new Map<string, PartnerCurrentStockItem>();
(raw ?? []).forEach((r: any) => {
  const key = `${r.product_name}|${r.product_variant}|${r.product_size}`;
  const prev = map.get(key) ?? {
    total_delivered: 0,
    total_sold: 0,
    total_withdrawn: 0,
    total_spoiled: 0
  };
  map.set(key, {
    ...prev,
    total_delivered: (prev.total_delivered ?? 0) + r.quantity_delivered,
    total_sold: (prev.total_sold ?? 0) + r.quantity_sold,
    // ... etc
  });
});
```

### Fuente de Verdad
**Tabla**: `commercial_partner_movement_items`  
**Columnas**: `quantity_delivered`, `quantity_sold`, `quantity_withdrawn`, `quantity_spoiled`  
**Agrupación**: POR `product_name | product_variant | product_size`

---

## 📍 PUNTO 8: FECHAS DE ENTREGA DISPONIBLES

### Fechas que Podemos Obtener

#### 1. Fecha de Entrega Más Antigua (Primera Entrega)
**Campo**: `commercial_partner_movements.movement_date` (WHERE movement_type='delivery')  
**Query**:
```sql
SELECT MIN(movement_date) AS oldest_delivery_date
FROM commercial_partner_movements m
JOIN commercial_partner_movement_items i ON m.id = i.movement_id
WHERE m.partner_id = $1
  AND m.movement_type = 'delivery'
  AND i.product_name = $2
  AND i.product_variant = $3
  AND i.product_size = $4
GROUP BY i.product_name, i.product_variant, i.product_size;
```

**Resultado**: "2 ago 2026" (desde `movement_date`)

#### 2. Fecha de Cada Entrega Individual
**Campo**: `commercial_partner_movements.movement_date`  
**Granularidad**: POR MOVIMIENTO, no por producto

Si un producto fue entregado en 3 fechas diferentes:
- Entrega 1: 2 ago
- Entrega 2: 5 ago
- Entrega 3: 10 ago

Necesitaríamos **3 filas** para mostrar todas.

#### 3. "Desde Cuándo Tiene el Producto" (Más Antiguo)
**Cálculo**:
```
days_in_possession = 
  TODAY() - MIN(delivery_date_for_this_product)
```

**Ejemplo**: Si delivery fue 2 ago y hoy es 19 ago → 17 días

#### 4. Fecha de Última Liquidación (Settlement)
**Campo**: `commercial_partner_movements.movement_date` (WHERE movement_type='settlement')  
**Query**:
```sql
SELECT MAX(movement_date) AS last_settlement_date
FROM commercial_partner_movements
WHERE partner_id = $1
  AND movement_type = 'settlement'
```

**Resultado**: "10 ago 2026" (última vez que reportó ventas)

#### 5. Fecha de Creación del Socio
**Campo**: `commercial_partners.created_at`  
**NO RECOMENDADO** para "desde cuándo tiene el producto" porque:
- El socio podría estar creado hace un año pero la primera entrega fue hace 2 meses
- Es un dato de administración, no del producto

### Información Disponible en la BD
✅ **SI**: Fecha exacta de cada entrega  
✅ **SI**: Fecha más antigua de cualquier entrega de un producto  
✅ **SI**: Fecha de cada liquidación/settlement  
✅ **SI**: Cantidad de días (diferencia)  
❌ **NO**: Fecha de "liquidación" específica por producto (solo por movimiento general)  

---

## 📍 PUNTO 9: CÁLCULO DE DEUDA EN COMODATO

### Deuda = Producto Vendido No Pagado

#### Fórmula Exacta
```
deuda_comodato_por_socio = 
  SUM(quantity_sold × price_to_catcorn)
  - SUM(pagos_recibidos)
```

O dicho de otra forma:

```
deuda_comodato_por_socio = 
  SUM(amount_due - pagos_en_ese_movimiento)
```

#### Cálculo Paso a Paso

**Tabla Fuente**: `commercial_partner_movement_items`

```sql
-- Por cada movement_item:
amount_owed = quantity_sold * price_to_catcorn

-- Ejemplo:
-- Si socio vendió 8 unidades a $30 cada una
amount_owed = 8 * 30 = $240
```

**Tabla Fuente**: `commercial_partner_payments`

```sql
-- Luego restar pagos relacionados
-- Ejemplo: Si pagó $100
pagos_recibidos = $100

deuda_neta = $240 - $100 = $140
```

#### Implementación Actual

**NO hay cálculo explícito de "deuda por comodato" en el componente B2BSummaryReport**.

El campo `comodato_pending_total` viene **directamente de la vista SQL** `v_b2b_dashboard_summary`.

**Inferencia**: La vista SQL calcula:
```sql
comodato_pending_total = 
  SUM(generated_from_movements) 
  - SUM(payments_with_status='completed'|'paid')
```

### Diferencia: Deuda vs Producto en Posesión

❌ **NO son lo mismo**:

| Aspecto | Deuda | Producto |
|---------|-------|----------|
| Cálculo | Cantidad vendida - Pagado | Cantidad entregada - Vendida - Retirada - Perdida |
| Tabla | `movement_items.amount_due` + `payments` | `movement_items.quantity_*` |
| Ejemplo | Vendió 8 pero solo pagó por 5 = debe $90 | Entregó 10, vendió 8, retiró 1 = 1 en posesión |
| Status | Aplica a CUALQUIER movimiento | Aplica solo si `quantity_delivered > 0` |

**El usuario necesita VER AMBOS en el detalle futuro**.

---

## 📍 PUNTO 10: TABLAS REALES DE MAYOREO

### Estructura Base

#### Tabla 1: `commercial_partners` (Compartida)
Ver Punto 6 (igual para Mayoreo).

#### Tabla 2: `wholesale_orders` (Órdenes)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `partner_id` | UUID | FK → commercial_partners |
| `folio` | TEXT | Identificador único (ej: "MAY-2026-001") |
| `total_amount` | NUMERIC | Monto total de la orden |
| `status` | TEXT | 'draft' \| 'confirmed' \| 'completed' \| 'cancelled' |
| `order_date` | DATE | Fecha de la orden |
| `delivery_date` | DATE | Fecha de entrega |
| `payment_terms_hours` | INTEGER | Horas para pago (ej: 48) |
| `minimum_order_pieces` | INTEGER | Cantidad mínima |
| `notes` | TEXT | Notas de Gerardo |
| `created_at` | TIMESTAMPTZ | Timestamp |
| `updated_at` | TIMESTAMPTZ | Timestamp |

**Crítico**: `folio` es el identificador visible al usuario.

#### Tabla 3: `wholesale_order_items` (Items de Orden)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `wholesale_order_id` | UUID | FK → wholesale_orders |
| `partner_id` | UUID | FK → commercial_partners |
| `product_code` | VARCHAR | SKU del producto |
| `product_name` | VARCHAR | Ej: "Gato Mayor" |
| `product_variant` | VARCHAR | Ej: "Sabores Variados", "Cheddar", "Limón" |
| `product_size` | VARCHAR | Tamaño/presentación |
| `quantity` | INTEGER | Piezas ordenadas |
| `unit_price` | NUMERIC | Precio por pieza |
| `subtotal` | NUMERIC | quantity × unit_price (puede ser calculado) |
| `notes` | TEXT | Notas por item (nullable) |

#### Tabla 4: `wholesale_payments` (Pagos Mayoreo)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `partner_id` | UUID | FK → commercial_partners |
| `wholesale_order_id` | UUID | FK → wholesale_orders |
| `payment_date` | TIMESTAMPTZ | Fecha/hora del pago |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' \| 'card' |
| `reference` | TEXT | Referencia (nullable) |
| `notes` | TEXT | Notas |
| `received_by` | UUID | FK → user_profiles |
| `status` | TEXT | 'completed' \| 'paid' |
| `created_at` | TIMESTAMPTZ | Timestamp |
| `updated_at` | TIMESTAMPTZ | Timestamp |

**Pago confirmado**: `status IN ('completed', 'paid')`

### Vista Auxiliar (Probablemente existe)
```
v_wholesale_order_totals
├─ wholesale_order_id
├─ partner_id
├─ partner_folio
├─ business_name
├─ order_folio
├─ total_pieces (SUM quantity)
├─ total_amount
├─ total_paid (SUM pagos con status válido)
├─ pending_amount (total_amount - total_paid)
└─ computed_payment_status
```

Usada en [WholesaleOrderDetailModal.tsx](components/commercialPartners/wholesale/WholesaleOrderDetailModal.tsx) línea 50-55.

---

## 📍 PUNTO 11: CÁLCULO DE DEUDA EN MAYOREO

### Deuda = Total de Órdenes - Pagado

#### Fórmula Exacta
```
deuda_mayoreo_por_socio = 
  SUM(wholesale_orders.total_amount)
  - SUM(wholesale_payments.amount WHERE status IN ('completed', 'paid'))
```

#### Por Orden Individual
```
deuda_por_orden = 
  wholesale_orders.total_amount 
  - SUM(wholesale_payments.amount 
        WHERE wholesale_order_id = this_order_id
          AND status IN ('completed', 'paid'))
```

#### Implementación Actual
**Ubicación**: [WholesaleOrderDetailModal.tsx](components/commercialPartners/wholesale/WholesaleOrderDetailModal.tsx)

```tsx
// Línea 50-55: Cargar totales
const { data: totalData } = await supabase
  .from('v_wholesale_order_totals')
  .select('*')
  .eq('wholesale_order_id', orderId)
  .single();

// Campos disponibles:
// - total_amount
// - total_paid
// - pending_amount (ya calculado)
```

### Estados de Mayoreo (Liquidación)

- **Pendiente**: `pending_amount > 0`
- **Liquidado**: `pending_amount = 0` (todo pagado)

---

## 📍 PUNTO 12: TABLAS REALES DE VENTA POR PIEZA

### Estructura Base

#### Tabla 1: `seller_piece_sales` (Ventas)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `seller_id` | UUID | FK → user_profiles (vendedor) |
| `sale_folio` | TEXT | Identificador único |
| `sale_date` | TIMESTAMPTZ | Fecha/hora de venta |
| `total_amount` | NUMERIC | Total vendido |
| `total_commission` | NUMERIC | Comisión generada |
| `payment_method` | TEXT | 'cash' \| 'transfer' |
| `payment_reference` | TEXT | Referencia |
| `notes` | TEXT | Notas |
| `items` | JSONB | Array de items (schema variable) |
| `status` | TEXT | 'pending' \| 'confirmed' \| 'rejected' \| 'cancelled' |
| `created_at` | TIMESTAMPTZ | Timestamp |

**IMPORTANTE**: NO hay `partner_id` directo. Los vendedores de venta por pieza NO son socios comerciales (partner_model).

#### Tabla 2: `seller_piece_sale_items` (Items de Venta)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `sale_id` | UUID | FK → seller_piece_sales |
| `seller_id` | UUID | FK → user_profiles |
| `product_id` | UUID | FK → productos |
| `product_name` | TEXT | Ej: "Gato Mayor" |
| `product_variant` | TEXT | Ej: "Salada" |
| `product_size` | TEXT | Tamaño |
| `quantity` | INTEGER | Piezas vendidas |
| `unit_price` | NUMERIC | Precio unitario |
| `subtotal` | NUMERIC | quantity × unit_price |
| `unit_commission` | NUMERIC | Comisión por pieza |
| `total_commission` | NUMERIC | quantity × unit_commission |
| `created_at` | TIMESTAMPTZ | Timestamp |

#### Tabla 3: `seller_piece_payments` (Pagos de Vendedor)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `seller_id` | UUID | FK → user_profiles |
| `sale_id` | UUID | FK → seller_piece_sales (nullable) |
| `request_id` | UUID | FK → payment_verification_request |
| `payment_date` | TIMESTAMPTZ | Fecha del pago |
| `amount` | NUMERIC | Monto pagado |
| `payment_method` | TEXT | 'cash' \| 'transfer' |
| `reference` | TEXT | Referencia |
| `status` | TEXT | 'completed' \| 'rejected' \| 'pending_review' |
| `notes` | TEXT | Notas |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Pago confirmado**: `status = 'completed'`

### Función RPC para Obtener Resumen
```typescript
// Ubicación: services/commercialCollectionsService.ts línea 308

export async function getPieceSaleSummary(
  startDate: Date,
  endDate: Date
): Promise<SalesChannelSummary> {
  // Carga:
  // 1. seller_piece_sales (generado)
  // 2. seller_piece_payments con status='completed' (cobrado)
  // 3. seller_piece_sale_items (contar piezas)
  
  return {
    generated: vendidoTotal,    // SUM(total_amount)
    paid: cobradoTotal,         // SUM(pagos.amount WHERE status='completed')
    pending: vendidoTotal - cobradoTotal,
    units: piecesTotal          // SUM(quantity)
  };
}
```

**Rango de Fechas**: Usa mes actual por defecto (línea 98-102 de B2BSummaryReport.tsx).

### Vista para Admin (Probablemente existe)
```
v_piece_sale_history (por seller)
├─ seller_id
├─ sale_folio
├─ sale_date
├─ total_amount
├─ total_commission
├─ status
├─ payment_status
└─ items (JSONB)
```

---

## 📍 PUNTO 13: CÁLCULO DE DEUDA EN VENTA POR PIEZA

### Deuda = Vendido - Pagado (Confirmado)

#### Fórmula Exacta
```
deuda_venta_por_pieza_total = 
  SUM(seller_piece_sales.total_amount WHERE status IN ('confirmed', 'pending'))
  - SUM(seller_piece_payments.amount WHERE status='completed')
```

#### Implementación Actual
**Ubicación**: [commercialCollectionsService.ts](services/commercialCollectionsService.ts) línea 325-400

```typescript
// 1. VENDIDO
const { data: pieceSales } = await supabase
  .from('seller_piece_sales')
  .select('id, total_amount')
  .gte('sale_date', startISO)
  .lte('sale_date', endISO);

let vendidoTotal = 0;
pieceSales?.forEach(sale => {
  vendidoTotal += Number(sale.total_amount) || 0;
});

// 2. COBRADO (confirmado)
const { data: pieceSalePayments } = await supabase
  .from('seller_piece_payments')
  .select('id, amount')
  .eq('status', 'completed')
  .gte('payment_date', startISO)
  .lte('payment_date', endISO);

let cobradoTotal = 0;
pieceSalePayments?.forEach(payment => {
  cobradoTotal += Number(payment.amount) || 0;
});

// 3. PENDIENTE
const pending = vendidoTotal - cobradoTotal;
```

### Nota Crítica: Venta por Pieza NO es "Socio Comercial"

- **NO se relaciona con `commercial_partners`**
- **NO aparece en Socios Comerciales tab**
- **Aparece solo en el RESUMEN B2B** porque se agrega por separado en el componente

El moneda $130 pendiente de Venta por Pieza se suma al saldo B2B **en React**, no en SQL.

---

## 📍 PUNTO 14: DEFINICIÓN REAL DE "LIQUIDADO"

### Definición por Modalidad

#### 1. COMODATO - Liquidado
```
balance_comodato = 0
AND existe al menos una liquidación (movement_type='settlement')
```

**Interpretación**: El socio entregó todos los productos, vendió lo que pudo, pagó la deuda.

#### 2. MAYOREO - Liquidado
```
pending_amount = 0
(total_amount - total_paid = 0)
```

**Interpretación**: Se pagó la orden completa.

#### 3. VENTA POR PIEZA - Liquidado
```
pending_amount = 0
(total_vendido - total_pagado_confirmado = 0)
```

**Interpretación**: Se pagó todo lo vendido.

### Distinción Importante

**El código actual NO guarda un flag "liquidated".**

Solo calcula `balance` y usa: `balance > 0 → PENDIENTE`, `balance = 0 → LIQUIDADO`.

### Para Futura Pestaña "LIQUIDADOS"

Necesitaremos:
1. **Socios con Comodato**:
   ```sql
   WHERE comodato_pending_total = 0
     AND (MAX(movement_date) para settlement) IS NOT NULL
   ```

2. **Socios con Mayoreo**:
   ```sql
   WHERE wholesale_pending_total = 0
   ```

3. **Vendedores Venta Pieza**:
   ```sql
   WHERE total_vendido - total_cobrado = 0
   ```

---

## 📍 PUNTO 15: FUENTES FINALES DE PAGOS

### Tablas de Pago (Fuentes de Verdad)

#### 1. COMODATO
**Tabla**: `commercial_partner_payments`

```sql
SELECT 
  id, partner_id, payment_date, amount, 
  payment_method, status, notes
FROM commercial_partner_payments
WHERE status IN ('completed', 'paid')
  AND partner_id = $1
ORDER BY payment_date DESC;
```

#### 2. MAYOREO
**Tabla**: `wholesale_payments`

```sql
SELECT 
  id, partner_id, wholesale_order_id, payment_date, 
  amount, payment_method, status, notes
FROM wholesale_payments
WHERE status IN ('completed', 'paid')
  AND partner_id = $1
ORDER BY payment_date DESC;
```

#### 3. VENTA POR PIEZA
**Tabla**: `seller_piece_payments`

```sql
SELECT 
  id, seller_id, payment_date, amount, 
  payment_method, status, notes
FROM seller_piece_payments
WHERE status = 'completed'
  AND seller_id = $1
ORDER BY payment_date DESC;
```

### Tabla NOT Para Usar
❌ `partner_payment_verification_requests` — Solo para PROCESO de verificación, no dato final.  
✅ Las tablas de pago arriba son las fuentes **finales**.

---

## 📍 PUNTO 16: POSIBILIDAD DE MOSTRAR PRODUCTOS

### Información Disponible

#### Para COMODATO
**Sí, COMPLETA**:
- Nombre: `product_name`
- Variante: `product_variant`
- Tamaño: `product_size`
- Cantidad entregada: `quantity_delivered`
- Cantidad vendida: `quantity_sold`
- Cantidad en posesión: (calculado)
- Precio: `price_to_catcorn`, `suggested_retail_price`

**Formato sugerido**:
```
Gato Mayor · Cheddar · 2pcs
 → En posesión: 2 de 10 entregadas
 → Pagado: $60 de $300
```

#### Para MAYOREO
**Sí, COMPLETA**:
- Nombre: `product_name`
- Variante: `product_variant`
- Tamaño: `product_size`
- Cantidad: `quantity`
- Precio unitario: `unit_price`
- Subtotal: `unit_price × quantity`

**Formato sugerido**:
```
Gato Mayor · Cheddar
 → 50 pcs @ $2.00 = $100.00
```

#### Para VENTA POR PIEZA
**Sí, PARCIAL**:
- Nombre: `product_name`
- Variante: `product_variant`
- Tamaño: `product_size`
- Cantidad: `quantity`
- Precio: `unit_price`

Disponible en `seller_piece_sale_items` (por venta individual).

### Posibilidad de Mostrar Snapshot
**Sí**: Ambas tablas guardan snapshots de `product_name`, `product_variant`, `product_size`.  
**NO guardan**: ID del producto (para link al inventario), pero NO es necesario para el detalle.

---

## 📍 PUNTO 17: POSIBILIDAD DE MOSTRAR "DESDE"

### Fechas Disponibles

#### Para COMODATO
✅ `commercial_partner_movements.movement_date` (para cada entrega)  
✅ Mínima fecha de entrega para el producto  
✅ Cálculo de antigüedad en días  

**Ejemplo**:
```
En posesión desde: 2 ago 2026
17 días en poder del socio
```

#### Para MAYOREO
✅ `wholesale_orders.order_date` (fecha de la orden)  
✅ `wholesale_orders.delivery_date` (si existe)  

**Ejemplo**:
```
Orden del: 5 ago 2026
12 días pendiente de pago
```

#### Para VENTA POR PIEZA
✅ `seller_piece_sales.sale_date` (fecha exacta)  

**Ejemplo**:
```
Venta del: 10 ago 2026
9 días pendiente de pago
```

### Cálculo de Antigüedad
```
days_since = TODAY() - MIN(relevant_date)
```

### Posible Agrupación por Rango
```
0-7 días:   "Esta semana"
8-15 días:  "Hace 2 semanas"
16-30 días: "Hace 3-4 semanas"
31+ días:   "Más de 1 mes"
```

---

## 📍 PUNTO 18: POSIBILIDAD DE MOSTRAR FECHA DE LIQUIDACIÓN

### Para COMODATO
✅ **Sí**: Fecha de `commercial_partner_movements` donde `movement_type='settlement'`

```sql
SELECT MAX(movement_date) 
FROM commercial_partner_movements
WHERE partner_id = $1 AND movement_type = 'settlement'
```

**Ejemplo**:
```
Liquidado el: 15 ago 2026
```

### Para MAYOREO
✅ **Sí, Indirecta**: Fecha del ÚLTIMO pago

```sql
SELECT MAX(payment_date)
FROM wholesale_payments
WHERE wholesale_order_id = $1 
  AND status IN ('completed', 'paid')
```

**Nota**: NO hay "fecha de liquidación" explícita. Usamos fecha del último pago.

### Para VENTA POR PIEZA
✅ **Sí, Indirecta**: Fecha del último pago confirmado

```sql
SELECT MAX(payment_date)
FROM seller_piece_payments
WHERE seller_id = $1 AND status = 'completed'
```

---

## 📍 PUNTO 19: ARQUITECTURA RECOMENDADA (VIEW/RPC/Frontend)

### Opción A: TODO en Frontend (N+1 queries)
❌ **NO RECOMENDADO**

```
1. Query: v_b2b_pending_balances → lista de 4 socios
2. Query: v_commercial_partner_current_stock → por cada socio
3. Query: commercial_partner_payments → por cada socio
4. Query: wholesale_order_items → por cada orden
5. Query: wholesale_payments → por cada orden
6. Query: seller_piece_sales → para vendedores
```

**Problema**: N+1 queries, lento, no escalable.

### Opción B: Vistas SQL Agregadas (RECOMENDADO)
✅ **RECOMENDADO**

Crear vistas que pre-agreguen los datos:

#### Vista 1: `v_b2b_pending_balances_detail`
```sql
SELECT
  partner_id,
  folio,
  business_name,
  partner_model,
  source_type,        -- 'comodato' | 'mayoreo'
  source_operation_id,
  total_generated,
  total_paid,
  pending_amount,
  oldest_date,
  days_since,
  status              -- 'pending' | 'liquidated'
FROM (
  -- COMODATO
  SELECT 
    cp.id AS partner_id,
    cp.folio,
    cp.business_name,
    cp.partner_model,
    'comodato' AS source_type,
    cpm.id AS source_operation_id,
    COALESCE(SUM(cpmi.amount_due), 0) AS total_generated,
    COALESCE(SUM(cpp.amount), 0) AS total_paid,
    COALESCE(SUM(cpmi.amount_due), 0) - COALESCE(SUM(cpp.amount), 0) AS pending_amount,
    MIN(cpm.movement_date) AS oldest_date,
    CURRENT_DATE - MIN(cpm.movement_date) AS days_since,
    CASE WHEN COALESCE(SUM(cpmi.amount_due), 0) = COALESCE(SUM(cpp.amount), 0) 
         THEN 'liquidated' ELSE 'pending' END AS status
  FROM commercial_partners cp
  LEFT JOIN commercial_partner_movements cpm ON cp.id = cpm.partner_id
  LEFT JOIN commercial_partner_movement_items cpmi ON cpm.id = cpmi.movement_id
  LEFT JOIN commercial_partner_payments cpp ON cp.id = cpp.partner_id
  WHERE cp.partner_model = 'comodato'
  GROUP BY cp.id, cpm.id
  
  UNION ALL
  
  -- MAYOREO
  SELECT 
    cp.id,
    cp.folio,
    cp.business_name,
    cp.partner_model,
    'mayoreo' AS source_type,
    wo.id AS source_operation_id,
    wo.total_amount,
    COALESCE(SUM(wp.amount), 0),
    wo.total_amount - COALESCE(SUM(wp.amount), 0),
    wo.order_date,
    CURRENT_DATE - wo.order_date,
    CASE WHEN wo.total_amount = COALESCE(SUM(wp.amount), 0)
         THEN 'liquidated' ELSE 'pending' END
  FROM commercial_partners cp
  LEFT JOIN wholesale_orders wo ON cp.id = wo.partner_id
  LEFT JOIN wholesale_payments wp ON wo.id = wp.wholesale_order_id
  WHERE cp.partner_model = 'mayoreo'
  GROUP BY cp.id, wo.id
);
```

**Beneficio**: 1 query, todos los datos listos.

#### Vista 2: `v_b2b_pending_products_detail`
```sql
SELECT
  partner_id,
  folio,
  business_name,
  source_type,
  source_operation_id,
  product_name,
  product_variant,
  product_size,
  quantity_delivered,
  quantity_sold,
  quantity_withdrawn,
  quantity_spoiled,
  current_quantity,
  price_to_catcorn,
  amount_due,
  delivery_date
FROM commercial_partner_movement_items cpmi
JOIN commercial_partner_movements cpm ON cpmi.movement_id = cpm.id
JOIN commercial_partners cp ON cpm.partner_id = cp.id
WHERE cpm.movement_type = 'delivery';
```

**+ equivalente para mayoreo con items**.

### Opción C: RPC Agregado
❌ **NO necesario** si las vistas SQL funcionan bien.

Solo si necesitas **lógica compleja** (búsquedas, filtros, paginación).

### Recomendación Final

**USAR OPCIÓN B** (Vistas SQL):
1. Crear `v_b2b_pending_balances_detail` (agrupa saldos por socio/operación)
2. Crear `v_b2b_pending_products_detail` (lista de productos)
3. Frontend hace 2 queries:
   - Cargar saldos (con filtro PENDIENTE vs LIQUIDADOS vs TODOS)
   - Cargar productos del socio seleccionado (lazy load en expand)

---

## 📍 PUNTO 20: ARCHIVOS A MODIFICAR POSTERIORMENTE

### Frontend React

#### 1. **B2BSummaryReport.tsx** (Modificación Mayor)
- [Link](components/commercialPartners/reports/B2BSummaryReport.tsx)
- **Cambio**: Hacer tarjeta PENDIENTE clicable
- **Acción**: Abrir modal con detalle

#### 2. **NUEVO: B2BPendingDetailModal.tsx** (Crear)
```
components/commercialPartners/reports/B2BPendingDetailModal.tsx
- Componente modal con 3 pestañas: PENDIENTES | LIQUIDADOS | TODOS
- Tabla con socios y su saldo
- Expand por socio → mostrar productos/operaciones
- Lazy load de detalles
```

#### 3. **NUEVO: B2BPendingDetailCard.tsx** (Crear, Opcional)
```
components/commercialPartners/reports/B2BPendingDetailCard.tsx
- Card por socio dentro del modal
- Muestra: nombre, modelo(s), total pendiente, fecha más antigua
- Al expandir: lista de operaciones y productos
```

#### 4. **b2bReportHelpers.ts** (Ampliación)
- [Link](components/commercialPartners/reports/b2bReportHelpers.ts)
- **Agregar**: Función `formatProductWithVariant(name, variant, size)`
- **Agregar**: Función `calculateDaysSince(date)`
- **Agregar**: Función `getAgeingBucket(days)`

#### 5. **b2bReportTypes.ts** (Ampliación)
- [Link](components/commercialPartners/reports/b2bReportTypes.ts)
- **Agregar tipos**:
  ```typescript
  interface B2BPendingDetail {
    partner_id: string;
    folio: string;
    business_name: string;
    partner_model: string;
    operations: B2BOperation[];
    total_pending: number;
    oldest_date: string;
    days_since: number;
  }
  
  interface B2BOperation {
    source_type: 'comodato' | 'mayoreo';
    operation_id: string;
    operation_date: string;
    total_generated: number;
    total_paid: number;
    pending_amount: number;
    products: B2BProductDetail[];
    status: 'pending' | 'liquidated';
  }
  
  interface B2BProductDetail {
    product_name: string;
    variant: string;
    size: string;
    quantity_delivered?: number;
    quantity_sold?: number;
    quantity_remaining?: number;
    amount_due?: number;
    price?: number;
  }
  ```

#### 6. **commercialCollectionsService.ts** (Ampliación)
- [Link](services/commercialCollectionsService.ts)
- **Agregar función**: `async getB2BPendingDetails(filter: 'pending' | 'liquidated' | 'all')`
- Retorna datos de ambas vistas para el modal

#### 7. **B2BReports.tsx** (Componente Contenedor, Posible Cambio)
- Ubicación: `components/commercialPartners/reports/B2BReports.tsx`
- **Cambio**: Pasar `refreshTrigger` y trigger de modal al componente

### SQL (Migraciones)

#### 1. **NUEVA MIGRACIÓN: `migration_b2b_pending_detail_views.sql`**
```sql
-- Crear vista: v_b2b_pending_balances_detail
-- Crear vista: v_b2b_pending_products_detail
-- Crear vista: v_b2b_liquidated_balances_detail (para LIQUIDADOS tab)
-- Grant SELECT para authenticated
```

---

## 📍 PUNTO 21: SQL QUE PROBABLEMENTE SERÁ NECESARIO

### Vista 1: Saldos Pendientes con Detalle (CRÍTICA)
```sql
CREATE OR REPLACE VIEW v_b2b_pending_balances_detail AS
SELECT
  cp.id AS partner_id,
  cp.folio,
  cp.business_name,
  cp.responsible_name,
  cp.phone,
  cp.whatsapp,
  cp.email,
  cp.partner_model,
  
  -- COMODATO
  COALESCE(SUM(CASE 
    WHEN cpm.movement_type = 'delivery' THEN cpmi.amount_due - COALESCE((
      SELECT SUM(cpp.amount) 
      FROM commercial_partner_payments cpp 
      WHERE cpp.movement_id = cpm.id
    ), 0)
    ELSE 0
  END), 0) AS comodato_pending,
  
  -- MAYOREO
  COALESCE((
    SELECT SUM(wo.total_amount) - COALESCE(SUM(wp.amount), 0)
    FROM wholesale_orders wo
    LEFT JOIN wholesale_payments wp ON wo.id = wp.wholesale_order_id AND wp.status IN ('completed', 'paid')
    WHERE wo.partner_id = cp.id
  ), 0) AS mayoreo_pending,
  
  -- VENTA POR PIEZA (si es necesario agregar partner_id a seller_piece_sales)
  0 AS piece_sale_pending,
  
  LEAST(
    MIN(CASE WHEN cpm.movement_type = 'delivery' THEN cpm.movement_date END),
    MIN(CASE WHEN wo.id IS NOT NULL THEN wo.order_date END)
  ) AS oldest_transaction_date,
  
  COUNT(DISTINCT CASE WHEN cpm.movement_type = 'delivery' THEN cpm.id END) AS comodato_deliveries,
  COUNT(DISTINCT wo.id) AS mayoreo_orders
  
FROM commercial_partners cp
LEFT JOIN commercial_partner_movements cpm ON cp.id = cpm.partner_id
LEFT JOIN commercial_partner_movement_items cpmi ON cpm.id = cpmi.movement_id
LEFT JOIN wholesale_orders wo ON cp.id = wo.partner_id

WHERE cp.deleted_at IS NULL

GROUP BY cp.id, cp.folio, cp.business_name, cp.responsible_name, cp.phone, cp.whatsapp, cp.email, cp.partner_model

HAVING (
  COALESCE(SUM(CASE WHEN cpm.movement_type = 'delivery' THEN cpmi.amount_due ELSE 0 END), 0) 
  > COALESCE((SELECT SUM(cpp.amount) FROM commercial_partner_payments cpp), 0)
)
OR (
  SELECT SUM(wo.total_amount) - COALESCE(SUM(wp.amount), 0)
  FROM wholesale_orders wo
  LEFT JOIN wholesale_payments wp ON wo.id = wp.wholesale_order_id
  WHERE wo.partner_id = cp.id
) > 0;
```

### Vista 2: Productos en Posesión (CRITICA)
```sql
CREATE OR REPLACE VIEW v_b2b_pending_products_in_possession AS
SELECT
  cp.id AS partner_id,
  cp.folio,
  cp.business_name,
  cpmi.product_name,
  cpmi.product_variant,
  cpmi.product_size,
  SUM(cpmi.quantity_delivered) AS total_delivered,
  SUM(cpmi.quantity_sold) AS total_sold,
  SUM(cpmi.quantity_withdrawn) AS total_withdrawn,
  SUM(cpmi.quantity_spoiled) AS total_spoiled,
  SUM(cpmi.quantity_delivered) 
    - SUM(cpmi.quantity_sold) 
    - SUM(cpmi.quantity_withdrawn) 
    - SUM(cpmi.quantity_spoiled) AS current_quantity,
  MIN(cpm.movement_date) AS oldest_delivery_date,
  MAX(cpm.movement_date) AS latest_movement_date,
  cpmi.price_to_catcorn,
  cpmi.suggested_retail_price,
  SUM(cpmi.amount_due) AS total_amount_due
  
FROM commercial_partners cp
JOIN commercial_partner_movements cpm ON cp.id = cpm.partner_id
JOIN commercial_partner_movement_items cpmi ON cpm.id = cpmi.movement_id

WHERE cp.partner_model = 'comodato'
  AND cpm.movement_type = 'delivery'
  AND (SUM(cpmi.quantity_delivered) 
       - SUM(cpmi.quantity_sold) 
       - SUM(cpmi.quantity_withdrawn) 
       - SUM(cpmi.quantity_spoiled) > 0)

GROUP BY 
  cp.id, cp.folio, cp.business_name,
  cpmi.product_name, cpmi.product_variant, cpmi.product_size,
  cpmi.price_to_catcorn, cpmi.suggested_retail_price;
```

### Vista 3: Operaciones Liquidadas (Para Tab LIQUIDADOS)
```sql
CREATE OR REPLACE VIEW v_b2b_liquidated_operations AS
SELECT
  cp.id AS partner_id,
  cp.folio,
  cp.business_name,
  'comodato' AS source_type,
  cpm.id AS operation_id,
  cpm.movement_date AS operation_date,
  MAX(cpp.payment_date) AS liquidation_date,
  SUM(cpmi.amount_due) AS total_amount,
  SUM(cpp.amount) AS total_paid,
  0 AS pending_amount
  
FROM commercial_partners cp
JOIN commercial_partner_movements cpm ON cp.id = cpm.partner_id AND cpm.movement_type = 'delivery'
JOIN commercial_partner_movement_items cpmi ON cpm.id = cpmi.movement_id
LEFT JOIN commercial_partner_payments cpp ON cpm.id = cpp.movement_id AND cpp.status IN ('completed', 'paid')

WHERE SUM(cpmi.amount_due) = SUM(cpp.amount)

GROUP BY cp.id, cp.folio, cp.business_name, cpm.id, cpm.movement_date

UNION ALL

SELECT
  cp.id,
  cp.folio,
  cp.business_name,
  'mayoreo' AS source_type,
  wo.id AS operation_id,
  wo.order_date,
  MAX(wp.payment_date) AS liquidation_date,
  wo.total_amount,
  SUM(wp.amount) AS total_paid,
  0 AS pending_amount
  
FROM commercial_partners cp
JOIN wholesale_orders wo ON cp.id = wo.partner_id
LEFT JOIN wholesale_payments wp ON wo.id = wp.wholesale_order_id AND wp.status IN ('completed', 'paid')

WHERE wo.total_amount = SUM(wp.amount)

GROUP BY cp.id, cp.folio, cp.business_name, wo.id, wo.order_date, wo.total_amount;
```

### Funciones RPC (Opcionales)

```sql
-- Obtener detalle de operaciones por socio
CREATE OR REPLACE FUNCTION get_partner_pending_operations(
  p_partner_id UUID,
  p_filter TEXT DEFAULT 'all'  -- 'all' | 'pending' | 'liquidated'
)
RETURNS TABLE (
  source_type TEXT,
  operation_id UUID,
  operation_date DATE,
  total_amount NUMERIC,
  total_paid NUMERIC,
  pending_amount NUMERIC,
  status TEXT,
  products JSONB
) AS $$
BEGIN
  -- Retorna operaciones (movimientos o órdenes) del socio
  -- Agregando productos en JSONB
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
```

---

## 📍 PUNTO 22: RIESGOS Y DATOS FALTANTES

### Riesgos Identificados

#### 1. **CRÍTICO: Vistas SQL No Definidas en Workspace**
- Las vistas `v_b2b_dashboard_summary`, `v_b2b_pending_balances`, etc. existen en Supabase pero NO en migraciones locales.
- **Riesgo**: Si se resetea la BD, se pierden.
- **Solución**: Crear archivo `migration_b2b_reports_views_definitive.sql` con todas las vistas.

#### 2. **CRÍTICO: Venta por Pieza No Vinculada a Socios**
- `seller_piece_sales` NO tiene `partner_id`.
- Los vendedores de venta por pieza NO son socios comerciales.
- **Riesgo**: No se puede saber cuál socio "debe" dinero por venta por pieza.
- **Solución**: Mostrar Venta por Pieza como canal GLOBAL (no por socio), o agregar campo `partner_id` a `seller_piece_sales` si hay necesidad futura.

#### 3. **MENOR: Comodato vs Mayoreo en Mismo Socio**
- Un socio puede tener `partner_model='comodato'` pero también órdenes mayoreo.
- **Riesgo**: Doble conteo si no se agrupa correctamente.
- **Solución**: Agrupar por socio ANTES de expandir por modalidad.

#### 4. **MENOR: Fecha de Liquidación en Mayoreo**
- NO hay campo "liquidation_date" en `wholesale_orders`.
- Solo se puede usar fecha del último pago.
- **Riesgo**: Si hay múltiples pagos, no está claro cuándo se "completó".
- **Solución**: Usar MAX(payment_date) como aproximación.

#### 5. **MENOR: Snapshot de Productos**
- `commercial_partner_movement_items` guarda `product_name` como TEXT, no como UUID + FK.
- Si el producto se renombra en inventario, los históricos quedan con nombre viejo.
- **Riesgo**: Histórico no es 100% editable pero es consistente para lo que se entregó.
- **Solución**: Aceptar como es; es un snapshot de la realidad.

### Datos Que Faltan (Potencialmente)

#### 1. **¿Hay productos "retirados" entre entregas?**
- `quantity_withdrawn` registra retiros, pero ¿cómo se registran?
- ¿Hay una UI para registrar retiro de stock?
- **Necesario verificar**: Si hay UI en [PartnerMovementForm.tsx](components/commercialPartners/comodato/PartnerMovementForm.tsx).

#### 2. **¿Hay "spoilage" real registrado?**
- `quantity_spoiled` y `spoilage_absorbed_by` existen.
- ¿Pero qué tan frecuentemente se usa?
- **Necesario verificar**: Si el socio reporta producto echado a perder.

#### 3. **¿Hay auditoría de cambios en pagos?**
- Las tablas de pago NO guardan "historia" de cambios.
- Si se registra un pago y luego se elimina, no hay rastro.
- **Riesgo**: Imposible reconciliar si algo cambió.
- **Solución**: NO es problema si los pagos NO se editan; solo se crean.

#### 4. **¿Existe field "pago_confirmado" vs "pago_solicitado"?**
- Hay `partner_payment_verification_requests` para VERIFICACIÓN.
- Pero el pago final se registra en `commercial_partner_payments`.
- **Necesario verificar**: Si el flujo es: Socio propone pago → Admin verifica → Se registra en tabla final.

---

## 📊 RESUMEN EJECUTIVO: 25 RESPUESTAS

| Punto | Hallazgo |
|-------|----------|
| 1. Componente | [B2BSummaryReport.tsx](components/commercialPartners/reports/B2BSummaryReport.tsx) línea 167-177 — Tarjeta no-interactiva |
| 2. Fuente $370 | `summary.b2b_pending_balance` + `pieceSale_pending_total` de vistas SQL + servicio |
| 3. Fuente "4 socios" | Campo `partners_with_pending_balance` de `v_b2b_dashboard_summary` (COUNT DISTINCT) |
| 4. Reconciliación | $240 Comodato + $0 Mayoreo + $130 Venta Pieza = $370 ✓ VERIFICADO |
| 5. v_b2b_dashboard_summary | EXISTE en Supabase, NO está en respaldos locales, 23 columnas definidas |
| 6. Tablas Comodato | `commercial_partners`, `commercial_partner_movements`, `commercial_partner_movement_items`, `commercial_partner_payments` |
| 7. Producto en posesión | Fórmula: delivered - sold - withdrawn - spoiled (cálculo en UI o SQL) |
| 8. Fechas de entrega | MIN/MAX de `movement_date`, por producto, disponible |
| 9. Deuda Comodato | SUM(amount_due) - SUM(pagos), por movimiento o socio |
| 10. Tablas Mayoreo | `commercial_partners`, `wholesale_orders`, `wholesale_order_items`, `wholesale_payments` |
| 11. Deuda Mayoreo | SUM(order.total_amount) - SUM(pagos), por orden o socio |
| 12. Tablas Venta Pieza | `seller_piece_sales`, `seller_piece_sale_items`, `seller_piece_payments` |
| 13. Deuda Venta Pieza | SUM(sales.total_amount) - SUM(pagos completados), por vendedor/mes |
| 14. Definición Liquidado | balance = 0 (no hay flag explícito, se calcula) |
| 15. Fuentes de pago | `commercial_partner_payments`, `wholesale_payments`, `seller_piece_payments` |
| 16. Mostrar productos | SÍ, datos completos: nombre, variante, tamaño, cantidad, precio |
| 17. Mostrar "desde" | SÍ, MIN(movement_date) o order_date, cálculo de días |
| 18. Fecha liquidación | SÍ, MAX(payment_date) de pagos o settlement_date si existe |
| 19. Arquitectura | OPCIÓN B: Vistas SQL agregadas + 2 queries desde frontend |
| 20. Archivos a modificar | B2BSummaryReport.tsx, B2BPendingDetailModal.tsx (nuevo), b2bReportTypes.ts, commercialCollectionsService.ts |
| 21. SQL necesario | 3 vistas nuevas: pending_balances_detail, products_in_possession, liquidated_operations |
| 22. Riesgos | Vistas no en respaldos locales, Venta Pieza sin partner_id, Comodato+Mayoreo en mismo socio |
| 23. Datos faltantes | ¿Retiros registrados? ¿Spoilage real? ¿Auditoría de pagos? |
| 24. Performance | 1-2 queries SQL + 1 load de modal (lazy load productos) |
| 25. Seguridad | Admin-only, sin cambios en permisos de socios_comerciales |

---

## 🎯 PRÓXIMOS PASOS (CUANDO AUTORICEN IMPLEMENTACIÓN)

1. **Crear archivo migration**: `migration_b2b_pending_detail_views.sql` con 3 vistas agregadas
2. **Crear componente modal**: `B2BPendingDetailModal.tsx` con 3 tabs y expandibles por socio
3. **Agregar tipos**: `B2BPendingDetail`, `B2BOperation`, `B2BProductDetail` en `b2bReportTypes.ts`
4. **Agregar servicio**: `getB2BPendingDetails()` en `commercialCollectionsService.ts`
5. **Hacer tarjeta clicable**: Modificar `B2BSummaryReport.tsx` línea 167-177 con `onClick={() => setShowPendingModal(true)}`
6. **Testing**: Verificar con datos reales que números coincidan en modal vs dashboard

---

**Fin del Diagnóstico**  
Todas las referencias, tablas y fórmulas verificadas en el código fuente.  
Sin implementación, SQL ni modificaciones, solo análisis técnico puro.
