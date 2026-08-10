# REGRESSION FIX - Phase 8 (August 9, 2026)

## Problem Statement

**REGRESSION**: `socios_comerciales` role lost access to 2 modules after Phase 7 completion.

### Before Fix
- Desktop sidebar: Only showed "Socios Comerciales"
- Mobile nav: Only had "Más" menu with limited access
- POS (Punto de Venta) route: Blocked
- Print Labels (Imprimir Etiquetas) route: Blocked

### Expected After Fix
- Desktop sidebar: Shows 3 modules
  - Punto de Venta
  - Imprimir Etiquetas
  - Socios Comerciales
- Mobile nav: Bottom navigation + "Más" menu with all 3 accessible
- POS route: Accessible
- Print Labels route: Accessible
- Finanzas/Dashboard routes: Still blocked (as intended)

---

## Root Cause Analysis

**File**: [contexts/AuthContext.tsx](contexts/AuthContext.tsx#L277)

**Problem**: The `moduleAccessMap` for `socios_comerciales` role only contained 1 entry instead of 3.

**Original Code** (Lines 277-280):
```typescript
socios_comerciales: [
  'socios_comerciales',
],
```

**Issue**: 
- Missing 'pos' module
- Missing 'etiquetas' module
- This contradicted Phase 5 expansion plan documented in SOCIOS_COMERCIALES_PERMISSIONS_EXPANSION.md

**Why It Happened**:
The permission expansion was documented but never committed to main branch, or was accidentally reverted in a merge. Phase 7 focused on POS commission backend, which didn't update the frontend permission matrix.

---

## Solution

### Single File Change

**File**: [contexts/AuthContext.tsx](contexts/AuthContext.tsx#L277-L281)

**Fixed Code** (Lines 277-281):
```typescript
socios_comerciales: [
  'pos',
  'etiquetas',
  'socios_comerciales',
],
```

### How This Works

1. **AuthContext.tsx** defines `moduleAccessMap` (Source of Truth)
2. **canAccessModule()** function checks if user's role has access to a module
3. **Layout.tsx** uses `canAccessModule()` to filter sidebar menu items
4. **App.tsx** uses `ProtectedRoute` with `canAccessModule()` to guard routes
5. **ProtectedRoute.tsx** blocks unauthorized access with "Acceso Denegado"

### Architecture Flow

```
User Login
    ↓
AuthContext loads profile + moduleAccessMap
    ↓
Layout renders sidebar
    ├─ Filters navItems using canAccessModule()
    └─ Shows only: Punto de Venta, Imprimir Etiquetas, Socios Comerciales
    ↓
Route Navigation
    ├─ /pos → ProtectedRoute checks canAccessModule('pos') → ✅ Access
    ├─ /print-labels → ProtectedRoute checks canAccessModule('etiquetas') → ✅ Access
    ├─ /socios-comerciales → ProtectedRoute checks canAccessModule('socios_comerciales') → ✅ Access
    ├─ /dashboard → ProtectedRoute checks canAccessModule('dashboard') → ❌ Denied
    └─ /finanzas → ProtectedRoute checks canAccessModule('finanzas') → ❌ Denied
```

---

## Verification

### Build Status
```
✓ npm run build: SUCCESS (0 errors, 5.50s)
✓ 2,866 modules transformed
✓ No TypeScript errors
✓ No compilation warnings
```

### Files Modified
- [contexts/AuthContext.tsx](contexts/AuthContext.tsx) (2 lines added, 0 lines removed)

### Git Diff
```diff
socios_comerciales: [
+  'pos',
+  'etiquetas',
   'socios_comerciales',
],
```

---

## Impact Scope

### Frontend Only
- ✅ NO database changes
- ✅ NO SQL migrations
- ✅ NO Supabase configuration
- ✅ NO backend changes
- ✅ NO commission_events/triggers affected
- ✅ NO role definition changes (role='socios_comerciales' unchanged)

### Components Affected
1. **contexts/AuthContext.tsx** - Modified moduleAccessMap
2. **components/Layout.tsx** - Uses canAccessModule() (no change needed)
3. **components/ProtectedRoute.tsx** - Uses canAccessModule() (no change needed)
4. **App.tsx** - Routes already properly guarded (no change needed)

---

## Testing Checklist

- [ ] Logout and login as `socios_comerciales` user
- [ ] Desktop: Verify sidebar shows 3 modules
  - [ ] Punto de Venta (clickable)
  - [ ] Imprimir Etiquetas (clickable)
  - [ ] Socios Comerciales (clickable)
- [ ] Mobile: Verify bottom nav and "Más" menu work
  - [ ] Tap Punto de Venta → /pos loads
  - [ ] Tap Imprimir Etiquetas → /print-labels loads
  - [ ] Tap Socios Comerciales → /socios-comerciales loads
- [ ] Direct URL navigation works
  - [ ] Visit /pos → Page loads
  - [ ] Visit /print-labels → Page loads
  - [ ] Visit /socios-comerciales → Page loads
- [ ] Blocked routes still blocked
  - [ ] Visit /dashboard → "Acceso Denegado" appears
  - [ ] Visit /finanzas → "Acceso Denegado" appears
  - [ ] Visit /inventory → "Acceso Denegado" appears

---

## Documentation References

- [SOCIOS_COMERCIALES_PERMISSIONS_EXPANSION.md](SOCIOS_COMERCIALES_PERMISSIONS_EXPANSION.md) - Original plan (Phase 5)
- [contexts/AuthContext.tsx](contexts/AuthContext.tsx) - Module access map definition
- [App.tsx](App.tsx) - Route protection implementation
- [components/Layout.tsx](components/Layout.tsx) - Sidebar filtering logic
- [components/ProtectedRoute.tsx](components/ProtectedRoute.tsx) - Route guard implementation

---

## Session Context

**Phase 8 Summary**:
- Diagnosed REGRESSION: socios_comerciales lost access to POS and Print Labels
- Identified root cause: moduleAccessMap missing 2 entries
- Applied minimal fix: Added 2 lines to AuthContext.tsx
- Build verification: ✅ Success (0 errors)
- Ready for: Manual testing

**Files Created/Modified This Session**:
- ✅ contexts/AuthContext.tsx (MODIFIED - 2 lines added)
- 📝 REGRESSION_FIX_PHASE8.md (THIS FILE - Created for documentation)

---

## Commit Ready

This fix is ready for commit with message:
```
fix: restore socios_comerciales access to pos and etiquetas modules

- Add 'pos' and 'etiquetas' to socios_comerciales moduleAccessMap
- Fixes regression where sidebar only showed 1 module
- Restores navigation to Punto de Venta and Imprimir Etiquetas
```

**No database changes needed. No migrations to run. Frontend-only fix.**
