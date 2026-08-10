# Quick Reference: Socios Comerciales Permissions

## What Changed
**Modified**: [contexts/AuthContext.tsx](contexts/AuthContext.tsx#L261-L279) (Lines 261-279)

```diff
  socios_comerciales: [
+   'pos',
+   'etiquetas',
    'socios_comerciales',
  ]
```

## Result

### Desktop Access
| Module | Route | Status |
|--------|-------|--------|
| Punto de Venta | `/pos` | ✅ ACCESSIBLE |
| Imprimir Etiquetas | `/print-labels` | ✅ ACCESSIBLE |
| Socios Comerciales | `/socios-comerciales` | ✅ ACCESSIBLE |
| **All Others** | — | ❌ BLOCKED |

### Sidebar Navigation
socios_comerciales users now see **3 items**:
1. Punto de Venta
2. Imprimir Etiquetas  
3. Socios Comerciales

### Security
- ✅ Route guards active
- ✅ Sidebar auto-filtering works
- ✅ Direct URL access protected
- ✅ Database role unchanged
- ✅ Admin role untouched

## Build Status
✅ SUCCESS - 4.04s, 0 errors

## Manual Testing

### To Test Access
1. Log in with role=socios_comerciales
2. Verify sidebar shows 3 items only
3. Click "Punto de Venta" → should load /pos
4. Click "Imprimir Etiquetas" → should load /print-labels
5. Verify Dashboard not in sidebar

### To Test Blocked Access
1. Try manually navigating to `/finanzas` → should show AccessDenied
2. Try manually navigating to `/inventario` → should show AccessDenied
3. Try manually navigating to `/dashboard` → should show AccessDenied

### To Test Admin (unchanged)
1. Log in with role=admin
2. Verify sidebar shows all 12 items
3. Verify all routes still accessible
4. No regression

## Backend Next Steps

1. Test POS module data loading
2. Test Print Labels module data loading
3. Check browser console for 403 errors
4. If errors appear → update Supabase RLS policies
5. Test full sales/label flow

## Files Reference

| File | Change | Line |
|------|--------|------|
| [contexts/AuthContext.tsx](contexts/AuthContext.tsx#L261-L279) | Permission matrix | 261-279 |
| [App.tsx](App.tsx#L70-L149) | Route guards | 70-149 |
| [components/Layout.tsx](components/Layout.tsx#L40-L54) | Sidebar filter | 40-54 |
| [components/ProtectedRoute.tsx](components/ProtectedRoute.tsx#L56-L62) | Access check | 56-62 |

## Full Report

See [SOCIOS_COMERCIALES_PERMISSIONS_EXPANSION.md](SOCIOS_COMERCIALES_PERMISSIONS_EXPANSION.md) for complete implementation details.
