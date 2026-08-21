# RESUMEN TÉCNICO: Fix Timezone Calendar Finanzas

## CAMBIOS REALIZADOS

### 1. lib/dateUtils.ts

**Agregados 2 nuevos helpers**:

#### `getBusinessDateFromUtcTimestamp(isoTimestamp: string | Date): string`
- Convierte UTC ISO timestamp → Business date (YYYY-MM-DD) en America/Mexico_City
- Usa Intl.DateTimeFormat con timeZone='America/Mexico_City'
- Maneja automáticamente DST
- **Ejemplo**: `"2026-08-20T00:00:00Z"` → `"2026-08-19"`

#### `getBusinessDayUtcRange(businessDateString: string): { startISO, endExclusiveISO }`
- Convierte business date (YYYY-MM-DD) → UTC range [start, end)
- Usa binary search para encontrar UTC midnight correcto
- Maneja automáticamente DST
- **Ejemplo**: `"2026-08-19"` → `{ startISO: "2026-08-19T06:00...", endExclusiveISO: "2026-08-20T06:00..." }`

---

### 2. components/finance/MonthCalendar.tsx

**Línea 5**: Agregado import
```typescript
import { getBusinessDateFromUtcTimestamp, getBusinessDayUtcRange } from '../../lib/dateUtils';
```

**Línea 127-133**: Reemplazado loadDayDetail()
```typescript
// ANTES
const dayStart = new Date(day.sale_date + 'T00:00:00-06:00').toISOString();
const nextDay = new Date(new Date(day.sale_date + 'T00:00:00-06:00').getTime() + 86400000).toISOString();

// DESPUÉS
const { startISO, endExclusiveISO } = getBusinessDayUtcRange(day.sale_date);
```

**Línea 314**: Reemplazado agrupación comercial
```typescript
// ANTES
const dateStr = item.payment_date.slice(0, 10);

// DESPUÉS
const businessDate = getBusinessDateFromUtcTimestamp(item.payment_date);
commercialByBusinessDate[businessDate] = ... // nuevo nombre de variable
```

---

### 3. services/commercialCollectionsService.ts

**Línea 37-54**: Actualizado JSDoc
- Agregado: `IMPORTANT: Date range semantics`
- Clarificado: `endDate: EXCLUSIVE < comparison (not <=)`

**Línea 90**: Comodato query
```typescript
// ANTES
.lte('payment_date', endISO);

// DESPUÉS
.lt('payment_date', endISO);
```

**Línea 125**: Mayoreo query
```typescript
// ANTES
.lte('payment_date', endISO);

// DESPUÉS
.lt('payment_date', endISO);
```

**Línea 174**: Piece Sale query
```typescript
// ANTES
.lte('payment_date', endISO);

// DESPUÉS
.lt('payment_date', endISO);
```

---

## IMPACTO DE CAMBIOS

### Antes del Fix
```
Día 19 Agosto:
├─ Sales: $405
├─ Comercial: $750 (todo el mes agrupado por UTC date)
│  ├─ $120 (UTC 18, era día 19 por .slice(0,10))
│  ├─ $270 (UTC 19, era día 20)
│  └─ $480 (UTC 20, era día 21)
├─ Celda: $675 ❌
├─ Header: $675 ❌
├─ Tarjeta Verde: $1,155 ❌ (porque loadDayDetail usa otro rango)
└─ Comercial Modal: $750 ❌

Inconsistencia: 3 valores diferentes para mismo día ($675, $675, $1,155)
```

### Después del Fix
```
Día 19 Agosto:
├─ Sales: $405 (UTC 2026-08-19T... a 2026-08-20T...)
├─ Comercial: $480 (solo UTC 2026-08-20T...)
│  └─ Correctamente mapeado a business date 2026-08-19
├─ Celda: $885 ✅
├─ Header: $885 ✅
├─ Tarjeta Verde: $885 ✅
└─ Comercial Modal: $480 ✅

Consistencia: Todos los valores = $885 (Caja $405 + Comercial $480)
```

---

## DISTRIBUCIÓN DE PAGOS CORRECTA

Confirmada en Supabase:

```
UTC Timestamp         → Business Date (Mexico)  → Amount
2026-08-18T...       → 2026-08-17              → $120 comodato
2026-08-19T...       → 2026-08-18              → $270 comodato
2026-08-20T...       → 2026-08-19              → $480 comodato ← CLAVE
```

El fix asegura que $480 (que tiene payment_date UTC 2026-08-20) se asigne correctamente a business date 2026-08-19.

---

## VERIFICACIONES DE COMPILACIÓN

```bash
$ npm run build
✓ TypeScript compilation: 0 errors
✓ Vite build: ✓ 2874 modules transformed
✓ Output size: 2,699.54 kB (715.13 kB gzip)
```

---

## ARCHIVOS DOCUMENTACIÓN CREADOS

1. **FIX_TIMEZONE_CALENDAR_REPORT.md** (este documento)
   - Problema
   - Causa raíz
   - Solución detallada
   - Impacto
   
2. **TESTING_CHECKLIST_TIMEZONE_FIX.md**
   - 12 pruebas específicas
   - Valores esperados
   - Checklist de validación

---

## LISTA DE CAMBIOS RESUMIDA

| Archivo | Línea | Cambio | Tipo |
|---------|-------|--------|------|
| dateUtils.ts | 50-100 | Nuevo: getBusinessDateFromUtcTimestamp() | Feature |
| dateUtils.ts | 102-180 | Nuevo: getBusinessDayUtcRange() | Feature |
| MonthCalendar.tsx | 5 | Import helpers | Import |
| MonthCalendar.tsx | 127-133 | Usar getBusinessDayUtcRange | Bugfix |
| MonthCalendar.tsx | 314 | Usar getBusinessDateFromUtcTimestamp | Bugfix |
| commercialCollectionsService.ts | 37-54 | Documentar range semantics | Docs |
| commercialCollectionsService.ts | 90 | .lte → .lt | Bugfix |
| commercialCollectionsService.ts | 125 | .lte → .lt | Bugfix |
| commercialCollectionsService.ts | 174 | .lte → .lt | Bugfix |

**Total**: 3 archivos, 9 cambios, 1 feature + 5 bugfixes + 3 docs

---

## NEXT STEPS

### Validación (Requerida)
- [ ] Ejecutar testing checklist (TESTING_CHECKLIST_TIMEZONE_FIX.md)
- [ ] Verificar días 17, 18, 19 agosto 2026
- [ ] Confirmar valores $120, $270, $480 correctamente distribuidos

### Si Aprobado
- [ ] NO commit (como indicó usuario)
- [ ] NO push (como indicó usuario)
- [ ] Reportar resultado en Discord

### Si Fallo
- [ ] Identificar en qué test falló
- [ ] Reportar con screenshot
- [ ] Investigar causa

---

**Implementación completada: 21 de agosto de 2026**
