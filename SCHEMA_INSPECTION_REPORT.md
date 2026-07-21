# 📊 REPORTE DE INSPECCIÓN DEL ESQUEMA - Supabase cat-corn-ops
**Fecha:** 20 de julio de 2026  
**Objetivo:** Confirmar estructura real de tablas y validar referencias en SQL

---

## ⚠️ HALLAZGOS CRÍTICOS

### 🔴 PROBLEMA PRINCIPAL
El archivo `migration_partner_payment_verification.sql` está haciendo referencias a tablas que **NO EXISTEN** en el schema.sql:

1. ❌ `public.commercial_partners` - **NO DEFINIDA EN schema.sql**
2. ❌ `public.commercial_partner_movements` - **NO DEFINIDA EN schema.sql**
3. ❌ `public.commercial_partner_movement_items` - **NO DEFINIDA EN schema.sql**
4. ❌ `public.commercial_partner_payments` - **NO DEFINIDA EN schema.sql**
5. ❌ `public.wholesale_orders` - **NO DEFINIDA EN schema.sql**
6. ❌ `public.wholesale_payments` - **NO DEFINIDA EN schema.sql**
7. ❌ `public.wholesale_contracts` - **NO DEFINIDA EN schema.sql**
8. ❌ `public.user_profiles` - **NO DEFINIDA EN schema.sql** (usa `auth.users`)
9. ❌ `public.activate_wholesale_partner()` - **FUNCIÓN NO DEFINIDA EN schema.sql**

---

## 📋 TABLA 1: `commercial_partners`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas en el código:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L25) - Línea 25
- [CommercialPartners.tsx](components/commercialPartners/comodato/CommercialPartnerComodato.tsx)
- [WholesaleActivationWizard.tsx](components/commercialPartners/wholesale/WholesaleActivationWizard.tsx#L316)
- [CommercialPartnerForm.tsx](components/commercialPartners/CommercialPartnerForm.tsx#L291)

### Columnas inferidas del código (TypeScript `CommercialPartner` interface):
```typescript
id: string;
folio?: string | null;
business_name: string;
responsible_name: string;
phone?: string | null;
whatsapp?: string | null;
email?: string | null;
business_type: string;
business_type_other?: string | null;
partner_model: string;              // 'comodato' | 'mayoreo'
status: string;                     // 'activo' | 'pausado' | 'inactivo'
wholesale_status?: string | null;   // 'active' | 'pending' | etc.
address?: string | null;
neighborhood?: string | null;
city?: string | null;
state?: string | null;
postal_code?: string | null;
google_maps_url?: string | null;
latitude?: number | null;
longitude?: number | null;
location_notes?: string | null;
opening_hours?: string | null;
preferred_visit_days?: string | null;
assigned_to?: string | null;        // FK a user_profiles (vendedor)
created_by?: string | null;
notes?: string | null;
active?: boolean | null;
created_at?: string | null;
updated_at?: string | null;
```

### Datos de prueba observados:
```json
{
  "id": "uuid",
  "folio": "PART-202607-001",
  "business_name": "Tienda El Maíz",
  "responsible_name": "Juan Pérez",
  "business_type": "retail",
  "partner_model": "comodato",
  "status": "activo",
  "assigned_to": "vendor-uuid"
}
```

---

## 📋 TABLA 2: `commercial_partner_movements`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L28) - Línea 28
- [PartnerMovementHistory.tsx](components/commercialPartners/comodato/PartnerMovementHistory.tsx#L46)
- [PartnerMovementForm.tsx](components/commercialPartners/comodato/PartnerMovementForm.tsx#L309)

### Columnas inferidas (TypeScript `PartnerMovement` interface):
```typescript
id: string;                    // PK UUID
partner_id: string;            // FK commercial_partners
movement_type: 'delivery' | 'settlement' | 'withdrawal' | 'spoilage' | 'adjustment' | 'visit';
movement_date: string;         // YYYY-MM-DD ISO
status: 'completed' | 'pending' | 'partial';
total_amount_due: number;      // NUMERIC
next_visit_date?: string | null;
next_visit_reason?: string | null;
notes?: string | null;
created_by?: string | null;
created_at: string;            // TIMESTAMPTZ
updated_at?: string | null;
commercial_partner_movement_items?: PartnerMovementItem[];
```

### Relación:
- **PK**: `id`
- **FK**: `partner_id` → `commercial_partners(id)`
- **Index**: `partner_id`, `movement_date`

---

## 📋 TABLA 3: `commercial_partner_movement_items`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql) - view queries
- [PartnerMovementHistory.tsx](components/commercialPartners/comodato/PartnerMovementHistory.tsx#L55)
- [PartnerMovementForm.tsx](components/commercialPartners/comodato/PartnerMovementForm.tsx#L329)
- [PartnerCurrentStock.tsx](components/commercialPartners/comodato/PartnerCurrentStock.tsx#L36)

### Columnas inferidas (TypeScript `PartnerMovementItem` interface):
```typescript
id: string;                          // PK UUID
movement_id: string;                 // FK commercial_partner_movements
partner_id: string;                  // FK commercial_partners
product_id?: string | null;
product_name: string;
product_variant?: string | null;
product_size?: string | null;
quantity_delivered: number;
quantity_sold: number;
quantity_withdrawn: number;
quantity_spoiled: number;
quantity_adjusted: number;
price_to_catcorn: number;            // NUMERIC - precio que paga Cat Corn
suggested_retail_price?: number | null;
amount_due: number;                  // NUMERIC = quantity_sold * price_to_catcorn
spoilage_absorbed_by?: string | null; // 'catcorn' | 'partner'
notes?: string | null;
```

### Relación:
- **PK**: `id`
- **FK**: `movement_id` → `commercial_partner_movements(id)` ON DELETE CASCADE
- **Index**: `movement_id`, `partner_id`

---

## 📋 TABLA 4: `commercial_partner_payments`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L200) - Línea 200
- [PartnerPaymentForm.tsx](components/commercialPartners/comodato/PartnerPaymentForm.tsx)
- [PartnerBalanceSummary.tsx](components/commercialPartners/comodato/PartnerBalanceSummary.tsx#L59)

### Columnas requeridas para INSERT (del migration_partner_payment_verification.sql):
```sql
INSERT INTO public.commercial_partner_payments (
  partner_id,              -- UUID NOT NULL
  movement_id,             -- UUID (puede ser NULL para mayoreo)
  payment_date,            -- TIMESTAMPTZ NOT NULL
  amount,                  -- NUMERIC(12,2) NOT NULL
  payment_method,          -- TEXT: 'cash' | 'transfer'
  reference,               -- TEXT (payment_reference)
  notes,                   -- TEXT
  received_by,             -- UUID (submitted_by)
  status,                  -- TEXT: 'completed' | 'paid'
  created_at,              -- TIMESTAMPTZ DEFAULT now()
  updated_at               -- TIMESTAMPTZ DEFAULT now()
)
```

### Completa estructura inferida:
```typescript
id: string;                    // PK UUID
partner_id: string;            // FK commercial_partners
movement_id?: string | null;   // FK commercial_partner_movements
payment_date: string;          // TIMESTAMPTZ ISO
amount: number;                // NUMERIC(12,2)
payment_method: 'cash' | 'transfer';
reference?: string | null;
notes?: string | null;
received_by: string;           // FK user_profiles
status: 'completed' | 'paid';
created_at: string;            // TIMESTAMPTZ
updated_at: string;            // TIMESTAMPTZ
```

### Relación:
- **PK**: `id`
- **FK**: `partner_id` → `commercial_partners(id)`
- **FK**: `movement_id` → `commercial_partner_movements(id)` ON DELETE CASCADE (nullable)
- **Index**: `partner_id`, `movement_id`, `payment_date`

---

## 📋 TABLA 5: `wholesale_orders`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L29) - Línea 29
- Usado en vistas de reportes B2B

### Columnas esperadas:
```sql
id UUID PRIMARY KEY,
partner_id UUID NOT NULL REFERENCES commercial_partners(id),
folio TEXT UNIQUE NOT NULL,        -- Identificador legible (ej: "MAY-2026-001")
total_amount NUMERIC(12,2) NOT NULL, -- Monto total de la orden
status TEXT,                        -- 'draft' | 'confirmed' | 'completed'
created_at TIMESTAMPTZ DEFAULT now(),
updated_at TIMESTAMPTZ DEFAULT now()
```

### ⚠️ NOTA IMPORTANTE: 
- Existe confusión en [QUICK_START.md](QUICK_START.md#L109) sobre `folio`:
  - ¿Existe columna `folio` o `order_folio`?
  - ¿Existe columna `total_amount` o está en una view?
  - **RESPUESTA**: Probablemente ambas existen, necesita confirmación

### Relación:
- **PK**: `id`
- **FK**: `partner_id` → `commercial_partners(id)`
- **Index**: `partner_id`, `folio`, `created_at`

---

## 📋 TABLA 6: `wholesale_payments`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L202) - Línea 202

### Columnas requeridas para INSERT (del migration):
```sql
INSERT INTO public.wholesale_payments (
  partner_id,              -- UUID NOT NULL
  wholesale_order_id,      -- UUID NOT NULL (diferente de movement_id)
  payment_date,            -- TIMESTAMPTZ NOT NULL
  amount,                  -- NUMERIC(12,2) NOT NULL
  payment_method,          -- TEXT: 'cash' | 'transfer'
  reference,               -- TEXT
  notes,                   -- TEXT
  received_by,             -- UUID (submitted_by)
  status,                  -- TEXT: 'completed' | 'paid'
  created_at,              -- TIMESTAMPTZ DEFAULT now()
  updated_at               -- TIMESTAMPTZ DEFAULT now()
)
```

### Estructura completa:
```typescript
id: string;                       // PK UUID
partner_id: string;               // FK commercial_partners
wholesale_order_id: string;       // FK wholesale_orders
payment_date: string;             // TIMESTAMPTZ ISO
amount: number;                   // NUMERIC(12,2)
payment_method: 'cash' | 'transfer';
reference?: string | null;
notes?: string | null;
received_by: string;              // FK user_profiles
status: 'completed' | 'paid';
created_at: string;               // TIMESTAMPTZ
updated_at: string;               // TIMESTAMPTZ
```

### Relación:
- **PK**: `id`
- **FK**: `partner_id` → `commercial_partners(id)`
- **FK**: `wholesale_order_id` → `wholesale_orders(id)`
- **Index**: `partner_id`, `wholesale_order_id`, `payment_date`

---

## 📋 TABLA 7: `wholesale_contracts`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias encontradas:
- [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql#L926) - Línea 926
- [WholesaleContractGenerator.tsx](components/commercialPartners/wholesale/WholesaleContractGenerator.tsx#L439)

### Columnas esperadas (inferidas):
```typescript
id: string;                    // PK UUID
partner_id: string;            // FK commercial_partners
contract_type: string;         // 'wholesale' | 'comodato'
status: string;                // 'draft' | 'signed' | 'active' | 'inactive'
contract_date?: string | null;
signature_date?: string | null;
created_at: string;
updated_at: string;
```

---

## 📋 TABLA 8: `user_profiles`

### Status: ❌ PARCIALMENTE DEFINIDA EN schema.sql

### Definición en schema.sql (línea 13-18):
```sql
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  role user_role DEFAULT 'cashier',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ⚠️ PROBLEMA DE NOMBRE:
- **schema.sql define**: `profiles` (tabla)
- **migration_partner_payment_verification.sql referencia**: `user_profiles` (tabla)
- **Código TypeScript referencia**: `public.user_profiles` (tabla)

### Esto causará ERRORES porque los nombres NO coinciden:
```sql
-- ERROR: Esto fallará
SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
-- Correcto sería:
SELECT role INTO v_user_role FROM public.profiles WHERE id = v_current_user_id;
```

### Columnas inferidas necesarias:
```typescript
id: string;              // PK UUID FK auth.users
full_name: string;
role: 'admin' | 'socios_comerciales' | 'cashier' | 'production' | 'auditor';
is_active?: boolean;
created_at: string;
```

---

## 🔴 FUNCIÓN 9: `activate_wholesale_partner()`

### Status: ❌ NO EXISTE EN schema.sql

### Definición en migration_partner_payment_verification.sql (línea 893-940):
```sql
CREATE OR REPLACE FUNCTION public.activate_wholesale_partner(p_contract_id UUID)
RETURNS TABLE (
  contract_id UUID,
  activation_success BOOLEAN,
  message TEXT
)
```

### Firma completa:
```sql
-- Entrada
p_contract_id UUID

-- Salida (TABLE)
contract_id UUID
activation_success BOOLEAN
message TEXT

-- Lógica:
1. Valida autenticación (auth.uid() no nulo)
2. Valida rol = 'admin'
3. Obtiene partner_id de wholesale_contracts
4. Calcula saldo pendiente de comodato
5. Si saldo_comodato > 0.005: RECHAZA con mensaje
6. Si OK: Activa partner para mayoreo
```

### ⚠️ PROBLEMA:
La función referencia `wholesale_contracts` que no existe, causará error.

---

## 🔴 VISTA 10: `v_wholesale_order_totals`

### Status: ❌ NO EXISTE EN schema.sql

### Referencias:
- [B2B_REPORTS_COLUMN_MAPPING_FIX.md](B2B_REPORTS_COLUMN_MAPPING_FIX.md) - Mapeo de campos

### Columnas esperadas (del código de reportes):
```typescript
partner_id: string;
partner_folio: string;
business_name: string;
wholesale_purchased: number;       // total_amount
wholesale_units: number;           // suma de units
wholesale_pending: number;         // balance sin pagar
wholesale_paid: number;            // monto pagado
```

---

## 🔴 FUNCIÓN 11: `is_commission_admin()` o similar

### Status: ❌ NO ENCONTRADA EN schema.sql

### Referencias esperadas en views/funciones de comisiones:
- [COMMISSIONS_MODULE_SUMMARY.md](COMMISSIONS_MODULE_SUMMARY.md) - Menciona roles pero no función

### Función esperada:
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

## 📊 RESUMEN EJECUTIVO

| # | Tabla/Función/Vista | Existe | Ubicación | Problema |
|---|---|---|---|---|
| 1 | `commercial_partners` | ❌ NO | - | Referenciada pero no definida |
| 2 | `commercial_partner_movements` | ❌ NO | - | Referenciada pero no definida |
| 3 | `commercial_partner_movement_items` | ❌ NO | - | Referenciada pero no definida |
| 4 | `commercial_partner_payments` | ❌ NO | - | Referenciada pero no definida |
| 5 | `wholesale_orders` | ❌ NO | - | Referenciada pero no definida |
| 6 | `wholesale_payments` | ❌ NO | - | Referenciada pero no definida |
| 7 | `wholesale_contracts` | ❌ NO | - | Referenciada pero no definida |
| 8 | `user_profiles` | ⚠️ PARCIAL | schema.sql:13 | Schema define `profiles`, código usa `user_profiles` |
| 9 | `activate_wholesale_partner()` | ❌ NO | - | Definida en migration pero incompleta |
| 10 | `v_wholesale_order_totals` | ❌ NO | - | Vista esperada para reportes |
| 11 | `is_commission_admin()` | ❌ NO | - | Función de validación no encontrada |

---

## 🛠️ ACCIONES RECOMENDADAS

### PRIORIDAD 1 - CRÍTICO: Crear tablas base faltantes
1. Crear `public.commercial_partners` con estructura completa
2. Crear `public.commercial_partner_movements` con FK a partners
3. Crear `public.commercial_partner_movement_items` con FK a movements
4. Crear `public.commercial_partner_payments` con FK a movements
5. Crear `public.wholesale_orders` con FK a partners
6. Crear `public.wholesale_payments` con FK a orders
7. Crear `public.wholesale_contracts` con FK a partners

### PRIORIDAD 2 - ALTA: Renombrar tabla de perfil
- Opción A: Renombrar `public.profiles` → `public.user_profiles`
- Opción B: Actualizar migration a usar `public.profiles` en lugar de `user_profiles`
- **Recomendación**: Opción A (consistencia con código)

### PRIORIDAD 3 - ALTA: Corregir referencias en migration
- Actualizar [migration_partner_payment_verification.sql](migration_partner_payment_verification.sql) líneas:
  - L25, L168, L175, L743, L798, L940: cambiar `commercial_partners` a tabla correcta
  - L46, L52: cambiar `user_profiles` a tabla correcta (si se elige opción B)

### PRIORIDAD 4 - MEDIA: Crear vistas faltantes
- Crear `v_wholesale_order_totals` para reportes B2B
- Crear `v_pending_payment_verifications` (ya en migration)
- Crear `v_partner_payment_verification_history` (ya en migration)

### PRIORIDAD 5 - MEDIA: Crear funciones faltantes
- Completar `activate_wholesale_partner()` con lógica real
- Crear `is_commission_admin()` para validaciones

---

## 📝 NOTAS FINALES

El proyecto tiene **9 tablas principales faltantes** en el schema base. El archivo `schema.sql` parece ser un template incompleto, mientras que el código y las migraciones esperan una estructura más compleja.

**Recomendación**: Ejecutar una auditoría SQL en la BD Supabase para determinar qué tablas REALMENTE EXISTEN en la BD viva, vs. qué es teórico en el code.

