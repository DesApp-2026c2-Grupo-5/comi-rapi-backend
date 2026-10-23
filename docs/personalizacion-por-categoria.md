# Personalización por categoría (plantillas)

## Objetivo

Permitir que el superadministrador defina, **por categoría**, los extras,
condimentos, opciones de personalización y acompañamientos que deben recibir
automáticamente los **productos nuevos** de esa categoría.

Ejemplo: en `Bebidas` se configura `Personalizar → Hielo`. Al crear un producto
nuevo de `Bebidas`, el producto nace con la opción `Hielo` (que el cliente ve
como “Sin Hielo”) sin tener que cargarla a mano.

Además, las plantillas activas se usan como **fallback de lectura** para los
productos existentes que no tienen ninguna configuración propia. De esta forma
los productos viejos también reflejan la configuración de su categoría.

## Extensión respecto del DER

El modelo aprobado en `docs/DER.md` y `docs/modelo-dominio.md` describe la
personalización con `OpcionGrupo` + `Opcion` + `ProductoOpcionGrupo`. La
implementación actual del backend, en cambio, usa `PersonalizacionElementos`
(una fila por opción y por producto).

Esta funcionalidad **extiende la implementación actual** con una entidad nueva,
`PersonalizacionCategorias`, sin migrar todo el módulo a `OpcionGrupo`. Queda
pendiente la alineación definitiva con el DER aprobado; hasta entonces, este
documento describe el comportamiento real del código.

## Modelo de datos

Tabla `PersonalizacionCategorias` (modelo
`lib/models/personalizacion_categoria.js`):

| Columna                   | Tipo            | Notas                                              |
| ------------------------- | --------------- | -------------------------------------------------- |
| `id`                      | `INTEGER`       | PK, autoincremental                                |
| `categoriaId`             | `INTEGER`       | FK → `Categorias.id`, `ON DELETE CASCADE`          |
| `tipo`                    | `ENUM`          | `extra`, `personalizar`, `acompanar`, `condimento` |
| `nombre`                  | `STRING`        | Nombre de la opción                                |
| `precio`                  | `DECIMAL(10,2)` | Obligatorio en `extra` y `acompanar`               |
| `productoReferenciaId`    | `INTEGER`       | FK → `Productos.id`, sólo `acompanar`              |
| `minimo`                  | `INTEGER`       | Default `0`                                        |
| `maximo`                  | `INTEGER`       | Default `1`                                        |
| `activo`                  | `BOOLEAN`       | Default `true`                                     |
| `createdAt` / `updatedAt` | `DATE`          | Timestamps                                         |

Las reglas de validación son las mismas que las de `PersonalizacionElementos`:

- `extra`: nombre obligatorio y precio mayor a 0.
- `personalizar` y `condimento`: nombre obligatorio, sin precio.
- `acompanar`: producto de referencia obligatorio y precio mayor o igual a 0.
- `maximo >= minimo`, `minimo >= 0`, `maximo >= 1`.
- No se permiten duplicados dentro de la misma categoría y tipo. Para
  `acompanar` la identidad es el producto de referencia; para el resto, el
  nombre (sin distinguir mayúsculas).

## API

Router montado en `/api/personalizacion/categorias` (antes del router
`/api/personalizacion`, que declara `/:id`).

| Método   | Ruta                                             | Acceso             |
| -------- | ------------------------------------------------ | ------------------ |
| `GET`    | `/api/personalizacion/categorias`                | Público            |
| `GET`    | `/api/personalizacion/categorias?categoriaId=ID` | Público            |
| `GET`    | `/api/personalizacion/categorias/:id`            | Público            |
| `POST`   | `/api/personalizacion/categorias`                | SUPERADMINISTRADOR |
| `PUT`    | `/api/personalizacion/categorias/:id`            | SUPERADMINISTRADOR |
| `DELETE` | `/api/personalizacion/categorias/:id`            | SUPERADMINISTRADOR |

Notas:

- El listado público devuelve sólo plantillas activas.
- Con una sesión de gestión, `?activa=false` incluye también las inactivas.
- `DELETE` es una baja lógica (`activo = false`). No modifica los productos ya
  creados.

## Copia al crear un producto

`lib/controllers/producto_controller.js` llama a
`copiarPlantillasAProducto({ productoId, categoriaId, transaction })` dentro de
la misma transacción del alta:

1. Busca las plantillas activas de la categoría.
2. Descarta los acompañamientos sin producto de referencia o que apunten al
   producto que se está creando (no puede pasar, pero se protege).
3. Crea filas equivalentes en `PersonalizacionElementos` con
   `productoId = nuevo producto`.

Si falla la copia, falla el alta completa del producto (no queda a medias).

Alcance:

- Aplica a productos `PRODUCTO` y también a `COMBO` (si se configuraron
  plantillas para la categoría `Combos`).
- **No** se copia retroactivamente a productos existentes.
- **No** se copia al cambiar de categoría un producto existente.

## Fallback para productos existentes

`src/context/PersonalizacionContext.jsx` carga las plantillas desde
`GET /api/personalizacion/categorias` y las usa cuando un producto:

- no tiene ninguna fila en `PersonalizacionElementos`, o
- no tiene filas de un tipo determinado (por ejemplo, no tiene extras
  configurados pero la categoría sí).

El catálogo hardcodeado que vivía en
`src/services/personalizacionConfig.js` fue eliminado. Las plantillas activas
de la base son la única fuente por defecto. El archivo conserva únicamente los
helpers de cálculo de precio.

## Interfaz de administración

Dentro de `/superadmin/personalizacion` hay una subnavegación:

- **Por producto** → `/superadmin/personalizacion` (comportamiento anterior).
- **Por categoría** → `/superadmin/personalizacion/categorias`.

Pantallas:

- `GestionPersonalizacionCategorias.jsx`: selector de categoría, filtros por
  tipo, tabla compartida con edición en línea de mínimo/máximo y acciones de
  alta, edición y baja.
- `EditarPlantillaCategoria.jsx`:
  - `/superadmin/personalizacion/categorias/nuevo?categoriaId=ID`
  - `/superadmin/personalizacion/categorias/editar/:id?categoriaId=ID`
- `FormularioPersonalizacion.jsx`: reutilizado en modo categoría (oculta el
  selector de producto y muestra la categoría fija).
- `TablaPersonalizacion.jsx`: tabla compartida entre ambas vistas.
- `SubnavPersonalizacion.jsx`: navegación entre las dos vistas.

Las rutas están protegidas para `SUPERADMINISTRADOR` en `AppRoutes.jsx`.

## Datos iniciales

El seeder
`db/seeders/20261023000002-personalizacion-categorias-iniciales.js` reproduce el
catálogo genérico que antes estaba hardcodeado, para que al desplegar la feature
los productos sin configuración sigan mostrando opciones.

- Es idempotente: no duplica filas existentes.
- Omite los acompañamientos cuyo producto de referencia no existe en la base
  (por ejemplo `Pileta de Cheddar`, `Gaseosa 500ml`, `Bebida 500ml`). Esos casos
  se informan por consola al ejecutar el seeder.

## Puesta en marcha

```bash
# Backend
npm run db:init          # transpila y aplica la migración
npx sequelize db:seed --seed 20261023000002-personalizacion-categorias-iniciales.js

# Frontend
npm run dev
```

Si la base ya estaba migrada, alcanza con:

```bash
npx cross-env NODE_ENV=development npx sequelize db:migrate
npx cross-env NODE_ENV=development npx sequelize db:seed --seed 20261023000002-personalizacion-categorias-iniciales.js
```

## Pruebas

`lib/controllers/personalizacion_categoria_controller.test.js` cubre:

- CRUD y validaciones de las plantillas.
- Duplicados.
- Edición parcial de mínimo/máximo.
- Acompañamiento con producto de referencia.
- Copia automática al crear un producto.
- Plantillas inactivas que no se copian.
- Baja lógica.
- Permisos (403 para ADMINISTRADOR).
