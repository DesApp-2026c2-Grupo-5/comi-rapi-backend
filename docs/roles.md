# Roles del sistema

Este documento describe el modelo de roles de Comi-Rapi, sus reglas de negocio, los permisos por módulo (backend) y cómo se materializan en la UI (frontend).

## 1. Modelo de roles

Existen tres roles jerárquicos:

| Rol                  | Nivel       | Alcance                                                                                                                                                              |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLIENTE`            | Base        | Comprar, gestionar sus direcciones y su perfil.                                                                                                                      |
| `ADMINISTRADOR`      | Gestión     | Operar su sucursal (stock, pedidos y clientes).                                                                                                                      |
| `SUPERADMINISTRADOR` | Corporativo | Visión global de todas las sucursales, gestión de usuarios admin y CRUD del catálogo (corporativo y único para todas las sucursales). Abarca los niveles inferiores. |

En la base el campo `rol` es un `ENUM('CLIENTE','ADMINISTRADOR','SUPERADMINISTRADOR')` (ver `lib/models/usuario.js`), obligatorio, con default `CLIENTE`.

### Sucursal asignada y sucursal de contexto

La columna `sucursales.id` en `Usuarios` (`sucursalId`) solo tiene valor para `ADMINISTRADOR`:

- `ADMINISTRADOR`: debe tener una sucursal asignada (obligatoria y existente).
- `CLIENTE` y `SUPERADMINISTRADOR`: siempre `null` (no están acotados a ninguna sucursal; el CHECK `chk_usuarios_sucursal_solo_admin` lo garantiza a nivel BD).

La sucursal efectiva de una sesión **siempre sale de la sesión server-side**, nunca de un `sucursalId` enviado en el request:

- `sucursalDeSesion` (`lib/middlewares/auth.js`): la asignada del `ADMINISTRADOR` (fuente del scoping de lecturas como el listado de pedidos del admin).
- `sucursalOperativaDeSesion`: la sucursal "en la que está parado" quien opera. Para el `ADMINISTRADOR` es su asignada; para el `SUPERADMINISTRADOR` es el **contexto de sucursal** que elige explícitamente (`POST /api/auth/sucursal-contexto`, validado contra la BD: existe y está activa) y vive en la sesión (`sucursalOperativaId`). `/api/auth/me` la expone como `sucursalOperativa` para ambos roles. Limpiar el contexto (`DELETE /api/auth/sucursal-contexto`) devuelve al superadmin a su rol puramente global.

## 2. Middlewares de autorización

Definidos en `lib/middlewares/auth.js`:

| Middleware                  | Rol afectado                   | Comportamiento                                                                                                                                                                                                |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verificarSesion`           | Todos                          | Exige sesión activa y usuario existente y activo; carga `req.usuario`. Devuelve 401 si no.                                                                                                                    |
| `permitirRoles(...roles)`   | Todos                          | 403 si `req.usuario.rol` no está en la lista.                                                                                                                                                                 |
| `requiereSucursal`          | Solo `ADMINISTRADOR`           | 403 si un admin no tiene sucursal asignada. No afecta a SUPERADMIN ni CLIENTE (protege también sus lecturas globales).                                                                                        |
| `requiereSucursalOperativa` | `ADMINISTRADOR` y `SUPERADMIN` | 403 si la sesión no tiene sucursal operativa: admin sin sucursal asignada o superadmin sin contexto elegido ("Elegí una sucursal para operar"). El CLIENTE pasa: su autorización es por propiedad del pedido. |
| `acotarASucursalPropia`     | `ADMINISTRADOR` y `SUPERADMIN` | 403 si se opera sobre un `:sucursalId` distinto a la sucursal OPERATIVA de la sesión (asignada o contexto).                                                                                                   |
| `sesionOpcional`            | —                              | Carga `req.usuario` si hay sesión pero no rechaza la petición (rutas públicas que distinguen autenticado/no autenticado).                                                                                     |

## 3. Permisos por módulo (backend)

Fuente: `lib/routes/*.js`.

| Módulo / ruta                                                                  | Público             | CLIENTE         | ADMINISTRADOR                                                                 | SUPERADMINISTRADOR                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------- | --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                                                              | ✔                   | ✔               | ✔                                                                             | ✔                                                                                                                              |
| `POST /api/auth/login`, `GET /api/auth/csrf-token`                             | ✔                   | ✔               | ✔                                                                             | ✔                                                                                                                              |
| `GET /api/auth/me`, `POST /api/auth/logout`                                    | —                   | ✔               | ✔                                                                             | ✔                                                                                                                              |
| `POST /api/auth/sucursal-contexto`, `DELETE /api/auth/sucursal-contexto`       | —                   | —               | —                                                                             | ✔ (elige/limpia su sucursal de contexto; valida activa)                                                                        |
| `GET /api/categorias(/:id)`, `/productos`, `/sucursales`, `/promociones`       | ✔ (sesión opcional) | ✔               | ✔                                                                             | ✔                                                                                                                              |
| `GET /api/geo/*`, `GET /api/docs`                                              | ✔                   | ✔               | ✔                                                                             | ✔                                                                                                                              |
| `GET /api/direcciones(/:id)` (ver direcciones)                                 | —                   | ✔               | ✔ (de un cliente, en su detalle)                                              | ✔ (de un cliente, en su detalle)                                                                                               |
| `POST/PUT/DELETE /api/direcciones`                                             | —                   | ✔               | —                                                                             | —                                                                                                                              |
| `/api/perfil` (todas)                                                          | —                   | ✔               | —                                                                             | —                                                                                                                              |
| `/api/pedidos` POST                                                            | —                   | ✔               | ✔ (requiere sucursal)                                                         | —                                                                                                                              |
| `PATCH /api/pedidos/:id/estado` (cambiar estado)                               | —                   | ✔ (dueño)       | ✔ (solo pedidos de su sucursal)                                               | ✔ (solo pedidos de la sucursal de su contexto)                                                                                 |
| `PATCH /api/pedidos/:id/sucursal` (reasignación manual)                        | —                   | —               | —                                                                             | ✔ (solo pedidos de la sucursal de su contexto; destino con cobertura+stock)                                                    |
| `GET /api/pedidos/:id/sucursales-candidatas`                                   | —                   | —               | —                                                                             | ✔ (destinos en cobertura con stock, para el selector del panel)                                                                |
| `/api/pedidos` GET, `/:id` (ver pedidos)                                       | —                   | ✔ (los propios) | ✔ (solo de su sucursal)                                                       | ✔ (visión global, no se acota por el contexto)                                                                                 |
| `POST/PUT/DELETE /api/categorias`, `/productos`, `/promociones`                | —                   | —               | —                                                                             | ✔                                                                                                                              |
| `POST/PUT/DELETE /api/sucursales` (CRUD)                                       | —                   | —               | —                                                                             | ✔                                                                                                                              |
| `/api/imagenes` (upload / recuperar)                                           | recuperar parcial   | —               | —                                                                             | ✔                                                                                                                              |
| `/api/stock` (todas)                                                           | —                   | —               | ✔ (requiere + acota a su sucursal)                                            | ✔ (requiere + acota a la sucursal de su contexto)                                                                              |
| `GET /api/usuarios(/:id)` y `GET /api/usuarios/:id/mas-comprados` (listar/ver) | —                   | —               | ✔ (solo CLIENTE con ≥1 pedido en su sucursal; el ranking acota a su sucursal) | ✔ (todos los usuarios registrados; el ranking suma todas las sucursales)                                                       |
| `POST /api/usuarios`, `PUT /api/usuarios/:id` (crear/editar)                   | —                   | —               | —                                                                             | ✔                                                                                                                              |
| `GET /api/superadmin/resumen`                                                  | —                   | —               | —                                                                             | ✔                                                                                                                              |
| `GET /api/reportes`                                                            | —                   | —               | ✔ (solo su sucursal; sin sucursal 403)                                        | ✔ (global o filtrado por `sucursalId`; el `?sucursalId=` es un filtro de LECTURA por request, distinto del contexto operativo) |

Nota: el `SUPERADMINISTRADOR` opera pedidos y stock **solo dentro del contexto de sucursal elegido** (`sucursalOperativaDeSesion`); su visión de pedidos sigue siendo global y sus capacidades corporativas (resumen, reportes, CRUD de sucursales/usuarios/catálogo, parámetros) no cambian. El `ADMINISTRADOR` **ya no reasigna pedidos manualmente**: la reasignación manual es exclusiva del superadmin con contexto. El catálogo lo edita solo el superadmin: es único y corporativo, y el admin controla su disponibilidad por sucursal desde el stock. La personalización (ingredientes y recetas) es hoy mock de frontend, sin endpoint propio.

## 4. Reglas de negocio por rol

### CLIENTE

- Puede crear pedidos, repetir pedidos anteriores, cambiar estado de sus propios pedidos (cancelar).
- Gestiona sus direcciones, con geolocalización.
- Solo accede a su perfil (`/api/perfil`).
- Un pedido siempre pertenece a un cliente (`Pedido.usuarioId`); la propiedad se valida en `index`/`show`.

### ADMINISTRADOR

- Escritura de su sucursal: stock (cantidades y disponibilidad por producto). El CRUD de catálogo (productos, categorías, promociones, imágenes) no es suyo: lo edita el SUPERADMINISTRADOR. El admin ve los listados de catálogo en **solo lectura** y, desde Productos, activa/desactiva la disponibilidad de cada ítem en su sucursal (alternativa directa al toggle del stock).
- Pedidos: opera los de su sucursal (estado pendiente → confirmado → en preparación → ...).
- **No reasigna pedidos manualmente**: la reasignación manual de sucursal es exclusiva del SUPERADMINISTRADOR con contexto (el endpoint responde 403 a cualquier admin, manipule ids o no).
- **Sin sucursal asignada queda bloqueado** para operar recursos acotados (`requiereSucursalOperativa`), y nunca accede a sucursales ajenas (`acotarASucursalPropia`).
- Lista usuarios a través de `/api/usuarios` (panel de clientes): ve solo los `CLIENTE` que hicieron al menos un pedido en su sucursal; el detalle de un usuario sigue la misma regla. El ranking de productos y categorías más comprados de ese detalle también acota las unidades a los pedidos de su sucursal (los cancelados no suman).
- No administra sucursales: el CRUD es del SUPERADMINISTRADOR.
- Consulta reportes de su sucursal (`GET /api/reportes`) desde su dashboard, sin poder filtrar por otra sucursal. Sin sucursal asignada recibe 403.

### SUPERADMINISTRADOR

- Ve el resumen agregado del negocio con filtros (`GET /api/superadmin/resumen`): totales, por sucursal, por estado, serie de 30 días, por operación.
- Consulta reportes globales o filtrados por sucursal (`GET /api/reportes`) desde `/superadmin/panel`. La venta/facturación considera solo pedidos entregados.
- Gestiona usuarios administrativos: crea y edita `ADMINISTRADOR` (con sucursal asignada) y `SUPERADMINISTRADOR`. El panel no crea ni edita clientes.
- En su panel de clientes ve el mismo detalle que el admin: direcciones (con cobertura), últimos pedidos y el ranking de productos y categorías más comprados de cualquier CLIENTE, en solo lectura. A diferencia del admin, el ranking suma los pedidos de todas las sucursales.
- Ve todos los usuarios registrados a través de `GET /api/usuarios` (sin la acotación por sucursal del admin), con filtros por `rol` y `buscar`. El panel de Clientes filtra `rol=CLIENTE`.
- Gestiona las sucursales (CRUD completo: crear, editar, dar de baja — y ver las dadas de baja, `?activa=false`) — decisión corporativa.
- Gestiona el catálogo completo (CRUD de productos, combos, categorías, promociones y subida de imágenes) — decisión corporativa: el catálogo vale para todas las sucursales.
- **Opera una sucursal por vez con su contexto de sucursal**: elige una sucursal activa (`POST /api/auth/sucursal-contexto`, selector en el Navbar) y trabaja con las mismas capacidades operativas que su administrador — avanzar estados y cancelar pedidos de esa sucursal, editar su stock y **reasignar manualmente** sus pedidos hacia destinos con cobertura y stock (`PATCH /api/pedidos/:id/sucursal`, con `GET /:id/sucursales-candidatas` para el selector). Sin contexto, toda operación recibe 403 ("Elegí una sucursal para operar"); con contexto, no toca pedidos ni stock de otras sucursales sin cambiar el contexto explícitamente. Su lectura de pedidos sigue siendo global y sus capacidades corporativas no cambian.
- No puede cambiarse su propio rol (se autodefine como no degradable).

## 5. Gestión de usuarios (panel SUPERADMIN)

Reglas en `lib/services/usuario_service.js`:

- Solo el actor `SUPERADMINISTRADOR` crea/edita usuarios por API. Se permiten los roles `CLIENTE`, `ADMINISTRADOR` y `SUPERADMINISTRADOR`.
- Un `ADMINISTRADOR` debe llevar un `sucursalId` válido y existente; `CLIENTE` y `SUPERADMINISTRADOR` nunca llevan sucursal.
- Email único (normalizado), contraseña de al menos 6 caracteres hasheada en el hook del modelo.
- La edición permite cambiar nombre, apellido, email, teléfono, rol, sucursal y estado `activo`.
- Protecciones: el SUPERADMIN no puede degradarse a sí mismo; la lista se puede filtrar por `rol` y `buscar` (texto).

### Creación del SUPERADMINISTRADOR

El primer SUPERADMIN se crea por script idempotente (cuenta raíz):

```bash
npm run crear:superadmin
```

- Usa variables de entorno `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` si están definidas; sin ellas usa los defaults `superadmin@test.com` / `123456`.
- No imprime la contraseña en consola.
- Si el email ya existe, no crea duplicados (idempotente).

Una vez existente el primer superadmin, se pueden crear más `SUPERADMINISTRADOR` desde el panel (botón "Nuevo usuario", rol Superadmin) o por `POST /api/usuarios`.

## 6. Frontend

### Autenticación y destino por rol

- Login de gestión unificado en `/admin-login` (`loginPanelAdmin` en `api/auth.js`): acepta tanto `ADMINISTRADOR` como `SUPERADMINISTRADOR` sin elegir rol.
- `ProtectedRoute` (`src/components/comunes/ProtectedRoute.jsx`) acepta `requiredRole` con un rol o un ARRAY de roles (ver `/admin/pedidos` y `/admin/stock`, compartidos); si no se indica, solo exige sesión.
- `destinoPorRol`: SUPERADMIN → `/superadmin/panel`; ADMIN → `/admin/dashboard`; CLIENTE → home.
- El contexto de sucursal del superadmin vive en `SucursalOperativaContext` + `useSucursalOperativa()` (`src/context/SucursalOperativaContext.jsx`): la sucursal operativa sale de `/auth/me` (uniforme para admin y superadmin) y al cambiarla se reconecta el socket para entrar a la room de la sucursal elegida.

### Rutas protegidas por rol (`src/routes/AppRoutes.jsx`)

- Grupo `requiredRole="CLIENTE"`, grupo `requiredRole="ADMINISTRADOR"` (dashboard con reportes, clientes y el catálogo en solo lectura: `/admin/productos`, `/admin/categorias`, `/admin/promociones`) y grupo `requiredRole="SUPERADMINISTRADOR"` (`/superadmin/panel` con reportes, `/superadmin/administradores`, `/superadmin/sucursales`, `/superadmin/sucursal/nuevo`, `/superadmin/sucursal/editar/:id` y el CRUD del catálogo: `/superadmin/productos`(+`/producto/{nuevo,nuevo-combo,editar/:id}`), `/superadmin/categorias`(+`/categoria/{nuevo,editar/:id}`), `/superadmin/personalizacion`(+`/nuevo`, `/editar/:id`) y `/superadmin/promociones`(+`/promocion/{nuevo,editar/:id}`)). `/admin/reportes` y `/superadmin/reportes` quedan como alias de las mismas pantallas.
- Grupo `requiredRole={['ADMINISTRADOR','SUPERADMINISTRADOR']}`: las rutas OPERATIVAS compartidas `/admin/pedidos` y `/admin/stock`. El admin entra siempre (su sucursal asignada); el superadmin, con su contexto elegido (sin contexto, las pantallas muestran el aviso de elegir sucursal y el backend responde 403 a cualquier operación).
- Roles definidos en `ROLES` (`CLIENTE`, `ADMIN`, `SUPERADMIN`) en `src/constants.js` y `AuthContext` expone `isAdmin`, `isSuperadmin`, `isCliente`.

### Navegación por rol

- `Navbar.jsx`: menú distinto según rol (`menuCliente`, `menuAdmin`, `menuSuperadmin` — Panel, Administradores, Clientes, Catálogo y Sucursales). El admin conserva el desplegable "Catálogo" (listados en SOLO LECTURA con disponibilidad por sucursal en Productos) y no tiene "Sucursales": queda con Dashboard, Pedidos, Catálogo, Stock y Clientes. El superadmin, con contexto elegido, suma "Pedidos (sucursal)" y "Stock (sucursal)" y ve el **selector de sucursal de contexto** (solo activas; "Dejar de operar" limpia el contexto) junto al badge de sucursal.
- `NavInferior.jsx` / `useMuestraNavInferior.js`: la barra inferior se muestra para CLIENTE, ADMIN y SUPERADMIN. El admin lleva Inicio, Pedidos, Catálogo (hoja en solo lectura), Stock y Clientes; el superadmin Panel, **Sucursal** (hoja: elige su sucursal de contexto y entra a los pedidos/stock de esa sucursal — en pantalla chica el menú superior queda oculto), Administradores, la hoja "Catálogo" (abre los CRUD) y la hoja "Negocio" (parámetros, sucursales y clientes).
- `rutas.js` (`esRutaDeAdmin`): rutas bajo `/admin` **y** `/superadmin` no muestran el footer de cliente.

### Panel SUPERADMIN

- `/superadmin/panel` y `/admin/dashboard` → `components/reportes/ReporteNegocio.jsx`: pantalla compartida de reportes con presets y rango de fechas, KPIs con variación, evolución de facturación, franja horaria, día de la semana, sucursales, productos (incluido el menos vendido), cancelaciones y promociones. El superadmin puede filtrar por sucursal y ve la cantidad de clientes nuevos del período (sin listarlos); el admin queda acotado a su sucursal y ve además los productos sin stock. No se muestran pedidos por estado.
- `/superadmin/reportes` y `/admin/reportes` quedan como alias de las mismas pantallas.
- `/superadmin/administradores` → `components/superadmin/GestionAdministradores.jsx`: listado de ADMINISTRADOR y SUPERADMINISTRADOR, alta/edición con modal (selector de rol, sucursal para admin, toggle de activo).
- `/superadmin/clientes` → `components/admin/ListaClientes.jsx` (prop `todos`): lista todos los CLIENTES registrados; `/superadmin/clientes/:id` → `pages/superadmin/DetalleCliente.jsx` (detalle de cliente como el del admin).
- `/superadmin/sucursales` y `/superadmin/sucursal/{nuevo,editar/:id}` → `pages/superadmin/GestionSucursales.jsx` y `EditarSucursal.jsx` (movidas desde el panel admin): CRUD completo de sucursales.

## 7. Tiempo real (Socket.IO)

El servidor coloca automáticamente en salas según el rol al conectar:

| Rol                | Sala                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| CLIENTE            | su propio canal de pedidos (por `usuarioId`)                                    |
| ADMINISTRADOR      | `sucursal:{id}` de su sucursal asignada                                         |
| SUPERADMINISTRADOR | `admins` (eventos globales) + `sucursal:{id}` de su contexto, si lo hay elegido |

El contexto se lee de la sesión en el handshake: al cambiarlo, el frontend reconecta el socket para entrar a la room de la sucursal nueva.

Más detalle en `docs/webSocketContext.md`.

## 8. Resumen (tabla rápida)

| Acción                                                              | CLIENTE     | ADMINISTRADOR | SUPERADMINISTRADOR                                           |
| ------------------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------ |
| Comprar / perfil / direcciones                                      | ✔           | —             | —                                                            |
| Catálogo (edición: productos, categorías, promociones, imágenes)    | —           | —             | ✔                                                            |
| Catálogo (ver listados, solo lectura + disponibilidad por sucursal) | —           | ✔             | ✔                                                            |
| Stock (cantidad y disponibilidad por sucursal)                      | —           | ✔ (sucursal)  | ✔ (sucurs. del contexto)                                     |
| Pedidos (operativa por sucursal)                                    | ✔ (propios) | ✔ (sucursal)  | ✔ (sucurs. del contexto)                                     |
| Reasignación manual de sucursal                                     | —           | —             | ✔ (solo pedidos de su contexto, destino con cobertura+stock) |
| Ver pedidos (detalle)                                               | ✔ (propios) | ✔ (sucursal)  | ✔ (visión global)                                            |
| Ver detalle de un cliente (datos, direcciones, últimos pedidos)     | —           | ✔             | ✔                                                            |
| CRUD de sucursales                                                  | —           | —             | ✔                                                            |
| Reportes / métricas (dashboard y panel)                             | —           | ✔ (sucursal)  | ✔ (global o filtrado)                                        |
| Crear/editar usuarios                                               | —           | —             | ✔ (ADMIN y SUPERADMIN; CLIENTE solo por API)                 |
| Crear SUPERADMINISTRADOR                                            | —           | —             | ✔ (panel o API; el primero por script)                       |
