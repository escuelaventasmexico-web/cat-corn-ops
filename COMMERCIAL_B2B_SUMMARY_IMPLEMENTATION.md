# Implementación: Resumen Comercial B2B para Socios Comerciales

**Fecha**: 9 de julio de 2026  
**Estado**: ✅ COMPLETADO

## Descripción

Se agregó una nueva sección **"Resumen comercial"** en la pestaña **"Resumen"** del detalle de Socios Comerciales. Esta sección muestra montos acumulados del socio en esquemas **Comodato** y **Mayoreo**, con un total consolidado **B2B**.

## Archivos Creados

### 1. `/components/commercialPartners/CommercialB2BSummary.tsx`

Componente principal que:
- Carga datos de `v_commercial_partner_operational_summary` (Comodato)
- Carga datos de `v_commercial_partner_wholesale_summary` (Mayoreo)
- Calcula totales B2B consolidados
- Renderiza 3 tarjetas con estilo mostaza

#### Tipos Incluidos
```typescript
interface ComodatoSummary {
  total_due?: number | null;           // Total generado
  total_paid?: number | null;          // Total cobrado
  pending_balance?: number | null;     // Saldo pendiente
  total_units_in_partner?: number | null; // Unidades en posesión
}

interface WholesaleSummary {
  total_purchased?: number | null;     // Total comprado
  total_paid?: number | null;          // Total pagado
  pending_balance?: number | null;     // Saldo pendiente
  total_pieces?: number | null;        // Piezas compradas
  purchase_count?: number | null;      // Compras realizadas
  last_purchase_date?: string | null;  // Última compra
}

interface B2BTotals {
  total_generated_or_purchased: number; // Comodato.total_due + Mayoreo.total_purchased
  total_collected_or_paid: number;      // Comodato.total_paid + Mayoreo.total_paid
  total_pending: number;                // Comodato.pending + Mayoreo.pending
}
```

#### Funciones de Formateo
- `fmtCurrency(value, hasData)` → `"$160.00"` o `"—"`
- `fmtPieces(value, hasData)` → `"10 piezas"` o `"—"`
- `fmtDateMx(value, hasData)` → `"01 jul 2026"` o `"—"`

### 2. `/components/commercialPartners/CommercialPartnerDetail.tsx` (MODIFICADO)

**Cambios**:
- Import: `import { CommercialB2BSummary } from './CommercialB2BSummary';`
- Uso en pestaña Resumen: Insertado después de Contacto, antes de Notas

```tsx
{/* Resumen comercial B2B */}
<CommercialB2BSummary partnerId={partner.id} />
```

## Comportamiento

### Carga de Datos
- Ambas vistas se cargan en paralelo vía Supabase
- Si una vista no existe (PGRST116), se ignora silenciosamente
- Errors se muestran en tarjeta roja con icono de alerta

### Estados de Renderización

#### 1. Cargando
```
⊙ Cargando resumen comercial...
```

#### 2. Error
```
❌ Error
[mensaje de error]
```

#### 3. Sin datos
No se muestra sección (retorna `null`)

#### 4. Con datos
Muestra tarjetas según disponibilidad:
- **Siempre**: Tarjeta "Total general B2B" (si hay datos en cualquier esquema)
- **Condicional**: Tarjeta "Comodato" (si hay datos)
- **Condicional**: Tarjeta "Mayoreo" (si hay datos)

### Destaque de Saldo Pendiente

Si `total_pending > 0`:
- Tarjeta B2B muestra alerta roja: "⚠️ Saldo pendiente"
- Texto del saldo en color rojo: `text-red-600`

Si `total_pending = 0`:
- Texto en color verde: `text-green-600`

## Ejemplo Visual

### Con datos de socio CP-010726-001:

```
┌─────────────────────────────────────────┐
│ RESUMEN COMERCIAL                       │
├─────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐│
│ │ Total general B2B                    ││
│ │                                      ││
│ │ ⚠️ Saldo pendiente                   ││
│ │                                      ││
│ │ ↗ Total generado/comprado     $160.00││
│ │ ↘ Total cobrado/pagado           $0.00││
│ │ ⚖ Saldo pendiente total       $160.00││ (en rojo)
│ └──────────────────────────────────────┘│
│ ┌──────────────────────────────────────┐│
│ │ Comodato                             ││
│ │                                      ││
│ │ ↗ Generado por comodato      $160.00││
│ │ ↘ Cobrado en comodato           $0.00││
│ │ ⚖ Saldo pendiente comodato   $160.00││
│ │ 📦 Unidades en posesión         5 uds││
│ └──────────────────────────────────────┘│
│ ┌──────────────────────────────────────┐│
│ │ Mayoreo                              ││
│ │                                      ││
│ │ ↗ Comprado en mayoreo            $0.00││
│ │ ↘ Pagado en mayoreo              $0.00││
│ │ ⚖ Saldo pendiente mayoreo        $0.00││
│ │ 📦 Piezas compradas                 —││
│ │ 🛒 Compras realizadas                —││
│ │ 📅 Última compra                     —││
│ └──────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

## Validación de Reglas

✅ **Formateo de moneda**: Siempre `$0.00` cuando el valor es 0 (no `—`)  
✅ **Formateo de piezas**: "10 piezas" (número + "piezas")  
✅ **Formateo de fechas**: "01 jul 2026" (DD MMM YYYY en español)  
✅ **Símbolo de dato faltante**: "—" solo cuando dato no existe/no cargó  
✅ **Cálculo B2B**: Suma correcta de comodato + mayoreo en frontend  
✅ **Etiquetas comodato**: "Generado por comodato" (no "Comprado")  
✅ **Estilos**: Panel mostaza (#D6A23A), cards claras, texto negro  
✅ **Responsive**: Se adapta al ancho del drawer  
✅ **Error handling**: Cargas silenciosas si una vista no existe  

## Testing

Para validar con socio **CP-010726-001**:

1. Abrir Socios Comerciales
2. Buscar CP-010726-001
3. Abrir el detalle
4. Ir a pestaña "Resumen"
5. Verificar:
   - Sección "Resumen comercial" visible después de Contacto
   - Tarjeta "Total general B2B" presente
   - Si tiene comodato: `total_due = $160.00`, `total_paid = $0.00`, `pending = $160.00`
   - Si tiene mayoreo: valores según sus compras y pagos
   - Cálculos correctos en B2B (suma de ambos esquemas)
   - Alerta roja si saldo pendiente > 0

## Build

```bash
npm run build
```

**Resultado**: ✅ SIN ERRORES TYPESCRIPT  
**Build time**: ~4 segundos  
**Output**: `/dist`

---

**Nota**: No se modificaron SQL, vistas, comodato, mayoreo, pagos ni ventas. Solo se agregó lectura y render en la pestaña Resumen.
