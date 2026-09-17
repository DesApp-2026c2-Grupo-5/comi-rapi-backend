# Plan de etapa — Pedidos: persistencia en Postgres (Docker)

Fecha: 2026-09-16
Alcance: registrar pedidos en la base Postgres del docker. Opción A (fiel a DER).
Archivo: `comi-rapi-backend/docs/plan-etapa-pedidos.md`

## 1. Objetivo

Conectar frontend ↔ backend ↔ Postgres (docker) **solo para pedidos**:
carrito + contexto de pedido → `POST /api/pedidos` → tablas `Pedidos`, `PedidoItems`, `PedidoEstadoHistorials` + catálogo `EstadoPedidos`.

Fuera de alcance en esta etapa: pago real, stock por sucursal, promociones, `PedidoItemOpcion`, repartidor / calificación / notificación (Propuesta 2), reasignación manual de sucursal, reportes.

## 2. Fuentes de verdad y arquitectura

1. `docs/enunciado.md`, 2. `docs/modelo-dominio.md`, 3. `docs/DER.md` (19 entidades, 23 relaciones).
2. Flujo: `Routes → Middlewares → Controllers → Services → Models → Database`.
3. `Routes` sin lógica, `Controllers` sin reglas de negocio, reglas en `Services`.
4. Un archivo por entidad DER, tabla en plural, columnas según DER.
5. Snapshots históricos obligatorios: `Pedido` conserva dirección; `PedidoItem` conserva `nombreProducto`/`precioUnitario`; no reconstruir desde catálogo.
6. Reutilizar implementación existente de `Categoria`/`Producto` como referencia.

## 3. Estado inicial detectado

Backend (`comi-rapi-backend/`):

- `lib/controllers/pedido_controller.js` — solo comentarios (`create/index/show/cambiarEstado`).
- `lib/models/pedido.js`, `linea_pedido.js`, `historial_estado_pedido.js`, `sucursal.js` — solo comentarios.
- `lib/routes/pedidos.js` — solo comentarios, no montada en `lib/routes/index.js`.
- `db/migrations/20260911000003-create-sucursal.js`, `...04-create-pedido.js`, `...05-create-linea-pedido.js`, `...06-create-historial-estado-pedido.js` — `no-op`.
- `lib/services/asignacion_sucursal.js`, `estados_pedido.js`, `calculo_personalizacion.js` — solo comentarios.
- Infra OK: `docker-compose.yml` (postgres 12.5, `unahur_desapp_dev:5432`), `.env.development` coincide, `lib/models/index.js` autodiscovery, `middlewares/auth.js` sesión + roles, `routes/utils.js` `withErrorHandling`.

Frontend (`comi-rapi-fronted/`):

- `src/api/pedidos.js` — mock con `delay`, `id: Date.now()`, `estado: 'Confirmado'`.
- `src/context/PedidoContext.jsx` (`crearPedido` local `PENDIENTE`), `src/context/CarritoContext.jsx` (total local).
- `src/services/seedData.js` (`pedidosMock`), `estadosPedido.js`, `utils/constants.js` (`ESTADOS_PEDIDO`).
- `.env` → `VITE_API_URL=http://localhost:3000/api`. Ningún `fetch` real todavía.

## 4. Decisión de modelo (Opción A)

Los stubs usan nombres viejos (`LineaPedido`, `HistorialEstadoPedido`, `estado` string, `Sucursal.lat/lng/estado`). El DER aprobado usa `PedidoItem`, `PedidoEstadoHistorial`, `EstadoPedido` (FK `estadoId`), `Sucursal.latitud/longitud/activa/horarios`. Gana el DER.

Para no bloquear la etapa se implementa el DER simplificado:
`Sucursal` mínima + `EstadoPedido` + `Pedido` + `PedidoItem` + `PedidoEstadoHistorial`.
`PedidoItemOpcion`, `Stock`, `Promocion*` quedan para etapas siguientes. La `personalizacion` del carrito se guarda temporalmente en `PedidoItem.observacion` (JSON string).

Se reutilizan los mismos archivos pedidos por el equipo:

- `sucursal.js` → `Sucursal` DER.
- `pedido.js` → `Pedido` DER.
- `linea_pedido.js` → `PedidoItem` DER (se mantiene el nombre de archivo legacy, `modelName: 'PedidoItem'`, `tableName: 'PedidoItems'`).
- `historial_estado_pedido.js` → `PedidoEstadoHistorial` DER (mismo criterio).
- nuevo `estado_pedido.js` → `EstadoPedido` (exigido por FK `Pedido.estadoId`).

## 5. Cambios backend (mismos archivos)

### 5.1 Migraciones `db/migrations/`

- `20260911000000-create-estado-pedido.js` (nuevo, corre primero): `EstadoPedidos(id, nombre UNIQUE, orden, esInicial, esFinal, activo, createdAt, updatedAt)`.
- `20260911000003-create-sucursal.js`: `Sucursales(id, nombre NOT NULL, direccion NOT NULL, latitud DECIMAL(10,7) NULL, longitud DECIMAL(10,7) NULL, telefono NULL, horarios NULL, activa BOOLEAN default true, createdAt, updatedAt)`.
- `20260911000004-create-pedido.js`: `Pedidos(id, usuarioId FK→Usuarios.id NOT NULL, sucursalId FK→Sucursales.id NOT NULL, fechaHora DATE NOT NULL default NOW, estadoId FK→EstadoPedidos.id NOT NULL, costoEnvio DECIMAL(10,2) default 0, total DECIMAL(10,2) NOT NULL, medioPago ENUM('MERCADO_PAGO','TARJETA') NULL, observacion TEXT NULL, calle NULL, altura INTEGER NULL, ciudad NULL, codigoPostal NULL, referencia TEXT NULL, latitud DECIMAL(10,7) NULL, longitud DECIMAL(10,7) NULL, createdAt, updatedAt)`.
- `20260911000005-create-linea-pedido.js`: `PedidoItems(id, pedidoId FK→Pedidos.id NOT NULL ON DELETE CASCADE, productoId FK→Productos.id NULL ON DELETE SET NULL, nombreProducto STRING NOT NULL, precioUnitario DECIMAL(10,2) NOT NULL, cantidad INTEGER NOT NULL default 1, subtotal DECIMAL(10,2) NOT NULL, observacion TEXT NULL, createdAt, updatedAt)`.
- `20260911000006-create-historial-estado-pedido.js`: `PedidoEstadoHistorials(id, pedidoId FK NOT NULL CASCADE, estadoId FK NOT NULL, usuarioId FK NULL SET NULL, fechaHora DATE NOT NULL default NOW, observacion TEXT NULL, createdAt, updatedAt)`.
- Seeder `db/seeders/20260915000001-estados-pedido-sucursales.js`: 7 estados (`PENDIENTE` inicial, `ENTREGADO`/`CANCELADO` finales) + 3 sucursales espejo de `sucursalesMock`.

### 5.2 Modelos `lib/models/`

Mismo patrón que `producto.js` (`init + associate`, `tableName` plural). Asociaciones:

- `Pedido.belongsTo(Usuario, as cliente)`, `belongsTo(Sucursal)`, `belongsTo(EstadoPedido, as estadoActual)`, `hasMany(PedidoItem, as items)`, `hasMany(PedidoEstadoHistorial, as historial)`.
- `PedidoItem.belongsTo(Pedido)`, `belongsTo(Producto)` nullable.
- `PedidoEstadoHistorial.belongsTo(Pedido/EstadoPedido/Usuario)`.

### 5.3 Servicios `lib/services/`

- `estados_pedido.js`: `ESTADOS = [pendiente, confirmado, en_preparacion, listo_para_entregar, en_camino, entregado, cancelado]`, `puedeTransicionar(actual, nuevo)`, `obtenerEstadosSiguientes(actual)`. Misma matriz que `frontend/src/services/estadosPedido.js` (admin no mueve `pendiente`; el pago/confirmación lo pasa a `confirmado`).
- `asignacion_sucursal.js`: `asignarSucursalOptima(sucursales, pedidosPendientes)` — filtra activas, cuenta pendientes (`pendiente/confirmado/en_preparacion`) por `sucursalId`, devuelve la de menor carga (empate: menor id) o `null`.
- `calculo_personalizacion.js`: `calcularPrecioUnitario(precioBase, extras=[], acompanamientos=[])`, `calcularPrecioPersonalizado(...cantidad)` — `extra`/`acompanar` suman, `personalizar`/`condimento` gratis. El total del pedido se recalcula en backend.

### 5.4 Controller `lib/controllers/pedido_controller.js`

- `create (POST /api/pedidos, CLIENTE)`: valida `productos[]` no vacío, resuelve `sucursalId` o auto-asigna, recalcula total + snapshots (`nombreProducto/precioUnitario/subtotal` desde `Productos` vigentes), snapshot de dirección del body, crea `Pedido + items + Historial(PENDIENTE)` en transacción. `201 {success:true,data}`.
- `index (GET /api/pedidos)`: CLIENTE `where usuarioId`, ADMIN todos + filtro `?sucursalId=`. Include `cliente, Sucursal, items, historial>estado`.
- `show (GET /api/pedidos/:id)`: 404 si no existe, 403 si CLIENTE pide pedido ajeno.
- `cambiarEstado (PATCH /:id/estado)`: valida con `puedeTransicionar`, actualiza `Pedido.estadoId` + inserta `PedidoEstadoHistorial` en transacción. Error 400 si transición inválida.

### 5.5 Routes `lib/routes/`

- `pedidos.js`: `POST / + GET /` (`verificarSesion`), `GET /:id`, `PATCH /:id/estado` (CLIENTE puede crear/ver propios y confirmar propio `pendiente→confirmado`; ADMIN todo). Todo con `withErrorHandling`.
- Montar en `index.js`: `router.use('/api/pedidos', pedidos)`.

## 6. Cambios frontend (sí incluidos, mínimos)

- `src/api/pedidos.js`: primera implementación real con `fetch`. `GET` sin CSRF, `POST/PATCH` con `credentials:'include'` + `x-csrf-token` (obtenido de `GET /api/auth/csrf-token`, cookie `csrf-token`). Contrato `{success,data}` preservado. Mapeo backend→UI: `usuarioId/sucursalId/items/historial` → `{id, cliente, productos, total, sucursal, estado, fecha, historialEstados, direccion}` para no romper Mis Pedidos/Detalle/Admin. Fallback a mock solo si `VITE_API_URL` no responde (dev).
- `src/context/PedidoContext.jsx`: `crearPedido/confirmarPedido` async contra API; `vaciarCarrito` solo si `success`.
- Sin cambios visuales en esta etapa.

Payload `POST /api/pedidos`:
`{ sucursalId?, productos: [{productoId?, nombre?, cantidad, precio?, personalizacion?}], direccionEntrega?: {calle, altura, ciudad, codigoPostal, referencia}, costoEnvio?, medioPago?, observacion? }`.
El backend ignora/valida `total` enviado y lo recalcula.

## 7. Tests Jest (backend)

Frontend no tiene Jest (solo vite/eslint). Tests en backend con `supertest`, patrón de `usuario_controller.test.js` + `producto.test.js` + `test/db_utils.js` (`cleanDb`):

- `lib/services/estados_pedido.test.js` (puro): transiciones válidas/inválidas, finales sin salida, `obtenerSiguientes('confirmado')`.
- `lib/controllers/pedido_controller.test.js` (integración): 201 + persistencia + snapshot, 401 sin sesión, CLIENTE solo propios / ADMIN todos, 400 en transición inválida, `PATCH pendiente→confirmado` OK.
- `lib/models/pedido.test.js`: snapshot `nombreProducto/precioUnitario` no cambia si cambia `Producto.precio`; FK `usuarioId/sucursalId/estadoId` NOT NULL.

## 8. Verificación de la etapa

1. `docker compose up -d db` + `pg_isready -U unahur_desapp -d unahur_desapp_dev`.
2. `npm run db:migrate` + `npm run db:seed` limpios desde cero (`down -v` + `up`).
3. `npm test` en verde (3 suites nuevas + existentes).
4. Manual: `GET /api/health`, login CLIENTE → `POST /api/pedidos` 201 → fila en Postgres → `GET /api/pedidos` persiste tras reload del frontend → crear pedido desde carrito aparece en admin.

## 9. Riesgos / notas

- `PedidoItem.productoId` nullable (`SET NULL`) para no perder historial si se borra un producto; el snapshot manda.
- `medioPago` nullable en esta etapa (pago simulado).
- `PedidoItemOpcion`/`Stock`/`Promocion` no se tocan; no inventar reglas fuera del DER.
- CSRF double-submit (`csrf-token` cookie + `x-csrf-token` header) obligatorio en `POST/PATCH` tanto en tests como en frontend.
