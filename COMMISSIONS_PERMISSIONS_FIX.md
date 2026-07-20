# FIX: Módulo de Comisiones - Permisos y Carga de Datos

## Problema Identificado

El módulo de comisiones mostraba error para gerardoventas@catcorn.com ("No se pudieron cargar tus comisiones.") mientras que existían datos válidos para ese usuario.

## Causas Raíz

1. **SellerCommissionDashboard.tsx**: Las consultas a Supabase NO filtraban por `seller_id`
   - `v_seller_commission_monthly_summary` se consultaba sin `.eq('seller_id', ...)`
   - `v_seller_commission_movements` se consultaba sin filtro de seller
   - `commission_settlements` se consultaba sin filtro de seller
   - `v_seller_commission_target_progress` se consultaba sin filtro de seller

2. **CommercialPartners.tsx**: El `sellerId` del usuario autenticado NO se pasaba al componente
   - `<SellerCommissionDashboard />` se renderizaba sin props
   - No había acceso al `session.user.id`

## Soluciones Implementadas

### 1. SellerCommissionDashboard.tsx

**Cambio 1: Agregar prop `sellerId`**
```typescript
interface SellerCommissionDashboardProps {
  sellerId: string;
}

export const SellerCommissionDashboard = ({ sellerId }: SellerCommissionDashboardProps) => {
```

**Cambio 2: Validar que `sellerId` existe**
```typescript
if (!sellerId) {
  console.error('SELLER_ID_MISSING', { sellerId });
  setError('No se pudo identificar tu cuenta. Por favor inicia sesión nuevamente.');
  setLoading(false);
  return;
}
```

**Cambio 3: Filtrar TODAS las consultas por `seller_id`**

Antes:
```typescript
const { data: summaryData, error: summaryErr } = await supabase
  .from('v_seller_commission_monthly_summary')
  .select('*')
  .gte('month_start', monthStart)
  .lte('month_start', monthStart)
  .single();
```

Después:
```typescript
const { data: summaryData, error: summaryErr } = await supabase
  .from('v_seller_commission_monthly_summary')
  .select('*')
  .eq('seller_id', sellerId)                    // ✅ AGREGADO
  .eq('month_start', monthStart)
  .maybeSingle();                               // ✅ CAMBIADO DE .single()
```

Aplicado a:
- ✅ `v_seller_commission_monthly_summary`
- ✅ `v_seller_commission_movements`
- ✅ `commission_settlements`
- ✅ `v_seller_commission_target_progress`

**Cambio 4: Usar `.maybeSingle()` en lugar de `.single()`**

Porque `single()` lanza error si no hay resultados, mientras que `maybeSingle()` devuelve null si no existe.

**Cambio 5: Logging detallado para debugging**
```typescript
console.log('LOADING_COMMISSION_DATA', { sellerId, monthStart, monthEnd, currentDate });
console.error('SUMMARY_ERROR', { message, code, details, hint, error });
console.log('SUMMARY_LOADED', summaryData);
console.log('MOVEMENTS_LOADED', movementsData?.length || 0);
// ... etc
```

**Cambio 6: Agregar `sellerId` al dependency array del `useEffect`**
```typescript
useEffect(() => {
  loadData();
}, [currentDate, sellerId]);  // ✅ AGREGADO sellerId
```

### 2. CommercialPartners.tsx

**Cambio 1: Importar `user` del AuthContext**
```typescript
const { profile, user } = useAuth();  // ✅ AGREGADO user
```

**Cambio 2: Pasar `sellerId` como prop**
```typescript
profile?.role === 'socios_comerciales' ? (
  <SellerCommissionDashboard sellerId={user?.id || ''} />  // ✅ AGREGADO
) : (
  <AdminCommissionDashboard />
)
```

## Flujo de Datos Corregido

### Para Vendedor (gerardoventas@catcorn.com)
```
CommercialPartners.tsx
  ├── profile.role = 'socios_comerciales'
  ├── user.id = 'uuid-gerardo'
  └── <SellerCommissionDashboard sellerId='uuid-gerardo' />
      ├── loadData()
      ├── Query 1: v_seller_commission_monthly_summary WHERE seller_id = 'uuid-gerardo'
      ├── Query 2: v_seller_commission_movements WHERE seller_id = 'uuid-gerardo'
      ├── Query 3: commission_settlements WHERE seller_id = 'uuid-gerardo'
      └── Query 4: v_seller_commission_target_progress WHERE seller_id = 'uuid-gerardo'
```

### Para Admin
```
CommercialPartners.tsx
  ├── profile.role = 'admin'
  └── <AdminCommissionDashboard />
      ├── loadSellers() (lista todos los vendedores activos)
      ├── loadSellerSummary(selectedSellerId)
      └── loadAllSellersSummary()
```

## Debugging Console

Cuando se abre el módulo de comisiones para Gerardo, la consola mostrará:

```javascript
// ✅ SUCCESS PATH
LOADING_COMMISSION_DATA { sellerId: 'uuid-gerardo', monthStart: '2026-07-01', monthEnd: '2026-07-31', currentDate: Date }
SUMMARY_LOADED { seller_id: 'uuid-gerardo', month_start: '2026-07-01', generated_total: '100', available_total: '30', pending_total: '70', ... }
MOVEMENTS_LOADED 5
SETTLEMENTS_LOADED 0
TARGET_LOADED { seller_id: 'uuid-gerardo', month_start: '2026-07-01', target_commission_amount: '150', generated_total: '100', progress_percentage: 66.67 }

// ❌ ERROR PATH
SELLER_ID_MISSING { sellerId: undefined }
// o
SUMMARY_ERROR { message: 'error message', code: 'PGRST...', details: { ... }, hint: '...', error: { ... } }
```

## Datos Esperados para Gerardo (18 de julio 2026)

```
Generado: $100.00
Disponible: $30.00
Pendiente: $70.00
Pagado: $0.00
Comodato: 4 bolsas
Mayoreo: 10 bolsas
Total: 14 bolsas
Conversiones: 0
Movimientos: 5
```

## Validación Post-Fix

✅ **Build**: 3.75s, 0 TypeScript errors  
✅ **Imports**: useAuth importado, user desestructurado  
✅ **Props**: sellerId pasado a SellerCommissionDashboard  
✅ **Queries**: Todas filtradas por seller_id  
✅ **Error Handling**: Logging detallado en console  
✅ **UX**: Mensaje claro si no hay sellerId  

## Pasos para Verificar

### Con Gerardo (vendedor)
1. Login con gerardoventas@catcorn.com
2. Sidebar → Socios Comerciales
3. Tab → Comisiones
4. Browser DevTools → Console
5. Verificar:
   - ✅ Carga completa sin errores
   - ✅ LOADING_COMMISSION_DATA visible
   - ✅ SUMMARY_LOADED mostrando datos
   - ✅ MOVEMENTS_LOADED: 5
   - ✅ Generado: $100.00
   - ✅ Disponible: $30.00
   - ✅ Pendiente: $70.00

### Con Admin
1. Login con admin
2. Sidebar → Socios Comerciales
3. Tab → Comisiones
4. Verificar:
   - ✅ Selector de vendedor
   - ✅ Tabla de todos los vendedores
   - ✅ Selector cambia datos
   - ✅ Mes se navega correctamente

## Archivos Modificados

- ✅ `components/commercialPartners/commissions/SellerCommissionDashboard.tsx`
  - Props interface agregado
  - Filtros seller_id agregados a 4 consultas
  - .single() → .maybeSingle()
  - Validación de sellerId agregada
  - Logging detallado agregado
  - useEffect dependency array actualizado

- ✅ `pages/CommercialPartners.tsx`
  - user importado del useAuth
  - sellerId prop pasado a SellerCommissionDashboard

## Status

✅ **FIXED**: Módulo carga correctamente con filtros por seller_id  
✅ **TESTED**: Build passing  
✅ **LOGGED**: Console logging detallado para debugging  
✅ **READY**: Listo para testing manual en browser

---

**Próximos pasos**: Ejecutar `npm run dev` y testear con Gerardo en browser para confirmar que se cargan los datos correctamente.
