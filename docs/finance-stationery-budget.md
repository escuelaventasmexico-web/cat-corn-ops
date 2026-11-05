# Presupuesto mensual de papelería

## Estado de producción

La migración de papelería fue ejecutada manualmente en Supabase el 5 de
noviembre de 2026. El verificador confirmó:

- `structural_checks_passed: true`
- `functional_calculation_checks_passed: true`
- `all_checks_passed: true`
- `november_limit_is_500: true`

El SQL exacto aplicado se conserva en:

`supabase/applied-manually/20261105120000_finance_stationery_budget.sql`

SHA-256:

`68b39b1028f24ef544bb1b71474d23d5a61e414a82792a733f4d8867f9769448`

El verificador de solo lectura permanece en:

`supabase/verification/20261105120000_verify_finance_stationery_budget.sql`

SHA-256:

`1f956a7cc11477d6234a3097155936c0c72de7f801bbd6fa78f3e7a54e622391`

No se debe copiar nuevamente la migración a `supabase/migrations`, ejecutar
`supabase db push` para ella ni volver a aplicarla en SQL Editor. La ejecución
manual no crea por sí sola una entrada en el historial administrado por
Supabase; mantener el archivo en `supabase/applied-manually` impide que una
ejecución automática futura intente repetirlo. Cualquier conciliación posterior
del historial remoto requiere un procedimiento explícito y revisado.

## Contrato funcional

- Noviembre de 2026 tiene un límite independiente de `$500 MXN`.
- La advertencia aparece desde `$400 MXN`, equivalente al 80%.
- Se permite alcanzar exactamente `$500 MXN`.
- Una captura o edición que proyecte más de `$500 MXN` se bloquea tanto en la
  interfaz como en el trigger transaccional de Supabase.
- Al editar, el cálculo excluye el importe anterior antes de sumar el nuevo.
- Sólo los gastos con `concept_code = 'STATIONERY'` consumen el presupuesto.
- Las compras a crédito consumen presupuesto al registrarse; el pago posterior
  de la tarjeta no se cuenta otra vez.
- Los gastos históricos sin concepto permanecen sin clasificar y no se asignan
  automáticamente a papelería.
- Los límites son independientes por mes y no se copian a meses futuros.

Papelería cubre, entre otros, hojas de sticker, tinta, hojas blancas y rollos
térmicos. No reutiliza `PACKAGING`, `SERVICES` ni `OTHER`.

## Publicación

El build de Vercel publica únicamente la interfaz; el repositorio no contiene
un paso de despliegue que ejecute esta migración. Después de publicar debe
comprobarse con una sesión autorizada que Finanzas muestre el límite de `$500`,
que “Nuevo gasto” ofrezca Papelería y que las simulaciones de `$400` y más de
`$500` se cancelen sin guardar movimientos ficticios.
