# 🗂️ DIAGRAMA DE RELACIONES - Esquema Comercial

## ASCII Diagram - Relaciones de Foreign Keys

```
┌─────────────────────────────────────────────────────────────────┐
│                     🔐 SISTEMA DE AUTENTICACIÓN                   │
│                                                                  │
│                      auth.users (Supabase)                       │
│                            ▲                                     │
│                            │                                     │
│                            │ (1:1)                               │
│                            │                                     │
│                      user_profiles ❌                            │
│                    (antes: "profiles")                           │
│            id, full_name, role, created_at                       │
│                                                                  │
└─────────────┬────────────────────────────────────────────────────┘
              │
              │ FK references
              │
              ├─────────────────────────────────────────────────────────┐
              │                                                         │
              ▼                                                         ▼
    ┌─────────────────────┐                              ┌──────────────────────┐
    │ assigned_to         │                              │ created_by           │
    │ created_by          │                              │ received_by          │
    │ received_by         │                              │ submitted_by         │
    │ reviewed_by         │                              │ produced_by          │
    │ created_by (other)  │                              │ created_by (other)   │
    └─────────────────────┘                              └──────────────────────┘


┌────────────────────────────────────────────────────────────────────────────┐
│                    🏢 SOCIOS COMERCIALES (Commercial Partners)               │
│                                                                              │
│  ┌─ commercial_partners ─────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  id (PK, UUID)                                                        │  │
│  │  folio (UNIQUE TEXT)                                                  │  │
│  │  business_name, responsible_name                                      │  │
│  │  contact: phone, whatsapp, email                                      │  │
│  │  location: address, neighborhood, city, state, postal_code            │  │
│  │  gps: latitude, longitude                                             │  │
│  │  model: partner_model ('comodato' | 'mayoreo')                        │  │
│  │  status: status ('activo' | 'pausado' | 'inactivo')                   │  │
│  │  status: wholesale_status (mayoreo only)                              │  │
│  │  assigned_to (FK → user_profiles) [vendedor asignado]                 │  │
│  │  timestamps: created_at, updated_at                                   │  │
│  │                                                                        │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                             │
│                               │ (1:N)                                       │
│                               │                                             │
└───────────────┬───────────────┼───────────────┬───────────────────────────┘
                │               │               │
                │               │               │
    ┌───────────▼──────┐   ┌────▼──────────┐   └──────┬──────────┐
    │                  │   │               │          │          │
    ▼                  ▼   ▼               ▼          ▼          ▼
    
    
┌──────────────────────────────────────────────────────────────────────┐
│              📦 COMODATO (Entrega y Liquidación de Stock)              │
│                                                                        │
│  ┌─ commercial_partner_movements ────────────────────────────────┐   │
│  │                                                               │   │
│  │  id (PK, UUID)                                              │   │
│  │  partner_id (FK → commercial_partners) [partner required]    │   │
│  │  movement_type (delivery|settlement|withdrawal|spoilage|...) │   │
│  │  movement_date (DATE)                                       │   │
│  │  status (completed|pending|partial)                         │   │
│  │  total_amount_due (NUMERIC)                                 │   │
│  │  visit_info: next_visit_date, next_visit_reason             │   │
│  │  timestamps: created_at, updated_at                         │   │
│  │                                                               │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                       │
│                             │ (1:N)                                 │
│                             │                                       │
│                    ┌────────▼────────┐                              │
│                    ▼                 ▼                              │
│                                                                     │
│  ┌─ commercial_partner_movement_items ────────────────────────┐   │
│  │                                                            │   │
│  │  id (PK, UUID)                                           │   │
│  │  movement_id (FK → movements) ON DELETE CASCADE           │   │
│  │  partner_id (FK → commercial_partners) [denormalized]     │   │
│  │  product: product_name, product_variant, product_size     │   │
│  │  quantities:                                              │   │
│  │    • quantity_delivered (entrega inicial)                │   │
│  │    • quantity_sold (lo que vendió)                       │   │
│  │    • quantity_withdrawn (retiró antes de vender)         │   │
│  │    • quantity_spoiled (pérdida/merma)                    │   │
│  │    • quantity_adjusted (ajustes administrativos)         │   │
│  │  pricing:                                                 │   │
│  │    • price_to_catcorn (lo que Cat Corn paga)           │   │
│  │    • suggested_retail_price (precio sugerido al público) │   │
│  │  amount_due = quantity_sold * price_to_catcorn          │   │
│  │  spoilage_absorbed_by (catcorn|partner)                 │   │
│  │  timestamps: created_at, updated_at                      │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│                             │                                  │
│                             │ (1:N)                            │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐  │
│  │                                                          │  │
│  │    commercial_partner_payments ◄── LINKED TO MOVEMENT  │  │
│  │                                                          │  │
│  │  id (PK, UUID)                                         │  │
│  │  partner_id (FK → commercial_partners)                 │  │
│  │  movement_id (FK → movements) [optional, for comodato] │  │
│  │  payment_date (TIMESTAMPTZ)                            │  │
│  │  amount (NUMERIC paid)                                 │  │
│  │  payment_method (cash|transfer)                        │  │
│  │  reference (comprobante/referencia transf.)            │  │
│  │  received_by (FK → user_profiles)                      │  │
│  │  status (completed|paid)                               │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│         💼 MAYOREO (Órdenes y Pagos de Mayorista)                     │
│                                                                        │
│  ┌─ wholesale_contracts ──────────────────────────────────────────┐  │
│  │                                                                 │  │
│  │  id (PK, UUID)                                                │  │
│  │  partner_id (FK → commercial_partners)                        │  │
│  │  contract_type (wholesale|comodato)                           │  │
│  │  status (draft|signed|active|inactive)                        │  │
│  │  dates: contract_date, signature_date                         │  │
│  │                                                                 │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                              │                                       │
│                              │ (required for activation)             │
│                              │                                       │
│  ┌───────────────────────────▼──────────────────────────────────┐  │
│  │  activate_wholesale_partner(contract_id)                     │  │
│  │  ✓ Verifica: saldo pendiente comodato <= 0.005               │  │
│  │  ✓ Si OK: activa partner.partner_model = 'mayoreo'           │  │
│  │  ✗ Si deuda: retorna error "Pague su deuda de comodato"      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└───────────────────────────┬────────────────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │               │
                    ▼               ▼

┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  ┌─ wholesale_orders ────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  id (PK, UUID)                                           │  │
│  │  partner_id (FK → commercial_partners)                   │  │
│  │  folio (UNIQUE, legible: MAY-2026-001)                   │  │
│  │  total_amount (NUMERIC monto orden)                      │  │
│  │  status (draft|confirmed|completed)                      │  │
│  │  timestamps: created_at, updated_at                      │  │
│  │                                                            │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │                                    │
│                           │ (1:N)                              │
│                           │                                    │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │                                                        │   │
│  │    wholesale_payments                                │   │
│  │                                                        │   │
│  │  id (PK, UUID)                                       │   │
│  │  partner_id (FK → commercial_partners)               │   │
│  │  wholesale_order_id (FK → wholesale_orders)          │   │
│  │  payment_date (TIMESTAMPTZ)                          │   │
│  │  amount (NUMERIC paid)                               │   │
│  │  payment_method (cash|transfer)                      │   │
│  │  reference (comprobante)                             │   │
│  │  received_by (FK → user_profiles)                    │   │
│  │  status (completed|paid)                             │   │
│  │  timestamps: created_at, updated_at                  │   │
│  │                                                        │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
└──────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│        🔍 SISTEMA DE VERIFICACIÓN DE PAGOS (Payment Verification)     │
│                                                                        │
│  ┌─ partner_payment_verification_requests ─────────────────────────┐ │
│  │                                                                  │ │
│  │  id (PK, UUID)                                                 │ │
│  │  folio (UNIQUE, auto-gen: COBRO-YYYYMM-#####)                 │ │
│  │  scheme (comodato|mayoreo) ◄── DETERMINA TIPO DE OPERACIÓN   │ │
│  │  partner_id (FK → commercial_partners)                        │ │
│  │                                                                  │ │
│  │  Operation references (solo UNO debe ser non-null):          │ │
│  │    • movement_id (FK → commercial_partner_movements)          │ │
│  │    • wholesale_order_id (FK → wholesale_orders)               │ │
│  │                                                                  │ │
│  │  Payment details:                                             │ │
│  │    • payment_date (TIMESTAMPTZ)                               │ │
│  │    • amount (NUMERIC(12,2))                                   │ │
│  │    • payment_method (cash|transfer)                           │ │
│  │    • payment_reference                                        │ │
│  │                                                                  │ │
│  │  Proof (solo para transfer):                                 │ │
│  │    • proof_path (path en storage)                             │ │
│  │    • proof_file_name, proof_mime_type, proof_size_bytes       │ │
│  │                                                                  │ │
│  │  Workflow Status (state machine):                            │ │
│  │    draft ─┬─► pending_review ─┬─► approved ─┬─► crear payment│ │
│  │           │                    └─► rejected │                │ │
│  │           └────────────────────────► cancelled                │ │
│  │                                                                  │ │
│  │  Review tracking:                                             │ │
│  │    • reviewed_by (FK → user_profiles) [solo admin]            │ │
│  │    • reviewed_at (TIMESTAMPTZ)                                │ │
│  │    • review_notes, rejection_reason                           │ │
│  │                                                                  │ │
│  │  Link a payment creado:                                       │ │
│  │    • approved_payment_id (FK a commercial o wholesale payment)│ │
│  │                                                                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Functions:                                                         │
│  • generate_payment_verification_folio() → COBRO-YYYYMM-#####      │
│  • create_partner_payment_verification_request() → draft            │
│  • submit_partner_payment_verification_request() → pending_review   │
│  • approve_partner_payment_verification_request() → approved+crea  │
│  • reject_partner_payment_verification_request() → rejected        │
│  • cancel_partner_payment_verification_request() → cancelled       │
│                                                                      │
│  RLS Policies:                                                      │
│  • Vendors ven solo sus requests                                   │
│  • Admin acceso completo                                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                    📊 VISTAS PARA REPORTERÍA                           │
│                                                                        │
│  ✓ v_pending_payment_verifications                                  │
│    SELECT * FROM v_pending_payment_verifications                    │
│    WHERE status = 'pending_review'                                  │
│    Columns: request_id, folio, scheme, partner, amount, seller     │
│                                                                      │
│  ✓ v_partner_payment_verification_history                          │
│    SELECT * FROM v_partner_payment_verification_history            │
│    WHERE created_at BETWEEN ? AND ?                                │
│    Columns: todo + status_label, submitted_by_name, reviewed_by   │
│                                                                      │
│  ❌ v_wholesale_order_totals (FALTA CREAR)                         │
│    SELECT partner_id, folio, total_amount, paid_amount,pending     │
│    FROM v_wholesale_order_totals                                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘


                        🔗 FLUJO DE DATOS COMODATO

    Socio Entrega Stock
         │
         ▼
    commercial_partner_movements (delivery)
         │
         ├─► commercial_partner_movement_items x N
         │    (cantidad_delivered = X)
         │
         ▼
    Socio vende stock localmente
         │
         ├─► movement_item.quantity_sold = Y
         │    amount_due = Y * price_to_catcorn
         │
         ▼
    Socio registra liquidación
         │
         ├─► commercial_partner_movements (settlement)
         │    con items de: quantity_sold, qty_returned, qty_spoiled
         │
         ▼
    Verificar pago pendiente
         │
         ├─► CREATE partner_payment_verification_request
         │    scheme = 'comodato'
         │    movement_id = [settlement movement]
         │
         ▼
    Socio SUBMIT pago (prueba si es transfer)
         │
         ├─► proof_path = usuarios/{user_id}/{request_id}/*
         │
         ▼
    Admin REVIEW y APPROVE
         │
         ├─► Crea commercial_partner_payments automáticamente
         │    movement_id = [settlement movement]
         │    status = 'completed'
         │
         ▼
    ✅ Pago registrado


                        🔗 FLUJO DE DATOS MAYOREO

    Partner activa mayoreo
         │
         ├─► wholesale_contracts.status = 'signed'
         ├─► activate_wholesale_partner(contract_id)
         │    Verifica: saldo_comodato_pendiente <= 0.005
         │
         ▼
    Partner crea orden mayoreo
         │
         ├─► wholesale_orders
         │    folio = MAY-2026-001
         │    total_amount = monto de orden
         │
         ▼
    Verificar pago orden
         │
         ├─► CREATE partner_payment_verification_request
         │    scheme = 'mayoreo'
         │    wholesale_order_id = [order id]
         │
         ▼
    Partner/Admin SUBMIT pago
         │
         ├─► proof_path (si transfer)
         │
         ▼
    Admin APPROVE
         │
         ├─► Crea wholesale_payments automáticamente
         │    wholesale_order_id = [order id]
         │
         ▼
    ✅ Pago registrado


                        🔗 ARQUITECTURA RLS

    public.partner_payment_verification_requests
    ├─ SELECT: submitted_by = auth.uid() OR role = 'admin'
    ├─ INSERT: false (solo vía RPC)
    ├─ UPDATE: false (solo vía RPC)
    └─ DELETE: false (solo vía RPC)

    Funciones SECURITY DEFINER:
    ├─ create_partner_payment_verification_request()
    ├─ submit_partner_payment_verification_request()
    ├─ approve_partner_payment_verification_request()
    ├─ reject_partner_payment_verification_request()
    └─ cancel_partner_payment_verification_request()

```

---

## 📐 Tabla de Relaciones Normalizadas

| From Table | To Table | FK Column | Cardinality | Delete | Notes |
|------------|----------|-----------|-------------|--------|-------|
| commercial_partners | user_profiles | assigned_to | N:1 | SET NULL | Vendedor asignado |
| commercial_partners | user_profiles | created_by | N:1 | SET NULL | Creador del registro |
| commercial_partner_movements | commercial_partners | partner_id | N:1 | CASCADE | Movimiento de socio |
| commercial_partner_movement_items | commercial_partner_movements | movement_id | N:1 | CASCADE | Item en movimiento |
| commercial_partner_movement_items | commercial_partners | partner_id | N:1 | CASCADE | Denormalizado para query |
| commercial_partner_payments | commercial_partners | partner_id | N:1 | CASCADE | Pago a socio |
| commercial_partner_payments | commercial_partner_movements | movement_id | N:1 | CASCADE | Pago de qué movimiento |
| commercial_partner_payments | user_profiles | received_by | N:1 | SET NULL | Quién recibió pago |
| wholesale_orders | commercial_partners | partner_id | N:1 | CASCADE | Orden de socio |
| wholesale_payments | commercial_partners | partner_id | N:1 | CASCADE | Pago a socio |
| wholesale_payments | wholesale_orders | wholesale_order_id | N:1 | CASCADE | Pago de qué orden |
| wholesale_payments | user_profiles | received_by | N:1 | SET NULL | Quién recibió |
| wholesale_contracts | commercial_partners | partner_id | N:1 | CASCADE | Contrato de socio |
| partner_payment_verification_requests | commercial_partners | partner_id | N:1 | RESTRICT | Verificación de pago |
| partner_payment_verification_requests | commercial_partner_movements | movement_id | N:1 | RESTRICT | Si comodato |
| partner_payment_verification_requests | wholesale_orders | wholesale_order_id | N:1 | RESTRICT | Si mayoreo |
| partner_payment_verification_requests | user_profiles | submitted_by | N:1 | RESTRICT | Quién envió |
| partner_payment_verification_requests | user_profiles | reviewed_by | N:1 | SET NULL | Quién revisó |

---

## 🎯 Entidades Principales vs. Transaccionales

### Maestros (Master Data)
```
commercial_partners ─► user_profiles
wholesale_contracts
```

### Transaccionales (Transactions)
```
commercial_partner_movements ─► commercial_partner_movement_items
├─► commercial_partner_payments
└─► partner_payment_verification_requests

wholesale_orders
├─► wholesale_payments
└─► partner_payment_verification_requests
```

