# WebSocket — canal de tiempo real para pedidos

Fecha: 2026-09-28
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

**Estado actual: implementación completa y verificada.** El backend emite, el frontend escucha, y el polling de 3 s ya no existe. Verificado en navegador real (sección 9.2).

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

| Archivo                      | Responsabilidad                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/realtime/index.js`      | Singleton `io`. `configurarSocketIO(server)`, `obtenerIO()`, `emitirPedidoActualizado(id)`, `cerrarSocketIO()` |
| `lib/realtime/conexion.js`   | `configurarConexion(io)`: autenticación del handshake, ingreso a rooms, handlers de suscripción                |
| `lib/realtime/eventos.js`    | `EVENTOS`, `ROOM_ADMINS`, `roomPedido(id)`. Sin lógica                                                         |
| `bin/www.js:22-23`           | Crea el servidor HTTP y le adjunta Socket.IO                                                                   |
| `bin/www.js:36`              | `server.listen(port)` (antes era `app.listen`)                                                                 |
| `lib/middlewares/auth.js:24` | `resolverUsuarioDeSesion(sesion)` — reusado por REST y por el socket                                           |

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

| Room          | Quién entra                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `admins`      | Automática al conectar, solo si `usuario.rol === 'ADMINISTRADOR'`       |
| `pedido:{id}` | Solo por suscripción explícita **y** autorización verificada en backend |

Un cliente **no** puede suscribirse a un pedido ajeno. La autorización se aplica en servidor, en `autorizarPedido` (`lib/realtime/conexion.js`), y aplica la misma regla que ya usa `GET /api/pedidos/:id` (`lib/controllers/pedido_controller.js:303-306`):

- El pedido no existe → `"Pedido no encontrado"`
- No es el dueño y no es admin → `"Acceso denegado"`
- En otro caso → entra a la room

El cliente nunca decide a qué room pertenece: solo pide, y el backend responde con un ack.

### 5.1 El frontend solo se suscribe a pedidos de cliente

En `PedidoContext.jsx` el admin **no** emite `suscribir_pedido`: ya entra a `admins` automáticamente y recibe por ahí todo. Suscribirse a cada `pedido:{id}` sería redundante.

## 6. Eventos

Payloads mínimos, definidos en `lib/realtime/eventos.js`.

| Evento               | Dirección        | Payload              | Destino                      |
| -------------------- | ---------------- | -------------------- | ---------------------------- |
| `suscribir_pedido`   | cliente → server | `{ pedidoId }` + ack | —                            |
| `desuscribir_pedido` | cliente → server | `{ pedidoId }` + ack | —                            |
| `pedido_actualizado` | server → cliente | `{ pedidoId }`       | `admins` **y** `pedido:{id}` |

Solo hay **un** evento de servidor. No existe `pedido_creado`, y es deliberado.

### 6.1 Por qué no hay evento "pedido creado"

Todo pedido nace `pendiente`, y el panel de administración **no muestra los pendientes** (comportamiento previo, `filtrarPorRol` en `src/context/PedidoContext.jsx`). Emitir un aviso al crearse obligaba al admin a refetchear para obtener exactamente la misma lista de siempre: un evento que nunca podía producir un cambio visible.

Decisión del 2026-09-28: se eliminó `pedido_creado`. El admin se entera recién cuando el pedido pasa a `confirmado`, que es justo cuando deja de estar pendiente y entra en su pantalla. Ese cambio ya dispara `pedido_actualizado`, así que no hizo falta agregar nada.

Para el cliente el evento tampoco hacía falta: su propio `POST /api/pedidos` ya le devuelve el pedido creado.

### 6.2 Por qué `pedido_actualizado` va también a `admins`

El panel de administración no se suscribe a rooms individuales. Como el frontend usa un único `PedidoContext` para ambos roles, si el evento fuera solo a `pedido:{id}` la lista del admin no se actualizaría al confirmarse el pago.

### 6.3 Consecuencia práctica

| Momento                                 | ¿El admin se entera?         |
| --------------------------------------- | ---------------------------- |
| El cliente crea el pedido (`pendiente`) | No, y no se le avisa         |
| El cliente confirma el pago             | Sí, con `pedido_actualizado` |
| El admin avanza el estado               | Ya lo está haciendo          |

## 7. Orden de emisión

Regla inviolable: **se emite después de que la operación en PostgreSQL haya terminado correctamente**.

```
1. Validar
2. Guardar / actualizar en transacción
3. Commit
4. Re-leer el pedido (findByPk)
5. Emitir el evento
6. Responder el HTTP
```

Si PostgreSQL falla, no hay commit, no hay re-lectura y **no se emite nada**. Un cliente nunca recibe la notificación de un pedido que no existe.

Puntos de emisión, **solo uno**, en `lib/controllers/pedido_controller.js`:

| Función         | Emisor                                    | Condición                                                      |
| --------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `cambiarEstado` | `emitirPedidoActualizado(actualizado.id)` | Después del `findByPk` que relee el pedido con el estado nuevo |

`create` no emite nada (ver sección 6.1). Ninguna otra ruta emite: cambiar la sucursal, las promociones o el catálogo no notifican pedidos.

## 8. Reconexión

Socket.IO reconecta solo. Ojo con un detalle: **al reconectar el socket obtiene un id nuevo y pierde las rooms**. La pertenencia a rooms vive en el servidor, atada al `socket.id`.

Por lo tanto el cliente re-emite `suscribir_pedido` en **cada** evento `connect`, no solo al montar el componente.

Comprobado end-to-end (sección 9.2): tras una reconexión, un socket que **no** vuelve a suscribirse deja de recibir, y uno que sí vuelve a suscribirse recupera los eventos.

Como el socket es solo un aviso, una desconexión prolongada no puede dejar datos desincronizados. Por eso el handler `connect` del frontend hace dos cosas: re-suscribirse **y** re-leer la lista por REST. Así, si un cambio ocurrió mientras no había conexión, el aviso perdido no deja datos viejos en pantalla.

## 8.1 Cómo se cierra el ciclo en el frontend

`src/context/PedidoContext.jsx` (frontend), en un solo `useEffect`:

```
instancia.on('connect',            alConectar)      // re-suscribe + refresca
instancia.on('pedido_actualizado', alCambiarPedido) // llega al admin y al dueño
```

Los dos handlers llaman a `refrescarPedidos()`, que re-listea por REST y actualiza tres cosas: la lista, `pedidoActual` (la pantalla de confirmación, que vive solo en memoria) y las notificaciones de cambio de estado.

Dos detalles de implementación:

- La dependencia del efecto es un **string de ids ordenados** (`idsPedidos`), no el array `pedidos`. Así el efecto corre solo cuando cambia el conjunto de pedidos —por ejemplo al crear uno nuevo, que hay que suscribir— y no en cada cambio de estado.
- El cleanup usa `off()` para los tres listeners y **no** desconecta el socket. Desconectar corría en cada re-ejecución del efecto; la desconexión real se dispara en un efecto aparte, cuando `emailSesion` queda vacío (logout).

## 9. Pruebas

| Caso | Qué verifica                                                             | Dónde                                       |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------- |
| 1    | Crear un pedido no emite nada (nace `pendiente`)                         | `lib/realtime/conexion.test.js` — **verde** |
| 2    | Cliente confirma → admin recibe `pedido_actualizado` con solo `pedidoId` | **verde**                                   |
| 3    | Varios admins conectados reciben sin suscribirse                         | **verde**                                   |
| 4    | Dos clientes con pedidos distintos → solo el dueño recibe                | **verde**                                   |
| 5    | Sin sesión → handshake rechazado                                         | **verde**                                   |
| 6    | Falla la BD → no se emite el evento                                      | **verde**                                   |
| 7    | Reconexión: id nuevo, rooms perdidas, re-suscripción, sin duplicados     | **verde** (6 tests)                         |

Estado: 25 tests en `lib/realtime/conexion.test.js` + 123 preexistentes = **148/148, 12 suites**.

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

**Navegador, en el frontend** (`scripts/verificar-tiempo-real.js`):

```bash
npm run test:tiempo-real   # requiere backend (:3000) y frontend (:5173)
# la primera vez: npx playwright install chromium
```

Verifica lo que los tests del backend no pueden ver: que la UI real escuche el socket, que el polling haya desaparecido y que las vistas se actualicen solas.

**Los dos scripts limpian al terminar.** Los tests crean pedidos por la API, que no tiene `DELETE /api/pedidos`, y el listado del admin devuelve todos los pedidos: sin limpieza el panel se llenaba de ~90 pedidos de prueba. Al terminar, cada script invoca `scripts/limpiar-pedidos-de-prueba.js` (`npm run limpiar:pruebas`), que borra los pedidos de los usuarios de prueba y sus dependientes (`PedidoItems`, `PedidoEstadoHistorials`, `PedidoPromociones`) en una transacción.

El script borra emails `%@test.com` **menos** `cliente@test.com` y `admin@test.com`, que son los de la seeder. Como borra datos de demo si algo sale mal, tiene tres controles: aborta si el patrón matchea un usuario protegido, no borra nada con `--dry-run`, y compara el conteo de pedidos de ejemplo antes y después (sale con código 1 si cambiaron). Se desactiva con `WS_TEST_LIMPIAR=0` para depurar una corrida fallida.

Toma la configuración de `lib/config/config.js`, así que respeta `NODE_ENV`: con `NODE_ENV=test` limpia `SQL_TEST_DATABASE` y nunca la base de desarrollo. Eso no era gratis: la primera versión leía `.env.development` a propósito, con lo cual `NODE_ENV=test node scripts/limpiar-pedidos-de-prueba.js` habría borrado los datos de desarrollo creyendo estar en la de test. Tiene su propio test en `scripts/limpiar-pedidos-de-prueba.test.js`, que comprueba sobre la base de test que el dry-run no borra nada, que se van los pedidos de prueba con sus tres tablas hijas, y que los usuarios protegidos siguen con los suyos.

Dos detalles de este script que costaron encontrar:

- Los estados se leen de los `.badge` y no del texto de la página. Las etiquetas de estado también están en el desplegable de filtros, así que buscar "En preparación" en el `innerText` daba un OK falso aunque la lista no se hubiera actualizado. Los casos donde el cliente no debe recibir nada usan un segundo usuario de verdad, no dos sockets del mismo usuario: con dos sockets del mismo cliente la autorización no se ejercita y el test pasa por inercia.
- Se registra una petición a `/api/pedidos` por evento en vez de esperar un texto, porque el refetch ocurre aunque la vista no muestre el cambio.

### 9.3 Límite conocido: un pedido creado en otra pestaña

El cliente solo recibe los avisos de los pedidos que tiene en su lista. En el flujo normal eso no molesta: al crear, `crearPedido` inserta el pedido en el estado y el efecto lo suscribe.

Lo que **no** está cubierto: si el usuario tiene Mis Pedidos abierto en una pestaña y crea el pedido en otra, esa pestaña no se entera hasta que recargue. La causa es directa: no hay evento de creación, y un cliente no puede suscribirse a la room de un pedido que todavía no conoce.

Cerrarlo requiere una decisión de producto: o un `pedido_creado` dirigido solo al room del cliente, o aceptar el refresh manual.

### 9.4 Un detalle que costó horas: la cookie de sesión va firmada

Al reutilizar sesiones para las pruebas manuales, mandar el `sid` crudo de la tabla `session` devuelve **401 en todas las requests**, aunque la fila exista y no esté vencida.

`express-session` firma la cookie: el valor real es `s:<sid>.<hmac-sha256-en-base64>`. `cookie-parser` solo puebla `req.signedCookies` si la firma valida, y `express-session` lee el sid de ahí. Con el `sid` pelado no hay sesión, y por eso tampoco entra el handshake del socket.

La receta para reusar una sesión sin pasar por `/api/auth/login` (que está rate-limited a 20 req / 15 min) es firmar el sid con `SESSION_SECRET` y mandar `comirapi.sid=s:<sid>.<firma>`.

Además, el CSRF es double-submit: el token que se manda en el header tiene que ser **exactamente** el de la cookie vigente, así que hay que re-leer la cookie `csrf-token` de cada `Set-Cookie` antes de construir la siguiente petición.

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

Para confirmar que el polling desapareció: en Network, filtrar `pedidos` y dejar la página quieta. No debe aparecer ninguna petición repetida; solo las ones que dispara un evento.

## 10.1 Archivos del frontend

| Archivo                         | Responsabilidad                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/services/socket.js`        | Instancia única, `conectarSocket`, `desconectarSocket`, `suscribirPedido`, `EVENTOS_SOCKET` |
| `src/context/PedidoContext.jsx` | Effect que escucha los eventos y llama a `refrescarPedidos()`                               |
| `.env`                          | `VITE_SOCKET_URL` (además de `VITE_API_URL`)                                                |
| `package.json`                  | `socket.io-client@^4.8.4`                                                                   |

`socket.js` es un **singleton a propósito**: `conectarSocket()` devuelve siempre la misma instancia si ya está viva. En desarrollo, el Strict Mode de React monta dos veces los efectos, y sin singleton se abrirían dos conexiones con dos juegos de listeners.

## 11. Restricciones

1. Nunca enviar el objeto `Pedido` por el socket: solo `pedidoId`.
2. No emitir antes del commit.
3. No reemplazar la API REST ni agregar endpoints para "compensar" al socket.
4. No agregar JWT: la autenticación es la sesión existente.
5. No cambiar las rutas REST, el CRUD ni la protección CSRF.
6. No modificar la autorización: se reusa la de `pedido_controller.js`.
7. No emitir desde `lib/models/`.

## 12. Ver también

- `AGENTS.md` — arquitectura y convenciones del backend
- `docs/plan-estados-pedido.md` — reglas de transición de estados
- `docs/reglas-negocio.md` — reglas de negocio de pedidos
