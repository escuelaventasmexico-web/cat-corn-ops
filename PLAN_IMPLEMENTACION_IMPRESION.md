# 🖨️ PLAN DE IMPLEMENTACIÓN: Impresión de Comprobantes - Socios Comerciales

## Investigación Completada ✅

### 1. QZ Tray Existente
- **Ubicación**: `/lib/qzService.ts` (403 líneas)
- **Funciones clave**:
  - `connectQZ()` - Conecta a QZ Tray
  - `printRaw(printerName, data: string[])` - Envía ESC/POS raw
  - `listPrinters()` - Lista impresoras disponibles
  - `getSavedPrinterName()` - Recupera nombre guardado
- **Configuración**: 
  - 58mm thermal (32 caracteres por línea)
  - ISO-8859-1 encoding
  - ESC/POS commands embebidos

### 2. Servicio de Impresión Actual
- **Ubicación**: `/lib/printReceipt.ts` (629 líneas)
- **Función principal**: `buildEscPosReceipt(data: ReceiptData): string[]`
- **Estructura**:
  - Helpers: `padR()`, `padL()`, `escRow()`, `divider()`
  - Comandos ESC/POS: INIT, CENTER, LEFT, BOLD_ON, DOUBLE_SIZE, LF, CUT
  - LINE_W = 32 caracteres por línea

### 3. Estructura de Datos de Socios Comerciales

#### Tablas en Supabase:
- `commercial_partners` - Datos del socio
  - `id`, `folio`, `business_name`, `responsible_name`
  - `partner_model` (comodato, mayoreo, etc.)
  - `status`

- `commercial_partner_movements` - Movimientos
  - `id`, `partner_id`, `movement_date`, `movement_type` (delivery, settlement, withdrawal, spoilage)
  - `status` (completed, pending, cancelled)
  - Relación: `commercial_partner_movement_items(*)`

- `commercial_partner_movement_items` - Productos en movimiento
  - `movement_id`, `product_name`, `product_variant`, `product_size`
  - `quantity_delivered`, `quantity_sold`, `quantity_withdrawn`, `quantity_spoiled`
  - `price_to_catcorn`, `amount_due`

- `commercial_partner_current_stock` o similar - Stock actual
  - Usará la VISTA/función existente que alimenta PartnerCurrentStock.tsx

- `commercial_partner_payments` - Pagos registrados
  - `id`, `partner_id`, `payment_date`, `amount`, `payment_method`

### 4. Ubicación de Botón "Imprimir"
- **Archivo**: `/components/commercialPartners/comodato/CommercialPartnerComodato.tsx`
- **Línea ~35**: Array `ACTION_BUTTON_DEFS` - AQUÍ se agrega nuevo botón
- **Patrón**: Cada botón tiene `label`, `icon`, `modal`, `className`

---

## Archivos a Crear

### 1. `services/commercialPartnerPrintService.ts` (NUEVA)
**Propósito**: Obtener datos de impresión, construir modelos, reutilizar QZ

**Funciones**:
```typescript
// Tipos de impresión disponibles
export type PrintOption = 
  | 'last_delivery_comodato'
  | 'delivery_by_date_comodato'
  | 'current_stock'
  | 'last_order_mayoreo'
  | 'order_by_date_mayoreo';

// Modelo de datos para imprimir
export interface CommercialPartnerPrintData {
  partner: {
    id: string;
    folio: string;
    business_name: string;
    responsible_name: string;
    partner_model: string; // 'comodato', 'mayoreo', etc.
  };
  printDate: Date;
  option: PrintOption;
  
  // Datos de comodato
  comodato?: {
    movement?: {
      id: string;
      movement_date: string;
      movement_type: string;
    };
    items: {
      product_name: string;
      product_variant?: string;
      product_size?: string;
      quantity_delivered: number;
      price_to_catcorn: number;
    }[];
  };
  
  // Datos de mayoreo
  mayoreo?: {
    order?: {
      id: string;
      folio: string;
      order_date: string;
      delivery_date?: string;
    };
    items: {
      product_name: string;
      product_variant?: string;
      product_size?: string;
      quantity: number;
      unit_price: number;
    }[];
  };
  
  // Stock actual
  currentStock?: {
    items: {
      product_name: string;
      product_variant?: string;
      product_size?: string;
      current_quantity: number;
      price_to_catcorn: number;
    }[];
  };
  
  seller?: {
    name: string;
  };
}

// Funciones principales
async function getLastDeliveryComodato(partnerId: string): Promise<CommercialPartnerPrintData>
async function getDeliveryByDate(partnerId: string, date: Date): Promise<CommercialPartnerPrintData[]>
async function getCurrentStock(partnerId: string): Promise<CommercialPartnerPrintData>
async function getLastOrderMayoreo(partnerId: string): Promise<CommercialPartnerPrintData>
async function getOrderByDateMayoreo(partnerId: string, date: Date): Promise<CommercialPartnerPrintData[]>
```

### 2. `lib/commercialPartnerPrintReceipt.ts` (NUEVA)
**Propósito**: Construir ESC/POS a partir de CommercialPartnerPrintData (reutilizando helpers de printReceipt.ts)

**Funciones**:
```typescript
export function buildComodatoDeliveryReceipt(data: CommercialPartnerPrintData): string[]
export function buildCurrentStockReceipt(data: CommercialPartnerPrintData): string[]
export function buildMayoreoOrderReceipt(data: CommercialPartnerPrintData): string[]
```

### 3. `components/commercialPartners/comodato/CommercialPartnerPrintModal.tsx` (NUEVA)
**Propósito**: Modal de opciones de impresión + previsualización

**Estructura**:
```typescript
interface CommercialPartnerPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerId: string;
  partnerName: string;
  partnerModel: string; // 'comodato', 'mayoreo', etc.
}

// Estados: 
// 1. Seleccionar opción de impresión
// 2. Si "por fecha" → Selector de fecha
// 3. Si hay varias → Selector cual imprimir
// 4. Previsualización
// 5. Imprimiendo...
```

### 4. Modificar `CommercialPartnerComodato.tsx`
**Cambios**: Agregar botón "Imprimir" al array ACTION_BUTTON_DEFS

---

## Flujo de Impresión

```
Usuario: Click "Imprimir"
  ↓
Modal abre con opciones:
  ✓ Última entrega
  ✓ Buscar entrega por fecha
  ✓ Existencia actual
  (Si mayoreo) ✓ Último pedido mayoreo
  (Si mayoreo) ✓ Buscar pedido por fecha
  ↓
Si "última entrega":
  → getLastDeliveryComodato(partnerId)
  → Construye CommercialPartnerPrintData
  → buildComodatoDeliveryReceipt()
  → Previsualización textual
  ↓
Si "por fecha":
  → Selector fecha
  → getDeliveryByDate(partnerId, date)
  → Si 1 resultado → Directo a preview
  → Si >1 → Selector cual
  ↓
Previsualización:
  → Modal con texto del ticket
  → Botones: Cancelar, Imprimir
  ↓
Al Imprimir:
  → printRaw(savedPrinter, escoposList)
  → Reutiliza impresora POS
  → Manejo de errores QZ
  ↓
Éxito:
  → Toast "Impreso correctamente"
  → Modal se cierra
```

---

## Ticket Comodato - Última Entrega

```
    CAT CORN
SOCIOS COMERCIALES

Fecha impresión: 21/08/2026
Hora: 14:35

Socio:           Mini super el nuevo paraíso
Folio:           MSP-001-2024
Responsable:     Juan Pérez García
Modalidad:       Comodato

————————————————————————

COMPROBANTE DE ENTREGA

Fecha entrega:   21/08/2026
Operación:       DELIVERY-001

————————————————————————

Michi — Clásico
90 gr
2 piezas × $30 = $60

Michi — Sabores
90 gr
4 piezas × $30 = $120

Gato Mayor — Clásico
180 gr
1 pieza × $45 = $45

————————————————————————

Total piezas entregadas:  7
Valor Cat Corn:          $225

EXISTENCIA ACTUAL EN POSESIÓN

Michi — Clásico (90 gr)   4 piezas × $30 = $120
Michi — Sabores (90 gr)   6 piezas × $30 = $180

Total en posesión:        10 piezas
Valor Cat Corn:           $300

————————————————————————

Vendedor: Gerardo Ventas

Firma vendedor

_______________________________

Firma socio

_______________________________

Cat Corn
Socios Comerciales
```

---

## Ticket Existencia Actual

```
    CAT CORN
SOCIOS COMERCIALES

Fecha: 21/08/2026
Hora: 14:35

Socio:           Mini super el nuevo paraíso
Folio:           MSP-001-2024
Responsable:     Juan Pérez García
Modalidad:       Comodato

————————————————————————

EXISTENCIA ACTUAL EN POSESIÓN

Michi — Clásico
90 gr
4 piezas
Precio Cat Corn: $30
Valor: $120

Michi — Sabores
90 gr
6 piezas
Precio Cat Corn: $30
Valor: $180

Gato Mayor — Clásico
180 gr
1 pieza
Precio Cat Corn: $45
Valor: $45

————————————————————————

Total piezas en posesión:    11
Valor Cat Corn en posesión:  $345

————————————————————————

Vendedor: Gerardo Ventas

Firma vendedor

_______________________________

Firma socio

Nombre: Juan Pérez García

_______________________________

Cat Corn
Socios Comerciales
```

---

## Notas Importantes

1. **NO tocar POS**: Reutilizar QZ pero sin modificar su servicio
2. **NO SQL todavía**: Solo consultas SELECT
3. **NO commit/push**: Build solo
4. **Reutilizar helpers**: padR, padL, escRow, divider de printReceipt.ts
5. **LINE_W = 32**: Usar misma anchura que POS
6. **Impresora misma**: getSavedPrinterName() sin cambios
7. **ESC/POS embebido**: Usar mismas constantes (INIT, CENTER, BOLD_ON, CUT)
8. **Previsualización**: Modal con texto crudo antes de imprimir
9. **Error handling**: Mostrar mensajes amigables si QZ falla
10. **Firmas**: Suficiente espacio vertical para firma física
