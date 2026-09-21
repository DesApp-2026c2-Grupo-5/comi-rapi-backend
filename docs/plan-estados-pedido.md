# Plan — Gestión de estados del pedido (admin + pago + repartidor)

Fecha: 2026-09-21
Alcance: `PENDIENTE → CONFIRMADO (auto por pago) → gestión manual admin → EN_CAMINO (entregado al repartidor) → ENTREGADO (marca repartidor, reflejado en admin)`.
Archivo: `comi-rapi-backend/docs/plan-estados-pedido.md`

## 1. Fuentes de verdad y reglas de alcance

1. `docs/enunciado.md` — flujo PENDIENTE→CONFIRMADO→EN_PREPARACION→LISTO→EN_CAMINO→ENTREGADO/CANCELADO.
2. `docs/modelo-dominio.md` §5.12-5.13, §7 — `Pedido.estadoId` = actual + `PedidoEstadoHistorial` trazabilidad, actualización consistente en transacción.
3. `docs/DER.md` — `EstadoPedido`, `Pedido.estadoId`, `PedidoEstadoHistorial`.
4. `AGENTS.md` — flujo `Routes → Middlewares → Controllers → Services`; no negocio en controllers.

### Decisiones confirmadas (2026-09-21)

1. Fallback sí: `EN_CAMINO→ENTREGADO` lo marca el ADMIN manualmente en esta etapa.
2. No crear `Repartidor` ni rol `REPARTIDOR`: sin cambios en `modelo-dominio.md` / `DER.md` / `AGENTS.md`.

Por lo tanto no hay Fase 2 en este plan: `EN_CAMINO` = "entregado al repartidor" (acción manual del admin) y `ENTREGADO` = confirmación manual del admin haciendo de fallback, visible por polling. Cuando exista app de repartidor a futuro, reutilizará el mismo `PATCH /api/pedidos/:id/estado`.

## 2. Estado actual detectado (verificado en código)

Backend:

- `lib/services/estados_pedido.js:19-43` — mapa válido: `pendiente→confirmado|cancelado`, `confirmado→en_preparacion|cancelado`, `en_preparacion→listo_para_entregar`, `listo→en_camino`, `en_camino→entregado`, finales sin salida.
- `lib/controllers/pedido_controller.js:276-339` — `cambiarEstado` valida con `puedeTransicionar`, actualiza `Pedido.estadoId` + inserta `PedidoEstadoHistorial` en transacción. Bien.
- Permisos actuales `lib/controllers/pedido_controller.js:307-314`: cliente solo puede `pendiente→confirmado` (pago) y cancelar propio; resto lo puede hacer CLIENTE o ADMIN si la transición es válida (demasiado permisivo: hoy un cliente podría avanzar `confirmado→en_preparacion`, y cualquiera podría marcar `entregado`).
- `lib/routes/pedidos.js:31-36` — `PATCH /:id/estado` permite `CLIENTE, ADMINISTRADOR`.
- `POST /api/pedidos` crea siempre en `PENDIENTE` (`pedido_controller.js:204`).

Frontend:

- `src/services/estadosPedido.js:24-32` — espejo **divergente**: `PENDIENTE→[CANCELADO]` solo (falta `CONFIRMADO`; el pago va por `confirmarPedido` directo a API). Backend sí permite `PENDIENTE→CONFIRMADO`.
- `src/api/pedidos.js:197-199` — `confirmarPedido(id, medioPago)` = `PATCH .../estado {estado:'confirmado'}`. Es el "pago pasa a Confirmado automáticamente".
- `src/context/PedidoContext.jsx:189-203,213-231` — `confirmarPedido` y `cambiarEstado` contra API real, sin mocks.
- Admin `src/components/admin/PedidosPendientes.jsx:54-67,160-242` — filtra por `?estado=`, lista en orden backend (recientes primero, ya verificado), stepper + botón "Avanzá con un clic" + cancelar. Filtra `PENDIENTE` en contexto `PedidoContext.jsx:44-50`.
- Polling 3s `PedidoContext.jsx:142-157` — admin ya ve cambios hechos desde otra sesión (base para "cuando el repartidor entrega, el admin lo ve").

## 3. Diseño objetivo

Estados (nombres backend `lib/services/estados_pedido.js:19-27`, mismos en `src/utils/constants.js:16-24`):
`pendiente → confirmado → en_preparacion → listo_para_entregar → en_camino → entregado`, más `cancelado` (solo desde `pendiente|confirmado`).

Matriz de responsabilidad propuesta:

- `pendiente→confirmado`: solo CLIENTE dueño (pago simulado) + `medioPago` obligatorio (`MERCADO_PAGO|TARJETA`). Automático al pagar.
- `pendiente|cancelado` y `confirmado→cancelado`: CLIENTE dueño o ADMIN.
- `confirmado→en_preparacion→listo_para_entregar→en_camino`: solo ADMIN manual (botones admin actuales).
- `en_camino→entregado`: ADMIN manual como fallback confirmado (simula la marca del repartidor). Nunca CLIENTE. El admin lo ve por polling/refetch sin acción extra.

Regla de historial: todo cambio escribe `PedidoEstadoHistorial(pedidoId, estadoId, usuarioId, fechaHora, observacion)` en la misma transacción que `Pedido.estadoId`.

## 4. Cambios propuestos (sin crear `Repartidor`)

### 4.1 Backend

1. `lib/services/estados_pedido.js` — sin cambio de mapa (ya correcto). Opcional: exportar `TRANSICIONES_POR_ROL` o `puedeTransicionarConRol(actual, nuevo, rol, esDueño)` para centralizar permisos.
2. `lib/controllers/pedido_controller.js:cambiarEstado` — endurecer:
   - CLIENTE: solo `pendiente→confirmado` (propio) y cancelar propio en `pendiente|confirmado`. Nada más.
   - ADMINISTRADOR: `confirmado→en_preparacion→listo→en_camino→entregado` (+ cancelar en `confirmado`). El paso `en_camino→entregado` es el fallback confirmado que simula la marca del repartidor.
   - Exigir `medioPago` válido en `pendiente→confirmado`; validar `puedeTransicionar` antes de todo.
3. `lib/routes/pedidos.js` — sin cambio de rutas (mismo `PATCH /:id/estado` servirá a futuro repartidor; solo se agregará rol).
4. Seeders/migraciones — sin cambio (7 estados ya existen).

### 4.2 Frontend admin

1. `src/services/estadosPedido.js` — alinear con backend: agregar `PENDIENTE→CONFIRMADO` al mapa o documentar que el pago no pasa por `puedeTransicionar` UI sino por `confirmarPedido`. Evita divergencia futura.
2. `src/components/admin/PedidosPendientes.jsx` — sin cambio visual mayor:
   - Mantener el botón de avance hasta `entregado` (fallback confirmado): `EN_CAMINO→ENTREGADO` visible como "Confirmar entrega".
   - Mantener orden/filtros actuales; el cambio `en_camino→entregado` llega por polling 3s + `mapearPedido` ya mapea `historialEstados`.
3. `src/context/PedidoContext.jsx` — sin cambio (polling ya refleja entrega del repartidor). Opcional: toast "Pedido #id entregado" cuando polling detecte `→entregado`.
4. Flujo pago cliente (ya existe): `crearPedido(PENDIENTE)` → pantalla pago → `confirmarPedido→CONFIRMADO`. Solo verificar que `medioPago` se envía siempre.

### 4.3 Tests (backend Jest, mismo patrón existente)

- `estados_pedido.test.js` — agregar casos por rol: cliente no puede `confirmado→en_preparacion`, ni `en_camino→entregado`; admin sí hasta `en_camino`.
- `pedido_controller.test.js` — integración: `POST` crea `PENDIENTE`; `PATCH pendiente→confirmado` con `medioPago` OK (cliente); `PATCH confirmado→en_preparacion` por cliente → 403; por admin → 200 + fila en `PedidoEstadoHistorial`; `en_camino→entregado` por cliente → 403.

## 5. Verificación

1. `npm run db:migrate` + `npm run db:seed` limpios.
2. `npm test` verde.
3. Manual: cliente crea → paga → `CONFIRMADO`; admin avanza hasta `EN_CAMINO`; `PATCH en_camino→entregado` (simulando repartidor) → admin ve `ENTREGADO` en ≤3s por polling + `GET /api/pedidos/:id` con historial completo.
4. `GET /api/health` + login CLIENTE/ADMIN con CSRF (`csrf-token` + `x-csrf-token`) como en etapa pedidos.

## 6. Riesgos / notas

1. Cerrado: `ENTREGADO` manual por admin como fallback (decisión 2026-09-21).
2. Cerrado: no crear `Repartidor`/`REPARTIDOR` en esta etapa; sin cambios en `AGENTS.md` + `modelo-dominio.md` + `DER.md`.
3. Divergencia frontend/backend en `PENDIENTE→CONFIRMADO` — unificar en este plan.
4. `medioPago` hoy nullable; para "pago→confirmado automático" debería ser obligatorio en esa transición.
5. Sin máquina de estados formal (excluida en modelo §10) — se implementa como mapa + validación en service, no como entidad nueva.

## 7. Orden de ejecución sugerido

1. Backend permisos en `cambiarEstado` + helper por rol.
2. Alinear `src/services/estadosPedido.js`.
3. Ajuste menor admin (ocultar/mostrar botón Entregado según decisión 6.1).
4. Tests + verificación §5.
