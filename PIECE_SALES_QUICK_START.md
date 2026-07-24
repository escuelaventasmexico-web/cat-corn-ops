# Venta por Pieza - Guía Rápida

## 🚀 Inicio Rápido

### Para Vendedores

1. Ve a **Socios Comerciales** (ícono ❤️ en menú izquierdo)
2. Selecciona pestaña **"Venta por pieza"** (si no ves, contacta admin)
3. Haz clic **"Reportar nueva venta"**
4. Selecciona productos, cantidad, método de pago
5. Haz clic **"Reportar venta"**
6. ✅ Recibirás folio de confirmación

**Métodos de pago:**
- 💵 **Efectivo**: Marca checkbox de confirmación
- 🏦 **Transferencia**: Sube comprobante (JPG/PNG/PDF ≤10MB)

---

## 📊 Componentes Principales

| Componente | Función | Archivo |
|------------|---------|---------|
| PieceSalesModule | Contenedor principal | `components/.../PieceSalesModule.tsx` |
| Summary Cards | 4 métricas: ventas/comisiones/cobros | `PieceSalesSummaryCards.tsx` |
| History Table | Listado de todas tus ventas | `PieceSalesHistoryTable.tsx` |
| Stock Table | Stock informativo | `SellerPieceStockTable.tsx` |
| New Sale Modal | Crear venta | `NewPieceSaleModal.tsx` |
| Retry Modal | Reintentar pago rechazado | `RejectionRetryModal.tsx` |

---

## 🔄 Estados de Venta

```
┌─────────────┐
│   DRAFT     │ (Creada en modal)
└──────┬──────┘
       │ submit_partner_payment_verification_request()
┌──────▼──────────────┐
│ PENDING_REVIEW      │ (Esperando admin)
└──────┬───────┬──────┘
       │       │
   ✅APPROVE │ ❌REJECT
       │       │
┌──────▼──┐  ┌─▼──────────────┐
│CONFIRMED│  │PAYMENT_REJECTED│
└─────────┘  └────────┬───────┘
                      │ Reintentar
                      │ (crea nuevo request)
                 ┌────▼─────┐
                 │PENDING_...│
                 └───────────┘
```

---

## 📁 Rutas de Archivos

```
Nuevos:
  components/commercialPartners/pieceSales/
  ├── PieceSalesModule.tsx
  ├── PieceSalesSummaryCards.tsx
  ├── PieceSalesHistoryTable.tsx
  ├── SellerPieceStockTable.tsx
  ├── NewPieceSaleModal.tsx
  ├── NewPieceSaleSuccess.tsx
  └── RejectionRetryModal.tsx
  
  types/pieceSales.ts
  lib/pieceSalesHelpers.ts
  lib/pieceSalesRpc.ts

Modificados:
  pages/CommercialPartners.tsx (+1 pestaña)
```

---

## 🗄️ Vistas BD Utilizadas

- `v_piece_sale_products` - Catálogo de productos con precios
- `v_piece_sale_history` - Historial de ventas del vendedor
- `v_seller_commission_monthly_summary` - Resumen de comisiones
- `v_seller_piece_stock` - Stock informativo por vendedor
- `v_pending_payment_verifications` - Panel admin (filter: scheme='venta_pieza')

---

## 🔑 RPC Functions

```typescript
// Crear venta nueva
create_piece_sale_with_payment_request({
  p_sale_date: ISO string,
  p_payment_method: 'cash' | 'transfer',
  p_items: [{product_id, quantity}],
  p_payment_reference?: string,
  p_notes?: string
})

// Reintentar pago rechazado
create_piece_sale_payment_request({
  p_sale_id: string,
  p_payment_date: ISO string,
  p_payment_method: 'cash' | 'transfer',
  p_payment_reference?: string
})

// Enviar para verificación (existente, reutilizada)
submit_partner_payment_verification_request(
  requestId: string,
  proofPath?: string,
  fileName?: string,
  mimeType?: string,
  sizeBytes?: number
)
```

---

## 💾 Upload de Archivos

**Bucket**: `customer-payment-proofs`  
**Path**: `{userId}/{requestId}/{timestamp}-{filename}`  
**Tipos**: JPEG, PNG, WebP, PDF  
**Tamaño máx**: 10 MB  
**RLS**: Vendedor puede subir solo a su carpeta  

---

## 🎨 Interfaz Visual

### Tarjetas de Resumen
```
┌─────────────────────┬─────────────────────┐
│ Ventas del mes: 5   │ Comisión pendiente   │
│                     │ $1,250.00            │
├─────────────────────┼─────────────────────┤
│ Comisión disponible │ Cobros en revisión   │
│ $3,500.00           │ 2                    │
└─────────────────────┴─────────────────────┘
```

### Historial
```
Folio     │ Fecha    │ Unidades │ Total      │ Método  │ Estado
VPZ-0001  │ 23 Feb   │ 10       │ $5,000.00  │ Efectivo│ ✅ Confirmado
VPZ-0002  │ 22 Feb   │ 5        │ $2,500.00  │ Trans.  │ ⏳ En revisión
VPZ-0003  │ 21 Feb   │ 8        │ $4,000.00  │ Efectivo│ ❌ Rechazado [Reintentar]
```

---

## ⚙️ Configuración

### Validaciones

- Mínimo 1 producto por venta
- Si cash: checkbox obligatorio
- Si transfer: archivo obligatorio
- Archivo: ≤10MB, solo jpeg/png/webp/pdf
- Productos: No se puede agregar mismo producto 2 veces

### Límites

- Cantidad: 0-99,999 unidades
- Comisión: Calculada por backend
- Stock: Informativo, no restrictivo

---

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| No veo pestaña "Venta por pieza" | Verifica rol = socios_comerciales |
| Error al subir archivo | Verifica tamaño ≤10MB y formato (JPG/PNG/PDF) |
| Error "producto ya agregado" | Borra el producto del carrito y vuélvelo a agregar con cantidad nueva |
| Comisión no se acredita | Espera a que admin confirme en Gestión de pagos |
| Venta rechazada sin motivo | Contacta admin para que agregue motivo del rechazo |

---

## 📋 Checklist de Funcionalidad

### Vendedor
- [x] Ver pestaña (role-gated)
- [x] Crear venta (efectivo/transferencia)
- [x] Upload de comprobante
- [x] Ver historial propio
- [x] Reintentar pago rechazado
- [x] Ver resumen de comisiones
- [x] Ver stock asignado

### Admin (Futuro)
- [x] Filtrar pagos por scheme='venta_pieza'
- [x] Aprobar/rechazar pagos
- [ ] Dashboard de ventas por pieza (próxima fase)
- [ ] Reportes B2B desglosados (próxima fase)

---

## 📞 Support

- **Para cambios de venta**: No se pueden editar directamente. Contacta admin.
- **Para rechazos**: Admin debe agregar motivo para claridad
- **Para inconsistencias**: Verifica que precios sean actuales en BD

---

**v1.0** | Última actualización: 2025-02-23
