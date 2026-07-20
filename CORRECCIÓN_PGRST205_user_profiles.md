# CORRECCIÓN: Error PGRST205 en user_profiles

**Fecha:** 9 de julio de 2026
**Problema:** GET /rest/v1/user_profiles 404
**Causa:** AuthContext estaba intentando cargar tabla incorrecta en Supabase

## Error Original

```
Error loading user profile:
{
  code: "PGRST205",
  message: "Could not find the table 'public.user_profiles' in the schema cache",
  hint: "Perhaps you meant the table 'public.profiles'"
}
```

## Análisis

El error sugería cambiar a `public.profiles`, pero esta no es la tabla correcta para roles y permisos. La tabla correcta es `public.user_profiles` que ya existe en el proyecto.

## Cambios Realizados

### 1. ✅ Revertir de `profiles` a `user_profiles`

**Archivo:** `contexts/AuthContext.tsx`

**Antes:**
```typescript
const { data: profileData, error: profileError } = await supabase
  .from('profiles')  // ❌ INCORRECTO
  .select('id, full_name, role, is_active, created_at, updated_at')
  .eq('id', userId)
  .maybeSingle();
```

**Después:**
```typescript
const { data: profileData, error: profileError } = await supabase
  .from('user_profiles')  // ✅ CORRECTO
  .select('id, full_name, role, is_active, created_at, updated_at')
  .eq('id', userId)
  .maybeSingle();
```

### 2. ✅ Mejorar Manejo de Error PGRST205

Agregado manejo específico para el error de tabla no encontrada:

```typescript
if (profileError.code === 'PGRST205') {
  console.error('Table user_profiles not found in schema cache');
  setProfile(null);
  setBlockedReason(null);
  setError('No se encontró la tabla user_profiles en Supabase. Revisa que exista, que tenga permisos para authenticated y que el frontend esté conectado al proyecto correcto.');
  return null;
}
```

**Resultado:**
- Error PGRST205 muestra mensaje detallado y claro
- App NO se queda en loading infinito
- Usuario puede ver por qué falló la conexión
- Sugiere pasos a seguir (verificar tabla, permisos, proyecto correcto)

### 3. ✅ Mensaje de Error Genérico

Si es otro tipo de error en user_profiles:

```typescript
setError('No se pudo cargar el perfil del usuario.');
```

## Variables de Entorno

Confirmadas en `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Proyecto actual:** `https://fcyjhkylazselxrhqxzk.supabase.co`

## Build

✅ Exitoso sin errores TypeScript

```bash
npm run build ✓
- tsc: OK
- vite build: OK
- dist/index.html: 1.14 kB
```

## Próximos Pasos para Validación

1. **Verificar que tabla `user_profiles` existe en Supabase:**
   ```sql
   SELECT * FROM user_profiles LIMIT 1;
   ```

2. **Verificar permisos en tabla:**
   - La tabla debe ser seleccionable por role `authenticated`
   - En Supabase, ir a SQL Editor y ejecutar queries

3. **Verificar variables de entorno:**
   - Confirmar que `.env` tiene `VITE_SUPABASE_URL` correcto
   - Confirmar que apunta a proyecto donde existe `user_profiles`

4. **Si la tabla no existe, crearla:**
   ```sql
   CREATE TABLE user_profiles (
     id UUID REFERENCES auth.users(id) PRIMARY KEY,
     full_name TEXT,
     role TEXT DEFAULT 'admin',
     is_active BOOLEAN DEFAULT TRUE,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

5. **Si falta migración SQL:**
   - Ejecutar `migration_add_is_active_to_profiles.sql`
   - O crear tabla desde cero como arriba

## Tabla de Referencia

| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| `id` | UUID | N/A | FK references auth.users |
| `full_name` | TEXT | NULL | Nombre del usuario |
| `role` | TEXT | 'admin' | 'admin' o 'socios_comerciales' |
| `is_active` | BOOLEAN | TRUE | Usuario activo o inactivo |
| `created_at` | TIMESTAMPTZ | NOW() | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NOW() | Fecha de actualización |

## No Cambiar (Según Instrucciones)

❌ No migrar a tabla `profiles`
❌ No cambiar SQL base
❌ No crear tabla duplicada
✅ Mantener `user_profiles` como tabla correcta

## Archivos Modificados

1. **[contexts/AuthContext.tsx](contexts/AuthContext.tsx)**
   - Revertido de `.from('profiles')` a `.from('user_profiles')`
   - Mejorado manejo de error PGRST205
   - Mensaje de error más descriptivo

## Status

✅ Corrección completada
✅ Build exitoso
✅ Sin errores TypeScript
✅ Lista para testing

---

**Próxima acción:** Verificar que tabla `user_profiles` existe en Supabase con los datos correctos.
