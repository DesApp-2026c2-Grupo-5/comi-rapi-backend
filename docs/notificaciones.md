# Centro de notificaciones del cliente

Documenta la entidad `Notificacion`, sus reglas de generación, los endpoints, el canal de tiempo real y la integración con el frontend.

> **Alcance:** el centro de notificaciones se autorizó explícitamente aunque figuraba fuera del alcance de la Propuesta 2. Solo se implementó `Notificacion`: siguen sin existir `Repartidor` ni el rol `REPARTIDOR`. La entidad tampoco reemplaza a `Resena`, `Queja` ni `PedidoEstadoHistorial`; es un aviso derivado de esos cambios.

## 1. Modelo

Entidad `Notificacion` (tabla `Notificaciones`), definida en `docs/DER.md` §2.24 y `docs/modelo-dominio.md` §5.20:

| Columna     | Tipo        | Regla                                                          |
| ----------- | ----------- | -------------------------------------------------------------- |
| `id`        | INTEGER     | PK                                                             |
| `usuarioId` | INTEGER     | FK → `Usuario.id`, NOT NULL, `ON DELETE CASCADE`; destinatario |
| `tipo`      | ENUM        | NOT NULL, default `SISTEMA`: `PEDIDO`, `QUEJA`, `SISTEMA`      |
| `titulo`    | STRING(160) | NOT NULL                                                       |
| `mensaje`   | TEXT        | NULLABLE                                                       |
| `pedidoId`  | INTEGER     | FK → `Pedido.id`, NULLABLE, `ON DELETE SET NULL`; destino      |
| `quejaId`   | INTEGER     | FK → `Queja.id`, NULLABLE, `ON DELETE SET NULL`; destino       |
| `leida`     | BOOLEAN     | NOT NULL, default `false`                                      |
| `leidaEn`   | DATE        | NULLABLE; se completa al marcar leída                          |
| `createdAt` | DATE        | NOT NULL                                                       |
| `updatedAt` | DATE        | NOT NULL                                                       |

Índices: `(usuarioId, leida)` para el badge, `(usuarioId, createdAt)` para el listado, y uno por cada FK de origen (`pedidoId`, `quejaId`). CHECK `notificaciones_tipo_valido` además del ENUM.

## 2. Reglas de negocio

- **Destinatario**: solo un `CLIENTE`. Las rutas exigen `verificarSesion` + `permitirRoles('CLIENTE')`; ADMINISTRADOR y SUPERADMINISTRADOR reciben 403. El negocio conserva sus badges de Pedidos y Reclamos.
- **Estado leído persistido**: `leida` y `leidaEn` viven en la base, así que el contador es el mismo desde cualquier dispositivo. El frontend no usa `localStorage` para esto.
- **Avisos de pedido**: se crean al cambiar de estado un pedido, con el texto de `MENSAJES_ESTADO` (en `lib/services/notificaciones.js`). La fila se crea **dentro de la transacción** que cambia el estado: si la transacción falla, el aviso no queda. El evento de socket se emite después del commit.
- **Cancelación del cliente**: el cliente no recibe aviso de su propia cancelación (la acaba de hacer y el frontend ya le mostró el resultado). Sí se notifica la **cancelación automática por cierre de la sucursal**, porque la decide el sistema. La **cancelación automática por vencimiento de la reserva de stock** (`docs/reglas-negocio.md` §25) **no genera notificación persistida**: la pantalla de pago vuelve al carrito con un único mensaje simple (`Tiempo de pago excedido.`).
- **Avisos de reclamo**: se crean cuando el negocio responde un reclamo, suma un mensaje al hilo o cambia su estado (`EN_REVISION`, `RESUELTA`, `RECHAZADA`). Las acciones del propio cliente (crear, responder, cerrar) no se auto-notifican.
- **Alcance de lectura**: el listado, el contador y el marcado siempre filtran por `usuarioId`. Marcar una notificación ajena responde 404 (no se revela que existe).
- **Sin borrado**: el cliente marca leídas, no elimina. La baja de un pedido o una queja deja `pedidoId`/`quejaId` en `NULL` para no perder el aviso histórico.

### 2.1 Textos por estado del pedido

| Estado                | Título                        | Mensaje                                                 |
| --------------------- | ----------------------------- | ------------------------------------------------------- |
| `confirmado`          | Pedido confirmado             | Recibimos tu pago y el pedido ya entró en la cocina.    |
| `en_preparacion`      | Tu pedido está en preparación | La sucursal está preparando tu pedido.                  |
| `listo_para_entregar` | Tu pedido está listo          | El pedido está listo y espera salir a entrega.          |
| `en_camino`           | Tu pedido está en camino      | El pedido salió de la sucursal y va hacia tu dirección. |
| `entregado`           | Pedido entregado              | Tu pedido fue entregado. ¡Que lo disfrutes!             |
| `cancelado`           | Pedido cancelado              | El pedido fue cancelado.                                |

La cancelación automática por cierre usa un título y un mensaje propios (`Pedido cancelado por cierre de la sucursal`). El vencimiento de la reserva de stock (`docs/reglas-negocio.md` §25) no crea aviso persistido. Los estados sin texto en `MENSAJES_ESTADO` no generan aviso: `notificarEstadoPedido` devuelve `null`.

## 3. Endpoints

Todas las rutas requieren sesión, rol `CLIENTE` y CSRF en los métodos que cambian estado. Montadas en `/api/notificaciones`.

### 3.1 Listado

`GET /api/notificaciones?tipo=PEDIDO&noLeidas=1&pagina=1&limite=20`

- `tipo`: opcional, `PEDIDO` | `QUEJA` | `SISTEMA` (sin distinguir mayúsculas). Un valor inválido responde 400.
- `noLeidas`: opcional, `1`/`true` para ver solo las pendientes.
- `pagina`: desde 1 (default 1). `limite`: 1 a 50 (default 20).

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 18,
        "tipo": "PEDIDO",
        "titulo": "Tu pedido está en camino",
        "mensaje": "El pedido salió de la sucursal y va hacia tu dirección.",
        "pedidoId": 42,
        "quejaId": null,
        "leida": false,
        "leidaEn": null,
        "creadaEn": "2026-11-06T18:30:00.000Z"
      }
    ],
    "total": 1,
    "noLeidas": 1,
    "pagina": 1,
    "limite": 20,
    "paginas": 1
  }
}
```

`noLeidas` es siempre el total pendiente del usuario, no el de la página.

### 3.2 Contador

`GET /api/notificaciones/no-leidas` → `{ "success": true, "data": { "noLeidas": 3 } }`. Es lo que alimenta el badge del header.

### 3.3 Marcar una como leída

`PUT /api/notificaciones/:id/leida` → 200 con la fila serializada. Es idempotente: si ya estaba leída, conserva `leidaEn`. Un `id` ajeno o inexistente responde 404.

### 3.4 Marcar todas

`PUT /api/notificaciones/leidas` → `{ "success": true, "data": { "actualizadas": 3 } }`.

La ruta va declarada antes de `/:id/leida`: si no, `leidas` se resolvería como un id.

## 4. Tiempo real

- Evento `notificacion_creada` (`EVENTOS.NOTIFICACION_CREADA`), payload `{ notificacionId, tipo }`.
- Va **solo** a la room privada `usuario:{id}`. Cada socket autenticado se une a su propia room al conectar (`lib/realtime/conexion.js`), así los avisos no se filtran entre cuentas.
- El evento no transporta datos: el frontend re-consulta el listado y el contador por REST, que siguen siendo la fuente de verdad.
- Los emisores (`emitirNotificacionCreada`, `avisarNotificacion`) son no-op seguros si Socket.IO no está inicializado.

## 5. Integración con el frontend

- `src/api/notificaciones.js` — `obtenerNotificaciones`, `obtenerNoLeidas`, `marcarLeida`, `marcarTodasLeidas`. Usa `apiPut` porque `client.js` no expone `apiPatch`.
- `src/context/NotificacionesCentroContext.jsx` + `src/hooks/useNotificacionesCentro.js` — estado del listado, contador, filtro, paginación y apertura del drawer. El contador se pide al hidratar la sesión y se refresca con el evento de socket.
- `src/components/comunes/CampanaNotificaciones.jsx` — botón con badge (`9+` a partir de diez, el total real va en el `aria-label`). Hay una copia en la fila superior del móvil y otra en la zona de escritorio; las dos comparten el contexto.
- `src/components/comunes/CentroNotificaciones.jsx` — `Offcanvas` lateral derecho (ancho completo en el teléfono, `min(100vw, 420px)` en escritorio) con filtros Todas / Pedidos / Reclamos, esqueletos de carga, estado vacío, error con reintento y "Ver más". Al tocar una notificación se marca leída y se navega a `/cliente/pedido/:id`, donde también vive el hilo del reclamo.
- El drawer se monta una sola vez en `Navbar.jsx` y solo para el CLIENTE.
- Estilos en `CentroNotificaciones.css` (campanita y drawer) y `MenuCuenta.css` (menú del logo). Todo el color sale de `tokens.css`, así que el tema oscuro no necesita reglas propias; hay soporte de `prefers-reduced-motion`.

## 6. Pruebas

- `lib/services/notificaciones.test.js` — listado y filtros, paginación, contador, marcado idempotente, aislamiento entre usuarios, textos de pedido y reclamo.
- `lib/controllers/notificacion_controller.test.js` — 401 sin sesión, 403 para administrador, listado propio, contador, marcado individual y masivo, y aviso generado por una respuesta del negocio.

Las migraciones de la base de test se aplican con `NODE_ENV=test npx sequelize db:migrate` después de `npm run build` (`.sequelizerc` apunta a `dist/`).
