# Dinero disponible — etapa 1

Esta etapa agrega un indicador de liquidez separado de ventas, utilidad, P&L y
presupuesto fijo. No modifica `finance_month_summary` ni reclasifica registros
históricos.

## Fórmula

Desde el punto de corte capturado por el usuario:

```text
saldo conocido = saldo inicial
               + cobros POS
               + cobranza B2B confirmada
               + cobros confirmados de Pedidos
               - gastos con pago inmediato
               - pagos reales de tarjeta de crédito
```

- `CARD` en ventas POS es Mercado Pago y está disponible al cobrarse.
- Una compra nueva con `CREDIT_CARD` entra al gasto/P&L, pero no reduce la
  liquidez hasta registrar su pago total o parcial.
- Un pago de tarjeta reduce liquidez y no inserta otro gasto.
- Un pago registrado es inmutable. Una corrección conserva la fila como
  `REVERSED`, con usuario, fecha y motivo, y después requiere un pago nuevo.
- El saldo inicial no es venta ni utilidad.
- El corte de noviembre usa `cutoff_business_date = 2026-11-01`. No se inventa
  una hora: cada movimiento de ese día se confirma como `BEFORE_OPENING`
  (ya incluido en el saldo) o `AFTER_OPENING` (ocurrió después del saldo).
- POS y Pedidos cobrados se agrupan por la fecha de `sales.created_at` en
  `America/Mexico_City`; gastos y
  pagos de tarjeta usan su fecha económica, nunca la hora en que se capturaron.
- Pedidos sólo entra cuando el flujo **Cobrar pedido** crea una venta con
  `sale_origin = 'order'`. La fila se cuenta una vez y conserva su desglose de
  efectivo, tarjeta y transferencia; pedidos pendientes, preparados,
  cancelados o estimados no crean esa venta y no se suman.

## Cuándo no se afirma un saldo exacto

La RPC devuelve `INCOMPLETE`, conserva sólo el saldo conocido y deja
`available_mxn` en `NULL` cuando detecta cualquiera de estos casos posteriores
al corte:

- gasto sin tratamiento de liquidez;
- venta POS devuelta sin una salida de reembolso explícita;
- cobro de pedido con un método que todavía no pueda conciliarse con liquidez;
- delivery, porque todavía no existe liquidación real de plataforma;
- método POS no soportado;
- movimiento del mismo día del saldo inicial todavía sin confirmar como antes
  o después.

Los gastos históricos `CARD` permanecen pendientes: no se infiere si fueron
débito, crédito o Mercado Pago. Los retiros de caja no se consideran por sí
mismos una salida del dinero de la empresa; son cambio de custodia, salvo que
exista un movimiento económico clasificado por separado.

## Acceso

Las cuatro tablas nuevas y `finance_month_available_funds` sólo exponen datos
a perfiles activos con rol `admin`, que es el rol que el frontend actual
autoriza para el módulo Finanzas. La clave financiera secundaria permanece como
protección adicional de interfaz; no se usa como credencial de base de datos.

## Orden seguro de aplicación

1. Ejecutar únicamente la consulta de diagnóstico
   `supabase/diagnostics/20261101_diagnose_available_funds_stage1.sql`.
2. Revisar los resultados ambiguos. Para noviembre, el usuario capturará los
   `$10,010` con corte `2026-11-01`. Después marcará como `AFTER_OPENING` los
   tres pagos reales de `$5,000`, `$1,000` y `$390`, y las cuatro ventas POS
   identificadas por `$285`; cualquier otro movimiento del día queda pendiente
   de revisión. No se solicita una hora ni se usa la hora de captura.
3. La migración base ya fue aplicada manualmente y verificada en Supabase. No
   volver a ejecutarla ni usar `supabase db push` para esta etapa. Su SQL exacto
   queda archivado en
   `supabase/applied-manually/20261101090000_finance_available_funds_stage1.sql`.
4. Ejecutar en SQL Editor el verificador estructural y de datos de solo lectura
   `supabase/verification/20261101090000_verify_finance_available_funds_stage1.sql`.
5. En una transacción separada, ejecutar el verificador autenticado con
   `ROLLBACK` `supabase/verification/20261101091000_verify_finance_available_funds_authenticated.sql`.
   Valida permisos reales, los tres pagos y `$3,920 - $4,940 = -$1,020` sin
   conservar sus filas de prueba.
6. Publicar la interfaz y comprobar con una sesión administradora que se puedan
   guardar saldo/corte, tarjetas y pagos, sin crear movimientos ficticios.
7. Clasificar manualmente sólo los gastos reales posteriores al corte que el
   panel señale; no inferir registros anteriores.
8. Cuando todos los capturadores estén actualizados, revisar y aplicar
   `supabase/pending/20261101100000_enforce_expense_liquidity_classification.sql`.
   Este archivo permanece fuera de `supabase/migrations` para impedir una
   activación automática prematura.
9. Repetir el verificador. `exact_liquidity_classification_complete` debe ser
   verdadero antes de tratar el resultado como saldo exacto.

Ningún SQL de esta etapa debe aplicarse desde un despliegue del frontend sin la
revisión manual indicada arriba.

## Estado de aplicación manual

La migración de etapa 1 fue ejecutada manualmente en Supabase antes de publicar
la interfaz y sus comprobaciones principales devolvieron `true`. Se conserva
fuera de `supabase/migrations` porque una ejecución desde SQL Editor no crea por
sí sola una entrada en el historial administrado de migraciones. Mantenerla en
`supabase/applied-manually` evita que un futuro descubrimiento automático la
intente reproducir.

No debe copiarse de nuevo a `supabase/migrations`. Si más adelante se desea
incorporarla al historial oficial, primero debe conciliarse explícitamente la
versión remota como ya aplicada mediante un procedimiento revisado; este cambio
no altera automáticamente el historial remoto. El repositorio no contiene un
workflow que ejecute migraciones durante el build de Vercel.

## Ajuste aplicado: decisión POS conjunta y comisiones

La migración fue aplicada manualmente en Supabase y su verificador confirmó
`structural_checks_passed: true`, el ajuste único de Gerardo sin cambio de
importe y un saldo calculado de `$3,805`. No debe ejecutarse nuevamente.
El SQL aplicado se conserva en
`supabase/applied-manually/20261101220000_available_funds_pos_defaults_commission_liquidity.sql`
con SHA-256
`d421aa3ceb1df9e4a0c13cb44b73e03a5fc546aa6789409956b201d26988d5a2`.
Permanece fuera de `supabase/migrations` para que un descubrimiento automático
no intente reproducir una ejecución hecha desde SQL Editor. No debe copiarse a
esa carpeta ni ejecutarse con `supabase db push`; cualquier conciliación futura
del historial remoto requiere un procedimiento revisado y explícito.

- Las ventas POS del día del saldo inicial reciben una sola regla conjunta
  `BEFORE_OPENING` o `AFTER_OPENING`. Una decisión individual conserva prioridad
  como excepción auditable y puede eliminarse para volver a la regla conjunta.
- La regla conjunta de noviembre se prepara como `AFTER_OPENING`, conforme a la
  confirmación de la usuaria. Los cobros POS posteriores siguen entrando una
  sola vez; `CARD` continúa representando Mercado Pago disponible de inmediato.
- Las liquidaciones automáticas continúan creando exactamente un gasto mediante
  la relación única `commission_settlement_id`. Efectivo y transferencia son
  salida inmediata; no se crea una segunda fila de gasto ni se altera el P&L.
- `COMMISSIONS` se agrupa presupuestalmente en `SHARED` y en el grupo Nómina
  junto con `PAYROLL`. La sucursal que originó los eventos se conserva aparte en
  `commission_origin_scope` (`AURRERA`, `CHIPITLAN`, `MIXED` o `UNKNOWN`).
- El gasto protegido de Gerardo por `$100` no se edita. La migración exige un
  único gasto automático de ese importe, pagado en efectivo y ya conciliado
  `AFTER_OPENING`, y añade un evento de liquidez inmutable e idempotente. Así se
  descuenta una vez y el verificador reconcilia el saldo esperado de `$3,805`.

El verificador de solo lectura está en
`supabase/verification/20261101220000_verify_available_funds_pos_defaults_commission_liquidity.sql`.
La obligatoriedad general futura de liquidez permanece separada en
`supabase/pending/20261101100000_enforce_expense_liquidity_classification.sql`.

## Cobros de Pedidos

La ampliación compatible agrega `finance_month_available_funds_v2(date)` y
mantiene la RPC anterior para que una versión previa de la interfaz continúe
funcionando durante el despliegue. La V2 reutiliza todo el cálculo existente y
suma una fuente separada `order_collections_mxn`; no modifica ventas, pedidos,
gastos, saldos ni las fórmulas de P&L.

El SQL se conserva fuera de `supabase/migrations` en
`supabase/applied-manually/20261110150000_finance_available_funds_order_collections.sql`.
Fue aplicado manualmente en Supabase el 10/11/2026 y no debe volver a
ejecutarse. Su SHA-256 exacto es
`0d216474e6745c7d580030f68de237669065af9d2394ea24bfd7edd17d13186b`.
Su verificador de solo lectura es
`supabase/verification/20261110150000_verify_finance_available_funds_order_collections.sql`.
El verificador confirmó el caso real de cuatro cobros por `$268` (`$124` en
efectivo y `$144` por transferencia), sin IDs duplicados ni filas clasificadas
simultáneamente como POS.
No debe ejecutarse mediante `supabase db push` ni copiarse a la carpeta de
migraciones automáticas.
