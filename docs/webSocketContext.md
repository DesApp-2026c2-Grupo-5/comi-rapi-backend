# WebSocket — canal de tiempo real para pedidos, catálogo, parámetros y stock

Fecha: 2026-09-28 (original) · 2026-10-19 (ampliación a catálogo, parámetros y stock)
Archivo: `comi-rapi-backend/docs/webSocketContext.md`
Estado: **documento vivo** — se actualiza al cerrar cada parte de la implementación.

## 1. Principio rector

> **REST maneja los datos. PostgreSQL es la fuente de verdad. El WebSocket solamente avisa que algo cambió.**

El socket **no** transporta el objeto `Pedido`. Transporta el `pedidoId` y nada más. Quien recibe la notificación va a la API REST y lee el estado actual desde la base.

Consecuencias directas:

- Un evento perdido **no** corrompe nada: se pierde una optimización, no un dato.
- La UI nunca queda desincronizada de forma permanente, porque el dato siempre se relee de la base.
- Los tests de `pedido_controller.test.js` no necesitan un socket: los emisores son no-op si no hay servidor escuchando.

## 2. Estado de la implementación

| Parte | Alcance                                                                                             | Estado    |
| ----- | --------------------------------------------------------------------------------------------------- | --------- |
| 1     | Infraestructura: Socket.IO en el servidor HTTP, autenticación por sesión, control de acceso a rooms | **Hecho** |
| 2     | Emisiones en `create` y `cambiarEstado` + tests de los casos 1 a 6                                  | **Hecho** |
| 3     | Frontend: servicio de socket + reemplazo del polling de 3 s                                         | **Hecho** |
| 4     | Reconexión y verificación end-to-end de los 7 casos                                                 | **Hecho** |
| 5     | Ampliación: `catalogo_actualizado`, `parametros_actualizados`, `stock_actualizado`                  | **Hecho** |

**Estado actual: implementación completa y verificada.** El backend emite, el frontend escucha, y el polling de 3 s ya no existe. Verificado en navegador real (sección 9.2). La ampliación (parte 5) agregó tres eventos con el mismo principio: REST manda, el socket solo avisa.

## 3. Arquitectura

```
Browser ──REST──► Express ──► Controllers ──► PostgreSQL
                        │          │
                        │          └── (después del commit) ──► io.emit()
                        │                                        │
                     Socket.IO ◄──────────────────────────────────┘
                        │
              room admins  /  room pedido:{id}
```

### 3.1 Mapa de archivos

| Archivo                      | Responsabilidad                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/realtime/index.js`      | Singleton `io`. `configurarSocketIO(server)`, `obtenerIO()`, `cerrarSocketIO()` y los emisores: `emitirPedidoActualizado`, `emitirCatalogoActualizado`, `emitirParametrosActualizados`, `emitirStockActualizado` |
| `lib/realtime/conexion.js`   | `configurarConexion(io)`: autenticación del handshake, ingreso a rooms, handlers de suscripción                                                                                                                  |
| `lib/realtime/eventos.js`    | `EVENTOS`, `ROOM_ADMINS`, `roomPedido(id)`, `roomSucursal(id)`. Sin lógica                                                                                                                                       |
| `bin/www.js:22-23`           | Crea el servidor HTTP y le adjunta Socket.IO                                                                                                                                                                     |
| `bin/www.js:36`              | `server.listen(port)` (antes era `app.listen`)                                                                                                                                                                   |
| `lib/middlewares/auth.js:24` | `resolverUsuarioDeSesion(sesion)` — reusado por REST y por el socket                                                                                                                                             |

> `lib/realtime/` **no** va dentro de `lib/models/`: `lib/models/index.js:29-42` auto-descubre todo `.js` de esa carpeta y le invoca `init()`.

### 3.2 Nota sobre `bin/www.js`

Antes de este cambio el archivo creaba `server = http.createServer(app)` pero escuchaba con `app.listen(port)`, dejando el `server` huérfano y sin ejecutar nunca los handlers `onError` / `onListening`. Ahora se escucha sobre `server` y Socket.IO se le adjunta en el mismo servidor HTTP, compartiendo puerto y cookie de sesión con la API REST.

## 4. Conexión y autenticación

**Usa la sesión server-side que ya existe. No hay JWT.**

El handshake viaja con la cookie `comirapi.sid` (HttpOnly, store PostgreSQL vía `connect-pg-simple`, `lib/middlewares/session.js:21-33`). El cliente conecta con `withCredentials: true`.

Flujo:

1. `io.engine.use(sessionMiddleware)` (`lib/realtime/conexion.js`) corre `express-session` sobre el handshake de Engine.IO, dejando `socket.request.session` disponible.
2. `io.use(...)` llama a `resolverUsuarioDeSesion(socket.request.session)`.
3. Sin sesión válida, o con usuario inactivo → `next(new Error('No autorizado'))`. **La conexión se rechaza y no se entra a ninguna room.**

`resolverUsuarioDeSesion` se extrajo de `verificarSesion` justamente para que REST y socket compartan la única definición de "quién es esta sesión", en vez de duplicar la consulta a `Usuario`.

**El CSRF no aplica al handshake**: el handshake es un GET y no muta estado. La protección CSRF global (`lib/app.js:37`) sigue intacta para las rutas REST.

## 5. Rooms y autorización

| Room            | Quién entra                                                                            |
| --------------- | -------------------------------------------------------------------------------------- |
| `admins`        | Automática al conectar, solo si `usuario.rol === 'SUPERADMINISTRADOR'`                 |
| `sucursal:{id}` | Automática al conectar, solo si `usuario.rol === 'ADMINISTRADOR'` y tiene `sucursalId` |
| `pedido:{id}`   | Solo por suscripción explícita **y** autorización verificada en backend                |

Un cliente **no** puede suscribirse a un pedido ajeno. La autorización se aplica en servidor, en `autorizarPedido` (`lib/realtime/conexion.js`), y aplica la misma regla que ya usa `GET /api/pedidos/:id` (`lib/controllers/pedido_controller.js`):

- El pedido no existe → `"Pedido no encontrado"`
- No es el dueño, no es admin de la sucursal del pedido y no es SUPERADMINISTRADOR → `"Acceso denegado"`
- En otro caso → entra a la room

El cliente nunca decide a qué room pertenece: solo pide, y el backend responde con un ack.

### 5.1 El frontend solo se suscribe a pedidos de cliente

En `PedidoContext.jsx` el admin **no** emite `suscribir_pedido`: entra automáticamente a `sucursal:{id}` de su local y recibe por ahí sus pedidos. Suscribirse a cada `pedido:{id}` sería redundante.

## 6. Eventos

Payloads mínimos, definidos en `lib/realtime/eventos.js`.

| Evento                    | Dirección        | Payload                       | Destino                                       |
| ------------------------- | ---------------- | ----------------------------- | --------------------------------------------- |
| `suscribir_pedido`        | cliente → server | `{ pedidoId }` + ack          | —                                             |
| `desuscribir_pedido`      | cliente → server | `{ pedidoId }` + ack          | —                                             |
| `pedido_actualizado`      | server → cliente | `{ pedidoId }`                | `admins`, `pedido:{id}` **y** `sucursal:{id}` |
| `catalogo_actualizado`    | server → cliente | `{ tipo, id, accion }`        | broadcast a todos los conectados              |
| `parametros_actualizados` | server → cliente | `{}`                          | broadcast a todos los conectados              |
| `stock_actualizado`       | server → cliente | `{ sucursalId, productoIds }` | **solo** `sucursal:{id}`                      |

No existe `pedido_creado`, y es deliberado (sección 6.1).

### 6.1 Por qué no hay evento "pedido creado"

Todo pedido nace `pendiente`, y el panel de administración **no muestra los pendientes** (comportamiento previo, `filtrarPorRol` en `src/context/PedidoContext.jsx`). Emitir un aviso al crearse obligaba al admin a refetchear para obtener exactamente la misma lista de siempre: un evento que nunca podía producir un cambio visible.

Decisión del 2026-09-28: se eliminó `pedido_creado`. El admin se entera recién cuando el pedido pasa a `confirmado`, que es justo cuando deja de estar pendiente y entra en su pantalla. Ese cambio ya dispara `pedido_actualizado`, así que no hizo falta agregar nada.

Para el cliente el evento tampoco hacía falta: su propio `POST /api/pedidos` ya le devuelve el pedido creado.

### 6.2 Por qué `pedido_actualizado` va también a rooms de personal

El panel de administración no se suscribe a rooms individuales. Como el frontend
usa un único `PedidoContext` para ambos roles, si el evento fuera solo a
`pedido:{id}` la lista del admin no se actualizaría al confirmarse el pago.
Con el rol jerárquico, cada responsable recibe el aviso por su room automática:
el **ADMINISTRADOR** por `sucursal:{id}` (solo sus pedidos) y el
**SUPERADMINISTRADOR** por `admins` (todos). Ninguno emite `suscribir_pedido`.

### 6.3 Consecuencia práctica

| Momento                                 | ¿El admin se entera?         |
| --------------------------------------- | ---------------------------- |
| El cliente crea el pedido (`pendiente`) | No, y no se le avisa         |
| El cliente confirma el pago             | Sí, con `pedido_actualizado` |
| El admin avanza el estado               | Ya lo está haciendo          |

### 6.4 `catalogo_actualizado` y `parametros_actualizados` (broadcast)

Se emiten desde los controllers de producto, categoría y promoción (alta, baja
y edición) y desde el de parámetros. El payload de catálogo identifica la
entidad: `{ tipo: 'producto'|'categoria'|'promocion', id, accion: 'creado'|'actualizado'|'eliminado' }`.

Son **broadcast**: no hay rooms de catálogo. Cualquier vista conectada recarga
por REST lo que muestra (catálogo del cliente, listas del panel). En modo
edición (`EditarProducto` y compañía) el listener filtra por `tipo` + `id` de
la entidad abierta: resetear un formulario por un cambio ajeno perdería la
edición en curso.

### 6.5 `stock_actualizado`: exclusivo de la sucursal

Se emite **solo** a `roomSucursal(id)` — nunca a la room global `admins` ni a
clientes. Solo el administrador de ese local ve la pantalla de stock, y la
aislación por sucursal hace que un admin no deba enterarse del stock ajeno.

Fuentes de emisión (todas post-commit):

| Origen                                        | Sucursal(es) avisada(s)                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `pedido_controller.create` (descuento)        | la elegida para el pedido                                                        |
| `pedido_controller.cambiarEstado`             | la del pedido; si hubo reasignación por reserva vencida, la vieja **y** la nueva |
| `pedido_controller.cambiarEstado` (cancel)    | la del pedido                                                                    |
| `pedido_controller.reasignarSucursal`         | la vieja **y** la nueva                                                          |
| `producto_controller` (alta/edición de combo) | sucursal(es) cuya fila de combo cambió                                           |
| `stock_controller` (alta/ajuste/baja)         | la sucursal del ajuste                                                           |

El `productoIds` del payload es **orientativo** (los ids tocados
directamente); el frontend recarga la tabla entera de su sucursal, que es más
simple y siempre correcto.

### 6.6 Límite conocido: sin sesión no hay tiempo real

El handshake rechaza anónimos (`conexion.js` → `next(new Error('No autorizado'))`). Las vistas públicas (Inicio, Catálogo, Detalle) solo abren el
socket con sesión vigente: para un visitante anónimo el catálogo se actualiza
con la recarga normal de la página.

## 7. Orden de emisión

Regla inviolable: **se emite después de que la operación en PostgreSQL haya terminado correctamente**.

```
1. Validar
2. Guardar / actualizar en transacción (la transacción también retorna las filas tocadas)
3. Commit
4. Emitir los eventos de esa operación
5. Responder el HTTP
```

Si PostgreSQL falla, no hay commit y **no se emite nada**. Un cliente nunca recibe la notificación de un dato que no existe. Los controllers no necesitan `try/catch` para emitir: los emisores de `lib/realtime/index.js` son no-op seguros si el servidor no está inicializado.

Mapa completo de emisiones:

| Controller              | Función               | Emisor(es) post-commit                                                                                 |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `pedido_controller`     | `create`              | `stock_actualizado` si el pedido tocó stock (ej. combos); **nunca** `pedido_actualizado`               |
| `pedido_controller`     | `cambiarEstado`       | `pedido_actualizado`; `stock_actualizado` por cada sucursal cuyo stock cambió (vencidas y cancelación) |
| `pedido_controller`     | `reasignarSucursal`   | `pedido_actualizado`; `stock_actualizado` para la sucursal vieja y la nueva                            |
| `producto_controller`   | create/update/destroy | `catalogo_actualizado` (+ `stock_actualizado` por sucursal si cambió un combo)                         |
| `categoria_controller`  | create/update/destroy | `catalogo_actualizado`                                                                                 |
| `promocion_controller`  | create/update/destroy | `catalogo_actualizado`                                                                                 |
| `promocion_controller`  | asignar/quitar        | `catalogo_actualizado`                                                                                 |
| `stock_controller`      | create/update/destroy | `stock_actualizado` de esa sucursal                                                                    |
| `parametros_controller` | update                | `parametros_actualizados`                                                                              |

La transacción de pedido devuelve lo que cambió (`id`, `sucursalId`, `filasStock` / `avisos[]`), y la emisión arma los payloads de `stock_actualizado` a partir de eso, en vez de releer la base. Cambiar la sucursal, las promociones o el catálogo **no** notifican pedidos: son eventos distintos con propósitos distintos.

## 8. Reconexión

Socket.IO reconecta solo. Ojo con un detalle: **al reconectar el socket obtiene un id nuevo y pierde las rooms**. La pertenencia a rooms vive en el servidor, atada al `socket.id`.

Por lo tanto el cliente re-emite `suscribir_pedido` en **cada** evento `connect`, no solo al montar el componente.

Comprobado end-to-end (sección 9.2): tras una reconexión, un socket que **no** vuelve a suscribirse deja de recibir, y uno que sí vuelve a suscribirse recupera los eventos.

Como el socket es solo un aviso, una desconexión prolongada no puede dejar datos desincronizados. Por eso el handler `connect` del frontend hace dos cosas: re-suscribirse **y** re-leer la lista por REST. Así, si un cambio ocurrió mientras no había conexión, el aviso perdido no deja datos viejos en pantalla.

## 8.1 Cómo se cierra el ciclo en el frontend

Hay dos patrones, según quién es dueño del ciclo del socket:

**1. Contextos dueños del socket** — `PedidoContext.jsx` y `ParametrosContext.jsx`:

```
instancia.on('connect',            alConectar)      // re-suscribe + refresca
instancia.on('pedido_actualizado', alCambiarPedido) // llega al admin y al dueño
```

`refrescarPedidos()` re-listea por REST y actualiza tres cosas: la lista, `pedidoActual` (la pantalla de confirmación, que vive solo en memoria) y las notificaciones de cambio de estado.

Dos detalles de implementación:

- La dependencia del efecto es un **string de ids ordenados** (`idsPedidos`), no el array `pedidos`. Así el efecto corre solo cuando cambia el conjunto de pedidos —por ejemplo al crear uno nuevo, que hay que suscribir— y no en cada cambio de estado.
- El cleanup usa `off()` para los tres listeners y **no** desconecta el socket. Desconectar corría en cada re-ejecución del efecto; la desconexión real se dispara en un efecto aparte, cuando `emailSesion` queda vacío (logout).

**2. Vistas con listeners propios** — catálogo, listas del panel, `GestionStock`, `PanelSuperadmin`, `Editar*`:

```
useEffect(() => {
  if (!conectado) return;  // hydrated && (isAuthenticated | user)
  socket.on('connect',            alConectar);            // solo re-sincroniza por REST
  socket.on('catalogo_actualizado', alCatalogoCambiado);  // recarga la lista
  return () => {
    socket.off('connect',            alConectar);
    socket.off('catalogo_actualizado', alCatalogoCambiado);
  };
}, [conectado, ...]);
```

Reglas del patrón:

- **Gate:** solo registran con sesión resuelta (`hydrated` + `isAuthenticated` o `user`). Sin ella el socket está desconectado y los handlers no aportan nada.
- **Sin `alConectar()` inmediato:** el useEffect de montaje original ya hizo la carga inicial; hacerlo al registrar duplicaría el primer fetch. La resincronización en `connect` cubre los cambios perdidos durante una reconexión.
- **Sin `desconectarSocket()`:** el ciclo del socket es de `PedidoContext` (o `ParametrosContext`). `desconectarSocket` es un cierre duro con `removeAllListeners()`, no un refcount: una vista que lo llame al desmontar mataría los listeners de todos los demás.
- **`GestionStock` filtra por sucursal:** descarta `stock_actualizado` de otra sucursal.
- **`ListaProductos` filtra por sucursal** y solo actúa en modo solo-lectura.
- **`Editar*` filtra por tipo + id** de la entidad abierta, para no resetear el formulario por un cambio ajeno (el `useEffect([producto])` de `FormularioProducto` haría `reset()`).
- **`PanelSuperadmin`** escucha `pedido_actualizado` y reconsulta `obtenerResumen()` (sección 9.5).

## 9. Pruebas

| Caso | Qué verifica                                                             | Dónde                                       |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------- |
| 1    | Crear un pedido no emite `pedido_actualizado` (nace `pendiente`)         | `lib/realtime/conexion.test.js` — **verde** |
| 2    | Cliente confirma → admin recibe `pedido_actualizado` con solo `pedidoId` | **verde**                                   |
| 3    | Varios admins conectados reciben sin suscribirse                         | **verde**                                   |
| 4    | Dos clientes con pedidos distintos → solo el dueño recibe                | **verde**                                   |
| 5    | Sin sesión → handshake rechazado                                         | **verde**                                   |
| 6    | Falla la BD → no se emite el evento                                      | **verde**                                   |
| 7    | Reconexión: id nuevo, rooms perdidas, re-suscripción, sin duplicados     | **verde** (6 tests)                         |

Estado: 38 suites, **586/586 tests en verde** (`npm test`). Los tests de realtime (`lib/realtime/conexion.test.js`) siguen verdes con la ampliación: los emisores nuevos son no-op sin servidor, así que ningún controller test se vuelve flaky.

El caso 5 se comprobó dos veces: en los tests y a mano, con el backend de desarrollo levantado.

### 9.1 Cómo se arman los tests

El archivo levanta un servidor HTTP real (`http.createServer(app)`) con Socket.IO adjunto, en un puerto que elige el SO, y conecta clientes de `socket.io-client` pasando la **misma cookie `comirapi.sid`** que usa la API REST. Así se prueba la autenticación real, no una simulada.

Dos detalles que costaron entender y conviene no volver a pisar:

- El CSRF es double-submit: hay que obtener el token **antes** de armar la petición. `agente.post(url).set('x-csrf-token', await obtenerCsrf(agente))` falla con 403, porque supertest captura el tarro de cookies al crear la petición. Por eso los helpers `post()` y `patch()` del test piden el token primero.
- `socket.rooms` **no existe en el cliente**: las rooms viven en el servidor. La pertenencia a una room se verifica por su efecto observable (quién recibe cada evento), no inspeccionando el estado interno.
- El `reconnect` del **Manager** se dispara antes de que el **Socket** reprocese el CONNECT, así que en ese instante `socket.id` todavía es `undefined`. Para comprobar el id nuevo hay que esperar al `connect` del Socket.

### 9.1.1 Cómo se prueba la reconexión sin hacer trampas

`conectar(sid, { reconexion: true })` deja al cliente con su ciclo de reconexión activo, y `cortarYEsperarReconexion` simula una caída cerrando el engine TCP (`socket.io.engine.close()`). No se cierra el socket desde el lado del cliente: si se hiciera con `socket.close()`, no habría reconexión y el test no probaría nada.

El caso 7 no se apoya en asserts negativos solos, que podrían pasar siempre. Cada test tiene un control positivo:

- el de "sin re-suscribirse" **verifica que el evento sí llegaba antes de la caída** y recién después afirma que dejó de llegar;
- el de "vuelve a recibir" arranca de una conexión recién caída, sin suscripción previa, y exige el evento;
- el de "no duplica" cuenta las entregas y exige exactamente 1, con dos suscripciones extra a la misma room.

### 9.2 Verificación end-to-end automatizada

Las verificaciones manuales que se hacían antes vivían en scripts sueltos en el temp. Ahora están en los repositorios y se ejecutan con un comando, así que no se pierden ni quedan desactualizadas al tocar el código.

**Protocolo, en el backend** (`test/tiempo-real/`):

```bash
npm run test:tiempo-real   # requiere el backend levantado en :3000
```

| Caso                                                | Qué fija                                            |
| --------------------------------------------------- | --------------------------------------------------- |
| 1. Crear un pedido no notifica a nadie              | el admin no se entera al crearse                    |
| 2. El admin se entera al confirmarse el pago        | `pedido_actualizado` con una sola clave, `pedidoId` |
| 3. Varios admins conectados reciben sin suscribirse | la room `admins` alcanza a todos                    |
| 4. Un cliente no escucha pedidos ajenos             | suscripción denegada **con otro usuario de verdad** |
| 5. REST sigue siendo la fuente de verdad            | el estado nuevo se lee por REST                     |
| 6. Sin sesión no se entra                           | handshake rechazado                                 |
| 7. Si la base falla, no se emite nada               | 400 no produce evento                               |
| 8. Reconexión                                       | cambia el `socket.id`; hay que re-suscribirse       |
| 9. Re-suscribirse de más no duplica el aviso        | las rooms son un conjunto, no una lista             |

La suite crea un pedido base (estado `pendiente`) apenas para conocer el `sucursalId` de la asignación, y con esa sucursal provisiona su ADMINISTRADOR: un admin sin sucursal es rechazado por `requiereSucursal`/la autorización de estados cuando avanza un pedido.

**Navegador, en el frontend** (`scripts/verificar-tiempo-real.js`):

```bash
npm run test:tiempo-real   # requiere backend (:3000) y frontend (:5173)
# la primera vez: npx playwright install chromium
```

Verifica lo que los tests del backend no pueden ver: que la UI real escuche el socket, que el polling haya desaparecido y que las vistas se actualicen solas. Además del flujo de pedidos (el cliente ve `en preparación` / `entregado` / `cancelado` sin recargar y los KPIs del superadmin cambian solos), cubre el caso 10 de la ampliación en dos escenarios (ver 9.6): un superadmin renombra un producto por REST y **el cliente y la tabla de gestión lo ven en el lugar** — sin recargar la página, sin el spinner de carga y sin re-pedir la colección entera —, y un pedido del cliente descuenta stock con **la fila de `/admin/stock` bajando de N a N-1 con la tabla viva**. Y, al restaurar los nombres, el canal se verifica en ambos sentidos.

**Los roles no salen del registro público.** El endpoint de registro siempre crea CLIENTE (`validarRegistro` ignora `body.rol`), así que ambos E2E crean —o reparan, si quedaron mal— su ADMINISTRADOR y su SUPERADMINISTRADOR con `scripts/crear-usuario-de-prueba.js <email> <password> <ROL> [sucursalId]`, que fija el rol en la DB y sigue con el login normal. Es idempotente (upsert) y recibe el `sucursalId` del pedido base cuando el rol es de gestión.

**Los dos scripts limpian al terminar.** Los tests crean pedidos por la API, que no tiene `DELETE /api/pedidos`, y el listado del admin devuelve todos los pedidos: sin limpieza el panel se llenaba de ~90 pedidos de prueba. Al terminar, cada script invoca `scripts/limpiar-pedidos-de-prueba.js` (`npm run limpiar:pruebas`), que borra los pedidos de los usuarios de prueba y sus dependientes (`PedidoItems`, `PedidoEstadoHistorials`, `PedidoPromociones`) en una transacción.

El script borra emails `%@test.com` **menos** `cliente@test.com` y `admin@test.com`, que son los de la seeder. Como borra datos de demo si algo sale mal, tiene tres controles: aborta si el patrón matchea un usuario protegido, no borra nada con `--dry-run`, y compara el conteo de pedidos de ejemplo antes y después (sale con código 1 si cambiaron). Se desactiva con `WS_TEST_LIMPIAR=0` para depurar una corrida fallida.

Toma la configuración de `lib/config/config.js`, así que respeta `NODE_ENV`: con `NODE_ENV=test` limpia `SQL_TEST_DATABASE` y nunca la base de desarrollo. Eso no era gratis: la primera versión leía `.env.development` a propósito, con lo cual `NODE_ENV=test node scripts/limpiar-pedidos-de-prueba.js` habría borrado los datos de desarrollo creyendo estar en la de test. Tiene su propio test en `scripts/limpiar-pedidos-de-prueba.test.js`, que comprueba sobre la base de test que el dry-run no borra nada, que se van los pedidos de prueba con sus tres tablas hijas, y que los usuarios protegidos siguen con los suyos.

Detalles de estas suites que costaron encontrar:

- Los estados se leen de los `.badge` y no del texto de la página. Las etiquetas de estado también están en el desplegable de filtros, así que buscar "En preparación" en el `innerText` daba un OK falso aunque la lista no se hubiera actualizado. Los casos donde el cliente no debe recibir nada usan un segundo usuario de verdad, no dos sockets del mismo usuario: con dos sockets del mismo cliente la autorización no se ejercita y el test pasa por inercia.
- Se registra una petición a `/api/pedidos` por evento en vez de esperar un texto, porque el refetch ocurre aunque la vista no muestre el cambio.
- Los pedidos mandan `direccionId` (Dirección persistida con coordenadas); el payload textual `direccionEntrega` es solo retro-compatibilidad. Con provincia "Buenos Aires" el `direccion_service` exige partido, con "Ciudad Autónoma de Buenos Aires" no: los E2E usan CABA para no depender de ese paso extra.
- La limpieza borra pedidos pero **no repone el stock** que esos pedidos descontaron: tras varias corridas seguidas un producto se queda en 0 y el create responde "no hay stock suficiente". La limpieza no lo repone a propósito (borrar pedidos no implica saber cuánto stock había), pero **el script ya no depende de adivinar cuál tiene**: recorre el catálogo hasta encontrar un producto con stock para el pedido base, y en la sección 10 sube a 10 y restaura después la cantidad del producto que mide. Si _ninguno_ tiene stock sale con un error que dice cómo reponerlo (panel de stock o un `UPDATE "Stocks"`).

### 9.3 Límite conocido: un pedido creado en otra pestaña

El cliente solo recibe los avisos de los pedidos que tiene en su lista. En el flujo normal eso no molesta: al crear, `crearPedido` inserta el pedido en el estado y el efecto lo suscribe.

Lo que **no** está cubierto: si el usuario tiene Mis Pedidos abierto en una pestaña y crea el pedido en otra, esa pestaña no se entera hasta que recargue. La causa es directa: no hay evento de creación, y un cliente no puede suscribirse a la room de un pedido que todavía no conoce.

Cerrarlo requiere una decisión de producto: o un `pedido_creado` dirigido solo al room del cliente, o aceptar el refresh manual.

### 9.4 Un detalle que costó horas: la cookie de sesión va firmada

Al reutilizar sesiones para las pruebas manuales, mandar el `sid` crudo de la tabla `session` devuelve **401 en todas las requests**, aunque la fila exista y no esté vencida.

`express-session` firma la cookie: el valor real es `s:<sid>.<hmac-sha256-en-base64>`. `cookie-parser` solo puebla `req.signedCookies` si la firma valida, y `express-session` lee el sid de ahí. Con el `sid` pelado no hay sesión, y por eso tampoco entra el handshake del socket.

La receta para reusar una sesión sin pasar por `/api/auth/login` (que está rate-limited a 20 req / 15 min) es firmar el sid con `SESSION_SECRET` y mandar `comirapi.sid=s:<sid>.<firma>`.

Además, el CSRF es double-submit: el token que se manda en el header tiene que ser **exactamente** el de la cookie vigente, así que hay que re-leer la cookie `csrf-token` de cada `Set-Cookie` antes de construir la siguiente petición.

### 9.5 Reportes del superadmin: sin evento propio

Los KPIs del panel (`obtenerResumen`) se actualizan por `pedido_actualizado`, no por un evento de reportes dedicado: cada vez que un pedido cambia de estado, `PanelSuperadmin` reconsulta el resumen por REST. Mismo principio, menos eventos.

Decisión de la ampliación (2026-10-19): se eliminó la métrica `pendientes` del resumen (backend `metricas_service.js` + tarjeta en el panel). Los pedidos pendientes no representan ventas, y sacarla simplificó `resumenDePedidos` (una sola consulta de estados en vez de dos).

### 9.6 El catálogo se actualiza en el lugar, no re-cargando la sección

Regla común a todo el catálogo (`ListaProductos`, `ListaCategorias`, `ListaPromociones`, `Catalogo`, `Inicio`, `DetalleProducto`):

> **El socket avisa, REST manda, y el estado local se parchea sin volver a montar la vista.**

Ante `catalogo_actualizado {tipo, id, accion}` cada vista relee **solo la entidad afectada** por su endpoint de detalle (`GET /api/productos/:id`, `/api/categorias/:id`, `/api/promociones/:id`) y la aplica al estado que ya tiene:

- `creado` o `actualizado` → se fusiona en la posición que ya ocupaba (`fusionarPorId`, en `src/utils/catalogoRealtime.js`); si es nueva, entra ordenada por `nombre ASC`.
- `eliminado` → `quitarPorId`. En las tablas de gestión (que muestran también inactivas) la categoría/promoción en vez de borrarse se marca `activa: false`, que es lo que hace el soft delete del backend.

Es el mismo patrón que ya usaba `GestionStock` con el stock, y el que usaba `ParametrosContext` con los parámetros: **aplicar la respuesta del mutador al estado local** en vez de re-cargar la colección.

Lo que quedó descartado, y por qué:

| Alternativa                             | Problema                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargar()` / `cargarCatalogo()` entero  | spinner en toda la sección, parpadeo de la grilla y reordenamiento por diferencia de colación                                                  |
| Reordenar la lista después del merge    | movería filas que el usuario ya estaba mirando; con `localeCompare(..., 'es')` el orden del backend no siempre coincide con el de `Array.sort` |
| Enviar el objeto completo por el socket | viola la restricción 9 de la sección 11: los eventos solo transportan identificadores                                                          |

**Única excepción: el nombre de una categoría.** Si cambia, cambia el nombre de categoría de _todos_ sus productos, así que no se puede parchear una fila con el dato viejo: ahí la vista hace un refresh silencioso de la colección entera (`cargarProductos({ silencioso: true })`), que pide la lista pero **sin spinner y sin recargar la página**.

Comprobado en navegador (sección 9 de `scripts/verificar-tiempo-real.js`): la tabla de gestión relee sólo el producto editado, **no** re-pide la colección, no se re-enciende el `.spinner-border` y `performance.getEntriesByType('navigation')` sigue en 1 (hubo un solo `goto`, cero recargas).

El **stock** sigue la misma idea con otro evento (`stock_actualizado {sucursalId, productoIds}`, room de la sucursal, sin datos: restricción 9): `GestionStock` relee sólo `GET /api/stock/:sucursalId/:productoId` por cada id notificado y fusiona la fila (sección 10 del E2E: cantidad N→N-1, tabla viva, cero spinners, cero pedidos a la colección `/api/stock`). El `PUT /api/stock` de un guardado manual hace lo mismo: se aplica la fila que devuelve el backend, sin `cargar()`.

## 10. Verificación manual

```bash
# 1. Base y backend
cd comi-rapi-backend
docker compose up -d
npm run db:init; npm run db:seed
npm start                       # http://localhost:3000

# 2. Frontend
cd ../comi-rapi-fronted
npm run dev                     # http://localhost:5173
```

Para ver el tráfico en el navegador: pestaña **Network** → filtro **WS** → conexión `socket.io`. En `Messages` se ven los eventos recibidos con su payload.

Para confirmar que el polling desapareció: en Network, filtrar `pedidos` y dejar la página quieta. No debe aparecer ninguna petición repetida; solo las que dispara un evento.

## 10.1 Archivos del frontend

| Archivo                                                            | Responsabilidad                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/services/socket.js`                                           | Instancia única, `conectarSocket`, `desconectarSocket`, `suscribirPedido`, `EVENTOS_SOCKET` (los 4 eventos) |
| `src/utils/catalogoRealtime.js`                                    | Merge en el lugar: `fusionarPorId`, `quitarPorId`, orden por `nombre ASC` (ver 9.6)                         |
| `src/context/PedidoContext.jsx`                                    | Dueño del socket; effect que escucha `pedido_actualizado` y llama a `refrescarPedidos()`                    |
| `src/context/ParametrosContext.jsx`                                | Dueño del socket en vistas sin pedidos; escucha `parametros_actualizados`                                   |
| `src/pages/cliente/{Inicio,Catalogo,DetalleProducto}.jsx`          | Listeners de `catalogo_actualizado` (+ `stock_actualizado` en Catálogo) con sesión                          |
| `src/components/admin/Lista{Productos,Categorias,Promociones}.jsx` | Listas del panel; aplican el cambio en el lugar (ver 9.6)                                                   |
| `src/pages/admin/GestionStock.jsx`                                 | `stock_actualizado` filtrado por sucursal; el guardado también se aplica en el lugar                        |
| `src/components/superadmin/PanelSuperadmin.jsx`                    | `pedido_actualizado` → reconsulta el resumen                                                                |
| `src/pages/superadmin/Editar{Producto,Categoria,Promocion}.jsx`    | `catalogo_actualizado` filtrado por tipo + id                                                               |
| `.env`                                                             | `VITE_SOCKET_URL` (además de `VITE_API_URL`)                                                                |
| `package.json`                                                     | `socket.io-client@^4.8.4`                                                                                   |

`socket.js` es un **singleton a propósito**: `conectarSocket()` devuelve siempre la misma instancia si ya está viva. En desarrollo, el Strict Mode de React monta dos veces los efectos, y sin singleton se abrirían dos conexiones con dos juegos de listeners.

## 11. Restricciones

1. Nunca enviar el objeto `Pedido` por el socket: solo `pedidoId` (y payloads mínimos en los demás eventos).
2. No emitir antes del commit.
3. No reemplazar la API REST ni agregar endpoints para "compensar" al socket.
4. No agregar JWT: la autenticación es la sesión existente.
5. No cambiar las rutas REST, el CRUD ni la protección CSRF.
6. No modificar la autorización: se reusa la de `pedido_controller.js`.
7. No emitir desde `lib/models/`.
8. `stock_actualizado` jamás sale de la room de su sucursal: ni a `admins` ni a clientes.
9. Ningún evento nuevo transporta datos: solo identificadores y la mínima seña para filtrar.

## 12. Ver también

- `AGENTS.md` — arquitectura y convenciones del backend
- `docs/plan-estados-pedido.md` — reglas de transición de estados
- `docs/reglas-negocio.md` — reglas de negocio de pedidos
