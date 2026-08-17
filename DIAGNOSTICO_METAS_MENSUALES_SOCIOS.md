# DIAGNÓSTICO COMPLETO - METAS MENSUALES DE SOCIOS ACTIVADOS

**Fecha:** 16 de agosto de 2026  
**Estatus:** 🔍 DIAGNÓSTICO SOLAMENTE (SIN IMPLEMENTACIÓN)  
**Usuario:** socios_comerciales  
**Módulo:** Socios Comerciales → Comisiones

---

## 📋 ÍNDICE DEL DIAGNÓSTICO

1. Componente real de home del vendedor
2. Estructura real de seller_monthly_targets
3. Uso actual de seller_monthly_targets
4. Condición real que hace un socio activo
5. Fecha disponible para activación
6. Comodato vs Mayoreo - diferencias de activación
7. Cómo evitar doble conteo entre modalidades
8. Relación real vendedor ↔ socio
9. Preservación de asignación histórica
10. Reasignaciones y su efecto
11. Arquitectura recomendada para target
12. Tabla existente vs tabla nueva
13. View/RPC recomendada para progreso
14. Ubicación recomendada del control admin
15. Ubicación exacta de tarjeta seller
16. Archivos frontend a modificar
17. SQL/migración necesaria
18. Riesgos y limitaciones

---

## 1. ✅ COMPONENTE REAL DE HOME DEL VENDEDOR

**Archivo:** [pages/CommercialPartners.tsx](pages/CommercialPartners.tsx#L183-L196)

**Enrutamiento (línea 185-196):**
```typescript
const isCommercialSeller = profile?.role === 'socios_comerciales';
if (isCommercialSeller) {
  return (
    <SellerCommercialPartnersView
      userProfile={profile}
      user={user}
      onLogout={() => { window.location.href = '/'; }}
    />
  );
}
```

**Vista actual de vendedor:**
[components/commercialPartners/mobile/SellerCommercialPartnersView.tsx](components/commercialPartners/mobile/SellerCommercialPartnersView.tsx)

**Componente principal dentro de la vista:**
[components/commercialPartners/mobile/SellerMobileHome.tsx](components/commercialPartners/mobile/SellerMobileHome.tsx)

**Tarjetas actuales en SellerMobileHome (líneas 28-40):**
```typescript
const quickStats = [
  {
    title: 'Comisión disponible',
    value: `$${commissionAvailable}`,
    icon: <DollarSign size={24} className="text-green-500" />,
    action: () => onNavigate('comisiones'),
  },
  {
    title: 'Comisión pendiente',
    value: `$${commissionPending}`,
    icon: <TrendingUp size={24} className="text-yellow-500" />,
    action: () => onNavigate('comisiones'),
  },
  {
    title: 'Mis socios',
    value: `${partnersCount ?? 0}`,
    icon: <Users size={24} className="text-blue-500" />,
    action: () => onNavigate('socios'),
  },
];
```

**Ubicación donde agregar tarjeta META MENSUAL:**
- Después de "Mis socios" en el grid de estadísticas
- ANTES de "Acciones rápidas"
- Línea ~60 del componente

---

## 2. ✅ ESTRUCTURA REAL DE `commercial_partners`

**Tabla base:** [public.commercial_partners]

**Columnas críticas (de ACTION_PLAN_SCHEMA_FIXES.md línea 98):**

```sql
CREATE TABLE public.commercial_partners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folio TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  responsible_name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  business_type TEXT,
  business_type_other TEXT,
  
  -- 🎯 MODELO DE NEGOCIO
  partner_model TEXT NOT NULL DEFAULT 'comodato',
  -- Valores: 'prospecto', 'comodato', 'mayoreo'
  
  -- 🎯 ESTATUS GENERAL
  status TEXT NOT NULL DEFAULT 'activo',
  -- Probable valores: 'prospecto', 'activo', 'pausado', 'inactivo'
  
  -- 🎯 ESTATUS MAYOREO ESPECÍFICO
  wholesale_status TEXT,
  -- Valores: NULL, 'active' (cuando socio dual)
  
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
  
  -- 🎯 ASIGNACIÓN AL VENDEDOR
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  -- 🎯 CREADOR (posiblemente diferente de assigned_to)
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  notes TEXT,
  active BOOLEAN DEFAULT true,
  
  -- 🎯 FECHAS CRÍTICAS
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- ⚠️ NO EXISTE: comodato_activated_at
  -- ⚠️ NO EXISTE: wholesale_activated_at en tabla base
);
```

**Campos de fecha encontrados en SUPABASE pero NO en table base:**
- `wholesale_activated_at` - Encontrado en migration_wholesale_debt_authorization.sql línea 660
  - Se ASIGNA dinámicamente en migration
  - ¿Posible que sea columna oculta o agregada posteriormente?

---

## 3. ✅ USO ACTUAL DE `seller_monthly_targets`

**Status:** ❌ **LA TABLA NO EXISTE AÚN**

**Pero existe una VISTA de lectura:**
[public.v_seller_commission_target_progress]

**Interfaz en TypeScript (commissionTypes.ts línea 97):**
```typescript
export interface SellerCommissionTargetProgress {
  seller_id: string;
  month_start: string;
  target_commission_amount: number;  // ← META EN DINERO, NO EN SOCIOS
  generated_total: number;           // ← COMISIÓN GENERADA
  progress_percentage: number;       // ← PORCENTAJE COMISIÓN
}
```

**Uso actual:**
[components/commercialPartners/commissions/SellerCommissionDashboard.tsx#L141]

```typescript
const { data: targetData, error: targetError } = await supabase
  .from('v_seller_commission_target_progress')
  .select('*')
  .eq('seller_id', sellerId)
  .eq('month_start', monthStart)
  .maybeSingle();

setTargetProgress(targetData as SellerCommissionTargetProgress);
```

**Observación crítica:**
- Vista actual mide META EN DINERO ($) de comisiones
- NO mide socios activados
- Será necesaria una NUEVA tabla/vista para META DE SOCIOS

---

## 4. ✅ CONDICIÓN REAL QUE HACE UN SOCIO "ACTIVO"

**Análisis del código (pages/CommercialPartners.tsx línea 113-132):**

```typescript
const filtered = partners
  .filter(p => {
    if (activeFilter === 'activos')    return p.status === 'activo';
    if (activeFilter === 'inactivos')  return p.status === 'inactivo' || p.active === false;
    return true;
  })
```

**Conclusión:**
Un socio se considera **ACTIVO** cuando:
- `status === 'activo'` (columna principal)

**Pero TAMBIÉN hay:**
- `active: boolean` (campo redundante)

**Estados de socio encontrados (CommercialPartnerDetail.tsx línea 107):**
```typescript
const COMODATO_ALLOWED_STATUSES = ['activo', 'pausado', 'inactivo'];
```

**Posibles valores de `status`:**
- 'prospecto' - No ha iniciado operación
- 'activo' - ✅ Operativo y disponible
- 'pausado' - Pausado temporalmente
- 'inactivo' - Dado de baja
- 'activo' es la única condición positiva para ser "activo"

---

## 5. ❌ FECHA DISPONIBLE PARA SABER CUÁNDO FUE ACTIVADO

**HALLAZGO CRÍTICO - LIMITACIÓN:**

**La tabla `commercial_partners` NO tiene:**
- ❌ `comodato_activated_at` - Fecha de activación comodato
- ❌ `first_activated_at` - Fecha de primera activación
- ❌ `status_changed_at` - Cuándo cambió de prospecto a activo

**Solo tiene:**
- ✅ `created_at` - Cuándo se CREÓ el registro (NO cuándo se activó)
- ✅ `updated_at` - Última actualización

**En modalidad Mayoreo (encontrado en migration_wholesale_debt_authorization.sql línea 660-706):**
- ✅ `wholesale_activated_at` - Se ASIGNA en activation RPC: `wholesale_activated_at = NOW()`

**PROBLEMA:**
Para contar socios "nuevamente activados en agosto", necesitaríamos:
- Socio activado: 15 julio (no cuenta agosto)
- Socio activado: 3 agosto (cuenta agosto)
- Socio activado: 25 agosto (cuenta agosto)

Pero sin campo `comodato_activated_at`, NO PODEMOS DISTINGUIR CUÁNDO PASÓ DE PROSPECTO A COMODATO.

---

## 6. ✅ COMODATO vs MAYOREO - ACTIVACIONES DIFERENTES

### Comodato:
- **Activación:** El socio cambia `status` de 'prospecto' a 'activo' (manual, en formulario)
- **Fecha de activación:** ❌ NO SE GUARDA (limitación)
- **Forma de saber:** Solo `created_at`

### Mayoreo:
- **Activación:** RPC `activate_wholesale_partner()` establece:
  - `wholesale_status = 'active'`
  - `wholesale_activated_at = NOW()` ✅
  - Puede ser dual: `partner_model='comodato' + wholesale_status='active'`
- **Fecha de activación:** ✅ GUARDADA en `wholesale_activated_at`

**Código de activación mayoreo (migration_wholesale_debt_authorization.sql línea 660-706):**
```sql
UPDATE public.commercial_partners
SET
  partner_model = 'mayoreo',
  wholesale_status = 'active',
  wholesale_activated_at = NOW(),  -- ✅ SE GUARDA
  wholesale_contract_id = p_contract_id,
  updated_at = NOW()
WHERE id = v_partner_record.id;
```

**CONCLUSIÓN:**
- Comodato: Fecha de activación NO está disponible
- Mayoreo: Fecha de activación SÍ está disponible en `wholesale_activated_at`

---

## 7. ✅ CÓMO EVITAR DOBLE CONTEO ENTRE MODALIDADES

**Análisis de duales (helpers.ts línea 18-30):**

```typescript
export const hasComodato = (partner: CommercialPartner): boolean => {
  return partner.partner_model === 'comodato';
};

export const hasWholesale = (partner: CommercialPartner): boolean => {
  return (
    partner.partner_model === 'mayoreo' ||
    partner.wholesale_status === 'active'  // ← Incluye duales
  );
};

export const isDualPartner = (partner: CommercialPartner): boolean => {
  return (
    partner.partner_model === 'comodato' &&
    partner.wholesale_status === 'active'
  );
};
```

**Estrategia de no-doble-conteo:**

**OPCIÓN A - Contar por PARTNER ID único (RECOMENDADO):**
```sql
SELECT COUNT(DISTINCT partner_id)
FROM commercial_partners
WHERE assigned_to = $1
  AND DATE_TRUNC('month', comodato_activated_at) = DATE_TRUNC('month', $2)
  AND (status = 'activo' OR wholesale_status = 'active');
```

- Un socio = 1 conteo
- Aunque tenga comodato y mayoreo = SIGUE SIENDO 1 socio

**OPCIÓN B - Contar activaciones (múltiples por socio):**
```sql
-- Comodato: 1 (cuando status cambió a 'activo')
-- Mayoreo: +1 (cuando wholesale_status cambió a 'active')
-- Total: 2 si el socio hizo ambas en el mismo mes
```

**RECOMENDACIÓN:**
- Usar **OPCIÓN A**: `COUNT(DISTINCT partner_id)`
- Métrica: "SOCIOS ACTIVADOS" no "CONTRATOS" ni "MODALIDADES"

---

## 8. ✅ RELACIÓN REAL VENDEDOR ↔ SOCIO

**Campo correcto:** `commercial_partners.assigned_to`

**Confirmación (CommercialPartnerDetail.tsx línea 105):**
```typescript
const mayoreoAllowed = partner.partner_model === 'mayoreo' || partner.wholesale_status === 'active';
```

Y en schema (ACTION_PLAN_SCHEMA_FIXES.md línea 123):
```sql
assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
```

**Diferencia de campos:**
- `assigned_to`: El vendedor actual responsable del socio
- `created_by`: Quién CREÓ el registro (posiblemente admin, no vendedor)

**Para la métrica usar:**
- ✅ `assigned_to` - Es quien tiene el socio asignado al momento de activación

---

## 9. ❌ PRESERVACIÓN DE ASIGNACIÓN HISTÓRICA

**HALLAZGO - LIMITACIÓN CRÍTICA:**

**No existe:**
- ❌ Tabla de historial de asignaciones
- ❌ Campo `previous_assigned_to`
- ❌ Campo `assigned_at` (cuándo se asignó)
- ❌ Tabla `commercial_partner_assignment_history`

**Escenario problemático:**
1. Julio: Socio "ABC" creado y asignado a GERARDO
2. Julio: ABC se activa (pero NO GUARDAMOS FECHA)
3. Agosto: Admin reasigna ABC a JUAN
4. Pregunta: ¿A QUIÉN contar en meta de agosto?

**Posibilidades:**
- A: JUAN (quien lo tiene ahora) - Pierde crédito de activación
- B: GERARDO (quien lo activó) - ABC no cuenta para JUAN

**Recomendación actual:**
- Si socio se reasigna DESPUÉS de su activación en agosto
- Contar para quien lo tenía ASIGNADO cuando se activó
- Pero SIN HISTORIAL, es imposible saberlo

**REQUIERE:** Agregar columna a `commercial_partners` para preservar `activated_by_seller_id` o crear tabla de eventos.

---

## 10. ✅ QUÉ PASA ACTUALMENTE CON REASIGNACIONES

**Código (CommercialPartnerDetail.tsx):**
- Cualquier admin puede hacer clic en "Editar" y cambiar `assigned_to`

**Efecto:**
- El campo se actualiza directamente
- Se actualiza `updated_at`
- ❌ NO SE GUARDA QUIÉN LO ASIGNÓ ORIGINALMENTE
- ❌ NO SE GUARDA CUÁNDO SUCEDIÓ LA REASIGNACIÓN

**Tabla de auditoria:**
- ❌ NO EXISTE

---

## 11. ✅ ARQUITECTURA RECOMENDADA PARA TARGET

### Opción A: Extender tabla existente `seller_monthly_targets` ⚠️

**Problema:** Tabla no existe aún

**Si se creara, estructura:**
```sql
CREATE TABLE public.seller_monthly_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES public.user_profiles(id),
  month_start DATE NOT NULL,  -- '2026-08-01'
  
  -- ACTUAL (para comisiones)
  target_commission_amount NUMERIC(12,2),
  
  -- 🎯 NUEVO (para socios)
  target_active_partners INTEGER,  -- Meta de 20 socios
  
  created_by UUID REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(seller_id, month_start)
);
```

**Ventaja:** Una tabla para ambas métricas

**Desventaja:** Mezcla comisiones (dinero) con socios (cantidad)

### Opción B: Tabla nueva específica `seller_monthly_partner_targets` ✅ RECOMENDADO

```sql
CREATE TABLE public.seller_monthly_partner_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  target_active_partners INTEGER NOT NULL,  -- 20, 25, etc.
  
  created_by UUID NOT NULL REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_seller_month UNIQUE(seller_id, month_start),
  CONSTRAINT positive_target CHECK (target_active_partners > 0)
);

CREATE INDEX idx_smpt_seller_id ON public.seller_monthly_partner_targets(seller_id);
CREATE INDEX idx_smpt_month_start ON public.seller_monthly_partner_targets(month_start);
```

**Ventaja:** Tabla específica, semántica clara, no mezcla conceptos

---

## 12. ✅ TABLA EXISTENTE vs TABLA NUEVA - RECOMENDACIÓN

**Recomendación:** ✅ **TABLA NUEVA**

**Razón:**
- Métrica de comisiones (dinero) tiene contexto diferente
- Métrica de socios (cantidad/progreso) tiene contexto diferente
- Facilita queries futuras sin JOINs confusos
- Permite RLS específica si es necesaria

**Estructura final:**
```sql
seller_monthly_partner_targets (
  id,
  seller_id,
  month_start,
  target_active_partners,
  created_by,
  updated_by,
  created_at,
  updated_at
)
```

---

## 13. ✅ VIEW/RPC RECOMENDADA PARA PROGRESO

### Opción A: VIEW (Lectura solamente) ✅ RECOMENDADO

```sql
CREATE OR REPLACE VIEW public.v_seller_monthly_partner_progress
WITH (security_invoker = true) AS
SELECT
  t.seller_id,
  t.month_start,
  t.target_active_partners AS target,
  
  COUNT(DISTINCT cp.id) AS achieved,
  
  t.target_active_partners - COUNT(DISTINCT cp.id) AS remaining,
  
  ROUND(
    (100.0 * COUNT(DISTINCT cp.id)) / NULLIF(t.target_active_partners, 0),
    2
  ) AS percentage,
  
  up.full_name AS seller_name,
  
  t.created_at,
  t.updated_at

FROM public.seller_monthly_partner_targets t
LEFT JOIN public.commercial_partners cp ON (
  cp.assigned_to = t.seller_id
  AND cp.status = 'activo'
  AND (
    cp.partner_model = 'comodato'
    OR cp.wholesale_status = 'active'
  )
  -- ⚠️ LIMITACIÓN: sin comodato_activated_at, no sabemos mes exacto
  -- Aquí asumiríamos que todos son "nuevos socios disponibles"
)
LEFT JOIN public.user_profiles up ON up.id = t.seller_id

GROUP BY t.id, t.seller_id, t.month_start, t.target_active_partners, up.full_name;
```

**Pros:**
- Lectura optimizada
- Cálculos en BD
- Reutilizable en reportes

**Contras:**
- Sin columna `comodato_activated_at`, el filtro por mes es impreciso

### Opción B: RPC (Si necesita lógica compleja)

Podría crearse RPC `get_seller_monthly_partner_progress()` que:
1. Busque metas del mes
2. Cuente socios asignados con status='activo'
3. Retorne progreso detallado

---

## 14. ✅ UBICACIÓN RECOMENDADA DEL CONTROL ADMIN

**Opción A: Dentro de Comisiones (RECOMENDADO)**
- Archivo: [components/commercialPartners/commissions/AdminCommissionDashboard.tsx](components/commercialPartners/commissions/AdminCommissionDashboard.tsx)
- Ubicación: Panel inferior, junto a "Pagar días extra"
- UI: Selector Vendedor → Mes → [Input META] [Botón Guardar]
- Ventaja: Admin ya está en ese lugar; flujo familiar

**Opción B: Panel de Reportes B2B**
- Archivo: [components/commercialPartners/reports/B2BReports.tsx]
- Ubicación: Nueva sección "Metas de Socios"
- Ventaja: Datos relacionados con B2B

**Opción C: Settings/Configuración**
- Nueva pestaña en CommercialPartners
- Menos evidente para admin

**RECOMENDACIÓN:** Opción A - Panel de Comisiones

---

## 15. ✅ UBICACIÓN EXACTA DE TARJETA SELLER

**Archivo:**
[components/commercialPartners/mobile/SellerMobileHome.tsx](components/commercialPartners/mobile/SellerMobileHome.tsx)

**Ubicación actual (líneas 28-44):**
```typescript
const quickStats = [
  { title: 'Comisión disponible', ... },
  { title: 'Comisión pendiente', ... },
  { title: 'Mis socios', ... },
];

return (
  <div className="space-y-4 pb-24">
    {/* Quick Stats */}
    <div className="grid grid-cols-1 gap-3 px-4 pt-4">
      {quickStats.map((stat, idx) => (
        // ... render cards
      ))}
    </div>

    {/* Acciones Rápidas */}
    <div className="px-4 space-y-2">
      {/* Botones: Nueva venta, Gestionar socios */}
    </div>

    {/* Info Card */}
    <div className="mx-4 p-4 rounded-lg bg-blue-500/10 ...">
      💡 Mantén actualizada tu información...
    </div>
  </div>
);
```

**Donde insertar nueva tarjeta:**

**OPCIÓN A: Cuarta tarjeta en quickStats**
```typescript
const quickStats = [
  { ... Comisión disponible },
  { ... Comisión pendiente },
  { ... Mis socios },
  { 
    title: 'Meta mensual',           // ← NUEVA
    value: `12 / 20`,                // ← progreso
    subtitle: '60%',
    icon: <Target size={24} className="text-cc-primary" />,
    action: () => null,              // ← no navega
  },
];
```

**OPCIÓN B: Tarjeta separada después de quickStats**
```typescript
return (
  <div className="space-y-4 pb-24">
    <div className="grid grid-cols-1 gap-3 px-4 pt-4">
      {quickStats.map(...)}
    </div>

    {/* 🎯 NUEVA TARJETA SEPARADA */}
    <div className="px-4">
      <SellerMobileMonthlyPartnerTarget {...} />
    </div>

    {/* Acciones Rápidas */}
    ...
  </div>
);
```

**RECOMENDACIÓN:** Opción B - Tarjeta separada es más clara visualmente

**Línea aproximada:** Después de línea 60 del componente

---

## 16. ✅ ARCHIVOS FRONTEND A MODIFICAR

### Fase 1: Crear componente de tarjeta
- ✅ `components/commercialPartners/mobile/SellerMobileMonthlyPartnerTarget.tsx` **(NUEVO)**
  - Mostrará meta y progreso
  - Consultará `v_seller_monthly_partner_progress`

### Fase 2: Integrar en home
- 📝 `components/commercialPartners/mobile/SellerMobileHome.tsx` (línea 60+)
  - Agregar importación
  - Insertar componente en JSX

### Fase 3: Admin - Administrar metas
- 📝 `components/commercialPartners/commissions/AdminCommissionDashboard.tsx`
  - Agregar sección nueva para editar metas
  - Crear componente: `AdminPartnerTargetEditor.tsx` **(NUEVO)**

### Fase 4: Tipos y constantes
- 📝 `components/commercialPartners/commissions/commissionTypes.ts`
  - Agregar interfaz: `SellerMonthlyPartnerTarget`
  - Agregar interfaz: `SellerMonthlyPartnerProgress`

### Fase 5: Servicios Supabase
- 📝 `lib/sellerPartnerTargetRpcs.ts` **(NUEVO)**
  - Funciones para consultar/crear/actualizar metas
  - Seguridad: solo admin puede escribir, solo vendedor ve su meta

### No modificar:
- ❌ SalesHistory.tsx
- ❌ CorteDeCaja.tsx
- ❌ Finanzas.tsx
- ❌ CommercialPartners.tsx (página principal)

---

## 17. ✅ SQL/MIGRACIÓN NECESARIA

### Tabla nueva:
```sql
CREATE TABLE IF NOT EXISTS public.seller_monthly_partner_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  target_active_partners INTEGER NOT NULL,
  
  created_by UUID NOT NULL REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_seller_month UNIQUE(seller_id, month_start),
  CONSTRAINT positive_target CHECK (target_active_partners > 0)
);

CREATE INDEX idx_smpt_seller_month 
  ON public.seller_monthly_partner_targets(seller_id, month_start);
```

### VIEW de progreso:
```sql
CREATE OR REPLACE VIEW public.v_seller_monthly_partner_progress
WITH (security_invoker = true) AS
SELECT
  t.seller_id,
  t.month_start,
  t.target_active_partners AS target,
  COALESCE(COUNT(DISTINCT cp.id), 0) AS achieved,
  t.target_active_partners - COALESCE(COUNT(DISTINCT cp.id), 0) AS remaining,
  ROUND(
    (100.0 * COALESCE(COUNT(DISTINCT cp.id), 0)) / NULLIF(t.target_active_partners, 0),
    2
  ) AS percentage,
  up.full_name AS seller_name
FROM public.seller_monthly_partner_targets t
LEFT JOIN public.user_profiles up ON up.id = t.seller_id
LEFT JOIN public.commercial_partners cp ON (
  cp.assigned_to = t.seller_id
  AND cp.status = 'activo'
  AND (cp.partner_model = 'comodato' OR cp.wholesale_status = 'active')
)
GROUP BY t.id, t.seller_id, t.month_start, t.target_active_partners, up.full_name;
```

### RPC para crear/actualizar meta:
```sql
CREATE OR REPLACE FUNCTION public.set_seller_monthly_partner_target(
  p_seller_id UUID,
  p_month_start DATE,
  p_target_active_partners INTEGER
)
RETURNS TABLE(target_id UUID, message TEXT) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_target_id UUID;
BEGIN
  v_current_user_id := auth.uid();
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only administrators can set partner targets';
  END IF;
  
  IF p_target_active_partners <= 0 THEN
    RAISE EXCEPTION 'Target must be positive';
  END IF;
  
  INSERT INTO public.seller_monthly_partner_targets (
    seller_id, month_start, target_active_partners, created_by, updated_by
  ) VALUES (
    p_seller_id, p_month_start, p_target_active_partners, v_current_user_id, v_current_user_id
  )
  ON CONFLICT (seller_id, month_start) DO UPDATE SET
    target_active_partners = p_target_active_partners,
    updated_by = v_current_user_id,
    updated_at = NOW()
  RETURNING id INTO v_target_id;
  
  RETURN QUERY SELECT v_target_id, 'Target set successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### RLS (Row Level Security):
```sql
ALTER TABLE public.seller_monthly_partner_targets ENABLE ROW LEVEL SECURITY;

-- Admin sees all
CREATE POLICY admin_see_all_partner_targets ON public.seller_monthly_partner_targets
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Vendor sees own target only
CREATE POLICY vendor_see_own_partner_target ON public.seller_monthly_partner_targets
  FOR SELECT
  USING (
    seller_id = auth.uid()
  );

-- Only admin can write
CREATE POLICY admin_write_partner_targets ON public.seller_monthly_partner_targets
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

---

## 18. ⚠️ RIESGOS Y LIMITACIONES

### CRÍTICA - Limitación de fecha de activación Comodato

**Problema:**
- `commercial_partners` NO almacena `comodato_activated_at`
- Solo tiene `created_at` (cuándo se creó el registro)
- Un socio podría crearse julio y activarse octubre
- Sin cambiar `status`, no sabríamos cuándo pasó

**Solución requerida ANTES de implementar:**
1. Agregar columna: `comodato_activated_at TIMESTAMPTZ`
2. O crear tabla de eventos de cambio de estado
3. O usar trigger para capturar cambios de `status`

**Riesgo si no se hace:**
- Imposible contar correctamente socios "nuevamente activados" en agosto
- Solo sabríamos "socios activos hoy"

---

### CRÍTICA - Sin historial de asignación

**Problema:**
- No existe tabla de asignaciones históricas
- Si admin reasigna socio, se pierde quién lo activó originalmente

**Soluciones opcionales:**
1. Agregar columna `activated_by_seller_id UUID` en `commercial_partners`
   - Guarda quién lo activó (inmutable)
   - Distingue de `assigned_to` (actual responsable)

2. Crear tabla `commercial_partner_assignment_history`
   - Registra cada cambio de `assigned_to`
   - Permite auditoría

**Recomendación:**
- Opción 1 es más simple
- Agregue `activated_by_seller_id` durante la misma migración

---

### IMPORTANTE - Ubicación temporal de meta

**Pregunta sin respuesta:**
- ¿Dónde se guarda la información cuando socio cambia de comodato a mayoreo en el mismo mes?
- ¿Cuenta para ambas modalidades en la meta?

**Recomendación:**
- Métrica = "SOCIOS ÚNICOS ACTIVADOS" (COUNT DISTINCT)
- No importa si tiene comodato, mayoreo, o ambas
- El socio = 1 unidad en la meta

---

### IMPORTANTE - Duración de desbloqueo vs ciclo fiscal

**Consideración:**
- Desbloqueo es 15 minutos para acceder
- Meta de socios es MENSUAL (ciclo completo)
- No hay conflicto, son conceptos independientes

---

## RESUMEN EJECUTIVO DEL DIAGNÓSTICO

| Punto | Status | Hallazgo |
|-------|--------|----------|
| 1. Home vendedor | ✅ | Existe, ubicación clara en SellerMobileHome.tsx |
| 2. seller_monthly_targets | ❌ | Tabla no existe aún; vista actual es solo para comisiones |
| 3. Uso actual | ✅ | VIEW mide comisiones en dinero, no socios |
| 4. Activación | ✅ | `status='activo'` es la condición principal |
| 5. Fecha de activación | ❌ CRÍTICA | Comodato no guarda fecha; Mayoreo sí (wholesale_activated_at) |
| 6. Comodato vs Mayoreo | ✅ | Activaciones diferentes; Mayoreo tiene timestamp |
| 7. No-doble-conteo | ✅ | Usar `COUNT(DISTINCT partner_id)` |
| 8. Relación vendedor-socio | ✅ | `assigned_to` es el campo correcto |
| 9. Historial asignación | ❌ CRÍTICA | No existe; se pierde en reasignaciones |
| 10. Reasignaciones | ⚠️ | Funcionan pero sin auditoría |
| 11. Arquitectura tabla | ✅ | Nueva tabla `seller_monthly_partner_targets` recomendada |
| 12. Tabla nueva | ✅ | Mejor que extender existente |
| 13. VIEW/RPC | ✅ | VIEW `v_seller_monthly_partner_progress` recomendada |
| 14. Control admin | ✅ | AdminCommissionDashboard es ubicación lógica |
| 15. Tarjeta seller | ✅ | SellerMobileHome.tsx línea ~60 |
| 16. Archivos frontend | ✅ | 5 archivos a crear/modificar |
| 17. SQL | ✅ | Tabla + VIEW + RPC + RLS necesarios |
| 18. Riesgos | ⚠️ | 2 críticos (fecha comodato, historial asignación) |

---

## PRÓXIMOS PASOS (Cuando se apruebe implementación)

1. **SQL MIGRATION:**
   - Crear `seller_monthly_partner_targets`
   - Crear VIEW `v_seller_monthly_partner_progress`
   - Crear RPC `set_seller_monthly_partner_target`
   - Crear RLS policies

2. **CRITICAL FIX (Recomendado primero):**
   - Agregar `comodato_activated_at TIMESTAMPTZ` a `commercial_partners`
   - Agregar `activated_by_seller_id UUID` a `commercial_partners`
   - Trigger para capturar cuándo `status` cambia a 'activo'

3. **FRONTEND:**
   - SellerMobileMonthlyPartnerTarget.tsx (tarjeta)
   - AdminPartnerTargetEditor.tsx (admin panel)
   - lib/sellerPartnerTargetRpcs.ts (servicios)
   - Actualizar tipos en commissionTypes.ts
   - Integrar en SellerMobileHome.tsx y AdminCommissionDashboard.tsx

4. **TESTING:**
   - Verificar cálculo de progreso
   - Verificar RLS (admin ve todas, vendedor ve solo suya)
   - Verificar duración 15 minutos no afecta meta mensual
   - Verificar no-doble-conteo en duales

---

*Diagnóstico completado: 16 de agosto de 2026*  
*Sin código implementado, solo análisis y recomendaciones*
