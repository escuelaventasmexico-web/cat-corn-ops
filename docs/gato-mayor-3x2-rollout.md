# Promoción 3 × 2 Gato Mayor — orden de publicación

No desplegar el frontend antes del SQL: el historial y el checkout nuevos dependen de `promotion_group_id`, `pos_promotion_groups` y `create_gato_mayor_3x2_pos_sale`.

1. Ejecutar únicamente `supabase/verification/20261020_preflight_recalculate_sale_total.sql` y revisar la definición completa. Confirmar que el total de venta se calcula a partir de `sale_items.price * quantity` y que no vuelve a restar `discount_amount`. Si la semántica difiere, ajustar la migración antes de continuar.
2. Revisar el historial de migraciones remoto. No volver a ejecutar migraciones anteriores.
3. Aplicar una sola vez `supabase/migrations/20261020_gato_mayor_3x2_promotion.sql`.
4. Ejecutar `supabase/verification/20261020_verify_gato_mayor_3x2.sql`; exigir `all_checks_passed = true` en todas las filas.
5. Desplegar el frontend del mismo commit.
6. Con una sesión normal autorizada, comprobar lectura del historial y hacer ventas legítimas controladas en cada sucursal. No usar ventas ficticias en producción.
7. Verificar un grupo para Angélica, uno para Gerardo y uno para Administrador; comprobar respectivamente $5, $5 y $0. Probar después dos grupos ($10), un artículo externo y una devolución conforme al estado real de la comisión.

## Semántica persistida

- Cada bolsa promocional se guarda como una partida de cantidad 1.
- Dos bolsas conservan el precio vigente; la bolsa más barata se guarda con precio efectivo 0 y `discount_amount` igual a su precio de catálogo.
- Las tres partidas conservan el snapshot de costo mediante el trigger desplegado `snapshot_sale_item_cost`.
- Cada grupo tiene UUID estable y es la fuente de una sola comisión `pos_sale` de $5.
- Las partidas fuera del grupo siguen el generador normal de comisiones.
- En Chipitlán el token vive en `pos_promotion_checkouts`; no se escribe en `sales.checkout_token`.

## Limitación de inventario

El repositorio y la exportación inspeccionados no contienen un movimiento de existencias de producto terminado asociado al checkout POS. La promoción registra tres unidades entregadas en `sale_items`, igual que las ventas POS normales, pero no es correcto afirmar que descuenta un stock físico por sucursal. Esta migración no crea un subsistema de inventario nuevo.

## Reversión funcional

No borrar tablas ni columnas después de que existan ventas. Para desactivar la promoción, retirar primero la tarjeta del frontend y revocar temporalmente `EXECUTE` de la RPC. Las devoluciones existentes encuentran los eventos promocionales por `source_type = 'pos_sale'` y `source_id = sale_id`: pendientes/disponibles se cancelan; pagadas conservan historial y quedan marcadas para ajuste manual.
