# Gastos de dirección operativa y destino Enrique

## Alcance prospectivo

La ampliación agrega el concepto estable `OPERATIONS_MANAGEMENT`, visible como
**Gastos dirección operativa**, y el destino manual estable `ENRIQUE`, visible
como **Enrique**. Ambos valores se consumen desde el catálogo compartido de
Finanzas, por lo que aparecen en captura, edición, filtros, tabla, desglose y
exportación sin mantener listas paralelas.

La migración no contiene `INSERT`, `UPDATE` ni `DELETE` sobre `expenses`. Los
registros históricos `OTHER` y los pendientes conservan exactamente su
clasificación e importe. La combinación nueva sólo existirá cuando una persona
la seleccione y guarde después de publicar el contrato.

`ENRIQUE` es un destino permitido para gastos manuales no vinculados. No se
agrega al ámbito de `fixed_costs`: una obligación fija vinculada sigue heredando
exclusivamente `AURRERA`, `CHIPITLAN` o `SHARED`. La clasificación automática de
comisiones continúa usando `COMMISSIONS`, destino presupuestal `SHARED` y su
origen operativo separado; el cliente autenticado sigue sin permiso para
escribir `commission_settlement_id`.

`OPERATIONS_MANAGEMENT` no forma parte de los conjuntos de insumos,
combustible, papelería o limpieza. Un gasto pagado con este concepto sí entra en
los cálculos generales vigentes de gastos, P&L y dinero disponible, exactamente
una vez y sólo después de que el usuario lo capture.

## Archivos SQL y orden seguro

La migración se aplicó manualmente en Supabase y se verificó satisfactoriamente
el 13/11/2026. El SQL exacto aplicado se conserva en
`supabase/applied-manually/20261111180000_add_operations_management_expense_classification.sql`
con SHA-256
`d768ca28d1c35eaa0e3b12eff0147f9e47628a4173081353e9a6bc1d913438e6`.
Se retiró de `supabase/migrations` para que una futura ejecución de
`supabase db push` no intente aplicarlo nuevamente.

1. No volver a ejecutar la migración ya aplicada ni modificar automáticamente
   el historial remoto de migraciones.
2. Conservar y, cuando sea necesario, ejecutar
   `supabase/verification/20261111180000_verify_operations_management_expense_classification.sql`.
   Es estrictamente de sólo lectura. Debe devolver `all_checks_passed = true` y
   reporta por separado los históricos `OTHER`, los pendientes y cualquier fila
   que ya use los nuevos valores.
3. Publicar la interfaz después de verificar el SQL. La interfaz anterior es
   compatible con la expansión y el contrato remoto ya admite los valores
   nuevos.
4. Probar sin datos ficticios la presencia de ambos selectores. La primera
   captura real debe ser decidida por el usuario.
5. Mantener el SQL archivado fuera de `supabase/migrations` antes de cualquier
   futura ejecución automática de migraciones.

No se modifica el historial administrado por Supabase automáticamente ni se
ejecutan migraciones desde el build de la aplicación.
