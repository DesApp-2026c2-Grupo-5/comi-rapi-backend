# Informe: rol jerárquico (SUPERADMINISTRADOR)

Resumen del cambio realizado para separar la gestión corporativa de la gestión por sucursal.

## Problema

El sistema tenía un único rol de gestión (`ADMINISTRADOR`) que combinaba dos responsabilidades opuestas:

- operar un local concreto (stock, pedidos de la sucursal), y
- administrar el negocio completo (métricas, sucursales, usuarios).

No existía una vista global ni una forma de administrar los usuarios administrativos.

## Solución

Se introdujo un nivel jerárquico nuevo: `SUPERADMINISTRADOR` sobre `ADMINISTRADOR` sobre `CLIENTE`.

### Backend

- **Modelo:** `rol` pasa a `ENUM('CLIENTE','ADMINISTRADOR','SUPERADMINISTRADOR')` en `Usuarios`; `sucursalId` queda exclusivo para `ADMINISTRADOR`.
- **Autorización:** middlewares `permitirRoles`, `requiereSucursal`, `acotarASucursalPropia` y `sucursalDeSesion` en `lib/middlewares/auth.js`. La sucursal efectiva siempre sale de la sesión, nunca del request.
- **Nuevos endpoints (/api):**
  - `GET /superadmin/resumen` — métricas agregadas del negocio (totales, por sucursal, por estado, serie 30 días, por operación), solo SUPERADMIN. Se calculan en DB (`COUNT`/`SUM`/`GROUP BY`), sin exponer datos de clientes.
  - `GET|POST /usuarios`, `PUT /usuarios/:id` — listar y crear/editar usuarios (solo SUPERADMIN crea/edita `ADMINISTRADOR` y `SUPERADMINISTRADOR`; `ADMINISTRADOR` sigue pudiendo listar). Reglas de negocio en `lib/services/usuario_service.js`: rol válido, sucursal obligatoria para admin, email único, contraseña ≥ 6 hasheada, no auto-degradable.
  - `GET /sucursales?activa=false` — devuelve todas las sucursales (activas e inactivas) para la gestión de admins.
  - **CRUD de sucursales movido a SUPERADMIN:** `POST/PUT/DELETE /sucursales` dejaron de ser del ADMINISTRADOR; crear, editar y dar de baja sucursales es decisión corporativa y solo la puede ejecutar el SUPERADMINISTRADOR.
  - **CRUD del catálogo movido a SUPERADMIN:** `POST/PUT/DELETE /categorias`, `/productos`, `/promociones` y el upload de `/imagenes` pasaron a exigir `SUPERADMINISTRADOR`. El catálogo es único y corporativo (vale para todas las sucursales); el ADMINISTRADOR conserva lectura de catálogo con `sesionOpcional` y activa/desactiva la disponibilidad de cada producto en su sucursal. Para ver promociones inactivas, promociones y stock ahora alcanza con ser ADMIN o SUPERADMIN.
- **Script idempotente** `scripts/crear-superadmin.js` (`npm run crear:superadmin`): crea el primer SUPERADMIN (default `superadmin@test.com`, contraseña por env, nunca se imprime).
- **Stock por sucursal:** los combos se arman contra el stock de la sucursal y la disponibilidad se calcula sobre ella reensamblada de la base.

### Frontend

- **Login unificado** `/admin-login` (`loginPanelAdmin`): acepta admin y superadmin sin seleccionar rol; `destinoPorRol` redirige a `/superadmin/panel` o `/admin/dashboard`.
- **Rutas protegidas por rol** (`ProtectedRoute requiredRole`): grupos CLIENTE, ADMINISTRADOR y SUPERADMINISTRADOR (`/superadmin/panel`, `/superadmin/administradores`).
- **Nuevos componentes:** `components/superadmin/PanelSuperadmin.jsx` (resumen visual con filtros por sucursal/operación y rango), `components/superadmin/GestionAdministradores.jsx` (ABM de ADMINISTRADOR y SUPERADMINISTRADOR con modal, selector de rol, toggle activo y select de sucursal); y `pages/superadmin/GestionSucursales.jsx` + `EditarSucursal.jsx` (CRUD de sucursales, movidas desde el panel admin a `/superadmin/sucursales`).
- **Catálogo en SOLO LECTURA para el ADMIN:** el admin conserva el desplegable "Catálogo" (navbar) y la hoja (barra inferior) con los listados de solo lectura: `pages/admin/GestionProductos.jsx`, `GestionCategorias.jsx` y `GestionPromociones.jsx` (rutas `/admin/productos|categorias|promociones`) renderizan los componentes compartidos con el prop `soloLectura`, que oculta Agregar/Editar/Eliminar. Personalización no se ofrece al admin: es solo del superadmin. En Productos el admin además ve el interruptor de disponibilidad por sucursal. El CRUD completo vive en el panel superadmin: `pages/superadmin/GestionProductos.jsx`, `EditarProducto.jsx`, `GestionCategorias.jsx`, `EditarCategoria.jsx`, `GestionPromociones.jsx`, `EditarPromocion.jsx`, `GestionPersonalizacion.jsx` y `EditarPersonalizacion.jsx` (rutas `/superadmin/productos|producto/*`, `/superadmin/categorias|categoria/*`, `/superadmin/promociones|promocion/*` y `/superadmin/personalizacion`). Los componentes compartidos (`ListaProductos`, `ListaCategorias`, `ListaPromociones`, `FormularioProducto`, `FormularioPersonalizacion`, `SubirImagen`) se reutilizan desde ambos paneles.
- **Navegación:** Navbar con menú por rol (menú Superadmin con Panel, Administradores, Clientes, Catálogo y Sucursales; menú Admin con Dashboard, Pedidos, Catálogo, Stock y Clientes). Barra inferior (hoja "Catálogo") para admin y superadmin; footer oculto para ambos.
- **Tiempo real:** salas jerárquicas — ADMIN → `sucursal:{id}`, SUPERADMIN → `admins`.

### Documentación

- `docs/swagger.yml`: `POST/PUT /usuarios`, `GET /superadmin/resumen`, schemas y tag `Superadmin`.
- `docs/roles.md` (nuevo), `docs/webSocketContext.md`, `docs/estructura-backend.md` y la documentación del frontend actualizadas.

## Alcance (decisiones tomadas)

- El SUPERADMIN **solo ve agregados globales** y decisiones corporativas: no gesta pedidos individuales (ni stock), y sí administra usuarios, el CRUD de sucursales y el CRUD del catálogo (productos, combos, categorías, promociones e imágenes) — el catálogo es único y corporativo. Para el detalle de un cliente en su panel lee en solo lectura sus direcciones y pedidos (visión global).
- El ADMINISTRADOR conserva la operación de su sucursal: stock (cantidad y disponibilidad), pedidos y clientes; el catálogo lo ve en solo lectura y la activación/desactivación de un producto para su sucursal puede hacerse desde su menú Catálogo (Productos) o desde el stock.
- El rol `REPARTIDOR` (Propuesta 2) sigue sin implementarse.
- La personalización de productos (extra/condimento) es mock de frontend, sin endpoint propio.

## Verificación

- Backend: `npm test` → 516/516 OK; `npm run lint` OK.
- Frontend: `npm run build` OK; archivos nuevos limpios en lint (el repo arrastra errores de lint preexistentes ajenos a este cambio).
- E2E local: backend `:3000`, frontend `:5173`; login `superadmin@test.com` + `GET /api/superadmin/resumen` responden correctamente.
