# Guía Rápida: Reportes B2B - Fase 5

## 📍 Acceso

- **Ruta**: Socios Comerciales → Tab "Reportes B2B"
- **Roles requeridos**: admin o socios_comerciales
- **Ubicación archivo**: `/pages/CommercialPartners.tsx`

## 🎯 Los 7 Reportes

| # | Reporte | Icono | Descripción | CSV | Datos de |
|---|---------|-------|-------------|-----|----------|
| 1 | **Resumen** | BarChart3 | Dashboard general con 9 secciones | ❌ | 3 vistas |
| 2 | **Cobranza** | TrendingUp | Saldos pendientes + prioridades | ✅ | 2 vistas |
| 3 | **Rankings** | Zap | Partners rankeados por 4 criterios | ✅ | 1 vista |
| 4 | **Productos** | Package | Top productos por ventas | ✅ | 1 vista |
| 5 | **Visitas** | Calendar | Próximas visitas + comodatos vencidos | ✅ | 2 vistas |
| 6 | **Mapa** | MapPin | Partners geográficos (legend + panel) | ❌ | 1 vista |
| 7 | **Zonas** | Layers | Ventas por zona + pipeline | ✅ | 2 vistas |

## 🔍 Funcionalidades por Reporte

### Resumen (v_b2b_dashboard_summary)
```
Cards mostrados:
├── General: Total Generado, Cobrado, Pendiente, Socios Activos, Modelos
├── Comodato: Generado, Saldo Pend., Tasa Cobro, Promedio Saldo
├── Mayoreo: Generado, Saldo Pend., Tasa Cobro, Promedio Saldo
├── Conversión: Prospectos, Activados, Tasa, Promedio Generado
└── Pipeline: 6 cards por estado (Prospecto, Negociando, Activado, etc.)
```

### Cobranza (v_b2b_pending_balances + v_b2b_collection_report)
```
Tabla sorteable:
  Folio | Socio | Responsable | Teléfono | Modelo | Comodato | Mayoreo | Total | Prioridad | Ver
  
Colores prioridad:
  🔴 saldo_alto     (Rojo) - Crítico
  🟡 saldo_medio    (Ámbar) - Atención
  🟢 saldo_bajo     (Verde) - Ok
  
Acciones:
  • CSV: 9 columnas
  • "Ver socio": Abre detail panel
```

### Rankings (v_b2b_partner_ranking)
```
Ordenar por:
  • B2B Total (default)
  • Comodato
  • Mayoreo
  • Pendiente

Tabla:
  Rank | Folio | Socio | Responsable | Modelo | Generado | Comodato | Mayoreo | Pagado | Pendiente | Unidades | Última Compra | Ver
  
CSV: 12 columnas
```

### Productos (v_b2b_top_products)
```
Cards estadísticas:
  • Total Piezas
  • Total Monto
  • Más Vendido
  • Fuerte en Mayoreo
  • Fuerte en Comodato

Tabla:
  Rank | Producto | Variante | Tamaño | Unidades | Monto Total | Unidades Comodato | Unidades Mayoreo | ...

Colores:
  🟣 Púrpura = Comodato
  🔵 Azul = Mayoreo
```

### Visitas (v_b2b_upcoming_visits + v_b2b_comodato_expired)
```
Categorías por fecha:
  ⚠️  Vencidas (rojo)      - Hace X días
  📍 Hoy (verde)          - Hoy
  📅 Esta Semana (azul)   - Próximos 7 días
  📆 Este Mes (gris)      - Próximos 30 días
  🔮 Futuras (info)       - Más de 30 días

Card de visita:
  Socio | Modelo | Teléfono | Dirección | Próxima Visita | Motivo | Días | Saldo | Ver socio

Extra: Sección Comodatos Vencidos (rojo, con días vencido + unidades + saldo)
```

### Mapa (v_b2b_partner_map)
```
Layout:
  Panel Izq: Lista searchable de partners
    • Input: buscar por nombre/folio
    • Selected: Detalles del partner
    • Botón: "Ver detalle completo"
    
  Panel Der: Mapa con leyenda (data-ready para Leaflet)
    
Legend (6 colores):
  🔴 Con saldo pendiente
  🔵 Mayoreo
  🟣 Comodato
  🟡 En negociación
  🟢 Activo
  ⚫ Otro
```

### Zonas (v_b2b_sales_by_zone + v_b2b_pipeline_by_status)
```
Pipeline section (6 cards):
  Estado | Socios | Generado | Pendiente

Tabla Zonas:
  Estado | Ciudad | Colonia | Socios Total | Comodato | Mayoreo | Activos | Generado | Pagado | Pendiente

Colores tabla:
  🟣 Púrpura = Comodato
  🔵 Azul = Mayoreo
  🟢 Verde = Activos
```

## 🔄 Cómo Funcionan los Reportes

### Flujo de Datos
```
CommercialPartners.tsx
  ↓ (pageTab === 'reportes')
B2BReports.tsx (Container)
  ↓ (renderiza según activeTab)
B2B[Nombre]Report.tsx
  ↓ (useEffect + useState)
Fetch desde Supabase (vía supabase-js)
  ↓ (loading → error → data)
Formatea con helpers (formatCurrency, formatDate, etc.)
  ↓
Renderiza UI (cards, tablas, listas)
```

### Callback: Ver Socio
```
B2BReports recibe: onPartnerSelect?: (partnerId: string) => void

En cualquier reporte:
  1. Usuario hace clic en "Ver socio" / "Ver detalle"
  2. Se llama onPartnerSelect(partnerId)
  3. CommercialPartners captura la llamada
  4. Busca el socio en su state (partners array)
  5. Abre CommercialPartnerDetail side panel

Código en CommercialPartners:
```
const handlePartnerSelectFromReports = (partnerId: string) => {
  const partner = partners.find(p => p.id === partnerId);
  if (partner) setSelectedPartner(partner);
};

<B2BReports onPartnerSelect={handlePartnerSelectFromReports} />
```

## 📊 Vistas Supabase

Todas preexistentes, no se modificaron:

| Vista | Uso | Columnas principales |
|-------|-----|----------------------|
| v_b2b_dashboard_summary | Resumen | partner_count, total_generated, total_collected, total_pending |
| v_b2b_pending_balances | Cobranza | folio, business_name, comodato_balance, mayoreo_balance, priority |
| v_b2b_collection_report | Cobranza | similar a pending_balances |
| v_b2b_partner_ranking | Rankings | folio, business_name, ranking, generado, comodato, mayoreo, pending |
| v_b2b_top_products | Productos | product_name, variant, size, units, total_amount |
| v_b2b_upcoming_visits | Visitas | business_name, model, next_visit, days_until, pending_balance |
| v_b2b_comodato_expired | Visitas | business_name, model, days_expired, units, pending_balance |
| v_b2b_partner_map | Mapa | folio, business_name, latitude, longitude, partner_type |
| v_b2b_sales_by_zone | Zonas | state, city, neighborhood, comodato_sales, mayoreo_sales |
| v_b2b_pipeline_by_status | Zonas | status, partner_count, total_generated, total_pending |
| v_b2b_conversion_summary | Resumen | conversion_rate, average_generated, partner_count |

## 🎨 Helpers Disponibles

```typescript
// En: components/commercialPartners/reports/b2bReportHelpers.ts

formatCurrency(value: number): string
  // $1,234.56 MXN

formatDate(iso: string | null): string
  // "01 jul 2026"

formatNumber(value: number): string
  // "1,234" con separadores locales

daysUntil(iso: string | null): number | null
  // -5 (hace 5 días), 0 (hoy), 10 (en 10 días)

getDayLabel(iso: string | null): string
  // "Hoy", "Mañana", "En 5 días", etc.

getPriorityColor(priority: string): string
  // Clases Tailwind: "text-red-500 bg-red-500/20" etc.

getMapMarkerColor(type: string): string
  // Colores CSS para markers del mapa

exportToCSV(data: any[], columns: string[], filename: string): void
  // Descarga CSV con data procesada
```

## 🔐 Seguridad

- **Autenticación**: Validada en AuthContext
- **Autorización**: Solo admin + socios_comerciales
- **Query**: Lectura desde vistas (no hay update/delete)
- **Permisos**: Verificados en ProtectedRoute

## 📱 Responsive

- **Desktop**: Tablas con scroll horizontal
- **Tablet**: Tablas comprimidas + cards
- **Mobile**: Cambio a layout de cards

## ⚙️ Configuración

### Agregar nuevo reporte

1. Crear archivo: `/components/commercialPartners/reports/B2B[Nombre]Report.tsx`
2. Importar en `B2BReports.tsx`
3. Agregar a const TABS
4. Agregar case en switch de renderizado
5. Implementar interfaz con `onPartnerSelect?` opcional

### Cambiar colores

- Edit: `/tailwind.config.js` (cc-primary, cc-surface, etc.)
- O usar Tailwind inline: `bg-red-500/20`, `text-amber-400`

### Agregar nueva vista Supabase

1. Crear SQL view en Supabase
2. Agregar interface en `b2bReportTypes.ts`
3. Usar en componente: `supabase.from('v_nombre_nueva').select()`

## 🚀 Performance

- **Lazy loading**: Cada tab se carga al hacer clic
- **Refresh manual**: Botón "Actualizar" en header
- **Caché**: useEffect con dependency array
- **Paginación**: Futura mejora para tablas grandes

## 🐛 Debugging

### Verificar datos desde Supabase
```typescript
// En browser console:
const { data } = await supabase
  .from('v_b2b_dashboard_summary')
  .select('*');
console.log(data);
```

### Logs útiles
```typescript
// En componente:
console.log('partnerId:', partnerId);
console.log('formatted data:', formatted);
console.log('partners state:', partners);
```

### Errores comunes

| Error | Causa | Fix |
|-------|-------|-----|
| "No data" | Supabase sin conexión o rol insuficiente | Verificar .env, roles |
| "Invalid type" | Estructura de datos no coincide | Revisar b2bReportTypes.ts |
| "CSV vacío" | Exportation sin columnas | Verificar array de columns |
| "Partner no encontrado" | ID no existe en partners array | Cargar partners primero |

## 📚 Referencias

- **CommercialPartners.tsx**: Página principal, maneja state global de partners
- **B2BReports.tsx**: Container, maneja tabs y refresh
- **B2B[Nombre]Report.tsx**: Componente individual, datos + UI
- **b2bReportHelpers.ts**: Funciones reutilizables
- **b2bReportTypes.ts**: Tipos TypeScript
- **supabase.ts**: Cliente Supabase singleton

---

**Última actualización**: 2024  
**Estado**: Production Ready ✅  
**Compilación**: npm run build - Success (4.14s)
