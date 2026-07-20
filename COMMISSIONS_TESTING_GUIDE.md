# Guía de Testing - Módulo de Comisiones

## Acceso al Módulo

### 1. Login
- Ir a `/login`
- Usar credenciales de:
  - **Vendedor (Socio Comercial)**: role='socios_comerciales'
  - **Admin**: role!='socios_comerciales'

### 2. Navegar a Socios Comerciales
- Sidebar → "Socios Comerciales"
- Se abre `/socios-comerciales`
- Debe haber 3 tabs: **Socios** | **Reportes B2B** | **Comisiones** (NUEVO)

### 3. Click en Tab "Comisiones"
- Se renderiza diferente según rol:

## Pruebas por Rol

### VENDEDOR (role='socios_comerciales')

#### Panel "Mis comisiones"
1. **Encabezado**: Debe mostrar "Mis comisiones" con subtitle
2. **Selector de mes**: 
   - Botones ‹ › para navegar
   - No debe permitir seleccionar meses futuros (botón › deshabilitado)
   - Muestra nombre del mes en formato "Julio 2026"

3. **Tarjetas de resumen** (4 tarjetas):
   - ✅ Disponible para pago (tarjeta principal con borde gradiente)
   - Pendiente (con icono reloj)
   - Pagado (con icono check)
   - Generado total
   - Cada una con monto en MXN formato

4. **Mensaje motivacional**:
   - Cambia según:
     - Mucho disponible: "¡Excelente trabajo! Ya generaste..."
     - Mucho pendiente: "Clientes pagando, tus comisiones se procesan..."
     - Poco generado: "Sigue vendiendo para incrementar..."

5. **Sección Meta**: (Progress bar)
   - Muestra meta, generado, avance %
   - Barra visual en color mostaza
   - Texto "Te falta $X para llegar a la meta"

6. **Actividad** (5 mini tarjetas):
   - Comodato units
   - Mayoreo units
   - Total bolsas
   - Conversiones
   - Socios atendidos

7. **Tabla de movimientos**:
   - Columnas: Fecha | Socio | Origen | Producto | Cantidad | Comisión | Estado
   - Filtros activos:
     - Status: Todos, Pendiente, Disponible, Pagada, Cancelada
     - Origen: Todos, Comodato, Mayoreo, Conversión, Ajuste
     - Búsqueda: Por nombre socio, folio, producto
   - Botón "Exportar CSV" (descarga archivo)
   - Hover effect en filas

8. **Tabla de liquidaciones**:
   - Historial de liquidaciones pasadas
   - Columnas: Folio | Período | Importe | Estado | Fecha de pago
   - Mostrada solo si existen liquidaciones

#### Verificar RLS
- Los datos mostrados deben ser SOLO del vendedor autenticado
- Cambiar URL/seller_id no debe mostrar datos de otros

### ADMIN (role != 'socios_comerciales')

#### Panel "Comisiones del equipo"
1. **Encabezado**: "Comisiones del equipo" con subtitle

2. **Selector de mes**:
   - Misma lógica que vendedor (‹ › + prevención futura)

3. **Selector de vendedor**:
   - Dropdown con todos los socios activos (is_active=true)
   - Al seleccionar, carga datos de ese vendedor
   - Muestra nombre completo

4. **Resumen del vendedor seleccionado**:
   - Mismas 4 tarjetas de resumen (CommissionSummaryCards)
   - Sección de actividad (ActivitySummary)
   - Actualiza al cambiar vendedor o mes

5. **Tabla resumen general**:
   - Listado de todos los vendedores con:
     - Vendedor (nombre)
     - Generado (cantidad en MXN)
     - Pendiente (cantidad, color amarillo)
     - Disponible (cantidad, color verde, más visible)
     - Pagado (cantidad, color azul)
     - Bolsas (total de unidades comodato + mayoreo)
     - Conversiones (número de conversiones)
   - Filas clickeables para seleccionar ese vendedor
   - Hover effect

#### Verificar datos
- Cambiar vendedor en dropdown debe actualizar todas las secciones
- Cambiar mes debe actualizar todos los datos
- Los totales en tabla general deben sumar a los del vendedor seleccionado

## Pruebas Técnicas

### 1. Responsivo
- **Móvil** (< 768px):
  - Layout apilado verticalmente
  - Tablas en scroll horizontal
  - Grid de tarjetas 1-2 cols
  
- **Desktop** (≥ 768px):
  - Layout horizontal
  - Tablas legibles
  - Grid de tarjetas máximo 5 cols

### 2. Datos Vacíos
- Si no hay movimientos: Mostrar "No hay datos"
- Si no hay liquidaciones: Sección vacía elegante
- Si vendedor sin datos: Mensaje descriptivo

### 3. Carga de Datos
- Indicador de loading (spinner) mientras se cargan datos
- Error message si falla Supabase
- Retry automático en ciertos errores

### 4. Conversiones Numéricas
- NUMERIC desde Supabase → Number con parseNumericValue()
- Mostrado siempre con formatCurrency() en MXN
- Decimales: siempre 2

### 5. Formato de Fechas
- Todas las fechas en locale es-MX
- Formato: "2-digit month short year" ej: "15 Jul 2026"

### 6. Export CSV
- Clickear "Exportar CSV" en tabla de movimientos
- Debe descargar archivo con nombre: `commission_movements_[fecha].csv`
- Columnas: Fecha | Socio | Origen | Producto | Cantidad | Comisión/unidad | Comisión Total | Estado
- Datos: todas las filas filtradas actualmente

### 7. Color Scheme
- Fondo oscuro: #1C1A1A
- Primario mostaza: #F4C542
- Texto main: Blanco/gris claro
- Estados:
  - Verde: Available/Paid
  - Amarillo: Pending
  - Azul: Wholesale
  - Morado: Comodato
  - Gris: Cancelled/Other

## Casos de Error

### Supabase no configurado
- Debe mostrar: "Supabase no está configurado"

### Sin datos para mes/vendedor
- Campos vacíos pero interfaz funcional
- No crashes

### NUMERIC null/undefined
- parseNumericValue() convierte a 0
- No debe causar NaN en cálculos

### Mes futuro seleccionado
- Botón › debe estar deshabilitado
- setCurrentDate no se ejecuta

## Post-Testing

### Verificar en Console
```javascript
// No debe haber errores TypeScript
// En browser DevTools → Console
// Buscar errores rojos
```

### Performance
- Load inicial: < 2 segundos
- Navegación de meses: instant
- Cambio de vendedor: < 1 segundo
- Export CSV: < 500ms

### Build Final
```bash
npm run build
# Debe mostrar: ✓ built in 3.8x segundos
# Sin TypeScript errors
```

---

**Status**: ✅ Listo para testing manual
