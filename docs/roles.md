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

### Sucursal asignada

La columna `sucursales.id` en `Usuarios` (`sucursalId`) solo tiene valor para `ADMINISTRADOR`:

- `ADMINISTRADOR`: debe tener una sucursal asignada (obligatoria y existente).
- `CLIENTE` y `SUPERADMINISTRADOR`: siempre `null` (no están acotados a ninguna sucursal).

La sucursal efectiva de una sesión **siempre sale de la sesión server-side** (`sucursalDeSesion` en `lib/middlewares/auth.js`), nunca de un `sucursalId` enviado en el request.

## 2. Middlewares de autorización

Definidos en `lib/middlewares/auth.js`:

| Middleware                | Rol afectado         | Comportamiento                                                                                                            |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `verificarSesion`         | Todos                | Exige sesión activa y usuario existente y activo; carga `req.usuario`. Devuelve 401 si no.                                |
| `permitirRoles(...roles)` | Todos                | 403 si `req.usuario.rol` no está en la lista.                                                                             |
| `requiereSucursal`        | Solo `ADMINISTRADOR` | 403 si un admin no tiene sucursal asignada. No afecta a SUPERADMIN ni CLIENTE.                                            |
| `acotarASucursalPropia`   | Solo `ADMINISTRADOR` | 403 si el admin opera sobre un `:sucursalId` distinto al suyo.                                                            |
| `sesionOpcional`          | —                    | Carga `req.usuario` si hay sesión pero no rechaza la petición (rutas públicas que distinguen autenticado/no autenticado). |

## 3. Permisos por módulo (backend)

Fuente: `lib/routes/*.js`.

| Módulo / ruta                                                            | Público             | CLIENTE         | ADMINISTRADOR                                 | SUPERADMINISTRADOR                 |
| ------------------------------------------------------------------------ | ------------------- | --------------- | --------------------------------------------- | ---------------------------------- |
| `GET /api/health`                                                        | ✔                   | ✔               | ✔                                             | ✔                                  |
| `POST /api/auth/login`, `GET /api/auth/csrf-token`                       | ✔                   | ✔               | ✔                                             | ✔                                  |
| `GET /api/auth/me`, `POST /api/auth/logout`                              | —                   | ✔               | ✔                                             | ✔                                  |
| `GET /api/categorias(/:id)`, `/productos`, `/sucursales`, `/promociones` | ✔ (sesión opcional) | ✔               | ✔                                             | ✔                                  |
| `GET /api/geo/*`, `GET /api/docs`                                        | ✔                   | ✔               | ✔                                             | ✔                                  |
| `GET /api/direcciones(/:id)` (ver direcciones)                           | —                   | ✔               | ✔ (de un cliente, en su detalle)              | ✔ (de un cliente, en su detalle)   |
| `POST/PUT/DELETE /api/direcciones`                                       | —                   | ✔               | —                                             | —                                  |
| `/api/perfil` (todas)                                                    | —                   | ✔               | —                                             | —                                  |
| `/api/pedidos` POST, PATCH estado                                        | —                   | ✔               | ✔ (requiere sucursal)                         | —                                  |
| `/api/pedidos` GET, `/:id` (ver pedidos)                                 | —                   | ✔ (los propios) | ✔ (solo de su sucursal)                       | ✔ (visión global)                  |
| `POST/PUT/DELETE /api/categorias`, `/productos`, `/promociones`          | —                   | —               | —                                             | ✔                                  |
| `POST/PUT/DELETE /api/sucursales` (CRUD)                                 | —                   | —               | —                                             | ✔                                  |
| `/api/imagenes` (upload / recuperar)                                     | recuperar parcial   | —               | —                                             | ✔                                  |
| `/api/stock` (todas)                                                     | —                   | —               | ✔ (requiere + acota a su sucursal)            | —                                  |
| `GET /api/usuarios(/:id)` (listar/ver)                                   | —                   | —               | ✔ (solo CLIENTE con ≥1 pedido en su sucursal) | ✔ (todos los usuarios registrados) |
| `POST /api/usuarios`, `PUT /api/usuarios/:id` (crear/editar)             | —                   | —               | —                                             | ✔                                  |
| `GET /api/superadmin/resumen`                                            | —                   | —               | —                                             | ✔                                  |

Nota: el `SUPERADMINISTRADOR` **no** opera pedidos individuales ni stock por API; su panel se apoya en agregados globales calculados en base de datos (`COUNT`/`SUM`/`GROUP BY`) y, para el detalle de un cliente, consulta en lectura sus pedidos y direcciones. El catálogo sí lo edita él por API: es único y corporativo, y el admin solo controla su disponibilidad por sucursal desde el stock. La personalización (ingredientes y recetas) es hoy mock de frontend, sin endpoint propio.

## 4. Reglas de negocio por rol

### CLIENTE

- Puede crear pedidos, repetir pedidos anteriores, cambiar estado de sus propios pedidos (cancelar).
- Gestiona sus direcciones, con geolocalización.
- Solo accede a su perfil (`/api/perfil`).
- Un pedido siempre pertenece a un cliente (`Pedido.usuarioId`); la propiedad se valida en `index`/`show`.

### ADMINISTRADOR

- Escritura de su sucursal: stock (cantidades y disponibilidad por producto). El CRUD de catálogo (productos, categorías, promociones, imágenes) no es suyo: lo edita el SUPERADMINISTRADOR. El admin ve los listados de catálogo en **solo lectura** y, desde Productos, activa/desactiva la disponibilidad de cada ítem en su sucursal (alternativa directa al toggle del stock).
- Pedidos: opera los de su sucursal (estado pendiente → confirmado → en preparación → ...).
- **Sin sucursal asignada queda bloqueado** para operar recursos acotados (`requiereSucursal`), y nunca accede a sucursales ajenas (`acotarASucursalPropia`).
- Lista usuarios a través de `/api/usuarios` (panel de clientes): ve solo los `CLIENTE` que hicieron al menos un pedido en su sucursal; el detalle de un usuario sigue la misma regla.
- No administra sucursales: el CRUD es del SUPERADMINISTRADOR.

### SUPERADMINISTRADOR

- Ve el resumen agregado del negocio con filtros (`GET /api/superadmin/resumen`): totales, por sucursal, por estado, serie de 30 días, por operación.
- Gestiona usuarios administrativos: crea y edita `ADMINISTRADOR` (con sucursal asignada) y `SUPERADMINISTRADOR`. El panel no crea ni edita clientes.
- En su panel de clientes ve el mismo detalle que el admin: direcciones (con cobertura) y últimos pedidos de cualquier CLIENTE, en solo lectura.
- Ve todos los usuarios registrados a través de `GET /api/usuarios` (sin la acotación por sucursal del admin), con filtros por `rol` y `buscar`. El panel de Clientes filtra `rol=CLIENTE`.
- Gestiona las sucursales (CRUD completo: crear, editar, dar de baja) — decisión corporativa.
- Gestiona el catálogo completo (CRUD de productos, combos, categorías, promociones y subida de imágenes) — decisión corporativa: el catálogo vale para todas las sucursales.
- No gestiona pedidos individuales ni stock (decisión de alcance de la entrega); cada admin opera los de su sucursal.
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
- `ProtectedRoute` (`src/components/comunes/ProtectedRoute.jsx`) acepta `requiredRole`; si no se indica, solo exige sesión.
- `destinoPorRol`: SUPERADMIN → `/superadmin/panel`; ADMIN → `/admin/dashboard`; CLIENTE → home.

### Rutas protegidas por rol (`src/routes/AppRoutes.jsx`)

- Grupo `requiredRole="CLIENTE"`, grupo `requiredRole="ADMINISTRADOR"` (dashboard, pedidos, stock, clientes y el catálogo en solo lectura: `/admin/productos`, `/admin/categorias`, `/admin/promociones`) y grupo `requiredRole="SUPERADMINISTRADOR"` (`/superadmin/panel`, `/superadmin/administradores`, `/superadmin/sucursales`, `/superadmin/sucursal/nuevo`, `/superadmin/sucursal/editar/:id` y el CRUD del catálogo: `/superadmin/productos`(+`/producto/{nuevo,nuevo-combo,editar/:id}`), `/superadmin/categorias`(+`/categoria/{nuevo,editar/:id}`), `/superadmin/personalizacion`(+`/nuevo`, `/editar/:id`) y `/superadmin/promociones`(+`/promocion/{nuevo,editar/:id}`)).
- Roles definidos en `ROLES` (`CLIENTE`, `ADMIN`, `SUPERADMIN`) en `src/constants.js` y `AuthContext` expone `isAdmin`, `isSuperadmin`, `isCliente`.

### Navegación por rol

- `Navbar.jsx`: menú distinto según rol (`menuCliente`, `menuAdmin`, `menuSuperadmin` — Panel, Administradores, Clientes, Catálogo y Sucursales). El admin conserva el desplegable "Catálogo" (listados en SOLO LECTURA con disponibilidad por sucursal en Productos) y no tiene "Sucursales": queda con Dashboard, Pedidos, Catálogo, Stock y Clientes.
- `NavInferior.jsx` / `useMuestraNavInferior.js`: la barra inferior se muestra para CLIENTE, ADMIN y SUPERADMIN. El admin lleva Inicio, Pedidos, Catálogo (hoja en solo lectura) y Stock; el superadmin Panel, Administradores, Clientes, la hoja "Catálogo" (abre los CRUD) y Sucursales.
- `rutas.js` (`esRutaDeAdmin`): rutas bajo `/admin` **y** `/superadmin` no muestran el footer de cliente.

### Panel SUPERADMIN

- `/superadmin/panel` → `components/superadmin/PanelSuperadmin.jsx`: tarjetas (total, vendidos, pendientes, ingresos), tablas por sucursal, por estado, serie de 30 días y por operación.
- `/superadmin/administradores` → `components/superadmin/GestionAdministradores.jsx`: listado de ADMINISTRADOR y SUPERADMINISTRADOR, alta/edición con modal (selector de rol, sucursal para admin, toggle de activo).
- `/superadmin/clientes` → `components/admin/ListaClientes.jsx` (prop `todos`): lista todos los CLIENTES registrados; `/superadmin/clientes/:id` → `pages/superadmin/DetalleCliente.jsx` (detalle de cliente como el del admin).
- `/superadmin/sucursales` y `/superadmin/sucursal/{nuevo,editar/:id}` → `pages/superadmin/GestionSucursales.jsx` y `EditarSucursal.jsx` (movidas desde el panel admin): CRUD completo de sucursales.

## 7. Tiempo real (Socket.IO)

El servidor coloca automáticamente en salas según el rol al conectar:

| Rol                | Sala                                         |
| ------------------ | -------------------------------------------- |
| CLIENTE            | su propio canal de pedidos (por `usuarioId`) |
| ADMINISTRADOR      | `sucursal:{id}` de su sucursal asignada      |
| SUPERADMINISTRADOR | `admins` (eventos globales)                  |

Más detalle en `docs/webSocketContext.md`.

## 8. Resumen (tabla rápida)

| Acción                                                              | CLIENTE     | ADMINISTRADOR | SUPERADMINISTRADOR                           |
| ------------------------------------------------------------------- | ----------- | ------------- | -------------------------------------------- |
| Comprar / perfil / direcciones                                      | ✔           | —             | —                                            |
| Catálogo (edición: productos, categorías, promociones, imágenes)    | —           | —             | ✔                                            |
| Catálogo (ver listados, solo lectura + disponibilidad por sucursal) | —           | ✔             | ✔                                            |
| Stock (cantidad y disponibilidad por sucursal)                      | —           | ✔             | —                                            |
| Pedidos (operativa por sucursal)                                    | ✔ (propios) | ✔ (sucursal)  | — (solo métricas)                            |
| Ver pedidos (detalle)                                               | ✔ (propios) | ✔ (sucursal)  | ✔ (visión global)                            |
| Ver detalle de un cliente (datos, direcciones, últimos pedidos)     | —           | ✔             | ✔                                            |
| CRUD de sucursales                                                  | —           | —             | ✔                                            |
| Resumen global / métricas                                           | —           | —             | ✔                                            |
| Crear/editar usuarios                                               | —           | —             | ✔ (ADMIN y SUPERADMIN; CLIENTE solo por API) |
| Crear SUPERADMINISTRADOR                                            | —           | —             | ✔ (panel o API; el primero por script)       |
