# 🚨 GUÍA DE ACCIÓN INMEDIATA - Problemas de Esquema Detectados

**Fecha:** 20 de julio de 2026  
**Crítico:** SÍ - Bloquea ejecución de migration_partner_payment_verification.sql

---

## 📌 PROBLEMA RESUMIDO

El archivo `migration_partner_payment_verification.sql` intenta crear funciones y vistas que dependen de **9 tablas que NO existen en schema.sql**:

```
❌ commercial_partners
❌ commercial_partner_movements
❌ commercial_partner_movement_items
❌ commercial_partner_payments
❌ wholesale_orders
❌ wholesale_payments
❌ wholesale_contracts
⚠️  user_profiles (existe como "profiles")
❌ activate_wholesale_partner (función)
```

---

## 🔍 PASO 1: VERIFICAR LA REALIDAD (2 minutos)

Abre la **consola SQL de Supabase** y ejecuta esto:

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

**Opciones posibles:**

### Opción A: Las tablas EXISTEN en la BD real
→ El `schema.sql` es un template incompleto  
→ Ve a **PASO 2A**

### Opción B: Las tablas NO existen
→ El proyecto está incompleto  
→ Ve a **PASO 2B**

---

## 🔧 PASO 2A: Si las tablas EXISTEN en Supabase

### Acción 1: Exportar esquema real
Ejecuta en Supabase SQL Editor:
```sql
-- Exportar DDL de cada tabla
SELECT
    'CREATE TABLE public.' || tablename || ' (' || array_to_string(
        array_agg(
            colname || ' ' || type || CASE WHEN notnull THEN ' NOT NULL' ELSE '' END || CASE WHEN defaultval IS NOT NULL THEN ' DEFAULT ' || defaultval ELSE '' END
        ), ', '
    ) || ');'
FROM (
    SELECT
        t.tablename,
        a.attname as colname,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
        CASE WHEN a.attnotnull THEN true ELSE false END as notnull,
        d.adsrc as defaultval
    FROM pg_tables t
    JOIN pg_class c ON t.tablename = c.relname
    JOIN pg_attribute a ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE t.schemaname = 'public'
    ORDER BY c.oid, a.attnum
) sub
GROUP BY tablename;
```

### Acción 2: Actualizar schema.sql con estructura real
Copia el DDL generado al archivo `schema.sql`

### Acción 3: Ejecutar migraciones en orden correcto
```bash
-- Ver qué migraciones ya se han aplicado
# Consulta table pg_migrations en Supabase

-- Aplicar solo las faltantes
```

---

## 🛠️ PASO 2B: Si las tablas NO existen en Supabase

### Acción 1: Crear estructura base (CRÍTICO)

Ejecuta en Supabase SQL Editor, en ESTE ORDEN:

#### 1️⃣ Crear tabla base: `commercial_partners`
```sql
CREATE TABLE IF NOT EXISTS public.commercial_partners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folio TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  responsible_name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  business_type TEXT,
  business_type_other TEXT,
  partner_model TEXT NOT NULL DEFAULT 'comodato',
  status TEXT NOT NULL DEFAULT 'activo',
  wholesale_status TEXT,
  address TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  google_maps_url TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  location_notes TEXT,
  opening_hours TEXT,
  preferred_visit_days TEXT,
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_commercial_partners_status ON public.commercial_partners(status);
CREATE INDEX idx_commercial_partners_partner_model ON public.commercial_partners(partner_model);
CREATE INDEX idx_commercial_partners_assigned_to ON public.commercial_partners(assigned_to);
```

#### 2️⃣ Crear tabla: `commercial_partner_movements`
```sql
CREATE TABLE IF NOT EXISTS public.commercial_partner_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('delivery', 'settlement', 'withdrawal', 'spoilage', 'adjustment', 'visit')),
  movement_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'partial')),
  total_amount_due NUMERIC(12,2),
  next_visit_date DATE,
  next_visit_reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cpm_partner_id ON public.commercial_partner_movements(partner_id);
CREATE INDEX idx_cpm_movement_date ON public.commercial_partner_movements(movement_date);
CREATE INDEX idx_cpm_type ON public.commercial_partner_movements(movement_type);
```

#### 3️⃣ Crear tabla: `commercial_partner_movement_items`
```sql
CREATE TABLE IF NOT EXISTS public.commercial_partner_movement_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_id UUID NOT NULL REFERENCES public.commercial_partner_movements(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  product_id UUID,
  product_name TEXT NOT NULL,
  product_variant TEXT,
  product_size TEXT,
  quantity_delivered NUMERIC(10,2) DEFAULT 0,
  quantity_sold NUMERIC(10,2) DEFAULT 0,
  quantity_withdrawn NUMERIC(10,2) DEFAULT 0,
  quantity_spoiled NUMERIC(10,2) DEFAULT 0,
  quantity_adjusted NUMERIC(10,2) DEFAULT 0,
  price_to_catcorn NUMERIC(12,2),
  suggested_retail_price NUMERIC(12,2),
  amount_due NUMERIC(12,2) DEFAULT 0,
  spoilage_absorbed_by TEXT CHECK (spoilage_absorbed_by IN ('catcorn', 'partner')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cpmi_movement_id ON public.commercial_partner_movement_items(movement_id);
CREATE INDEX idx_cpmi_partner_id ON public.commercial_partner_movement_items(partner_id);
```

#### 4️⃣ Crear tabla: `commercial_partner_payments`
```sql
CREATE TABLE IF NOT EXISTS public.commercial_partner_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  movement_id UUID REFERENCES public.commercial_partner_movements(id) ON DELETE CASCADE,
  payment_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  reference TEXT,
  notes TEXT,
  received_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cpp_partner_id ON public.commercial_partner_payments(partner_id);
CREATE INDEX idx_cpp_movement_id ON public.commercial_partner_payments(movement_id);
CREATE INDEX idx_cpp_payment_date ON public.commercial_partner_payments(payment_date);
```

#### 5️⃣ Crear tabla: `wholesale_orders`
```sql
CREATE TABLE IF NOT EXISTS public.wholesale_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  folio TEXT UNIQUE NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'completed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wholesale_orders_partner_id ON public.wholesale_orders(partner_id);
CREATE INDEX idx_wholesale_orders_folio ON public.wholesale_orders(folio);
```

#### 6️⃣ Crear tabla: `wholesale_payments`
```sql
CREATE TABLE IF NOT EXISTS public.wholesale_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  wholesale_order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE CASCADE,
  payment_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  reference TEXT,
  notes TEXT,
  received_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wholesale_payments_partner_id ON public.wholesale_payments(partner_id);
CREATE INDEX idx_wholesale_payments_order_id ON public.wholesale_payments(wholesale_order_id);
```

#### 7️⃣ Crear tabla: `wholesale_contracts`
```sql
CREATE TABLE IF NOT EXISTS public.wholesale_contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  contract_date DATE,
  signature_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wholesale_contracts_partner_id ON public.wholesale_contracts(partner_id);
```

---

## 🏷️ PASO 3: Resolver problema de nombre de tabla

El código espera `user_profiles` pero `schema.sql` define `profiles`.

### Opción A: Renombrar tabla (RECOMENDADO)
```sql
ALTER TABLE public.profiles RENAME TO user_profiles;
```

### Opción B: Actualizar migration (si prefieres mantener "profiles")
```sql
-- En migration_partner_payment_verification.sql, cambiar:
-- FROM public.user_profiles 
-- POR:
-- FROM public.profiles
```

---

## ✅ PASO 4: Ejecutar migration_partner_payment_verification.sql

Una vez creadas las tablas base, ejecuta:

```bash
cd /Users/mariana/Downloads/cat-corn-ops
# Ejecutar la migración en Supabase
```

---

## 🔗 PASO 5: Verificar integridad

Después de ejecutar todo, verifica:

```sql
-- Confirmar que las funciones fueron creadas
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE 'create_partner_payment_verification%';

-- Confirmar que las vistas fueron creadas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'VIEW'
  AND table_name LIKE 'v_pending_payment%';
```

---

## 📋 CHECKLIST DE VALIDACIÓN

- [ ] Ejecuté PASO 1 - Verifiqué si las tablas existen
- [ ] Ejecuté las 7 tablas base en PASO 2B
- [ ] Resolví el nombre de `user_profiles` en PASO 3
- [ ] Ejecuté `migration_partner_payment_verification.sql`
- [ ] Verifiqué que funciones y vistas se crearon en PASO 5
- [ ] Las funciones responden correctamente a llamadas RPC

---

## 🆘 Si hay ERRORES

### Error: "relation 'public.commercial_partners' does not exist"
→ Las tablas base aún no se crearon  
→ Vuelve a PASO 2B, ejecuta en orden

### Error: "column 'assigned_to' does not exist on public.user_profiles"
→ Aún existe el problema de nombre  
→ Ejecuta Opción A del PASO 3

### Error: "violates foreign key constraint"
→ Hay datos inconsistentes  
→ Limpiar datos o revisar integridad referencial

---

## 📞 SOPORTE

Si necesitas ayuda, contacta con:
- Equipo Backend para confirmar esquema real
- DevOps para ejecutar migraciones en producción

**Documento de referencia:** [SCHEMA_INSPECTION_REPORT.md](SCHEMA_INSPECTION_REPORT.md)

