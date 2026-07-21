/* ═══════════════════════════════════════════════════════════════════════════════
   INSTRUCCIONES DE IMPLEMENTACIÓN
   FASE 1: Migration SQL - Partner Payment Verification System
   ═════════════════════════════════════════════════════════════════════════════ */

ARCHIVO A EJECUTAR EN SUPABASE
═══════════════════════════════════════════════════════════════════════════════

📄 migration_partner_payment_verification.sql

PASOS PARA APLICAR LA MIGRACIÓN
═══════════════════════════════════════════════════════════════════════════════

1. ABRIR SUPABASE DASHBOARD
   - Ve a: https://app.supabase.com
   - Selecciona tu proyecto "cat-corn-ops"

2. IR A SQL EDITOR
   - En el sidebar izquierdo: "SQL Editor"
   - O nuevo query: "+"

3. COPIAR Y EJECUTAR MIGRACIÓN
   - Abre el archivo: migration_partner_payment_verification.sql
   - Copia TODO el contenido
   - Pégalo en el editor SQL de Supabase
   - Presiona "Run" (botón rojo abajo a la derecha)

4. ESPERAR CONFIRMACIÓN
   - La ejecución demorará 15-30 segundos
   - Verifica que NO haya errores rojo
   - Busca mensajes verdes de éxito

5. VERIFICAR CREACIÓN
   - Ve a "Database" → "Tables"
   - Deberías ver:
     ✓ partner_payment_verification_requests
   - Ve a "Database" → "Views"
   - Deberías ver:
     ✓ v_pending_payment_verifications
     ✓ v_partner_payment_verification_history
   - Ve a "Database" → "Functions"
   - Deberías ver:
     ✓ generate_payment_verification_folio
     ✓ create_partner_payment_verification_request
     ✓ submit_partner_payment_verification_request
     ✓ approve_partner_payment_verification_request
     ✓ reject_partner_payment_verification_request
     ✓ cancel_partner_payment_verification_request

6. CREAR BUCKET DE ALMACENAMIENTO
   - Ve a "Storage" en el sidebar
   - Click "New bucket"
   - Nombre: customer-payment-proofs
   - Private: ON
   - Click "Create bucket"

7. CONFIGURAR BUCKET
   - Click en el bucket "customer-payment-proofs"
   - Ve a "Settings"
   - Allowed MIME types:
     - image/jpeg
     - image/png
     - image/webp
     - application/pdf
   - Max file size: 10485760 (10 MB)

8. AGREGAR POLÍTICAS DE ACCESO AL BUCKET
   - En "Policies" dentro del bucket:
   
   a) Vendors can upload:
      Policy name: "Vendors can upload to own folder"
      For: INSERT
      Allowed: auth.role() = 'authenticated'
      WITH CHECK:
      (storage.foldername(name))[1] = auth.uid()::text

   b) Vendors can read own:
      Policy name: "Vendors can read own proofs"
      For: SELECT
      Allowed: auth.role() = 'authenticated'
      USING:
      (storage.foldername(name))[1] = auth.uid()::text

   c) Admins can read all:
      Policy name: "Admins can read all proofs"
      For: SELECT
      Allowed: (auth.role() = 'authenticated' AND 
                 EXISTS (SELECT 1 FROM user_profiles 
                        WHERE id = auth.uid() AND role = 'admin'))
      USING: true

   d) Admins can delete:
      Policy name: "Admins can delete"
      For: DELETE
      Allowed: (auth.role() = 'authenticated' AND 
                 EXISTS (SELECT 1 FROM user_profiles 
                        WHERE id = auth.uid() AND role = 'admin'))
      USING: true

QUÉ SE CREÓ
═══════════════════════════════════════════════════════════════════════════════

TABLA: partner_payment_verification_requests
────────────────────────────────────────────
- Almacena solicitudes de verificación de cobros
- Flujo de estado: draft → pending_review → approved/rejected
- Campos: folio auto, scheme, partner_id, amount, proof, etc.
- RLS: Solo vendedores ven sus solicitudes

FUNCIONES RPC:
─────────────────
1. create_partner_payment_verification_request(...)
   → Crea borrador con validaciones
   → Retorna: request_id, folio, amount, status

2. submit_partner_payment_verification_request(...)
   → Envía a revisión (pending_review)
   → Valida comprobante si es transferencia

3. approve_partner_payment_verification_request(...)
   → Solo admin
   → Crea pago real (completed) en commercial_partner_payments o wholesale_payments
   → Activa triggers de comisiones

4. reject_partner_payment_verification_request(...)
   → Solo admin
   → Requiere motivo de rechazo

5. cancel_partner_payment_verification_request(...)
   → Cancela draft o pending_review
   → Vendedor solo su propio, admin todos

VISTAS:
────────
1. v_pending_payment_verifications
   → Muestra solicitudes en "pending_review"
   → Incluye datos de socio, vendedor, balance actual
   → Para dashboard admin

2. v_partner_payment_verification_history
   → Todo el historial de solicitudes
   → Incluye traducción de estados, datos de revisión
   → Para historial del vendedor

BUCKET: customer-payment-proofs
────────────────────────────────
- Privado
- Almacena comprobantes de transferencias
- Ruta: {user_id}/{request_id}/{timestamp}-{filename}
- Max 10 MB

RESTRICCIONES VERIFICADAS
═══════════════════════════════════════════════════════════════════════════════

✓ Amount > 0
✓ Comodato: movement_id obligatorio, wholesale_order_id null
✓ Mayoreo: wholesale_order_id obligatorio, movement_id null
✓ Transferencia: proof_path obligatorio en pending_review+
✓ No se puede rechazar request ya aprobado
✓ Validación de deuda para activar mayoreo
✓ Folio único y auto-generado

PRÓXIMOS PASOS
═══════════════════════════════════════════════════════════════════════════════

Después de aplicar esta migración:

1. ✓ FASE 1: SQL [HECHA - TÚ EJECUTAS EN SUPABASE]

2. FASE 2: Tipos TypeScript
   - Crear interfaces en commissionTypes.ts
   - Exportar tipos para pagos verificables

3. FASE 3: Utilidades RPC
   - paymentVerificationUtils.ts
   - Wrappers para las 5 funciones

4. FASE 4: Componentes Frontend
   - Modal "Reportar cobro" (reemplaza "Pago")
   - Componente verificación admin
   - Panel de revisión de cobros

5. FASE 5: Integración en dashboards
   - Modificar PartnerPaymentForm.tsx
   - Agregar sección en admin dashboard
   - Historial en socio dashboard

6. FASE 6: Bloqueo de conversión a mayoreo
   - Validar deuda en frontend
   - Validar en RPC (backend)

IMPORTANTE
═══════════════════════════════════════════════════════════════════════════════

⚠️  NO confundir:
   - Reportar cobro (nuevo) ≠ Registrar pago (viejo)
   - pending_review ≠ pago confirmado
   - Comisión pending ≠ comisión available

⚠️  La migración NO modifica:
   - commercial_partner_payments (tabla existente)
   - wholesale_payments (tabla existente)
   - Datos históricos
   - Flujo de comisiones actual (usa triggers)

⚠️  Los pagos reales se crean SOLO cuando admin aprueba:
   - INSERT en commercial_partner_payments (comodato)
   - INSERT en wholesale_payments (mayoreo)
   - Status: completed
   - Esto activa triggers de recálculo de comisiones

ERRORES COMUNES Y SOLUCIONES
═══════════════════════════════════════════════════════════════════════════════

Error: "Cannot find table..."
→ Solución: Asegúrate que las tablas base existen:
   - commercial_partners
   - commercial_partner_movements
   - wholesale_orders
   - commercial_partner_payments
   - wholesale_payments
   - user_profiles

Error: "Column doesn't exist"
→ Solución: Verifica nombres de columnas en tu base datos
   Puede que tu esquema sea ligeramente diferente

Error: "RLS policy violation"
→ Solución: Las políticas RLS requieren que NO haya inserts directos
   Todo debe ir por las funciones RPC

Error: "Function already exists"
→ Solución: Si ejecutas 2 veces, usa:
   DROP FUNCTION IF EXISTS public.function_name(params);
   Pero la migración usa CREATE OR REPLACE, así que debería ser idempotente

TESTING DESPUÉS DE MIGRACIÓN
═══════════════════════════════════════════════════════════════════════════════

Para validar que todo funciona:

1. En SQL Editor, ejecuta:

   -- Ver folio generado
   SELECT public.generate_payment_verification_folio();
   
   -- Ver tabla creada
   SELECT * FROM partner_payment_verification_requests LIMIT 1;
   
   -- Ver vista
   SELECT * FROM v_pending_payment_verifications LIMIT 1;

2. Intenta insertar directamente (debe fallar por RLS):

   INSERT INTO partner_payment_verification_requests (...)
   VALUES (...);
   
   → Debe devolver: "new row violates row-level security policy"

3. Llama a la función RPC (debe funcionar):

   SELECT * FROM public.create_partner_payment_verification_request(
     'comodato',
     'PARTNER_UUID_HERE',
     'MOVEMENT_UUID_HERE',
     NULL,
     NOW(),
     250.00,
     'cash',
     NULL,
     'Pago del cliente'
   );

REFERENCIA RÁPIDA DE FUNCIONES
═══════════════════════════════════════════════════════════════════════════════

-- Crear solicitud (draft)
SELECT * FROM public.create_partner_payment_verification_request(
  p_scheme := 'comodato',
  p_partner_id := 'uuid-del-socio',
  p_movement_id := 'uuid-liquidacion',
  p_wholesale_order_id := NULL,
  p_payment_date := NOW(),
  p_amount := 250.00,
  p_payment_method := 'cash',
  p_payment_reference := NULL,
  p_notes := 'Cliente pagó'
);

-- Enviar a revisión (con comprobante opcional)
SELECT * FROM public.submit_partner_payment_verification_request(
  p_request_id := 'uuid-solicitud',
  p_proof_path := 'user-uuid/request-uuid/archivo.jpg',
  p_proof_file_name := 'archivo.jpg',
  p_proof_mime_type := 'image/jpeg',
  p_proof_size_bytes := 512000
);

-- Aprobar (admin only)
SELECT * FROM public.approve_partner_payment_verification_request(
  p_request_id := 'uuid-solicitud',
  p_review_notes := 'Validado en sistema'
);

-- Rechazar (admin only)
SELECT * FROM public.reject_partner_payment_verification_request(
  p_request_id := 'uuid-solicitud',
  p_rejection_reason := 'Comprobante incorrecto'
);

-- Cancelar (vendedor su propio, admin todos)
SELECT * FROM public.cancel_partner_payment_verification_request(
  p_request_id := 'uuid-solicitud',
  p_cancel_reason := 'Error de operación'
);

═══════════════════════════════════════════════════════════════════════════════
