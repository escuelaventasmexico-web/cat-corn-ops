# Finanzas — paso 2: obligaciones de gastos fijos

Estado: la migración corregida fue ejecutada manualmente en Supabase y su
verificador devolvió `all_checks_passed = true`. El repositorio conserva la
misma versión exacta; no se modificaron pagos históricos.

## Diagnóstico confirmado el 30 de octubre de 2026

### Modelo desplegado

- `fixed_costs` sólo guarda `id`, `name`, `amount_mxn`, `active`, `notes`,
  `created_at` y `created_by`. No distingue sucursal, periodicidad, vigencia,
  provisión mensual ni importe pendiente de confirmar.
- `expenses.fixed_cost_id` ya existe y tiene FK hacia `fixed_costs(id)`, pero el
  formulario de gastos no carga el catálogo ni muestra un selector. El valor se
  envía siempre como `null` para gastos nuevos que no llegaron ya vinculados.
- Las políticas actuales permiten `ALL` sobre ambas tablas a cualquier usuario
  `authenticated`. El módulo Finanzas sólo está habilitado para `admin` en
  `AuthContext`, pero no está confirmado qué otros flujos legítimos escriben
  gastos. Por eso esta migración conserva RLS sin cambios y aplica únicamente
  integridad estructural; el endurecimiento de permisos queda condicionado a
  un inventario de roles y escritores automáticos.
- `finance_month_summary` suma todos los conceptos `active` como plan del mes,
  suma todos los gastos `FIXED` como pagados y calcula:

  `fixed_pending_mxn = GREATEST(fixed_plan_mxn - expenses_fixed_mxn, 0)`

  No verifica `fixed_cost_id`, no concilia obligación por obligación y utiliza
  el catálogo activo actual incluso al consultar otro mes.

### Catálogo actual

| ID | Concepto | Importe | Observación |
|---|---:|---:|---|
| `46a6d8f9-780e-4f20-b539-1cfc05052881` | Contador | $1,000 | Sin ámbito |
| `27ed5bd7-d5d5-4ce7-b88e-42be50cecfb8` | INTERNET | $500 | Sin ámbito |
| `bab55c5c-c117-41ee-8b66-a7e33da99eab` | LUZ | $1,190 | Nota de peor escenario; sin ámbito |
| `75321c6e-d834-48be-93e0-d98b35a164a2` | Renta | $6,900 | Sin ámbito |

Total activo: **$9,590**.

No se debe convertir ninguno de estos registros en una obligación nueva por
coincidencia de nombre. La propuesta los conserva como catálogo legado,
`UNASSIGNED`, con vigencia hasta el 31 de octubre de 2026.

### Gastos fijos de octubre

Los seis registros suman **$13,670** y todos tienen `fixed_cost_id = NULL`.
Por tanto, la cantidad de vínculos estructuralmente confirmados es cero.

| Fecha | Importe | Categoría / proveedor / nota | Diagnóstico |
|---|---:|---|---|
| 10 oct | $6,960 | Renta / Claudia | Revisión humana: difiere $4 de la renta conocida de Chipitlán y no contiene ámbito estructurado. |
| 11 oct | $360 | Seguro auto / BBVA | Revisión humana: no existe en la lista conocida; decidir si es obligación fija, gasto de vehículo u otro concepto. |
| 17 oct | $1,200 | Servicios / totalplay | Revisión humana: podría agrupar más de un servicio; un gasto sólo admite un `fixed_cost_id`. |
| 20 oct | $1,250 | Nómina / Angélica / “Pago 1/2” | Candidato fuerte a nómina Angélica, pero requiere confirmación explícita porque la evidencia sólo está en texto libre. |
| 29 oct | $3,500 | Nómina / Gerardo Asbeury | Candidato fuerte a nómina Gerardo, pero requiere confirmación explícita porque no tiene FK. |
| 30 oct | $400 | Servicios / totalplay / “internet Chipitlán” | Candidato fuerte a Internet Chipitlán; requiere confirmación y explicación de la diferencia contra $440. |

Ningún `UPDATE` histórico forma parte de la propuesta. Los tres candidatos
fuertes tampoco se vinculan automáticamente: deben aprobarse uno por uno si en
el futuro se decide corregir octubre.

La razón exacta del pendiente actual de $0 es:

`GREATEST($9,590 - $13,670, 0) = $0`

Un pago sin relación puede cubrir artificialmente cualquier obligación, e
incluso un exceso en una obligación oculta el faltante de otra.

## Obligaciones propuestas desde noviembre de 2026

| Ámbito | Obligación | Pago contractual | Periodicidad | Provisión mensual |
|---|---|---:|---|---:|
| Aurrera | Renta | $5,000 | Mensual | $5,000 |
| Aurrera | Mantenimiento del local | $1,624 | Mensual | $1,624 |
| Aurrera | Internet | $500 | Mensual | $500 |
| Aurrera | Luz | Desconocido | Mensual | Desconocida |
| Chipitlán | Renta | $6,964 | Mensual | $6,964 |
| Chipitlán | Internet | $440 | Mensual | $440 |
| Chipitlán | Luz | $990 | Bimestral | $495 |
| Compartido | Nómina Angélica | $2,500 | Mensual | $2,500 |
| Compartido | Nómina Gerardo | $3,500 | Mensual | $3,500 |
| Compartido | Contador | $1,000 | Mensual | $1,000 |

Total mensual conocido: **$22,023**. La luz de Aurrera debe permanecer `NULL`
y visible como configuración incompleta; nunca debe convertirse en cero.

El mes de cobro de la luz de Chipitlán aún necesita un mes ancla. Mientras no
se confirme, la provisión mensual sí es $495, pero la interfaz debe marcar el
calendario bimestral como pendiente de configuración.

El pago Enrique de $6,000 se mantiene únicamente como escenario visual de
flujo: **$28,023**. No se inserta en `fixed_costs`, no crea un `expense` y no
afecta P&L hasta decidir si es remuneración o retiro.

## Implementación preparada

La migración exacta aplicada está en
`supabase/migrations/20261030210000_finance_fixed_cost_obligations.sql`. El
catálogo, sus restricciones y el reemplazo completo de
`finance_month_summary` están dentro de una sola transacción. Un preflight
valida el MD5 confirmado, los cuatro IDs y los seis gastos de octubre antes de
realizar cualquier cambio. No debe volver a ejecutarse.

La implementación amplía `fixed_costs` con:

- código estable de obligación;
- ámbito `CHIPITLAN`, `AURRERA`, `SHARED` o legado `UNASSIGNED`;
- periodicidad e intervalo de pago;
- importe contractual nullable;
- provisión mensual nullable;
- vigencia desde/hasta;
- mes ancla para pagos bimestrales;
- estado de configuración.

`expenses.fixed_cost_id` sigue siendo el vínculo explícito. Para gastos fijos
nuevos, la interfaz exige selección humana o la excepción explícita “no
presupuestado” con motivo. No se usa `vendor`,
`category`, `notes` ni el importe como llave de conciliación.

El detalle mensual calcula por obligación:

- provisión del mes;
- pago vinculado durante el mes;
- provisión acumulada desde el inicio de vigencia;
- pagos acumulados vinculados;
- saldo pendiente acumulado;
- crédito o anticipo, sin compensarlo contra otra obligación;
- pago contractual esperado sólo cuando el calendario está configurado.

Para octubre y meses anteriores, `finance_month_summary` conserva el total de
gastos registrado pero devuelve `LEGACY_UNRECONCILED` y no calcula un falso
saldo global por pagar. Desde noviembre consume el detalle por obligación. El P&L
continúa sumando todos los gastos `FIXED` efectivamente pagados, incluso los no
vinculados; estos últimos se muestran aparte y no cubren el presupuesto.

## Interfaz implementada localmente

### Catálogo de gastos fijos

- Se añadieron columnas Ámbito, Periodicidad, Pago contractual, Provisión mensual,
  Vigencia y Estado de configuración.
- Mostrar la luz de Aurrera como “Importe pendiente”, no `$0`.
- Mostrar la luz de Chipitlán como `$990 bimestral / $495 provisionado al mes`
  y solicitar su mes ancla.
- Sustituir eliminación física por “Cerrar vigencia”. Los registros usados o
  históricos no se borran.

### Captura de gastos

- Si el tipo es `FIXED`, mostrar un selector obligatorio con las obligaciones
  vigentes para la fecha del gasto.
- Mostrar ámbito, periodicidad e importe esperado junto a la opción.
- Permitir pagos parciales y diferencias sin compensar una obligación con otra.
- Si un comprobante agrupa varias obligaciones, se debe dividir en varios
  gastos; nunca se elige una obligación por texto.
- Los gastos automáticos de comisiones conservan su protección actual.

### Resumen de Finanzas

- Tarjetas separadas: “Apartar este mes”, “Pagos que vencen este mes” y
  “Pagos registrados”.
- Tabla por obligación con ámbito, provisión, pago del mes, pendiente y crédito.
- Alertas independientes para importe desconocido y calendario pendiente.
- No permitir que un sobrepago cubra visualmente otra obligación.
- Añadir un control no persistente “Escenario Enrique +$6,000”, separado de las
  cifras contables y de la exportación oficial.

## Pruebas locales y posteriores a la instalación

1. El plan conocido desde noviembre suma exactamente $22,023 y reporta una
   obligación con importe desconocido.
2. Octubre conserva $13,670 registrados, reporta seis gastos sin vínculo y se
   muestra como `LEGACY_UNRECONCILED`; no se afirma que todo esté pagado.
3. Un pago de Gerardo no reduce el pendiente de renta, luz ni otro concepto.
4. Dos pagos parciales de Angélica por $1,250 cubren únicamente su obligación
   mensual de $2,500.
5. Luz Chipitlán acumula $495 por mes: un pago bimestral de $990 deja crédito de
   $495 el primer mes y saldo cero al cerrar el segundo.
6. Luz Aurrera aparece como desconocida y no participa como cero en el total.
7. Desde noviembre, un gasto `FIXED` requiere vínculo o la marca explícita “no
   presupuestado”; ambos siguen contando en P&L.
8. Cambiar un importe crea una nueva versión con otra vigencia y no modifica
   meses cerrados.
9. El escenario Enrique muestra $28,023, pero no cambia RPC, P&L, exportación ni
   tablas.
10. La consulta posterior lista las políticas vigentes para auditar roles antes
    de cualquier cambio de RLS; esta implementación no restringe todavía a los
    escritores autenticados existentes.
