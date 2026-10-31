# Clasificación prospectiva de gastos

## Contrato

Los gastos manuales nuevos se capturan con un identificador estable de concepto
(`CORN`, `OIL`, `SEASONINGS`, `CARAMEL`, `PACKAGING`, `FUEL`, `SERVICES`,
`COMMISSIONS` u `OTHER`) y un destino (`AURRERA`, `CHIPITLAN` o `SHARED`).
`SHARED` describe una
sola compra central: la fila y su importe se registran una vez, sin reparto ni
duplicación por sucursal.

`category` queda como campo heredado de solo compatibilidad. No se usa para
deducir la clasificación nueva. Las filas que no tienen los campos nuevos se
muestran como **Pendiente de clasificar**.

Un gasto fijo vinculado hereda `fixed_costs.scope`. El formulario no vuelve a
pedir destino y el trigger comprueba el valor contra la obligación vigente. Un
gasto fijo no presupuestado sí requiere selección explícita de destino.

Las liquidaciones automáticas se reconocen únicamente por
`commission_settlement_id` y usan el concepto explícito `COMMISSIONS`. Su destino
se resuelve recorriendo todos sus eventos hasta la venta POS y el código estable
de sucursal:

- todos los eventos en Aurrera: `AURRERA`;
- todos los eventos en Chipitlán: `CHIPITLAN`;
- eventos resueltos en ambas sucursales: `MIXED`;
- cualquier evento no resoluble, canal sin sucursal o liquidación sin eventos:
  `UNKNOWN`.

`UNKNOWN` nunca se transforma en `SHARED`. Las liquidaciones siguen siendo una
sola fila protegida y no se reparten. La función generadora y los importes
financieros no se reemplazan.

Los gastos de comisiones protegidos que ya existan al instalar la fase 1 quedan
sin backfill, como cualquier histórico. Su trigger de protección impide una
edición manual posterior; resolverlos requeriría otra migración auditada, nunca
una inferencia por vendedor, nota o importe.

`type = 'OTHER'` conserva su significado financiero actual y es independiente
de `concept_code = 'OTHER'`. Las comisiones pueden seguir siendo tipo `OTHER`,
pero su concepto es `COMMISSIONS`.

## Orden de publicación compatible

1. Ejecutar el diagnóstico de solo lectura y revisar el esquema, las políticas,
   las funciones financieras y las funciones de liquidaciones.
2. Aplicar la migración transaccional. Es una expansión: no actualiza filas
   existentes y permite que la interfaz anterior siga guardando registros con
   clasificación pendiente.
3. Ejecutar el verificador de fase 1. Debe aprobar la estructura y mostrar por
   separado cantidad e importe pendientes; no declara clasificación completa.
4. Publicar la interfaz nueva. Desde ese momento su formulario exige concepto y
   destino; los registros transitorios creados por una versión anterior siguen
   visibles como pendientes.
5. Probar todos los capturadores: formulario manual, gasto fijo vinculado,
   cambio de tipo, gasto no presupuestado y liquidación automática.
6. Revisar humanamente cualquier pendiente creado durante la ventana de
   publicación. No inferirlo por proveedor, notas, importe o categoría heredada.
7. Sólo entonces mover el SQL de `supabase/pending` al historial oficial,
   aplicar la fase 2 y ejecutar su verificador. Desde ese momento todo `INSERT`
   manual incompleto falla; los históricos permanecen intactos, pero deben
   clasificarse antes de cambiar tipo, fecha u obligación fija.

Publicar la interfaz antes de la fase 1 no es compatible porque intentaría
escribir columnas que aún no existen.

La fase 2 se conserva deliberadamente fuera de `supabase/migrations`: un proceso
automático no debe aplicarla junto con la fase 1 antes de validar los
capturadores. Los reportes muestran `SHARED`, `MIXED` y `UNKNOWN` como grupos
separados; nunca reparten sus importes entre Aurrera y Chipitlán.

## Retiros y pagos personales

No se incorpora una clasificación automática para “personal Enrique”, “apoyo
mamá” ni textos semejantes. Concepto y destino describen gasto operativo, pero
no bastan para distinguir un gasto del negocio de un retiro de propietario o un
anticipo personal.

La separación futura necesita un contrato contable adicional, revisado con los
datos reales, por ejemplo `movement_nature` con estados equivalentes a gasto
operativo, retiro y anticipo personal. En esa etapa habría que cambiar de forma
coordinada las RPC: los retiros afectarían flujo de efectivo, pero no gastos ni
utilidad. Añadir esa opción ahora sin cambiar las funciones financieras haría
que un retiro siguiera reduciendo la utilidad, por lo que queda expresamente
fuera de esta migración.

## Decisiones que requieren datos reales

- Clasificación humana de cada fila heredada o transitoria pendiente.
- Naturaleza contable de retiros, apoyos o pagos personales y su tratamiento en
  caja, P&L y exportaciones.
- Rol autorizado para reclasificar historia. Las políticas actuales de escritura
  para usuarios autenticados se conservan hasta revisar los roles reales de
  captura.
- Revisar las liquidaciones que resulten `UNKNOWN`; sólo una definición contable
  explícita puede asignarles destino posteriormente.
