# 📑 REFERENCIA RÁPIDA - Estructura de Tablas Faltantes

## Tabla 1: `commercial_partners`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK, default gen_random_uuid() |
| folio | TEXT | YES | UNIQUE - identificador legible |
| business_name | TEXT | YES | Nombre del negocio |
| responsible_name | TEXT | YES | Contacto principal |
| phone | TEXT | NO | Teléfono |
| whatsapp | TEXT | NO | Número WhatsApp |
| email | TEXT | NO | Email |
| business_type | TEXT | YES | retail, distributor, etc. |
| business_type_other | TEXT | NO | Si business_type es 'other' |
| partner_model | TEXT | YES | DEFAULT 'comodato' - comodato\|mayoreo |
| status | TEXT | YES | DEFAULT 'activo' - activo\|pausado\|inactivo |
| wholesale_status | TEXT | NO | active\|pending\|inactive (mayoreo) |
| address | TEXT | NO | Dirección |
| neighborhood | TEXT | NO | Colonia/Barrio |
| city | TEXT | NO | Ciudad |
| state | TEXT | NO | Estado |
| postal_code | TEXT | NO | Código postal |
| google_maps_url | TEXT | NO | URL en Google Maps |
| latitude | NUMERIC | NO | Coordenada GPS |
| longitude | NUMERIC | NO | Coordenada GPS |
| location_notes | TEXT | NO | Notas de ubicación |
| opening_hours | TEXT | NO | Horario de atención |
| preferred_visit_days | TEXT | NO | Días preferidos (JSON array) |
| assigned_to | UUID | NO | FK user_profiles - Vendedor asignado |
| created_by | UUID | NO | FK user_profiles - Quién creó |
| notes | TEXT | NO | Notas internas |
| active | BOOLEAN | NO | DEFAULT true |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_commercial_partners_status ON public.commercial_partners(status);
CREATE INDEX idx_commercial_partners_partner_model ON public.commercial_partners(partner_model);
CREATE INDEX idx_commercial_partners_assigned_to ON public.commercial_partners(assigned_to);
CREATE INDEX idx_commercial_partners_folio ON public.commercial_partners(folio);
```

---

## Tabla 2: `commercial_partner_movements`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| movement_type | TEXT | YES | delivery\|settlement\|withdrawal\|spoilage\|adjustment\|visit |
| movement_date | DATE | YES | Fecha del movimiento |
| status | TEXT | YES | DEFAULT 'completed' - completed\|pending\|partial |
| total_amount_due | NUMERIC(12,2) | NO | Monto total adeudado |
| next_visit_date | DATE | NO | Fecha próxima visita |
| next_visit_reason | TEXT | NO | Razón de próxima visita |
| notes | TEXT | NO | Notas |
| created_by | UUID | NO | FK user_profiles |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_cpm_partner_id ON public.commercial_partner_movements(partner_id);
CREATE INDEX idx_cpm_movement_date ON public.commercial_partner_movements(movement_date);
CREATE INDEX idx_cpm_type ON public.commercial_partner_movements(movement_type);
CREATE INDEX idx_cpm_status ON public.commercial_partner_movements(status);
```

---

## Tabla 3: `commercial_partner_movement_items`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| movement_id | UUID | YES | FK commercial_partner_movements(id) ON DELETE CASCADE |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| product_id | UUID | NO | Referencia a productos |
| product_name | TEXT | YES | Nombre del producto |
| product_variant | TEXT | NO | Variante (Salada, Caramelo, etc.) |
| product_size | TEXT | NO | Tamaño (Mini Michi, Gato Mayor, etc.) |
| quantity_delivered | NUMERIC(10,2) | NO | DEFAULT 0 - Unidades entregadas |
| quantity_sold | NUMERIC(10,2) | NO | DEFAULT 0 - Unidades vendidas |
| quantity_withdrawn | NUMERIC(10,2) | NO | DEFAULT 0 - Unidades retiradas |
| quantity_spoiled | NUMERIC(10,2) | NO | DEFAULT 0 - Unidades pérdida |
| quantity_adjusted | NUMERIC(10,2) | NO | DEFAULT 0 - Unidades ajustadas |
| price_to_catcorn | NUMERIC(12,2) | NO | Precio que paga Cat Corn por unidad |
| suggested_retail_price | NUMERIC(12,2) | NO | Precio sugerido al público |
| amount_due | NUMERIC(12,2) | NO | DEFAULT 0 - Monto a pagar por ventas |
| spoilage_absorbed_by | TEXT | NO | catcorn\|partner - Quién absorbe merma |
| notes | TEXT | NO | Notas del item |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Cálculos:**
```
amount_due = quantity_sold * price_to_catcorn
```

**Índices recomendados:**
```sql
CREATE INDEX idx_cpmi_movement_id ON public.commercial_partner_movement_items(movement_id);
CREATE INDEX idx_cpmi_partner_id ON public.commercial_partner_movement_items(partner_id);
```

---

## Tabla 4: `commercial_partner_payments`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| movement_id | UUID | NO | FK commercial_partner_movements(id) ON DELETE CASCADE |
| payment_date | TIMESTAMPTZ | YES | Fecha/hora del pago |
| amount | NUMERIC(12,2) | YES | Monto pagado |
| payment_method | TEXT | YES | cash\|transfer |
| reference | TEXT | NO | Referencia de transferencia o comprobante |
| notes | TEXT | NO | Notas |
| received_by | UUID | NO | FK user_profiles - Quién recibió |
| status | TEXT | YES | DEFAULT 'completed' - completed\|paid |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_cpp_partner_id ON public.commercial_partner_payments(partner_id);
CREATE INDEX idx_cpp_movement_id ON public.commercial_partner_payments(movement_id);
CREATE INDEX idx_cpp_payment_date ON public.commercial_partner_payments(payment_date);
```

---

## Tabla 5: `wholesale_orders`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| folio | TEXT | YES | UNIQUE - Identificador legible (MAY-2026-001) |
| total_amount | NUMERIC(12,2) | YES | Monto total de la orden |
| status | TEXT | YES | DEFAULT 'draft' - draft\|confirmed\|completed |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_wholesale_orders_partner_id ON public.wholesale_orders(partner_id);
CREATE INDEX idx_wholesale_orders_folio ON public.wholesale_orders(folio);
CREATE INDEX idx_wholesale_orders_status ON public.wholesale_orders(status);
```

---

## Tabla 6: `wholesale_payments`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| wholesale_order_id | UUID | YES | FK wholesale_orders(id) ON DELETE CASCADE |
| payment_date | TIMESTAMPTZ | YES | Fecha/hora del pago |
| amount | NUMERIC(12,2) | YES | Monto pagado |
| payment_method | TEXT | YES | cash\|transfer |
| reference | TEXT | NO | Referencia de transferencia |
| notes | TEXT | NO | Notas |
| received_by | UUID | NO | FK user_profiles - Quién recibió |
| status | TEXT | YES | DEFAULT 'completed' - completed\|paid |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_wholesale_payments_partner_id ON public.wholesale_payments(partner_id);
CREATE INDEX idx_wholesale_payments_order_id ON public.wholesale_payments(wholesale_order_id);
CREATE INDEX idx_wholesale_payments_payment_date ON public.wholesale_payments(payment_date);
```

---

## Tabla 7: `wholesale_contracts`
| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| id | UUID | YES | PK |
| partner_id | UUID | YES | FK commercial_partners(id) ON DELETE CASCADE |
| contract_type | TEXT | YES | wholesale\|comodato |
| status | TEXT | YES | DEFAULT 'draft' - draft\|signed\|active\|inactive |
| contract_date | DATE | NO | Fecha del contrato |
| signature_date | DATE | NO | Fecha de firma |
| created_at | TIMESTAMPTZ | NO | DEFAULT now() |
| updated_at | TIMESTAMPTZ | NO | DEFAULT now() |

**Índices recomendados:**
```sql
CREATE INDEX idx_wholesale_contracts_partner_id ON public.wholesale_contracts(partner_id);
CREATE INDEX idx_wholesale_contracts_status ON public.wholesale_contracts(status);
```

---

## Tabla 8: Corrección de `profiles` → `user_profiles`

**Estado actual en schema.sql:**
```sql
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  role user_role DEFAULT 'cashier',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Problema:** Código espera `user_profiles`

**Solución:**
```sql
-- OPCIÓN A: Renombrar
ALTER TABLE public.profiles RENAME TO user_profiles;

-- O OPCIÓN B: Crear alias/view
CREATE VIEW user_profiles AS SELECT * FROM profiles;
```

---

## Vista 9: `v_wholesale_order_totals`

Columnas esperadas:
```sql
CREATE OR REPLACE VIEW v_wholesale_order_totals AS
SELECT
  wo.id,
  wo.partner_id,
  cp.folio AS partner_folio,
  cp.business_name,
  wo.folio,
  wo.total_amount,
  COALESCE(
    (SELECT SUM(CAST(amount AS NUMERIC)) 
     FROM wholesale_payments 
     WHERE wholesale_order_id = wo.id AND status IN ('completed', 'paid')),
    0
  ) AS paid_amount,
  wo.total_amount - COALESCE(
    (SELECT SUM(CAST(amount AS NUMERIC)) 
     FROM wholesale_payments 
     WHERE wholesale_order_id = wo.id AND status IN ('completed', 'paid')),
    0
  ) AS pending_amount,
  wo.status,
  wo.created_at
FROM wholesale_orders wo
LEFT JOIN commercial_partners cp ON wo.partner_id = cp.id;
```

---

## Función 10: `activate_wholesale_partner(p_contract_id UUID)`

**Firma:**
```sql
CREATE OR REPLACE FUNCTION public.activate_wholesale_partner(p_contract_id UUID)
RETURNS TABLE (
  contract_id UUID,
  activation_success BOOLEAN,
  message TEXT
)
```

**Lógica:**
1. Validar que usuario es admin
2. Obtener partner_id del contrato
3. Calcular saldo pendiente de comodato
4. Si saldo > 0.005: rechazar con mensaje de deuda
5. Si OK: activar mayoreo y retornar éxito

---

## Función 11: `is_commission_admin()`

**Recomendado:**
```sql
CREATE OR REPLACE FUNCTION public.is_commission_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql;
```

---

## 🔗 Relaciones de Foreign Keys

```
commercial_partners
├── ← commercial_partner_movements (partner_id)
├── ← commercial_partner_movement_items (partner_id)
├── ← commercial_partner_payments (partner_id)
├── ← wholesale_orders (partner_id)
├── ← wholesale_payments (partner_id)
├── ← wholesale_contracts (partner_id)
├── → user_profiles (assigned_to)
└── → user_profiles (created_by)

commercial_partner_movements
├── → commercial_partners (partner_id)
├── ← commercial_partner_movement_items (movement_id)
├── ← commercial_partner_payments (movement_id)
└── → user_profiles (created_by)

commercial_partner_movement_items
├── → commercial_partner_movements (movement_id)
└── → commercial_partners (partner_id)

commercial_partner_payments
├── → commercial_partners (partner_id)
├── → commercial_partner_movements (movement_id)
└── → user_profiles (received_by)

wholesale_orders
├── → commercial_partners (partner_id)
└── ← wholesale_payments (wholesale_order_id)

wholesale_payments
├── → commercial_partners (partner_id)
├── → wholesale_orders (wholesale_order_id)
└── → user_profiles (received_by)

wholesale_contracts
├── → commercial_partners (partner_id)

user_profiles
└── → auth.users (id)
```

---

## ⚠️ RESTRICCIONES Y CONSTRAINTS

### CHECK Constraints (Valores permitidos):
```sql
-- commercial_partner_movements.movement_type
CHECK (movement_type IN ('delivery', 'settlement', 'withdrawal', 'spoilage', 'adjustment', 'visit'))

-- commercial_partner_movements.status
CHECK (status IN ('completed', 'pending', 'partial'))

-- commercial_partner_movement_items.spoilage_absorbed_by
CHECK (spoilage_absorbed_by IN ('catcorn', 'partner'))

-- commercial_partner_payments.payment_method
CHECK (payment_method IN ('cash', 'transfer'))

-- commercial_partner_payments.status
CHECK (status IN ('completed', 'paid'))

-- wholesale_orders.status
CHECK (status IN ('draft', 'confirmed', 'completed'))

-- wholesale_payments.payment_method
CHECK (payment_method IN ('cash', 'transfer'))

-- wholesale_payments.status
CHECK (status IN ('completed', 'paid'))

-- wholesale_contracts.status
CHECK (status IN ('draft', 'signed', 'active', 'inactive'))
```

### UNIQUE Constraints:
```sql
UNIQUE (folio) ON commercial_partners
UNIQUE (folio) ON wholesale_orders
```

---

## 📊 Resumen de Cardinalidad

| Relación | Tipo | Razón |
|----------|------|-------|
| Partner → Movements | 1:N | Un socio puede tener múltiples movimientos |
| Movement → Items | 1:N | Un movimiento puede tener múltiples items |
| Movement → Payments | 1:N | Un movimiento puede tener múltiples pagos |
| Partner → Payments | 1:N | Pagos directos al socio |
| Partner → Orders | 1:N | Un socio puede tener múltiples órdenes mayoreo |
| Order → Payments | 1:N | Una orden puede tener múltiples pagos |
| Partner → Contracts | 1:N | Un socio puede tener múltiples contratos |
| Partner → User | N:1 | Múltiples socios asignados a un vendedor |

