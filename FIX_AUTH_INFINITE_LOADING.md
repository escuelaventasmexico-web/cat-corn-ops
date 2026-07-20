# FIX_AUTH_INFINITE_LOADING - Correcciones Implementadas

**Fecha:** 9 de julio de 2026

## Problema Original
- App atrapada en "Cargando Cat Corn OPS..." infinitamente
- `NavigatorLockAcquireTimeoutError` en Supabase Auth (timeout de 10000ms)
- `profileLoading` nunca terminaba
- Usuario no podía entrar aunque estuviera logueado

## Correcciones Implementadas

### 1. ✅ Verificación de Supabase Client (CORRECCIÓN 1)
- Confirmado: Solo **1 createClient** en `supabase.ts`
- No hay múltiples instancias en componentes ni hooks
- Resultado: ✓ OK - Cliente singleton compartido correctamente

### 2. ✅ Refactorización AuthContext.tsx (CORRECCIONES 2-4)
**Cambios principales:**
- Función `loadUserProfile()` con **try/catch/finally** garantizado
- Usa `.maybeSingle()` en lugar de `.single()` para evitar errores si no existe
- Inicialización con `setLoading(true)` y `setProfileLoading(true)` al inicio
- **Finally siempre ejecuta** `setLoading(false)` y `setProfileLoading(false)`
- Todos los errores de Supabase capturados con mensajes claros:
  - Error de sesión: "No se pudo cargar la sesión."
  - Perfil no existe: "Tu usuario no tiene perfil asignado."
  - Usuario inactivo: "Tu usuario está inactivo."
  - Error inesperado: "Error cargando permisos del usuario."

**Handlers implementados:**
```typescript
// Manejo de error en getSession()
if (sessionError) {
  setSession(null);
  setError('No se pudo cargar la sesión.');
  return; // Exit pero con finally ejecutándose
}

// Manejo de perfil no encontrado
if (!profileData) {
  setBlockedReason('no_profile');
  setError('Tu usuario no tiene perfil asignado...');
  return; // Con finally ejecutándose
}

// Try/catch/finally garantizado
finally {
  setLoading(false);
  setProfileLoading(false);
}
```

### 3. ✅ Evitar Lock Manager Timeout (CORRECCIÓN 4)
- Agregado `setTimeout(..., 0)` en `onAuthStateChange` para evitar bloqueo de Supabase Auth
- Esto previene que el lock manager de Supabase quede atorado esperando múltiples accesos
- `loadUserProfile()` ahora se llama dentro del `setTimeout` con `.finally()`

**Código:**
```typescript
setTimeout(() => {
  if (isSubscribed) {
    loadUserProfile(newSession.user.id)
      .finally(() => {
        setLoading(false);
        setProfileLoading(false);
      });
  }
}, 0);
```

### 4. ✅ Timeout de Seguridad (CORRECCIÓN 6)
- Agregado `useEffect` que monitorea `loading` y `profileLoading`
- Si después de **12 segundos** siguen en `true`, se fuerzan a `false`
- Mensaje: "La sesión tardó demasiado. Cierra otras pestañas, actualiza e intenta de nuevo."
- Evita que la app se bloquee para siempre

**Código:**
```typescript
useEffect(() => {
  if (!loading && !profileLoading) return;

  const timeout = setTimeout(() => {
    console.warn('Auth loading timeout reached after 12 seconds');
    setLoading(false);
    setProfileLoading(false);
    setError('La sesión tardó demasiado...');
  }, 12000);

  return () => clearTimeout(timeout);
}, [loading, profileLoading]);
```

### 5. ✅ ProtectedRoute mejorado (CORRECCIONES 5, 7)
**Antes:** Mostraba loader infinito sin salidas claras

**Ahora:**
1. Si `loading` → "Cargando sesión..."
2. Si no hay `session` → Redirige a `/login`
3. Si `profileLoading` → "Cargando perfil..."
4. Si `error && blockedReason` → ErrorScreen con botones:
   - "Reintentar" (recarga)
   - "Cerrar sesión" (limpia localStorage/sessionStorage)
5. Si `error` pero sin blockedReason → ErrorScreenWithReset con:
   - "Reiniciar sesión" (limpia todo + va a login)
6. Si sin acceso a módulo → AccessDenied con:
   - "Ir a Socios Comerciales"
   - "Salir"

**Componentes nuevos:**
- `ErrorScreen`: Para errores de perfil/usuario inactivo
- `ErrorScreenWithReset`: Para errores de timeout/sesión
- `AccessDenied`: Ya existente, pero mejorado

### 6. ✅ Limpieza de Sesión (CORRECCIÓN 7)
- Botón "Reiniciar sesión" ejecuta:
  ```typescript
  await logout();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '/login';
  ```
- Limpia completamente cualquier dato local atrapado

### 7. ✅ Debug en Consola (CORRECCIÓN 8)
- Se mantiene `console.log('AUTH DEBUG', {...})` pero:
  - NO en loop infinito
  - Solo imprime cuando cambian los estados
  - Incluye: `userEmail`, `profile.id`, `role`, `loading`, `profileLoading`, `error`

### 8. ✅ Roles y Permisos (CORRECCIÓN 9)
**Validación confirmada:**
- `gerardoventas@catcorn.com`:
  - Debe tener: `role = 'socios_comerciales'`, `is_active = true`
  - Acceso: Solo módulo `socios_comerciales`
  - Otros módulos: "No tienes permiso"

- `admin@catcorn.com`, `gortega@catcorn.com`, `marianagm@catcorn.com`:
  - Deben tener: `role = 'admin'`, `is_active = true`
  - Acceso: Todos los módulos

**Código:**
```typescript
const moduleAccessMap: Record<UserRole, string[]> = {
  admin: [
    'dashboard', 'pos', 'inventario', 'produccion',
    'etiquetas', 'merma', 'logistica', 'socios_comerciales',
    'historial', 'corte_caja', 'pedidos', 'finanzas'
  ],
  socios_comerciales: ['socios_comerciales'],
};
```

### 9. ✅ Migración SQL
- Creado: `migration_add_is_active_to_profiles.sql`
- Agrega columnas faltantes a tabla `profiles`:
  - `is_active BOOLEAN DEFAULT TRUE`
  - `updated_at TIMESTAMPTZ DEFAULT NOW()`
  - Trigger para actualizar `updated_at` automáticamente

### 10. ✅ Build Exitoso
```
npm run build ✓ passed
- TypeScript compilation: OK
- Vite build: OK
- No errors found
- Warnings: Only chunk size warnings (non-critical)
```

## Cambios en Archivos

### `/Users/mariana/Downloads/cat-corn-ops/contexts/AuthContext.tsx`
- Refactorizado completo `initializeAuth()` con try/catch/finally
- Mejorado `loadUserProfile()` con manejo de todos los casos
- Agregado timeout de 12s de seguridad
- Fixed lock manager timeout con `setTimeout(..., 0)`
- Mejorado debug logging

### `/Users/mariana/Downloads/cat-corn-ops/components/ProtectedRoute.tsx`
- Agregado `ErrorScreen` component para errores no-bloqueantes
- Agregado `ErrorScreenWithReset` component para reiniciar sesión
- Mejorada lógica de flujo (sin loader infinito)
- Agregados botones de acción en cada pantalla de error

### `/Users/mariana/Downloads/cat-corn-ops/migration_add_is_active_to_profiles.sql` (Nuevo)
- Migración para actualizar esquema de `profiles` table

## Flujo de Carga Post-Fix

```
1. App inicia
   ↓
2. AuthProvider se monta
   ├─ setLoading(true)
   ├─ setProfileLoading(true)
   ↓
3. initializeAuth() ejecuta
   ├─ try:
   │  ├─ getSession() → Si error, set error message y return
   │  ├─ Si OK, setSession + await loadUserProfile()
   │  └─ loadUserProfile():
   │     ├─ try:
   │     │  ├─ fetch profiles con maybeSingle()
   │     │  ├─ Si error, set error message
   │     │  ├─ Si no existe, blockedReason = 'no_profile'
   │     │  ├─ Si inactivo, blockedReason = 'inactive'
   │     │  └─ Si OK, setProfile + setRole + setError(null)
   │     └─ finally: setProfileLoading(false) ✓ SIEMPRE
   ├─ catch: setError + todos states a null
   └─ finally: setLoading(false) ✓ SIEMPRE
   ↓
4. ProtectedRoute recibe states
   ├─ Si loading === true → Show LoadingScreen
   ├─ Si no session → Redirect to /login
   ├─ Si profileLoading === true → Show LoadingScreen
   ├─ Si error → Show ErrorScreen o ErrorScreenWithReset
   ├─ Si sin acceso → Show AccessDenied
   └─ Si todo OK → Renderiza children ✓ APP LOADED

5. Timeout de 12s monitorea
   └─ Si loading/profileLoading === true después de 12s:
      └─ Force setLoading(false), setProfileLoading(false)
      └─ Show error: "La sesión tardó demasiado..."
      └─ User can click "Reiniciar sesión" → Clear + Redirect
```

## Validación Final - Pasos a Seguir

```
PASO 1: Limpiar Storage
- localStorage.clear()
- sessionStorage.clear()

PASO 2: Entrar con Admin
- Email: admin@catcorn.com
- Debe cargar SIN loader infinito
- Debe ver Dashboard completo

PASO 3: Verificar Socios Comerciales
- Logout
- Entrar con: gerardoventas@catcorn.com
- Debe cargar Socios Comerciales

PASO 4: Verificar Denegación de Acceso
- Escribir en URL: /dashboard
- Debe mostrar "No tienes permiso"
- NO debe ser loader

PASO 5: Verificar Otras Denegaciones
- Escribir en URL: /finanzas
- Debe mostrar "No tienes permiso"
- Botón "Ir a Socios Comerciales"

PASO 6: Reiniciar Sesión
- Click "Salir"
- Debe ir a /login
- Volver a entrar sin atorarse
```

## Notas Importantes

✅ NO se modificó: Supabase, SQL base, Socios Comerciales, Comodato, Mayoreo
✅ SOLO se corrigió: AuthContext, ProtectedRoute, loading infinito, error handling
✅ Build exitoso: Sin errores TypeScript
✅ Backward compatible: Cambios no rompen nada existente

## Líneas de Código Agregadas

- **AuthContext.tsx**: +80 líneas (try/catch/finally, timeout, seguridad)
- **ProtectedRoute.tsx**: +60 líneas (ErrorScreen, ErrorScreenWithReset, botones)
- **migration_add_is_active_to_profiles.sql**: +30 líneas (migración SQL)

**Total: ~170 líneas de código defensivo para evitar loading infinito**
