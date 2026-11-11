# Concepto de gastos de mantenimiento

Estado: aplicado manualmente en Supabase y verificado el 11 de noviembre de
2026; la interfaz correspondiente se incluye en la publicación de este cambio.

La ampliación agrega el identificador estable `MAINTENANCE`, presentado como
**Mantenimiento**, al catálogo prospectivo de gastos. No actualiza ni infiere
el concepto de filas históricas: los registros `OTHER` permanecen intactos
hasta que una persona los edite expresamente.

El formulario sugiere Mantenimiento cuando se selecciona una obligación fija
cuyo nombre o categoría corresponde a mantenimiento. La sugerencia es editable
y el destino continúa heredándose de la obligación seleccionada.

`MAINTENANCE` no forma parte de los conceptos de insumos, combustible,
papelería o limpieza. Por tanto, no consume esos presupuestos. Conserva el
tratamiento normal de un gasto para P&L y dinero disponible, según su fecha y
forma de pago, y aparece mediante el catálogo común en filtros, tablas,
desgloses y exportaciones.

## Registro de aplicación manual

La migración exacta aplicada está archivada en
`supabase/applied-manually/20261111120000_add_maintenance_expense_concept.sql`,
con SHA-256
`22eef79fcc9c8ea5f22dc693593722fa0c15f025f630f144f78727d1eab77924`.
Se retiró de `supabase/migrations` para impedir que `supabase db push` o un
flujo automático futuro intente repetirla.

El verificador de solo lectura
`supabase/verification/20261111120000_verify_maintenance_expense_concept.sql`
devolvió verdaderos `all_checks_passed`, `maintenance_concept_allowed`,
`manual_classification_enforcement_preserved`,
`commission_link_write_still_protected` y
`maintenance_isolated_from_special_budgets`. Su SHA-256 es
`716ebb6bf5ef370f93bb6558426c6c20e5721be9e442f354d67b59de719d7d4d`.

No se debe volver a ejecutar la migración. La reclasificación de gastos reales
permanece como una acción manual posterior; esta implementación no modifica
ninguna fila de `expenses`.

La migración aplicada sólo amplió la restricción de `concept_code`; no reemplazó
funciones financieras, no modifica permisos y no altera la protección de
`commission_settlement_id`.
