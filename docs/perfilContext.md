# Contexto: Perfil y gestión de cuenta del cliente

Fecha: 2026-09-30
Archivo: `comi-rapi-backend/docs/perfilContext.md`
Estado: **documento vivo** — se actualiza al cerrar cada parte de la implementación.

## 1. Qué hace

La sección `/cliente/perfil` deja que el cliente vea y edite su propia cuenta, sin
tocar la autenticación ni el CRUD administrativo que ya existían:

- **Ver** sus datos personales.
- **Editar** email, teléfono y fecha de nacimiento (y solo cuando lo pide: la ficha arranca en modo lectura).
- **Agregar, cambiar o quitar** la foto de perfil.
- **Cambiar la contraseña**, verificando la actual.

No es un alta ni una baja de usuario, y no agrega ninguna forma de tocar la cuenta
de otro: es exactamente lo que ya podía hacer un usuario sobre sí mismo, ordenado en
una pantalla.

`nombre` y `apellido` **no** se modifican desde acá: son la identidad de la cuenta
(el nombre que ve el cliente en cada pedido y en la interfaz) y cambiarlos desde un
formario de perfil los dejaría inconsistentes con el historial. El backend los
rechaza con `400` igual que a `rol` o `activo`.

## 2. Estado de la implementación

| Parte | Alcance                                                                                     | Estado    |
| ----- | ------------------------------------------------------------------------------------------- | --------- |
| 1     | Migración `fotoPerfilUrl`, modelo y serializador `datosDePerfil()`                          | **Hecho** |
| 2     | `GET/PUT /api/perfil` con validación y campos protegidos                                    | **Hecho** |
| 3     | `POST/DELETE /api/perfil/foto` con el servicio de imágenes compartido                       | **Hecho** |
| 4     | `POST /api/perfil/cambiar-password` con invalidación de las demás sesiones                  | **Hecho** |
| 5     | Frontend: `api/perfil.js`, página `Perfil.jsx`, ruta, navbar y `refrescarUsuario`           | **Hecho** |
| 6     | Rediseño de la interfaz: acceso por avatar, ficha en modo lectura, direcciones en el perfil | **Hecho** |
| 7     | Rate limit por usuario en el cambio de contraseña                                           | **Hecho** |
| 8     | Tests del backend (30 del perfil + 12 de rate limit) y verificación end-to-end              | **Hecho** |

**Estado actual: implementación completa y verificada.** 250/250 tests en 18 suites;
verificado además a mano contra el backend de desarrollo (sección 10).

## 3. Principio rector

> **El usuario siempre sale de la sesión. Nunca del cuerpo de la petición.**

No existe `GET /api/perfil/:id` ni `PUT /api/perfil/:id`, y en el body no se acepta
`usuarioId` ni `id`. El controller lee `req.usuario.id`, que `verificarSesion` ya
resolvió desde la cookie `comirapi.sid`.

Esto no es una preferencia de estilo: es lo que impide que un cliente edite la
cuenta de otro. Un endpoint con id en la ruta obliga a una comparación de propiedad
en cada handler; este la resuelve una sola vez, en el middleware que ya existe.

## 4. Contrato HTTP

Montado en `lib/routes/index.js:35` como `router.use('/api/perfil', perfil)`.

| Método   | Ruta                           | Body                                            | Respuesta                          |
| -------- | ------------------------------ | ----------------------------------------------- | ---------------------------------- |
| `GET`    | `/api/perfil`                  | —                                               | Perfil                             |
| `PUT`    | `/api/perfil`                  | Solo `email`, `telefono`, `fechaNacimiento`     | Perfil actualizado                 |
| `POST`   | `/api/perfil/foto`             | `multipart/form-data`, campo `imagen`           | `201` + `{ url }`                  |
| `DELETE` | `/api/perfil/foto`             | —                                               | Perfil con `fotoPerfilUrl` en null |
| `POST`   | `/api/perfil/cambiar-password` | `{ passwordActual, password, confirmPassword }` | `{ message }`                      |

Todas las respuestas usan el formato uniforme del proyecto: `{ success: true, data }`
o `{ success: false, error }`.

Cadena de middlewares (`lib/routes/perfil.js`):

```
router.use(verificarSesion, permitirRoles('CLIENTE'))   → 401 sin sesión, 403 si no es CLIENTE
router.post('/foto', subirImagenUnica(), ...)           → 400 si no es imagen o excede 5 MB
router.post('/cambiar-password', perfilPasswordLimiter, ...)
                                                       → 429 al superar 5 intentos en 15 min
```

El CSRF global de `lib/app.js:37` corre **antes** de las rutas en todo POST/PUT/DELETE.

## 5. Arquitectura

```
Browser ──REST──► Express ──► Middlewares ──► Controllers ──► Services ──► Models ──► PostgreSQL
                                  │                │             │           │
                             verificarSesion   perfil_controller  perfil_service  Usuario
                             + CSRF                                + imagen_upload_service
                             + permitirRoles                      + sesion_service
```

### 5.1 Mapa de archivos

| Archivo                                                         | Responsabilidad                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `lib/routes/perfil.js`                                          | Los 5 endpoints. `verificarSesion` + `permitirRoles('CLIENTE')` una sola vez para todos                  |
| `lib/controllers/perfil_controller.js`                          | HTTP ↔ dominio: validación de formato, campos protegidos, traducción de errores                          |
| `lib/services/perfil_service.js`                                | Reglas de negocio: unicidad de email, Argon2id al cambiar la contraseña, borrado de la foto anterior     |
| `lib/services/sesion_service.js`                                | `eliminarSesiones(usuarioId, { transaction, exceptoSid })`, compartida con la recuperación de contraseña |
| `lib/services/imagen_upload_service.js`                         | `guardarImagenPerfil()` y `eliminarImagenEnCarpeta()` junto a las de productos/categorías                |
| `lib/middlewares/upload.js`                                     | `subirImagenUnica()`: multer en memoria, 5 MB, solo JPG/PNG/WEBP, errores traducidos a 400               |
| `lib/middlewares/rate_limit.js`                                 | `perfilPasswordLimiter`: 5 cambios de contraseña por usuario cada 15 minutos                             |
| `lib/models/usuario.js`                                         | Campo `fotoPerfilUrl` y `datosDePerfil()`                                                                |
| `db/migrations/20260930000001-agregar-foto-perfil-a-usuario.js` | Agrega la columna `fotoPerfilUrl` a `Usuarios`                                                           |
| `lib/config/config.js:158-166`                                  | `imagenes.perfilesDir` / `imagenes.perfilesUrlBase`                                                      |

### 5.2 Dos archivos que quedaron fuera de `perfil_*`

- **`sesion_service.js`** nació en la recuperación de contraseña y ahora lo usan los
  dos features: ambos necesitan invalidar las sesiones de una cuenta. Para no romper
  la API pública previa, `password_reset_service.js` la importa y la **reexporta**
  (`export { eliminarSesiones }`): `docs/recuperacion-contrasena.md:93` sigue siendo
  cierto y los tests que la importaban desde ahí no se tocaron.
- **`lib/middlewares/upload.js`** es el multer que ya usaba `lib/routes/imagenes.js`.
  Se extrajo tal cual (misma configuración, mismos errores) y ahora lo comparten las
  imágenes del admin y la foto de perfil. Sin extraerlo, el perfil habría tenido su
  propia copia con límites distintos.

### 5.3 Un tercer archivo que quedó fuera de `perfil_*`

- **`lib/middlewares/rate_limit.js`** nació para login y recuperación de contraseña
  (`docs/recuperacion-contrasena.md:110`). El perfil no inventó un limitador nuevo: sumó
  `perfilPasswordLimiter` al mismo archivo, con el mismo criterio de
  `skip: () => !config.rateLimit.enabled` que permite desactivar todo con
  `RATE_LIMIT_ENABLED=false` (por eso los tests pueden repetir el endpoint).

## 6. Serialización: `datosDePerfil()`

El perfil **no** se arma con un `res.json(usuario)`. El modelo expone tres vistas y
el perfil usa la nueva:

| Método                | Campos                                                                  | Uso                                   |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `datosPublicos()`     | `id, nombre, apellido, email, telefono, rol, fotoPerfilUrl`             | Navegación y datos de sesión          |
| `datosPrivados()`     | lo anterior + `passwordHash`, `tokenHash`                               | Verificaciones internas del backend   |
| **`datosDePerfil()`** | `id, nombre, apellido, email, telefono, fechaNacimiento, fotoPerfilUrl` | `GET`/`PUT`/`DELETE` de `/api/perfil` |

Incluye `fechaNacimiento` a propósito: es un dato privado y editable que el perfil
muestra. `fotoPerfilUrl` aparece en las dos vistas porque la usan los dos: la del
perfil para la portada y la de sesión para el **avatar del navbar**, que se dibuja en
todas las páginas sin volver a pedir `/api/perfil`. Excluye `password`, `passwordHash` y
`tokenHash` siempre, por construcción y no por filtro: el serializer es una lista
explícita, así que un campo nuevo no se filtra solo.

## 7. Validación y errores

El controller valida formato; el service maneja las reglas que necesitan base de datos.

| Situación                                                                   | Código | `error`                                           |
| --------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| Sin sesión                                                                  | 401    | `No autorizado`                                   |
| Rol distinto de `CLIENTE`                                                   | 403    | `Acceso denegado`                                 |
| Llega `id`, `usuarioId`, `rol`, `activo`, `password`, `nombre` o `apellido` | 400    | `"<campo> no puede modificarse en este endpoint"` |
| Email vacío o mal formado                                                   | 400    | `No se pudo completar la operación`               |
| Fecha inválida                                                              | 400    | `No se pudo completar la operación`               |
| El email pertenece a otra cuenta                                            | 400    | `No se pudo completar la operación`               |
| Sin archivo en `POST /foto`                                                 | 400    | `No se recibió ninguna imagen`                    |
| El archivo no es imagen / excede 5 MB                                       | 400    | texto específico del error de multer              |
| Contraseña actual incorrecta                                                | 400    | `La contraseña actual es incorrecta.`             |
| Las contraseñas nuevas no coinciden                                         | 400    | `Las contraseñas no coinciden.`                   |

### 7.1 Por qué el email duplicado da un error genérico

`registro` ya tenía esa decisión y el perfil la **hereda**: si el email está tomado, la
respuesta es la misma que ante un formato inválido. Un mensaje distinto ("ese email ya
existe") le confirmaría a cualquiera que pruebe emails que esa cuenta existe. El
service lanza `EmailEnUsoError` con el detalle real y el controller lo aplana.

### 7.2 Por qué los campos protegidos dan 400 y no se ignoran

Si `PUT {"rol": "ADMINISTRADOR"}` se ignorara en silencio, el cliente creería que
guardó algo que no guardó. Se rechaza explícitamente con el nombre del campo, como ya
hacían las direcciones. El `400` además distingue "no puedo" de "no existe el campo".

### 7.3 Campos vacíos

`telefono` y `fechaNacimiento` aceptan `""` o `null` y se guardan como `null` (no como
cadena vacía). El `email` es obligatorio: vacío o mal formado → `400`. Un `PUT` sin
ningún campo editable no altera nada y devuelve el perfil actual, para que un cliente
que reenvíe el formulario completo no rompa nada. `nombre` y `apellido` ya no son un
caso de validación: si llegan, el `PUT` se rechaza entero (§7.2).

## 8. Foto de perfil

### 8.1 El recorrido

```
POST /api/perfil/foto (multipart, campo "imagen")
  │
  ├─ subirImagenUnica()        multer memoryStorage, 5 MB, JPG/PNG/WEBP → 400 si no
  │
  ├─ perfil_service.guardaFotoPerfil(usuarioId, req.file)
  │     ├─ guardarImagenPerfil()   escribe public/imagenes/perfiles/<nombre>-<ts>.<ext>
  │     ├─ usuario.update({ fotoPerfilUrl })   ← primero la base
  │     └─ eliminarImagenEnCarpeta(anterior)   ← después el archivo viejo
  │
  └─ 201 { url: "/imagenes/perfiles/avatar-1790740211935.png" }
```

El nombre del archivo es el original normalizado más un timestamp
(`nombreArchivoUnico`, el mismo del admin): dos subidas del mismo `avatar.png` no se
pisan, y comparar la URL nueva con la anterior decide si hay algo que borrar.

**El orden importa.** Se persiste la URL nueva antes de borrar el archivo anterior: si
el borrado falla, el perfil sigue apuntando a una imagen que existe. El borrado va
envuelto en `try/catch` con un `console.warn`, porque un archivo huérfano es desorden
de disco, no un error de negocio que deba convertir un éxito en `500`.

### 8.2 Por qué el archivo se escribe en el repo del frontend

Es la decisión que ya tenía el proyecto con productos y categorías: la imagen se
guarda como archivo en `comi-rapi-fronted/public/imagenes/<carpeta>` y se devuelve la
ruta relativa, que Vite sirve en la raíz. Así el resto del equipo la ve tras un `pull`,
sin depender de un bucket ni de credenciales. La carpeta y la URL son configurables
por `IMAGENES_PERFILES_DIR` y `imagenes.perfilesUrlBase`.

Consecuencias que conviene tener presentes:

- `fotoPerfilUrl` guarda una ruta **relativa** (`/imagenes/perfiles/...`), no absoluta,
  igual que `Producto.imagen`. La resuelve el frontend, no el backend.
- Pedir la imagen al backend en `:3000` da `404`: el archivo no lo sirve Express. Se
  sirve desde el origen del frontend (`:5173` en desarrollo).
- `public/imagenes/perfiles/` está en el `.gitignore` del frontend. A diferencia de
  productos y categorías, que son del seed y sí se versionan, estas son **datos de
  usuarios** y no corresponde commitearlas.
- El archivo se nombra a partir del `nombreOriginal` que manda el cliente, normalizado a
  minúsculas y con guiones, más `Date.now()`: `/imagenes/perfiles/10002-1790745616801.jpg`.
  Los tests no tocan esa carpeta: `.env.test` apunta `IMAGENES_PERFILES_DIR` a
  `./test/tmp/perfiles`.

### 8.3 Borrado seguro

`eliminarImagenEnCarpeta` toma `path.basename(url)` y lo valida contra
`^[a-z0-9-]+\.(jpg|png|webp)$` antes de tocar el disco. Sin ese filtro, una `url` con
`../../` apuntaría fuera de la carpeta. Si el archivo no existe, devuelve `false` sin
error: `DELETE /foto` es idempotente.

## 9. Cambio de contraseña

```
POST /api/perfil/cambiar-password
  │
  ├─ ¿password === confirmPassword?           no → 400 "Las contraseñas no coinciden."
  ├─ ¿nueva.length >= 6?                      no → 400 genérico
  │
  └─ perfil_service.cambiarPassword(usuarioId, { passwordActual, nuevaPassword, sessionId })
        ├─ usuario.verificarPassword(actual)  no → PasswordActualIncorrectaError → 400
        ├─ usuario.update({ password })        ← instancia: dispara beforeSave → Argon2id
        └─ eliminarSesiones(usuarioId, { exceptoSid: req.session.id })
```

Dos decisiones:

- **`usuario.update()`, nunca un update masivo.** El hash lo aplica el hook `beforeSave`
  del modelo. Un `db.Usuario.update(...)` guardaría la contraseña en texto plano; es el
  mismo motivo por el que `password_reset_service` usa update por instancia.
- **`exceptoSid: req.session.id`.** Se invalidan las demás sesiones (otra pestaña, otro
  dispositivo) pero **no** la desde la que se está cambiando, o el usuario se
  desloguearía a sí mismo en el momento de confirmar. La cookie `comirapi.sid` viene
  firmada (`s:<sid>.<hmac>`), por eso se usa `req.session.id` y no el valor crudo de la
  cookie.

### 9.1 Rate limit: por usuario, no por IP

`POST /api/perfil/cambiar-password` exige la contraseña actual, así que sin un límite
quien se aproveche de una sesión ajena podría probarla indefinidamente. El endpoint va
con `perfilPasswordLimiter`: **5 intentos cada 15 minutos, por usuario**.

```
keyGenerator: (req) => String(req.usuario?.id || 'sin-sesion')
```

Dos decisiones:

- **La clave es `req.usuario.id`, no la IP.** `verificarSesion` corre antes que el
  limitador (`router.use` en `routes/perfil.js`), así que el id ya está resuelto. Con
  clave por IP un atacante rotaría de dirección para reiniciar el contador; y un cliente
  legítimo detrás de una red compartida (oficina, aula) sufriría el límite de los demás.
- **El 429 no dice por qué.** `429 { success: false, error: 'Demasiados intentos de cambio de contraseña. Intente nuevamente más tarde.' }`: no menciona la contraseña
  actual ni si fue correcta, para no confirmar nada a un atacante.

Configurable con `PERFIL_RATE_LIMIT_PASSWORD_MAX` y
`PERFIL_RATE_LIMIT_PASSWORD_WINDOW_MINUTES` (`config.perfil.rateLimitPassword`), y
desactivable con `RATE_LIMIT_ENABLED=false`, igual que los otros limitadores del
proyecto. Ojo con esto al probar a mano: si el limitador está activo en `:3000` y se
falla 5 veces, el sexto intento da 429 **aunque la contraseña sea correcta**.

El login no se tocó: ya venía cubierto por `authLimiter` (`routes/auth.js:36`, 20
intentos por IP cada 15 minutos) y el registro por el mismo limitador.

## 10. Verificación

### 10.1 Tests del backend

`lib/controllers/perfil_controller.test.js`, 30 tests contra la app completa con tres
agentes reales (cliente, otro cliente y admin):

| Bloque                    | Qué fija                                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/perfil`         | Los 7 campos exactos y nada sensible; 401 sin sesión; 403 para otro rol                                                                                                                                                                                                            |
| `PUT /api/perfil`         | Actualiza y normaliza el email; no deja tomar el email ajeno; rechaza `id`/`usuarioId`/`rol`/`activo`/`password`/`nombre`/`apellido`; **un `nombre` en el body descarta el resto del PUT**; no toca otros usuarios; rechaza email y fecha inválidos; PUT sin campos no altera nada |
| `POST /api/perfil/foto`   | Sube y persiste; reemplaza la anterior y borra el archivo viejo; **expone la foto en `/auth/me` para el avatar del navbar**; 400 sin archivo; 400 si no es imagen                                                                                                                  |
| `DELETE /api/perfil/foto` | Borra el archivo y el registro; devuelve el perfil completo; idempotente sin foto                                                                                                                                                                                                  |
| `cambiar-password`        | Rechaza actual incorrecta, contraseñas distintas y nueva corta; cambia la contraseña, **mantiene la sesión actual e invalida el login viejo**; **429 al superar los 5 intentos, y la contraseña del segundo cliente queda sin cambiar**                                            |

`lib/middlewares/rate_limit.test.js`, 12 tests (7 de la recuperación que ya había + 5
del perfil). Los del perfil montan una app mínima con un `req.usuario` simulado y fijan
que el límite es **por usuario** (otro id no comparte contador), que el 429 no filtra si
la contraseña era correcta, que `RATE_LIMIT_ENABLED=false` lo desactiva y que los
valores por defecto son 5 y 15 minutos.

Estado: **250/250, 18 suites**. `npm run lint` y `npm run build` limpios.

> Los tests del limitador del perfil habilitan `config.rateLimit.enabled = true` dentro
> del caso y lo restauran en un `finally`, porque `.env.test` trae
> `RATE_LIMIT_ENABLED=false`. El caso usa el **segundo** agente a propósito: el contador
> es por usuario y el primer cliente ya viene arrastrando los intentos del `describe`.

### 10.2 Verificación end-to-end contra el backend de desarrollo

Con el backend en `:3000` se ejecutó el flujo completo por HTTP:

| Paso                                | Resultado                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/perfil`                   | `200` con los 7 campos                                                            |
| `PUT /api/perfil`                   | `200`, normaliza y persiste                                                       |
| `PUT /api/perfil {"rol": ...}`      | `400 rol no puede modificarse en este endpoint`                                   |
| `PUT /api/perfil {"nombre": ...}`   | `400 nombre no puede modificarse en este endpoint`                                |
| `PUT /api/perfil {"apellido": ...}` | `400 apellido no puede modificarse en este endpoint`                              |
| `PUT` con email/teléfono/fecha      | `200`, con nombre y apellido intactos                                             |
| `POST /api/perfil/foto`             | `201` con `/imagenes/perfiles/10002-<ts>.jpg`                                     |
| `GET /api/auth/me`                  | Trae `fotoPerfilUrl` (la del avatar del navbar)                                   |
| Pedir esa URL al frontend (`:5173`) | `200 image/png`                                                                   |
| `DELETE /api/perfil/foto`           | `200`, perfil completo con `fotoPerfilUrl` en `null`, archivo eliminado del disco |
| `POST /cambiar-password`            | `200`                                                                             |
| Login con la contraseña vieja/nueva | `401` / `200`                                                                     |
| `POST /cambiar-password` 6 veces    | `429` en la sexta, con el mensaje genérico                                        |

## 11. Detalles que costaron encontrar

- **El CSRF es double-submit y supertest captura las cookies al crear la petición.**
  `.set('x-csrf-token', await obtenerCsrf(agente))` **falla con 403**: `agente.put(...)`
  ya se evaluó y adjuntó el tarro de cookies _antes_ de que corriera el `await`, así que
  la petición sale con la cookie vieja y el header nuevo. El token tiene que pedirse en
  una línea anterior:
  ```js
  const csrf = await obtenerCsrf(agente);
  const res = await agente.put('/api/perfil').set('x-csrf-token', csrf);
  ```
  Es el mismo detalle que ya está anotado en `docs/webSocketContext.md` (sección 9.1)
  para los tests del socket. Cinco tests del perfil fallaban por esto y no por el
  código de la feature.
- **El backend de desarrollo sirve `dist/`, no `lib/`.** Después de agregar rutas hay que
  `npm run build` y reiniciar `node ./dist/bin/www`; si no, `GET /api/perfil` responde
  `404 Cannot GET /api/perfil` aunque el archivo exista.
- **Vite cachea `public/` en desarrollo.** Borrar la foto y pedirla de nuevo al `:5173`
  puede seguir devolviendo `200` con el archivo viejo aunque en disco ya no esté. Para
  comprobar el borrado hay que mirar la carpeta, no la respuesta.

## 12. Frontend

| Archivo                                          | Responsabilidad                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/api/perfil.js`                              | `obtenerPerfil`, `actualizarPerfil`, `subirFotoPerfil`, `eliminarFotoPerfil`, `cambiarPasswordPerfil`    |
| `src/pages/cliente/Perfil.jsx`                   | Portada con avatar, ficha de datos, columna de herramientas y gestor de direcciones                      |
| `src/pages/cliente/Perfil.css`                   | Portada con banda, ficha en dos columnas y comportamiento responsive                                     |
| `src/components/comunes/Avatar.jsx`              | Avatar reutilizable: foto si hay, iniciales si no (navbar y portada), con fallback si la imagen no carga |
| `src/components/comunes/CampoPassword.jsx`       | Campo de contraseña con ojo (ver por un instante), usado por perfil, login, registro y recuperación      |
| `src/components/cliente/FormularioDireccion.jsx` | Alta/edición de dirección, reutilizada dentro del perfil (venía de `MisDirecciones.jsx`)                 |
| `src/routes/AppRoutes.jsx`                       | `/cliente/perfil` dentro de `ProtectedRoute requiredRole="CLIENTE"`                                      |
| `src/components/comunes/Navbar.jsx`              | Acceso al perfil: avatar con foto + nombre, junto al botón de cerrar sesión                              |
| `src/context/AuthContext.jsx`                    | `refrescarUsuario()`: vuelve a leer `/auth/me` para que el avatar del navbar quede al día                |
| `src/context/DireccionContext.jsx`               | `useDirecciones()`: las direcciones del cliente, sin estado nuevo en el perfil                           |
| `src/utils/formatters.js`                        | `formatDateOnly`, `calcularEdad`, `obtenerIniciales`, `nombreCompleto`                                   |

La página no tiene estado global: el perfil solo se usa en una pantalla, así que va con
`useState` local, como `Inicio.jsx`. No se creó un `PerfilContext` —los contextos del
proyecto (`DireccionContext`, `PedidoContext`) existen para datos que comparten varias
vistas. Las direcciones sí reconectan `DireccionContext`, que ya existía.

### 12.1 Acceso al perfil

No hay un enlace "Mi perfil" en el menú. Se entra desde el **avatar con el nombre del
cliente, al lado de "Cerrar sesión"**: es donde la persona ya mira para saber quién es.

- Con foto: la imagen de `usuario.fotoPerfilUrl`, que viaja en la sesión (`/auth/me`).
- Sin foto: las iniciales (`obtenerIniciales`) sobre el naranja de marca.
- Si la URL existe pero la imagen no carga (archivo borrado del servidor), `Avatar` cae
  también a las iniciales en vez de dejar el ícono de imagen rota del navegador.
- En pantallas medianas el nombre se oculta y queda el avatar; en celular el botón de
  cerrar sesión queda solo con el ícono (el `aria-label` conserva el nombre accesible).

Por eso `datosPublicos()` incluye `fotoPerfilUrl` (§6): el navbar no pide `/api/perfil`
en cada página. Después de subir o quitar la foto, `Perfil.jsx` llama a
`refrescarUsuario()` para que el avatar del navbar se actualice en el acto.

### 12.2 La pantalla, estado por estado

**Lectura (por defecto).** Portada con avatar, nombre y email; el único botón de acción
es **Editar mis datos**. Debajo, dos columnas: la ficha de datos a la izquierda
(`lg=8`) y **Mis direcciones** a la derecha (`lg=4`). La ficha muestra etiqueta a la
izquierda y valor a la derecha, con filas punteadas y "Sin cargar" en los vacíos.

**Edición.** Al tocar el botón la columna derecha la ocupan las herramientas (foto y
contraseña) y **las direcciones se desplazan debajo**, a todo el ancho. La tarjeta de
datos se estira a la altura de la columna (`h-100`) y lleva dentro, en el espacio libre,
la sección de contraseña: no hay recuadros vacíos ni una segunda tarjeta suelta. La
foto se edita en la columna derecha, con vista previa (`Avatar`) que muestra las
iniciales mientras no haya imagen.

**No se ve el rol** en ningún lado: es un dato interno de la cuenta, no del perfil.

### 12.3 Guardar pide confirmación, y solo si algo cambió

- **Guardar cambios** aparece únicamente cuando algún campo quedó modificado: la página
  calcula `cambiosPendientes` comparando el formulario contra el perfil guardado. Si no
  hay diferencias, queda solo "Cancelar".
- Al guardar se abre un `ConfirmarModal` **antes de tocar el backend**, con el detalle de
  los campos que van a cambiar (`Email: ana@correo.com · Teléfono: 115555…`). "Volver"
  cierra el modal y deja el formulario tal como estaba.

`nombre` y `apellido` no aparecen como campos editables ni con candado: directamente no
están en el formulario, con una nota al pie que aclara que no se modifican desde el
perfil. Es coherente con §7.2: si alguien los enviara a mano, el `PUT` se rechaza entero.

### 12.4 Direcciones: dentro del perfil, editadas aparte

La CRUD de direcciones pasó a vivir en el perfil y **la página `/cliente/mis-direcciones`
se borró** (con su entrada en el menú y su ruta), porque quedaba como duplicado.

- En lectura, la tarjeta de la derecha lista alias, calle + altura, localidad/provincia,
  código postal y referencia. Con un botón que abre el **gestor en un modal**:
  `FormularioDireccion` para alta/edición y botones Editar/Eliminar por dirección, con
  la confirmación de borrado.
- El gestor se abre además con la query `?direcciones=1`, que usan los dos enlaces del
  carrito ("Agregá una dirección" y "Gestionar direcciones"): el perfil lee el
  parámetro con `useSearchParams` y abre el modal al cargar, así el carrito no queda
  apuntando a una ruta que ya no existe.

### 12.5 Ver la contraseña por un instante

`CampoPassword` es el componente único detrás de los cuatro lugares con contraseña
(perfil, login, registro y recuperación):

- Un ojo alterna `type` entre `password` y `text`, y **se vuelve a tapar solo al
  segundo** (`MILISEGUNDOS_VISIBLE = 1000`).
- El ícono refleja el **estado**, no la acción: ojo tachado = está tapada, ojo abierto
  = se está viendo. El `aria-label` y el `title` sí describen la acción ("Ver contraseña"
  / "Ocultar"), que es lo que corresponde a un botón.
- Acepta `icono`/`claseIcono` para conservar el candado de las pantallas de acceso
  (`auth-input-ico`) y `requerido={false}` donde la etiqueta no lleva asterisco.

Fecha y edad se calculan en el frontend con `formatDateOnly` y `calcularEdad`. La
primera descompone el `YYYY-MM-DD` del backend: `new Date('1995-03-10')` se interpreta
como UTC y en Argentina mostraría el 9 de marzo.

Detalles que siguen las convenciones del proyecto:

- Sin `import React` (JSX automático del runtime de Vite).
- `credentials: 'include'` y el token CSRF los resuelve `api/client.js`, que ya reintenta
  una vez ante un 403 por token rotado.
- `fotoPerfilUrl` se usa **tal cual** en el `src` del `<img>`, como `producto.imagen`.
- El email se valida con `validateEmail` de `utils/validators.js` antes de enviar.
- Quitar la foto y eliminar una dirección piden confirmación con `ConfirmarModal`.
- Los errores y el éxito del cambio de contraseña se muestran **dentro** de la sección
  (alerta roja / verde) y no solo en el toast: el mensaje verde "Contraseña actualizada
  correctamente." queda visible hasta que se vuelve a abrir el formulario.
- Colores, radios y el breakpoint de 767.98px salen de `src/styles/comirapi.css` y de los
  `.css` de las demás páginas, no de colores sueltos.

## 13. Restricciones

1. Nunca aceptar `id` o `usuarioId` del body: el usuario sale de la sesión.
2. Nunca responder con `datosPublicos()` ni con el modelo crudo: solo `datosDePerfil()`.
3. Nunca modificar `nombre` ni `apellido` desde `PUT /api/perfil`; solo se leen.
4. Nunca cambiar el hash con un update masivo: `usuario.update()` para que corra Argon2id.
5. Nunca invalidar la sesión actual al cambiar la contraseña: usar `exceptoSid`.
6. No tocar el login, el registro, la recuperación de contraseña, el CRUD del admin ni
   las rutas de imágenes: el perfil reusa lo que ya existía. La única excepción es
   `routes/auth.js`, que ya traía su propio limitador y no se modificó.
7. No guardar archivos fuera de `config.imagenes.perfilesDir` ni borrar rutas sin validar
   el `basename`.
8. No versionar `public/imagenes/perfiles/`.
9. La ficha arranca siempre en modo lectura: la edición se habilita a pedido, no por
   defecto.
10. No dejar `POST /api/perfil/cambiar-password` sin `perfilPasswordLimiter`: exigir la
    contraseña actual sin limitar intentos convierte el endpoint en un oráculo de fuerza
    bruta para quien tenga una sesión robada.
11. No usar la IP como clave del limitador del perfil: con `req.usuario.id` el límite no
    se esquiva cambiando de dirección.

## 14. Ver también

- `AGENTS.md` — arquitectura y convenciones del backend
- `docs/DER.md`, `docs/modelo-dominio.md` — `fotoPerfilUrl` en `Usuario`
- `docs/recuperacion-contrasena.md` — el otro consumidor de `eliminarSesiones`
- `docs/sistema-de-sesiones.md` — cómo funciona la sesión que resuelve el perfil
- `docs/webSocketContext.md` — el detalle del CSRF en los tests con agentes
