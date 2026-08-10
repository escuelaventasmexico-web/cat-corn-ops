# QUICK REFERENCE: Implementación POS Comisiones

**Estado**: ✅ COMPLETADA - SIN EJECUTAR  
**Build**: ✅ SUCCESS (0 errors)

---

## 🎯 LO QUE SE IMPLEMENTÓ

### Backend (SQL)
**Archivo**: `supabase/migrations/20260809_pos_commission_integration.sql`

1. **ALTER TABLE constraint** - Agregar 'pos_sale' a commission_events.source_type
2. **Función**: `sync_pos_commission_for_sale_item()` - Crea comisión automáticamente
3. **Trigger #1**: `tr_sale_items_sync_pos_commission` - Dispara en cada INSERT de sale_item
4. **Función #2**: `handle_sale_refund_commission()` - Maneja refunds
5. **Trigger #2**: `tr_sales_refund_commission` - Dispara cuando sale.is_refunded = true
6. **Vista**: `v_commission_events_effective` - Garantiza pos_sale incluidas

### Frontend (TypeScript)
**Cambios mínimos**: +5 líneas total

| Archivo | Línea | Cambio |
|---------|-------|--------|
| commissionTypes.ts | 25 | CommissionMovement.source_type: añadir 'pos_sale' |
| commissionTypes.ts | 79 | CommissionSettlementDetail.source_type: añadir 'pos_sale' |
| commissionTypes.ts | 125 | SourceType type: añadir 'pos_sale' |
| commissionUtils.ts | 85 | getSourceTypeLabel('pos_sale') → 'Venta en Punto de Venta' |
| commissionUtils.ts | 93 | getSourceTypeColor('pos_sale') → '#06b6d4' (cyan) |

**POS.tsx**: ✅ 0 cambios (handleCheckout sin modificar)

---

## 🔄 FLUJO AUTOMÁTICO

```
┌─────────────────────────────────────────┐
│ socios_comerciales cobra en POS        │
│ Inserta: sales + sale_items             │
└──────────────┬──────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ TRIGGER dispara:     │
    │ tr_sale_items_       │
    │ sync_pos_commission  │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ FUNCIÓN verifica:               │
    │ 1. sale_origin = 'pos'? ✓      │
    │ 2. role = 'socios_comerciales'? │
    │ 3. product_id IS NOT NULL?      │
    │ 4. is_refunded = false?         │
    │ 5. Tariff existe?               │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ CREA commission_event:           │
    │ • seller_id = cashier_id        │
    │ • partner_id = NULL             │
    │ • source_type = 'pos_sale'      │
    │ • status = 'available'          │
    │ • commission = qty × tariff     │
    └──────────────────────────────────┘
```

---

## ✅ TESTING SCENARIOS

### A. Admin cobra POS
```
Admin → $65 venta → SIN comisión ✅
(role != socios_comerciales)
```

### B. socios_comerciales cobra POS (con tariff)
```
Gerardo → $65 venta → $10 comisión ✅
(role = socios_comerciales + tariff existe)
```

### C. socios_comerciales cobra genérico
```
Gerardo → $50 genérico → SIN comisión ✅
(product_id = NULL)
```

### D. Refund venta con comisión
```
Comisión status=available → status=cancelled ✅
Motivo registrado: "Venta POS reembolsada"
```

### E. Refund venta con comisión pagada
```
Comisión status=paid → NO modificar ✅
Admin recibe alerta: "Requiere revisión manual"
```

---

## 📊 DATOS GUARDADOS

### commission_events (nuevo registro)
```sql
seller_id:           UUID (cashier)
partner_id:          NULL (POS no tiene partner)
source_type:         'pos_sale' (NEW)
source_id:           sales.id
source_item_id:      sale_items.id
rule_id:             UUID de venta_pieza
product_key:         'gato_mayor_normal' (ej)
product_name:        'Gato Mayor'
product_variant:     'Normal' (flavor)
product_size:        '750 grs' (size_label)
quantity:            1
unit_commission:     10 (numérico)
commission_amount:   10 (qty × unit)
release_condition:   'immediate_payment'
status:              'available' (NO pending)
earned_at:           sales.created_at
available_at:        sales.created_at
metadata:            {
                       channel: 'pos',
                       cashier_id: UUID,
                       sale_id: UUID,
                       sale_item_id: UUID,
                       commission_scheme: 'venta_pieza'
                     }
```

---

## 🔐 SEGURIDAD

### Por qué backend-driven?
| Aspecto | Frontend | Backend | Elegido |
|---------|----------|---------|---------|
| **Bypasseable** | SÍ (usuario modifica) | NO | Backend ✅ |
| **Auditable** | NO | SÍ (logs SQL) | Backend ✅ |
| **Consistente** | NO (bugs JS) | SÍ (constraints) | Backend ✅ |

### Por qué SECURITY DEFINER?
```sql
SECURITY DEFINER
SET search_path = public, pg_temp
```
- Ejecuta como propietario (Supabase superuser)
- No accesible directamente desde frontend
- Previene tampering de permisos

### RLS: ¿Qué cambia?
**NADA**: Función invoca con privilegios DEFINER, RLS no se aplica

---

## 📈 DATOS A VERIFICAR

### Dashboard Comisiones - Vendedor
```
Nombre:          Gerardo
Generadas:       $10 (pos_sale)
Disponibles:     $10 (status=available)
Pendientes:      $0
Pagadas:         $0
Origen:
  • Comodato:    $0
  • Mayoreo:     $0
  • Pieza:       $0
  • Punto Venta: $10 ← NUEVO
```

### Dashboard Comisiones - Admin
```
Todos los vendedores
Filtro: source_type = 'pos_sale' ← NUEVO FILTRO
Ordena por earned_at desc
```

### Settlement
```
Disponible para pagar:
  • Comodato:    $50
  • Mayoreo:     $100
  • Pieza:       $25
  • Punto Venta: $10 ← INCLUIDA AUTOMÁTICAMENTE
  TOTAL:         $185
```

---

## ⚠️ LIMITACIONES ACTUALES

### No Incluidos (Por Diseño)
1. ❌ Comisiones negativas para refunds (esperar confirmación settlements)
2. ❌ Nuevo índice único (idempotencia via función query, no índice)
3. ❌ commission_sync_issue tabla (logging, futuro)
4. ❌ Desglose de unidades pos_sale en summary (puede agregarse)

### No Modificados (Preservación)
1. ✅ POS.tsx (sin cambios)
2. ✅ SalesHistory.tsx (sin cambios)
3. ✅ AuthContext (sin cambios)
4. ✅ RLS policies (sin cambios)

---

## 🚀 PARA EJECUTAR

### Paso 1: Review
```
Lee: IMPLEMENTACION_POS_COMISIONES_COMPLETO.md
Verifica: Reglas de negocio correctas
Aprueba: Cambios SQL + TypeScript
```

### Paso 2: SQL Execution (Supabase Dashboard)
```sql
-- Copy entire migration file:
-- supabase/migrations/20260809_pos_commission_integration.sql
-- Paste into Supabase SQL editor
-- Execute (watch for errors)
```

### Paso 3: Deploy Frontend
```bash
cd /path/to/project
git add components/commercialPartners/commissions/
git commit -m "feat: add pos_sale to commission types and utilities"
git push origin main
npm run build  # Already done: ✅ 0 errors
```

### Paso 4: Test
```
1. Admin cobra POS → verifica Dashboard (sin comisión)
2. socios_comerciales cobra POS → verifica Comisiones (con comisión)
3. Refund venta → verifica comisión cancelada
4. Payment system → calcula settlement correcto
```

---

## 📂 ARCHIVOS GENERADOS

### Nuevos
- ✅ `supabase/migrations/20260809_pos_commission_integration.sql` (550 líneas)
- ✅ `IMPLEMENTACION_POS_COMISIONES_COMPLETO.md` (este documento extenso)

### Modificados
- ✅ `components/commercialPartners/commissions/commissionTypes.ts` (+3 líneas)
- ✅ `components/commercialPartners/commissions/commissionUtils.ts` (+2 líneas)

### Sin Cambios
- ✅ `pages/POS.tsx` (0 cambios)
- ✅ `contexts/AuthContext.tsx` (0 cambios)
- ✅ Todas las demás

---

## 🎓 CONCEPTOS CLAVE

### source_type vs rule scheme
```
source_type: 'pos_sale'        ← Describe origen (POS)
rule scheme: 'venta_pieza'     ← Describe tarifa (reutilizada)

Esto permite:
• Rastrear que fue POS (source_type)
• Usar tariffs existentes (rule scheme)
• Sin crear nuevas reglas
```

### status: 'available' vs 'pending'
```
pending:   Requiere aprobación (ej: piece_sale)
available: Inmediatamente disponible (ej: pos_sale)

POS se paga now → comisión available now → pago disponible
```

### partner_id = NULL
```
comodato:     partner_id = UUID (Socio Comercial específico)
mayoreo:      partner_id = UUID (Socio Comercial específico)
pieza:        partner_id = UUID (Vendedor específico)
pos_sale:     partner_id = NULL (No hay "socio", es POS)

Vistas: LEFT JOIN (permite NULL) ✅
Settlement: Procesa normal ✅
```

---

## 🔍 DEBUGGING

### Si comisión NO se crea:
```sql
-- Verificar: Sales creada correctamente
SELECT * FROM sales WHERE id = 'sale_id_aqui' LIMIT 1;
→ Verifica: sale_origin='pos', is_refunded=false, cashier_id=UUID

-- Verificar: Sale_item creada correctamente
SELECT * FROM sale_items WHERE id = 'item_id_aqui' LIMIT 1;
→ Verifica: product_id IS NOT NULL, is_generic=false, quantity>0

-- Verificar: Usuario tiene rol correcto
SELECT role FROM user_profiles WHERE id = 'cashier_id_aqui';
→ Debe retornar: 'socios_comerciales'

-- Verificar: Tariff existe
SELECT * FROM commission_rules WHERE product_key LIKE '%gato%' AND schema_name='venta_pieza';
→ Debe retornar at least 1 row con commission_amount > 0

-- Verificar: Logs de error
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';  -- si logs configurados
```

### Si comisión creada pero status=pending:
```sql
-- Verificar metadata
SELECT metadata FROM commission_events WHERE id = 'event_id_aqui';
→ Debe contener: "commission_scheme": "venta_pieza"

-- Actualizar a available (manual, solo si necesario)
UPDATE commission_events SET status='available', available_at=now() WHERE id='event_id_aqui';
```

### Si refund NO cancela comisión:
```sql
-- Verificar: trigger ejecutó
SELECT * FROM pg_trigger WHERE tgname = 'tr_sales_refund_commission';
→ Debe existir y estar enabled (tgenabled = 'O')

-- Verificar: update fue correcto
SELECT is_refunded FROM sales WHERE id='sale_id_aqui';
→ Debe ser: true

-- Check comisión state
SELECT status, cancelled_at FROM commission_events WHERE source_id='sale_id_aqui';
→ Si status='available': Debe ser → 'cancelled' y cancelled_at set
```

---

## 📞 CONTACTO / QUESTIONS

- **SQL Questions**: Ver IMPLEMENTACION_POS_COMISIONES_COMPLETO.md secciones 2-9
- **TypeScript Questions**: Ver IMPLEMENTACION_POS_COMISIONES_COMPLETO.md sección 10
- **Business Logic**: Ver IMPLEMENTACION_POS_COMISIONES_COMPLETO.md secciones 12-18
- **Integration**: Ver IMPLEMENTACION_POS_COMISIONES_COMPLETO.md secciones 17, 19

---

**Última actualización**: 9 de agosto de 2026  
**Versión**: 1.0 (LISTO PARA REVIEW)  
**Build Status**: ✅ 0 ERRORS
