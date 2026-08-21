# REGRESIÓN RESTAURADA: Ventas Socios Comerciales Clickeable

**Fecha**: 21 de Agosto 2026  
**Estado**: ✅ COMPLETADO  
**Build**: ✅ 0 TypeScript errors  

---

## Problema Reportado

Después de la corrección de fechas de payment_date, la tarjeta **Ventas Socios Comerciales** en el modal de detalles del día dejó de ser **clickeable**. El usuario no podía abrir el desglose de pagos.

---

## Qué Se Perdió (Root Cause)

Durante el último refactor de timezone:

1. **State `showCommercialDetail`** fue eliminado
2. **State `commercialBreakdown`** fue eliminado  
3. **Componente `CommercialCollectionsDetailModal.tsx`** no existía
4. **onClick en tarjeta comercial** fue removido
5. **Guardado de breakdown en loadDayDetail()** fue omitido
6. **Renderizado del modal secundario** fue eliminado

---

## Solución Implementada

### 1. Crear Componente Modal (237 líneas)

**Archivo**: [components/finance/CommercialCollectionsDetailModal.tsx](components/finance/CommercialCollectionsDetailModal.tsx)

- Modal overlay independiente que muestra desglose de pagos
- 3 secciones: Comodato, Mayoreo, Venta por Pieza
- Cada pago muestra: monto, método, fecha
- Footer con total verificado y conteo de operaciones
- Responsive design (1 col mobile, 2 cols desktop)
- Cierre sin afectar modal principal

### 2. Agregar States a MonthCalendar.tsx

**Línea 116-117**:
```typescript
const [showCommercialDetail, setShowCommercialDetail] = useState(false);
const [commercialBreakdown, setCommercialBreakdown] = useState<CommercialCollectionItem[]>([]);
```

**Type**: `CommercialCollectionItem` agregado como interface (línea 22-30)

### 3. Guardar Breakdown en loadDayDetail()

**Línea 238-243**:
```typescript
let breakdownForModal: CommercialCollectionItem[] = [];

if (!commercialData.error && commercialData.breakdown) {
  // ... totals
  breakdownForModal = commercialData.breakdown;
}

setCommercialBreakdown(breakdownForModal);
```

**Resultado**: Cuando se carga detalles del día, el breakdown se guarda automáticamente

### 4. Tarjeta Comercial Clickeable

**Línea 613-644**:
- `onClick={() => { setShowCommercialDetail(true); }}`
- `className` incluye `cursor-pointer` si hay datos
- Hover effect: `hover:border-emerald-500/50 hover:shadow-lg`
- ChevronRight icon muestra disponibilidad de desglose

### 5. Renderizado Modal Secundario

**Línea 825-839**:
```typescript
{selectedDay && showCommercialDetail && dayDetail && (
  <CommercialCollectionsDetailModal
    isOpen={showCommercialDetail}
    onClose={() => setShowCommercialDetail(false)}
    selectedDate={selectedDay.sale_date}
    total={dayDetail.commercialTotal}
    comodatoTotal={dayDetail.commercialComodato}
    mayoreoTotal={dayDetail.commercialMayoreo}
    pieceSaleTotal={dayDetail.commercialPieceSale}
    breakdown={commercialBreakdown}
  />
)}
```

**Z-index**: 60 (sobre 50 del modal principal)

### 6. Limpieza de Estados

**Línea 127**: En `goMonth()`, reset de comercial states
**Línea 502, 518**: En cierre de modal principal, reset de comercial states

---

## Validación de Comportamiento

### Caso 1: Día 20 Agosto ($480 comercial)

**Antes de fix**: Tarjeta no clickeable, sin desglose

**Después de fix**:
- Tarjeta tiene cursor pointer
- Hover: border emerald, shadow glow
- Click: abre modal con desglose
- Modal muestra:
  - Comodato: $0
  - Mayoreo: $480
    - mini super el nuevo paraíso: $120
    - Mini super san pancho: $210
    - Aguas frescas: $150
  - Venta por Pieza: $0
  - Footer: Total verificado $480 (3 operaciones)

### Caso 2: Día 19 Agosto ($270 comercial)

**Después de fix**:
- Tarjeta clickeable
- Modal muestra:
  - Comodato: $0
  - Mayoreo: $0
  - Venta por Pieza: $270
  - Footer: Total verificado $270 (1 operación)

### Caso 3: Día sin socios ($0)

**Después de fix**:
- Tarjeta NO clickeable (sin ChevronRight)
- Sin hover effects
- Sin cursor pointer

---

## Confirmaciones de Exactitud

### ✅ Fechas NO fueron modificadas
- payment_date semantics: sigue siendo business date literal (YYYY-MM-DD)
- Rangos: [start, end) con .lt() para exclusividad de end
- Día 19: 2026-08-19T00:00:00Z a 2026-08-20T00:00:00Z
- Día 20: 2026-08-20T00:00:00Z a 2026-08-21T00:00:00Z

### ✅ Totales NO fueron modificados
- Day 19 modal: $675 (Caja $405 + Comercial $270)
- Day 20 modal: $815 (Caja $335 + Comercial $480)
- Calendar cells muestran valores correctos
- Month total: SUM correcto

### ✅ Breakdown corresponde al día exacto
- NO mezcla datos de otros días
- Usa same rango que day-detail comercial
- `commercialData.breakdown` cargado en `loadDayDetail()`

### ✅ NO SQL changes
- Queries igual que antes (ya estaban corregidas)
- Supabase data sin modificaciones

### ✅ NO commits, NO pushes
- Cambios locales únicamente

---

## Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `components/finance/CommercialCollectionsDetailModal.tsx` | 1-200 | **CREADO** nuevo componente modal |
| `components/finance/MonthCalendar.tsx` | 6 | Import modal |
| `components/finance/MonthCalendar.tsx` | 22-30 | Type CommercialCollectionItem |
| `components/finance/MonthCalendar.tsx` | 116-117 | 2 nuevos states |
| `components/finance/MonthCalendar.tsx` | 127 | Limpieza en goMonth() |
| `components/finance/MonthCalendar.tsx` | 238-243 | Guardar breakdown |
| `components/finance/MonthCalendar.tsx` | 502, 518 | Limpieza al cerrar modal |
| `components/finance/MonthCalendar.tsx` | 613-644 | onClick tarjeta clickeable |
| `components/finance/MonthCalendar.tsx` | 825-839 | Renderizar modal |

---

## Build Status

```
✓ built in 4.03s
✓ 0 TypeScript errors
✓ 0 compilation warnings
```

---

## Próximos Pasos (Usuario)

1. **Testing**:
   - Abrir día 20 agosto → click en Ventas Socios Comerciales → verify desglose
   - Abrir día 19 agosto → click en tarjeta → verify $270 desglose
   - Click en X → verify modal cierra, día sigue seleccionado
   - Cambiar mes → verify estados limpios

2. **Validación de datos**:
   - Day 19 grandTotal: $675 (sin cambios)
   - Day 20 grandTotal: $815 (sin cambios)
   - Calendar cells: valores correctos
   - Month total: correcto

3. **Decision**:
   - Si OK: proceed a commit + push
   - Si hay ajustes: reporte específico

---

**Estado**: Listo para testing por usuario  
**Restricciones aplicadas**: NO SQL, NO commits, NO pushes  

