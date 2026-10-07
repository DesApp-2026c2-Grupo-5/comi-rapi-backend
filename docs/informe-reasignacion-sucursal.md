# Informe — Reasignación de sucursal (T4 manual + corrección de la automática)

Fecha: 2026-10-07
Rama: `feat/pedidos`
Alcance: reasignación manual por admin (T4 del plan maestro) y corrección de la reasignación automática al confirmar el pago.
Reglas vigentes: `reglas-negocio.md` §6, §20.1 (D1), §20.3, §20.4.

## 1. Problema reportado

Pedido entregado en **AV GDOR VERGARA 3430, Hurlingham**, inicialmente asignado a **sucursal vergara** (~1 km). Antes de pagar, el admin apaga el producto en vergara (`disponible = false`): la reserva del pedido vence. Al pagar, el pedido termina reasignado a **sucursal palermo** (~20 km, fuera del radio de 5 km), cuando la alternativa correcta era **sucursal oeste** (<5 km, con stock).

## 2. Diagnóstico (causa raíz)

La reasignación automática al confirmar el pago NO usaba las reglas D1. `cambiarEstado` → `buscarSucursalConTodo` elegía con `asignarSucursalOptima` (lógica legada pre-T1): **menor cantidad de pedidos pendientes entre TODAS las sucursales activas**, empate por menor id — sin cobertura, sin distancia, sin coordenadas. Palermo ganó por ese criterio y, al estar fuera del radio, la reasignación violaba §6 ("ordenar por proximidad… si ninguna puede, el pedido no se confirma") y §20.1 (D1: cobertura hard). La asignación inicial (T1) sí cumplía D1: dos lógicas distintas para el mismo concepto.

## 3. Solución

**Una sola fuente de verdad.** La reasignación automática ahora delega en `seleccionarSucursal` (el service de T1), con un parámetro nuevo `exceptoSucursalId` para excluir la sucursal original (su reserva venció, ya no es elegible). Cambios:

- `lib/services/seleccion_sucursal_service.js`: `exceptoSucursalId` + cuando ninguna candidata tiene stock, el `SinSucursalElegibleError` lleva los `faltantes` de la **mejor candidata** (menos productos faltantes; empate → más unidades — conserva el desempate que vivía en el controller, regresión "quedan 4 vs quedan 10").
- `lib/controllers/pedido_controller.js` (confirmación): reasignación vía service; `SinSucursalElegibleError` → `StockInsuficienteError` (**409**, contrato existente del pago bloqueado; sin candidatas evaluadas se informa qué productos perdieron su reserva). El 422 del POST /pedidos también informa los faltantes cuando los hay. Eliminados los helpers muertos (`buscarSucursalConTodo`, `sucursalesConStock`, `faltantesEnSucursalMasProvista`, `quedaMasCerca`, `unidadesFaltantes`, `sucursalesActivas`, `pedidosPendientes`).
- `lib/services/asignacion_sucursal.js`: **eliminado** (su único consumidor era el path defectuoso; el espejo mock del frontend `src/services/asignacionSucursal.js` es otro archivo, ajeno a este cambio).

**Pago sin sucursal posible**: no se agrega ningún estado ni reembolso. El pago simulado ES la transición `pendiente→confirmado`; si ninguna sucursal en cobertura puede armar el pedido, la transacción no se confirma (409), el pedido queda `pendiente` con su sucursal/stock originales y el cliente puede cancelarlo. No existe el estado "pagado sin sucursal".

## 4. T4 (reasignación manual, commiteada aparte)

`PATCH /api/pedidos/:id/sucursal` (solo ADMIN; `pendiente|confirmado|en_preparacion`): valida activa (404) + cobertura por ruta desde el snapshot (422) + stock (409) + no la misma sucursal (400); transfiere la reserva atómicamente, registra trazabilidad en `PedidoEstadoHistorial` y recalcula el ETA (degradación si ORS falla). UI en `PedidosPendientes.jsx`, aviso al cliente en `DetallePedido.jsx`/`ListaPedidos.jsx`.

## 5. Tests

- `seleccion_sucursal_service.test.js` (nuevos): exclusión por `exceptoSucursalId` (caso Vergara→Oeste), no se consulta el stock de la excluida, todas excluidas → error sin faltantes, faltantes de la mejor candidata (10 no 4; menos productos gana sobre más unidades).
- `pedido_controller.test.js`: reasignación al pagar ahora afirma `exceptoSucursalId`; 409 con faltantes de la mejor candidata sin tocar stock/sucursal. Se reescribió el describe "el mensaje de stock informa el máximo disponible": era un test pre-T1 (commite 2b919d5) que quedó desactualizado cuando T1 cambió el flujo de creación y fallaba en HEAD; ahora prueba el mapeo HTTP del 422 con faltantes (el cálculo real vive en el service).
- Suite del plan maestro en verde: seleccion_sucursal, pedido_controller, reasignacion, eta, estados, stock.integration, realtime (154 tests, `--runInBand`). Lint y prettier OK.

## 6. Verificación en vivo (caso del reporte)

Con las tres sucursales de prueba y la dirección Vergara 3430: crear pedido → asigna vergara → apagar el producto en vergara → pagar → reasigna a **oeste** (la más cercana con stock dentro de cobertura; palermo queda excluida por el radio). Apagando también en oeste → 409, el pedido queda `pendiente` y cancelable.
