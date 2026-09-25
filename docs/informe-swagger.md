# Informe de documentación OpenAPI (Swagger)

**Archivo:** `docs/swagger.yml`
**Formato:** OpenAPI 3.0.0
**Última validación:** `swagger-cli validate docs/swagger.yml` → _is valid_

## Resumen

La especificación documenta la API de **comi-rapi-backend**:

- **21 paths** / 47 schemas.
- **Server base:** `http://localhost:3000/api`.
- **UI interactiva:** `GET /api/docs` (Swagger UI vía `swagger-ui-express`).
- **Seguridad:** dos esquemas montados en cascada (`allOf`):
  - `cookieAuth` — cookie `comirapi.sid` (sesión de `express-session`).
  - `csrfToken` — header `x-csrf-token` (exigido en toda mutación POST/PUT/PATCH/DELETE, alineado al middleware `csrfProtection`).

## Alcance de paths

| Módulo      | Paths                                                                           |
| ----------- | ------------------------------------------------------------------------------- |
| Salud       | `GET /health`                                                                   |
| Auth        | `/auth/csrf-token`, `/auth/registro`, `/auth/login`, `/auth/logout`, `/auth/me` |
| Usuarios    | `/usuarios`, `/usuarios/{id}`                                                   |
| Categorías  | `/categorias`, `/categorias/{id}`                                               |
| Productos   | `/productos`, `/productos/{id}`                                                 |
| Pedidos     | `/pedidos`, `/pedidos/{id}`, `/pedidos/{id}/estado`                             |
| Sucursales  | `/sucursales`, `/sucursales/{id}`                                               |
| Direcciones | `/direcciones`, `/direcciones/{id}`                                             |
| Imágenes    | `/imagenes/upload`, `/imagenes/upload/categoria`                                |

## Enums documentados

- `rol`: `CLIENTE` | `ADMINISTRADOR`
- `tipo` (producto): `PRODUCTO` | `COMBO`
- `medioPago`: `MERCADO_PAGO` | `TARJETA`
- `estado` (pedido): `pendiente` | `confirmado` | `en_preparacion` | `listo_para_entregar` | `en_camino` | `entregado` | `cancelado`

## Cómo usar la UI de Swagger

Abrir **http://localhost:3000/api/docs** con el backend corriendo. El backend exige **doble token** en todas las mutaciones (cookie `csrf-token` + header `x-csrf-token`); el paso inicial es idéntico para ambos roles:

1. `GET /api/auth/csrf-token` → **Try it out → Execute** y copiar `data.csrfToken` de la respuesta.
2. Botón **Authorize** (arriba a la derecha) → esquema `csrfToken` → pegar el token → **Authorize**. No tocar `cookieAuth`: la cookie de sesión se envía sola (la UI es del mismo origen).
3. `POST /api/auth/login` → **Try it out**, completar con las credenciales del rol y **Execute**. La sesión queda activa y los candados (🔒) quedan autorizados.

Usuarios de prueba del seed: `admin@test.com` / `123456` (ADMINISTRADOR) y `cliente@test.com` / `123456` (CLIENTE).

### Como ADMINISTRADOR

Con la sesión de `admin@test.com` activa se puede:

- **Gestionar catálogo:** `POST /categorias`, `POST /productos`, `PUT` y `DELETE` de ambos (baja lógica) — con cuerpo de ejemplo precargado en el swagger.
- **Gestionar sucursales:** `POST /sucursales` y sus `PUT`/`DELETE`.
- **Administrar usuarios:** `GET /usuarios` y `GET /usuarios/{id}` (solo admin).
- **Subir imágenes:** `POST /imagenes/upload` y `POST /imagenes/upload/categoria` (multipart, campo `imagen`, JPG/PNG/WEBP, máx. 5 MB).
- **Pedidos:** ver todos con `GET /pedidos` (opcional `?sucursalId=`), ver uno con `GET /pedidos/{id}`, y **avanzar el estado** con `PATCH /pedidos/{id}/estado`: `confirmado → en_preparacion → listo_para_entregar → en_camino → entregado`.

Ejemplo de avance de pedido:

```json
{ "estado": "en_preparacion", "observacion": "Arranca la cocina" }
```

### Como CLIENTE

Con la sesión de `cliente@test.com` activa se puede:

- **Ver catálogo:** `GET /categorias`, `GET /productos`, `GET /sucursales` (públicos, no requieren sesión).
- **Administrar direcciones:** `POST /direcciones` (cuerpo de ejemplo precargado), y `GET/PUT/DELETE` de las propias.
- **Registrar un pedido:** `POST /pedidos` con, por ejemplo:

```json
{
  "productos": [
    { "productoId": 1, "cantidad": 2, "observacion": "Sin cebolla" }
  ],
  "medioPago": "MERCADO_PAGO",
  "observacion": "Dejar en portería"
}
```

- **Ver sus pedidos:** `GET /pedidos` (solo los propios) y `GET /pedidos/{id}`.
- **Confirmar o cancelar un pedido propio:** `PATCH /pedidos/{id}/estado`:
  - Confirmar: `{ "estado": "confirmado", "medioPago": "TARJETA" }` (requiere medio de pago).
  - Cancelar: `{ "estado": "cancelado" }`.

> El CLIENTE solo puede confirmar/cancelar pedidos de los que es dueño; el resto de las transiciones de estado son exclusivas del ADMINISTRADOR.

### Problemas comunes

- **`403 Solicitud no válida` al hacer POST/PUT/DELETE:** la cookie y el header CSRF se desincronizaron. Repetir `GET /api/auth/csrf-token`, copiar el nuevo token y actualizarlo en **Authorize**.
- **`401 No autorizado`:** no hay sesión (falta el login) o se navegó/recargó y la cookie `comirapi.sid` se perdió. Volver a hacer login.
- **`403 Acceso denegado`:** la operación es de otro rol (ej. un CLIENTE intenta crear una categoría). Entrar con la cuenta correcta.

## Notas

- La spec es la fuente para mantener sincronizada la documentación con el código de las rutas (`lib/routes/`).
- Se mantiene en `docs/` y se consume por `lib/routes/docs.js` (carga con `yamljs` y se expone en la UI).
- Las reglas de negocio y detalles de entidades están en `docs/modelo-dominio.md` y `docs/DER.md`; el swagger solo refleja el contrato HTTP.
