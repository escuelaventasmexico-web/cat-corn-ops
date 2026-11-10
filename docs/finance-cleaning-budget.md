# Presupuesto mensual de limpieza

Estado: aplicado manualmente en Supabase y verificado el 6 de noviembre de 2026; interfaz pendiente de publicación al registrar este documento.

La implementación agrega el concepto estable `CLEANING` y un presupuesto mensual independiente. Noviembre de 2026 se configura en $350 MXN sin sobrescribir un límite existente. No se infieren conceptos para gastos históricos ni se modifican filas de `expenses`.

La advertencia comienza al 80% del límite ($280 en noviembre). Rebasar el límite se informa en rojo, pero no bloquea el registro del gasto real. Las compras a crédito consumen presupuesto al registrar el gasto; los pagos posteriores de tarjeta quedan fuera del cálculo.

## Registro de aplicación manual

La migración exacta aplicada está archivada en `supabase/applied-manually/20261106120000_finance_cleaning_budget.sql`, con SHA-256 `4d99d146b4095da1546f7b30af0c3640b5616cd04b3982d39dc161e9da2c054a`. Se retiró de `supabase/migrations` para impedir que un flujo futuro de migraciones automáticas intente repetirla.

El verificador de solo lectura `supabase/verification/20261106120000_verify_finance_cleaning_budget.sql` devolvió verdaderos `structural_checks_passed`, `functional_calculation_checks_passed`, `all_checks_passed` y `november_limit_is_350`. Su SHA-256 es `0cdb2618a65cd04dddd3bd2219ca26c1dff0ea1648b5f264d129f6280b6bf973`.

No se debe volver a ejecutar la migración ni usarla mediante `supabase db push`. La interfaz puede publicarse contra el contrato remoto ya comprobado. La revisión visual debe simular —sin guardar— una proyección de $280 y otra superior a $350.
