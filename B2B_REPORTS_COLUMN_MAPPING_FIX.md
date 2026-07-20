# Corrección de Reportes B2B - Mapeo de Columnas Supabase

## 📋 Resumen del Problema

El frontend de Reportes B2B estaba usando nombres de columnas incorrectos, lo que causaba que los totales apareceran como **$0.00** incluso cuando Supabase traía datos correctamente.

**Síntomas observados:**
- Resumen General: Total generado, Total cobrado, Pendiente → $0.00
- Cobranza: Columna TOTAL mostraba $0.00 aunque Mayoreo mostraba $70.00
- Pipeline por Estado: Datos correctos (ej: Activo → $380.00)

## ✅ Correcciones Realizadas

### 1. **Actualización de Tipos TypeScript** (`b2bReportTypes.ts`)

#### B2BDashboardSummary
Reemplazó nombres de columnas incorrectos con los reales:

| Incorrecto | Correcto |
|-----------|----------|
| `total_b2b_generated` | `b2b_total_generated` |
| `total_b2b_collected` | `b2b_total_paid` |
| `total_b2b_pending` | `b2b_pending_balance` |
| `total_units_b2b` | `b2b_total_units` |
| `partners_with_pending` | `partners_with_pending_balance` |
| `comodato_generated` | `comodato_generated_total` |
| `comodato_collected` | `comodato_paid_total` |
| `comodato_pending` | `comodato_pending_total` |
| `comodato_units` | `comodato_units_in_partner` |
| `wholesale_purchased` | `wholesale_purchased_total` |
| `wholesale_paid` | `wholesale_paid_total` |
| `wholesale_pending` | `wholesale_pending_total` |
| `wholesale_units` | `wholesale_total_pieces` |

#### B2BPartnerRanking
Reemplazó propiedades y cambió campos:

```typescript
// Antes
id: string;
total_generated: number;
total_paid: number;
total_pending: number;
total_units: number;

// Después
partner_id: string;
b2b_total_generated: number;
b2b_total_paid: number;
b2b_pending_balance: number;
b2b_total_units: number;
```

#### B2BPendingBalance
Expandió la interfaz con todas las columnas reales:

```typescript
export interface B2BPendingBalance {
  partner_id: string;          // ← cambió de 'id'
  folio: string;
  business_name: string;
  responsible_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  business_type: string | null;
  status: string;
  partner_model: string;
  comodato_pending: number;
  wholesale_pending: number;
  b2b_pending_balance: number; // ← reemplazo de 'total_pending'
  comodato_generated: number;
  wholesale_purchased: number;
  b2b_total_generated: number;
  comodato_paid: number;
  wholesale_paid: number;
  b2b_total_paid: number;
  last_purchase_date: string | null;
  collection_status: string;
}
```

#### B2BSalesByZone
Reemplazó columnas para coincidir con vista actual:

```typescript
// Antes
partner_count: number | null;
comodato_count: number | null;
wholesale_count: number | null;
active_count: number | null;
total_generated: number | null;
total_paid: number | null;
total_pending: number | null;

// Después
partners_count: number;
comodato_partners: number;
wholesale_partners: number;
active_partners: number;
b2b_total_generated: number;
b2b_total_paid: number;
b2b_pending_balance: number;
```

### 2. **Corrección de B2BSummaryReport.tsx**

✅ Cambios en todas las secciones:

**Resumen General:**
- `summary.total_b2b_generated` → `summary.b2b_total_generated`
- `summary.total_units_b2b` → `summary.b2b_total_units`
- `summary.total_b2b_collected` → `summary.b2b_total_paid`
- `summary.total_b2b_pending` → `summary.b2b_pending_balance`
- `summary.partners_with_pending` → `summary.partners_with_pending_balance`

**Sección Comodato:**
- `summary.comodato_generated` → `summary.comodato_generated_total`
- `summary.comodato_units` → `summary.comodato_units_in_partner`
- `summary.comodato_collected` → `summary.comodato_paid_total`
- `summary.comodato_pending` → `summary.comodato_pending_total`

**Sección Mayoreo:**
- `summary.wholesale_purchased` → `summary.wholesale_purchased_total`
- `summary.wholesale_units` → `summary.wholesale_total_pieces`
- `summary.wholesale_paid` → `summary.wholesale_paid_total`
- `summary.wholesale_pending` → `summary.wholesale_pending_total`

✅ Agregado `console.log('B2B dashboard summary:', summary);` para debugging.

### 3. **Corrección de B2BCollectionsReport.tsx**

✅ Cambios principales:

1. **Importó `getCollectionPriority` helper:**
   ```typescript
   import { getCollectionPriority } from './b2bReportHelpers';
   ```

2. **Función handleExport actualizada:**
   ```typescript
   const pendingAmount = Number(b.b2b_pending_balance || 0);
   pendiente_total: pendingAmount,
   prioridad: getPriorityLabel(getCollectionPriority(pendingAmount)),
   ```

3. **Tabla actualizada:**
   - `balance.total_pending` → `Number(balance.b2b_pending_balance || 0)`
   - `balance.balance_priority` → `getCollectionPriority(Number(balance.b2b_pending_balance || 0))`
   - `balance.id` → `balance.partner_id`

✅ Agregado `console.log('B2B collection rows:', balances);` para debugging.

### 4. **Corrección de B2BRankingsReport.tsx**

✅ Cambios principales:

1. **Type SortKey actualizado:**
   ```typescript
   type SortKey = 'b2b_total_generated' | 'comodato_generated' | 'wholesale_purchased' | 'b2b_pending_balance';
   ```

2. **Estado inicial:**
   ```typescript
   const [sortBy, setSortBy] = useState<SortKey>('b2b_total_generated');
   ```

3. **Botones de ordenamiento:**
   - `setSortBy('total_generated')` → `setSortBy('b2b_total_generated')`
   - `setSortBy('total_pending')` → `setSortBy('b2b_pending_balance')`

4. **Tabla renderizada:**
   - `key={ranking.id}` → `key={ranking.partner_id}`
   - `ranking.total_generated` → `Number(ranking.b2b_total_generated || 0)`
   - `ranking.total_paid` → `Number(ranking.b2b_total_paid || 0)`
   - `ranking.total_pending` → `Number(ranking.b2b_pending_balance || 0)`
   - `ranking.total_units` → `Number(ranking.b2b_total_units || 0)`

5. **Función handleExport:**
   ```typescript
   generado: Number(r.b2b_total_generated || 0),
   pagado: Number(r.b2b_total_paid || 0),
   pendiente: Number(r.b2b_pending_balance || 0),
   unidades: Number(r.b2b_total_units || 0),
   ```

✅ Agregado `console.log('B2B rankings data:', rankings);` para debugging.

### 5. **Corrección de B2BZoneReport.tsx**

✅ Cambios principales:

1. **Función handleExportZones:**
   ```typescript
   socios_totales: Number(z.partners_count || 0),
   socios_comodato: Number(z.comodato_partners || 0),
   socios_mayoreo: Number(z.wholesale_partners || 0),
   socios_activos: Number(z.active_partners || 0),
   generado: Number(z.b2b_total_generated || 0),
   pagado: Number(z.b2b_total_paid || 0),
   pendiente: Number(z.b2b_pending_balance || 0),
   ```

2. **Tabla renderizada:**
   - `zone.partner_count` → `Number(zone.partners_count || 0)`
   - `zone.comodato_count` → `Number(zone.comodato_partners || 0)`
   - `zone.wholesale_count` → `Number(zone.wholesale_partners || 0)`
   - `zone.active_count` → `Number(zone.active_partners || 0)`
   - `zone.total_generated` → `Number(zone.b2b_total_generated || 0)`
   - `zone.total_paid` → `Number(zone.b2b_total_paid || 0)`
   - `zone.total_pending` → `Number(zone.b2b_pending_balance || 0)`

✅ Agregados logs para debugging.

### 6. **Agregada función helper** (`b2bReportHelpers.ts`)

```typescript
export const getCollectionPriority = (amount: number): 'saldo_alto' | 'saldo_medio' | 'saldo_bajo' => {
  if (amount > 500) return 'saldo_alto';
  if (amount > 100) return 'saldo_medio';
  return 'saldo_bajo';
};
```

Esto reemplaza la necesidad de `balance_priority` que venía de SQL.

## 🔄 Manejo de Números desde Supabase

Supabase puede retornar NUMERIC como string, por lo que se agregó conversión:

```typescript
Number(value || 0)
```

Ejemplo en B2BCollectionsReport:
```typescript
const pendingAmount = Number(b.b2b_pending_balance || 0);
```

## 📊 Validación Esperada

Con los datos del socio CP-010726-001:

### Resumen General
```
Total generado B2B: $380.00  ✓ (antes: $0.00)
Total cobrado B2B: $310.00   ✓ (antes: $0.00)
Saldo pendiente B2B: $70.00  ✓ (antes: $0.00)

Comodato:
  Generado: $160.00  ✓
  Cobrado: $160.00   ✓
  Pendiente: $0.00   ✓

Mayoreo:
  Comprado: $220.00  ✓
  Pagado: $150.00    ✓
  Pendiente: $70.00  ✓
```

### Cobranza - Fila CP-010726-001
```
Comodato: $0.00      ✓
Mayoreo: $70.00      ✓
Total: $70.00        ✓ (antes: $0.00)
```

### Cards Superiores
```
Saldo total pendiente: $70.00      ✓
Socios con pendiente: 1            ✓
Mayor deudor: Socio Prueba Fase 2 — $70.00  ✓
```

## 🐛 Debugging

Se agregaron console.log en:
1. **B2BSummaryReport**: `console.log('B2B dashboard summary:', summary);`
2. **B2BCollectionsReport**: `console.log('B2B collection rows:', balances);`
3. **B2BRankingsReport**: `console.log('B2B rankings data:', rankings);`
4. **B2BZoneReport**: Logs para zones y pipeline data

Estos logs permiten ver exactamente qué columnas y valores trae Supabase en el navegador (F12 → Console).

## ✨ No Modificado

❌ SQL: No cambios
❌ Vistas Supabase: No cambios
❌ Esquema: No cambios
❌ Otros módulos: No afectados

## 🚀 Build Status

```
✓ npm run build: SUCCESS en 4.17s
✓ TypeScript compilation: 0 errores
✓ Vite build: Completo sin errores críticos
⚠️ Warnings sobre tamaño de chunks (normales)
```

## 📝 Resumen de Cambios por Archivo

| Archivo | Cambios |
|---------|---------|
| `b2bReportTypes.ts` | 5 interfaces actualizadas con nombres de columnas correctos |
| `b2bReportHelpers.ts` | +1 función helper: `getCollectionPriority()` |
| `B2BSummaryReport.tsx` | Todos los nombres de propiedades corregidos + console.log |
| `B2BCollectionsReport.tsx` | Uso de `b2b_pending_balance`, `partner_id`, `getCollectionPriority()` + console.log |
| `B2BRankingsReport.tsx` | Mapeo de columnas, `b2b_*` prefixes, `partner_id` + console.log |
| `B2BZoneReport.tsx` | Mapeo de columnas `partners_count`, `comodato_partners`, etc. + console.log |

---

**Estado**: ✅ CORREGIDO Y COMPILADO  
**Fecha**: 9 de julio de 2026  
**Build**: Success (4.17s, 0 errors)
