## 🎯 PAYMENT VERIFICATION SYSTEM - SETUP CHECKLIST

### ✅ COMPLETADO - FASE 1 BACKEND

1. **SQL Migration** ✅
   - Archivo: [`migration_partner_payment_verification.sql`](./migration_partner_payment_verification.sql)
   - Contenido: 990 líneas con todas las tablas, funciones, vistas y RLS
   - Status: **LISTO PARA EJECUTAR EN SUPABASE**

2. **TypeScript Types** ✅
   - Archivo: [`types/paymentVerification.ts`](./types/paymentVerification.ts)
   - Contiene: 15 interfaces, tipos de estado, constantes
   - Status: **SIN ERRORES**

3. **RPC Utilities** ✅
   - Archivo: [`lib/paymentVerification.ts`](./lib/paymentVerification.ts)
   - Contiene: 10 funciones públicas + 2 helpers
   - Status: **SIN ERRORES, LISTO PARA USAR**

### 📋 PRÓXIMOS PASOS INMEDIATOS

#### PASO 1: EJECUTAR MIGRACIÓN SQL EN SUPABASE (5 minutos)
```
1. Ve a https://app.supabase.com
2. Selecciona proyecto "cat-corn-ops"
3. SQL Editor → New Query
4. Copia todo el contenido de migration_partner_payment_verification.sql
5. Pega y ejecuta (botón Run)
6. Espera confirmación verde "✓ Success"
```

Ver instrucciones detalladas: [`MIGRATION_INSTRUCTIONS.md`](./MIGRATION_INSTRUCTIONS.md)

#### PASO 2: CREAR BUCKET EN STORAGE (2 minutos)
```
1. Supabase Dashboard → Storage
2. New Bucket → Nombre: customer-payment-proofs
3. Private: ON
4. Create
5. Ir a Settings del bucket
6. Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf
7. Max size: 10485760 (10 MB)
```

#### PASO 3: AGREGAR POLÍTICAS RLS AL BUCKET (3 minutos)
Ver [`MIGRATION_INSTRUCTIONS.md`](./MIGRATION_INSTRUCTIONS.md) sección "AGREGAR POLÍTICAS DE ACCESO AL BUCKET"

---

### 🚀 DESPUÉS DE EJECUTAR MIGRACIÓN

Una vez que la migración esté en Supabase y el bucket creado:

**El sistema está listo para:**
- ✅ Crear solicitudes de verificación (draft)
- ✅ Enviarlas a revisión (pending_review)
- ✅ Aprobarlas/rechazarlas (admin)
- ✅ Registrar pagos reales (approved)
- ✅ Disparar recálculos de comisiones

**Frontend components que se crearán después:**
- ReportPaymentModal.tsx - Vendedor reporta cobro
- PaymentVerificationReviewPanel.tsx - Admin revisa
- PaymentVerificationHistory.tsx - Historial

---

### 📊 ARQUITECTURA DEL SISTEMA

```
Frontend (React)
    ↓ [calls via paymentVerificationUtils]
RPC Functions (PostgreSQL - SECURITY DEFINER)
    ↓ [validates & inserts]
partner_payment_verification_requests table
    ↓ [on status = 'approved']
commercial_partner_payments OR wholesale_payments
    ↓ [triggers]
Existing commission recalculation
```

---

### 🔐 SEGURIDAD IMPLEMENTADA

✅ Row-Level Security (RLS) en tabla
✅ SECURITY DEFINER en todas las RPC
✅ Validaciones en RPC (no en cliente)
✅ Proof upload con path validation
✅ Admin-only approval/rejection
✅ Idempotent operations (no duplicados)

---

### 🧪 TESTING (DESPUÉS DE MIGRACIÓN)

Ejecuta en SQL Editor de Supabase:

```sql
-- Test 1: Generar folio
SELECT public.generate_payment_verification_folio();

-- Test 2: Ver tabla creada
SELECT COUNT(*) FROM partner_payment_verification_requests;

-- Test 3: Ver vistas
SELECT COUNT(*) FROM v_pending_payment_verifications;
SELECT COUNT(*) FROM v_partner_payment_verification_history;

-- Test 4: Verificar RLS (debe fallar)
INSERT INTO partner_payment_verification_requests (...) VALUES (...);
-- ERROR: new row violates row-level security policy

-- Test 5: Llamar RPC (debe funcionar)
SELECT * FROM public.create_partner_payment_verification_request(
  'comodato',
  'PARTNER_UUID',
  'MOVEMENT_UUID',
  NULL,
  NOW(),
  250.00,
  'cash',
  NULL,
  'Pago del cliente'
);
```

---

### 📝 ARCHIVOS CREADOS EN ESTA SESIÓN

1. [`migration_partner_payment_verification.sql`](./migration_partner_payment_verification.sql) - 990 líneas
   - ✅ Tabla: partner_payment_verification_requests (25 columnas)
   - ✅ Funciones RPC: 6 funciones
   - ✅ Vistas: 2 vistas
   - ✅ Índices: 8 índices
   - ✅ RLS Policies: 4 políticas
   - ✅ Updated: activate_wholesale_partner() con verificación de deuda

2. [`MIGRATION_INSTRUCTIONS.md`](./MIGRATION_INSTRUCTIONS.md) - Guía completa
   - Pasos para ejecutar migración
   - Configurar bucket
   - Agregar políticas RLS
   - Testing cases
   - Errores comunes y soluciones

3. [`types/paymentVerification.ts`](./types/paymentVerification.ts) - 350 líneas
   - 15 interfaces TypeScript
   - Type unions para estados y métodos
   - Constantes de mapeo (labels, colores, iconos)
   - Documentación completa

4. [`lib/paymentVerification.ts`](./lib/paymentVerification.ts) - 505 líneas
   - 10 funciones públicas (RPC wrappers)
   - 2 funciones helper (error handling)
   - Validaciones frontend
   - Manejo de storage (upload/delete)
   - Parser de errores RPC

---

### 🎯 CHECKLIST DE EJECUCIÓN

- [ ] **Leer** [`MIGRATION_INSTRUCTIONS.md`](./MIGRATION_INSTRUCTIONS.md)
- [ ] **Ejecutar** migración SQL en Supabase
- [ ] **Esperar** confirmación "Success" (15-30 seg)
- [ ] **Verificar** tablas/funciones/vistas en Supabase
- [ ] **Crear** bucket `customer-payment-proofs`
- [ ] **Agregar** políticas RLS al bucket
- [ ] **Testear** creando solicitud de prueba
- [ ] **Confirmar** que todo funciona
- [ ] **Notificar** cuando lista para frontend

---

### 🔍 VALIDACIÓN DE REQUISITOS

**Del usuario:**
1. ✅ "Primero crear migración SQL" → HECHA
2. ✅ "No resolver únicamente en frontend" → Todo en RPC
3. ✅ "No modificar eventos de comisión" → Triggers automáticos
4. ✅ "Crear bucket customer-payment-proofs" → Instrucciones en MIGRATION_INSTRUCTIONS.md
5. ✅ "Validar deuda para mayoreo" → Implementado en RPC
6. ✅ "Comisión pending hasta aprobación" → Status workflow lo asegura
7. ✅ "Comprobante obligatorio para transfers" → Validado en submit RPC

**Características implementadas:**
- ✅ Folio auto-generado (COBRO-YYYYMM-#####)
- ✅ Workflow: draft → pending_review → approved/rejected
- ✅ Separación: reporte ≠ pago confirmado
- ✅ Admin-only approval (RLS + funciones)
- ✅ Proof storage con validación
- ✅ Idempotent operations
- ✅ Comprehensive audit trail

---

**PRÓXIMA SESIÓN:** 
Una vez que confirmes que la migración está en Supabase y el bucket está creado, procederemos con:
1. Frontend components para vendedor (ReportPaymentModal)
2. Frontend components para admin (ReviewPanel)  
3. Integración en dashboards
4. Testing del flujo completo
