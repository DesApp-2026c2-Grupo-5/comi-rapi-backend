# Emisiones de cupones: selección y envío

Este documento complementa el flujo original de emisiones (producto/categoría →
período de análisis → clientes que más compraron → emisión). No reemplaza ni
modifica el modelo aprobado.

## Esquema

El módulo conserva únicamente tres tablas: `CuponEmisiones`, `Cupones` y
`PedidoCupones`. El alcance por productos/categorías vive congelado en
`CuponEmisiones.configuracionSnapshot.alcance` y en `Cupones.alcanceSnapshot`;
la clasificación de clientes y la cantidad mínima, en
`configuracionSnapshot.seleccion`; y el historial de compras se calcula desde
`Pedidos` y `PedidoItems`. Programación y reenvíos se apoyan en las fechas y en
`estadoEnvio` de `Cupones`, sin tablas auxiliares.

El preview de un solo uso se persiste como hash SHA-256 en
`CuponEmisiones.previewTokenHash` (UNIQUE); los metadatos (`usado`, `creadoEn`,
`expiraEn`, `usadoEn`) quedan en `configuracionSnapshot.previewToken`. El token
en claro nunca se guarda.

## Selección automática de destinatarios

- El orden es el original: se cuentan unidades de los productos alcanzados en
  pedidos `ENTREGADOS` del período y se ordena de mayor a menor, desempatando
  por última compra y por ID.
- `tiposCliente` es obligatorio. El formulario permite **una sola opción** de
  `NUEVO`, `ACTIVO` o `INACTIVO`; si falta se responde 400
  `tipo_cliente_requerido`. La API, en cambio, acepta varios tipos y los
  normaliza (sin repetidos, en orden canónico): no se duplican destinatarios ni
  cupones.
  - `NUEVO`: usuario registrado dentro del período de análisis. Su regla no
    cambió.
  - `ACTIVO`: cliente con **al menos un pedido `ENTREGADO` dentro del período**,
    sin importar qué productos o categoría compró.
  - `INACTIVO`: cliente **sin pedidos `ENTREGADOS` dentro del período** pero con
    al menos uno anterior. No se incluye dentro de `ACTIVO`.
- `NUEVO` y `ACTIVO` **no son excluyentes**: un cliente registrado dentro del
  período que además compró en ese período pertenece a ambos. Un cliente nuevo
  sin pedidos es sólo `NUEVO`. Si por API llegan varios tipos a la vez, se
  calcula una sola fila por cliente (con un array `tiposAplicables` y una sola
  etiqueta `tipoCliente`) y se emite un solo cupón.
- `periodoAnalisisDias` también es obligatorio
  (`periodo_requerido_para_tipos`). El service conserva internamente el
  criterio original para llamadas sin tipos, pero la API y el formulario ya no
  lo permiten.

### Fuente de datos de la clasificación

- La clasificación se calcula con la **actividad general** de pedidos
  `ENTREGADOS`: se comprueba si el cliente tiene pedidos dentro del período
  (`ACTIVO`) o sólo antes del período (`INACTIVO`). No se filtra por los
  productos o categorías del cupón.
- La elegibilidad por productos/categorías se calcula aparte, con las líneas de
  `PedidoItem` de los productos resueltos: es lo que alimenta el mínimo de
  unidades, el ranking y la columna informativa. Los combos (`tipo='COMBO'`)
  siguen excluidos del cómputo de unidades, aunque un pedido de combos sí
  demuestra actividad general.
- Para el desglose informativo, las líneas anteriores incluyen productos hoy
  dados de baja: la baja es posterior a la compra y no borra el historial.
- No se usa ninguna métrica agregada: no conserva el detalle por producto/fecha
  que la regla necesita.
- Sólo cuentan los pedidos `ENTREGADOS`. Los pendientes, cancelados y fallidos
  (y cualquier otro estado) no son compras realizadas. `ENTREGADO` y
  `CANCELADO` son estados finales según `lib/services/estados_pedido.js`.
- Las unidades compradas antes del período (`unidadesPrevias`) y dentro del
  período (`unidades`) se calculan en consultas separadas y se exponen junto con
  `unidadesHistoricas` en el preview. No intervienen en la clasificación, que se
  decide con la actividad general de pedidos entregados.

- `minUnidadesCompradas` es opcional y distinto de `compraMinima` (que es un
  monto para usar el cupón). Cuenta unidades de los productos o categorías
  alcanzados en pedidos `ENTREGADOS`, según el tipo de cliente resultante:

  - `ACTIVO` (y `NUEVO`): **sólo unidades dentro del período de análisis**. Las
    compras anteriores no se suman: con mínimo 4 y período de 7 días, quien
    compró 1 unidad en el período y 9 antes queda excluido.
  - `INACTIVO`: **unidades históricas** (`unidadesHistoricas`, período más
    anteriores; para un inactivo las unidades del período son 0). Con mínimo 2
    se elige a quien compró 2 unidades del cupón en el pasado. Aplicar el
    criterio del período dejaría fuera a todos los inactivos.

  El preview y la emisión definitiva usan el mismo criterio, porque la emisión
  respeta los destinatarios firmados en el preview. Quien no alcanza el mínimo
  según su tipo no recibe el cupón.

- El orden y el corte por `maxDestinatarios` se mantienen: primero por unidades
  compradas **en el período** (lo que conserva el ranking original), luego por
  última compra y por ID.

Los campos nuevos viajan en el `configuracionSnapshot` de la emisión
(`seleccion.tiposCliente` y `seleccion.minUnidadesCompradas`) y forman parte del
hash del `previewToken`, por lo que no se pueden alterar entre la vista previa y
la confirmación.

## Cupones programados

- Una emisión cuya `fechaInicio` es futura crea los cupones con
  `estadoEnvio: PENDIENTE` y `enviadoEn: null`, pero **no envía correos**.
- `lib/services/cupon_programado_vigia.js` (arrancado desde `bin/www.js`) llama
  periódicamente a `lib/services/cupon_programados.js`. Cuando ya pasó la fecha
  de inicio, envía el correo con `enviarEmailCupon` y marca el cupón como
  `ENVIADO` en la misma transacción.
- La idempotencia se apoya en `estadoEnvio`/`enviadoEn` y en un bloqueo
  `FOR UPDATE`: reintentos, reinicios y pasadas concurrentes no generan correos
  duplicados. Los cupones cancelados (`activo: false`), programados o vencidos
  nunca se envían.
- `reenviarEmision` rechaza emisiones todavía programadas (409,
  `motivo: emision_programada`) y sólo reenvía cupones vigentes.

## Visibilidad en "Mis cupones"

`GET /api/cupones/mios` (`listarCuponesCliente`) devuelve **sólo cupones con
`estadoEnvio: ENVIADO`**: el cupón existe para el cliente recién cuando salió
el correo. Los programados (`PENDIENTE`) y los fallidos (`FALLIDO`) no aparecen
en "Mis cupones" ni en el selector del carrito, que lee la misma respuesta.
`estadoEnvio` se marca `ENVIADO` en la misma transacción que confirma el envío,
así que no hay ventana intermedia. Cuando el vigía activa un programado, avisa
por socket y la pantalla se reconsulta sola, sin recargar.

## Recibo de pago

El comprobante (PDF y email) muestra el **nombre de la emisión** del cupón, no
su código. Al crear el pedido se guarda ese nombre como snapshot en
`PedidoCupon.nombre`, junto al código y las condiciones de descuento, para que
el recibo sea reconstruible sin consultar la emisión actual. Los usos anteriores
al agregado de la columna se completan desde su emisión en la migración
`20261123000002-agregar-nombre-pedido-cupon.js`.

## Actualización en tiempo real

El canal Socket.IO **solo avisa**; no reemplaza a REST ni cambia ninguna regla
de negocio. Los emisores viven en `lib/realtime/index.js` y se llaman siempre
**después del commit**:

| Evento                | Destino                        | Payload (solo IDs)        |
| --------------------- | ------------------------------ | ------------------------- |
| `emision_actualizada` | `admins` (SUPERADMINISTRADOR)  | `{ emisionId, cuponId? }` |
| `cupon_actualizado`   | `usuario:{id}` del propietario | `{ cuponId, emisionId? }` |

Se emite al crear o reenviar una emisión, al activarla automáticamente el vigía
de programadas, al dar de alta/baja un cupón (solo si `activo` cambió) y en el
ciclo de vida del pedido: reserva al crearlo, confirmación o liberación al pagar
y liberación por cancelación manual, cierre de sucursal o vencimiento de la
reserva. En creación, reenvío y vigía, el aviso al cliente va **sólo por los
cupones que quedaron `ENVIADO`**: los programados y los fallidos no aparecen en
"Mis cupones" y no generan refrescos. Las operaciones idempotentes que no
cambian filas no emiten nada.

Los invitados y otros clientes no reciben estos eventos: no hay broadcasts con
datos de cupones ni salas `cupon:{id}` / `emision:{id}` nuevas. El detalle se
sigue leyendo por REST.

En el frontend, `RealtimeBridge.jsx` escucha `emision_actualizada` sólo como
SUPERADMINISTRADOR y `cupon_actualizado` sólo como CLIENTE. Invalida
`emisionesListaPrefix`, `emision(id)`, `emisionCupones(id)`,
`cuponesListaPrefix`, `cupon(id)` y `cuponesCliente` según corresponda; en la
reconexión repite las invalidaciones por prefijo —incluidos los detalles de
emisión y cupón— para recuperar avisos perdidos.
`MisCupones` y el carrito comparten `cuponesCliente`, por lo que ven el estado
nuevo sin recargar. `CrearEmision.jsx` usa `useCrearEmision`, que ya invalida el
listado de emisiones y de cupones al crear, sin duplicar invalidaciones locales.

Detalle completo del canal: `docs/webSocketContext.md` §6.9.
