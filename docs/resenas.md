# Reseñas de productos y combos

Documenta la entidad `Resena`, sus reglas de negocio, los endpoints y la integración con el frontend. Reemplaza las reseñas demo (`RESENAS_DEMO`) que mostraba el detalle de producto.

> **Alcance:** esta funcionalidad se autorizó explícitamente aunque la Propuesta 2 listaba "Calificaciones" como fuera de alcance. No se implementaron `Repartidor`, `Notificacion` ni el rol `REPARTIDOR`. La reseña se limita a producto/combo + estrellas + comentario.

## 1. Modelo

Entidad `Resena` (tabla `Resenas`), definida en `docs/DER.md` §2.22:

| Columna      | Tipo    | Regla                                                        |
| ------------ | ------- | ------------------------------------------------------------ |
| `id`         | INTEGER | PK                                                           |
| `usuarioId`  | INTEGER | FK → `Usuario.id`, NOT NULL                                  |
| `productoId` | INTEGER | FK → `Producto.id`, NOT NULL (simple o `tipo = COMBO`)       |
| `pedidoId`   | INTEGER | FK → `Pedido.id`, NOT NULL; pedido entregado que la habilita |
| `puntuacion` | INTEGER | NOT NULL, CHECK `BETWEEN 1 AND 5`                            |
| `comentario` | TEXT    | NULLABLE, máximo 500 caracteres                              |
| `createdAt`  | DATE    | NOT NULL                                                     |
| `updatedAt`  | DATE    | NOT NULL                                                     |

- UNIQUE `(usuarioId, productoId)`: una sola reseña por cliente y producto.
- Índice por `productoId` para el listado público y los agregados.
- FKs con `ON DELETE RESTRICT`: no se puede borrar un usuario, producto o pedido que tenga reseñas.
- No guarda snapshots: la reseña es una opinión actual sobre el producto. El `pedidoId` deja trazabilidad de qué compra la habilitó.

Archivos:

- `db/migrations/20261025000001-create-resena.js`
- `lib/models/resena.js`
- Asociaciones en `lib/models/producto.js`, `lib/models/pedido.js` y `lib/models/usuario.js`
- `lib/services/resenas.js`
- `lib/controllers/resena_controller.js`
- `lib/routes/resenas.js` y `GET /:id/resenas` en `lib/routes/productos.js`

## 2. Reglas de negocio

1. **Quién**: solo `CLIENTE` autenticado. `ADMINISTRADOR` y `SUPERADMINISTRADOR` reciben 403.
2. **Cuándo**: el cliente debe tener al menos un pedido en estado `entregado` que incluya el producto (`PedidoItem.productoId`). Pedidos `pendiente`, `confirmado`, `en_preparacion`, `en_camino`, `listo_para_entregar` o `cancelado` no habilitan la reseña.
3. **Cuántas**: una por producto. Si ya existe, el alta devuelve 409. El cliente puede editarla o eliminarla.
4. **Puntuación**: obligatoria, entero de 1 a 5. Se valida en el service y en la base (CHECK).
5. **Comentario**: opcional, máximo 500 caracteres. Vacío o solo espacios se guarda como `NULL`.
6. **Autoría**: solo el autor puede editar o eliminar. Un id ajeno responde 404 (no se filtra si existe).
7. **Autor público**: "Nombre I." (primer nombre + inicial del apellido). Nunca se expone el email ni el apellido completo.
8. **Agregados**: el promedio y la cantidad se calculan en la base sobre todas las reseñas del producto; no se denormalizan.
9. **Producto activo**: no se puede crear una reseña nueva de un producto dado de baja (`activo = false`); las reseñas existentes se conservan.

## 3. Endpoints

Todas las rutas cuelgan de `/api`. El detalle completo está en `docs/swagger.yml` (tag `Resenas`).

### 3.1 Listado público

`GET /api/productos/:id/resenas?pagina=1&limite=10`

No requiere sesión. `limite` se limita a 50. Devuelve:

```json
{
  "success": true,
  "data": {
    "promedio": 4.3,
    "cantidad": 3,
    "items": [
      {
        "id": 12,
        "productoId": 5,
        "puntuacion": 5,
        "comentario": "La mejor hamburguesa del barrio.",
        "creadaEn": "2026-10-24T18:30:00.000Z",
        "actualizadaEn": "2026-10-24T18:30:00.000Z",
        "autor": { "nombre": "Elmesia" }
      }
    ],
    "total": 3,
    "pagina": 1,
    "limite": 10,
    "paginas": 1
  }
}
```

El resumen también viaja en `GET /api/productos/:id` como `data.resenas: { promedio, cantidad }`.

### 3.2 Elegibles

`GET /api/resenas/elegibles?pedidoId=42` — solo `CLIENTE`.

Devuelve los productos de pedidos entregados que el cliente todavía no reseñó. `pedidoId` es opcional y acota el resultado a ese pedido. Cada ítem incluye el pedido que lo habilitó:

```json
{
  "success": true,
  "data": [
    {
      "productoId": 5,
      "pedidoId": 42,
      "nombre": "Hamburguesa clásica",
      "imagen": "https://...",
      "tipo": "SIMPLE"
    }
  ]
}
```

### 3.3 Mis reseñas

`GET /api/resenas/mias` — solo `CLIENTE`. Devuelve las reseñas propias con el producto:

```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "productoId": 5,
      "puntuacion": 5,
      "comentario": "La mejor hamburguesa del barrio.",
      "creadaEn": "2026-10-24T18:30:00.000Z",
      "actualizadaEn": "2026-10-24T18:30:00.000Z",
      "autor": { "nombre": "Elmesia" },
      "producto": {
        "id": 5,
        "nombre": "Hamburguesa clásica",
        "imagen": "https://...",
        "tipo": "SIMPLE"
      }
    }
  ]
}
```

### 3.4 Crear

`POST /api/resenas` — solo `CLIENTE`, requiere CSRF.

```json
{
  "productoId": 5,
  "puntuacion": 5,
  "comentario": "La mejor hamburguesa del barrio."
}
```

Responde 201 con la reseña creada (`RespuestaResena`).

### 3.5 Editar

`PUT /api/resenas/:id` — solo el autor, requiere CSRF.

```json
{
  "puntuacion": 4,
  "comentario": "Muy rica, le faltó un poco de sal."
}
```

Si `comentario` se omite, conserva el anterior. Responde 200 con la reseña actualizada.

### 3.6 Eliminar

`DELETE /api/resenas/:id` — solo el autor, requiere CSRF. Responde 200 con `data: null`.

### 3.7 Errores

| Status | Caso                                                              |
| ------ | ----------------------------------------------------------------- |
| 400    | Puntuación fuera de 1..5, comentario > 500, `productoId` faltante |
| 401    | Sin sesión                                                        |
| 403    | Rol distinto de `CLIENTE`, sin compra entregada o CSRF inválido   |
| 404    | Producto inexistente, reseña inexistente o de otro usuario        |
| 409    | El cliente ya tiene una reseña de ese producto                    |

El controller traduce `ResenaError.codigo` al status HTTP; cualquier otro error sigue el middleware general (500).

## 4. Frontend

- `src/api/resenas.js` — `obtenerResenasDeProducto`, `obtenerProductosElegiblesParaResenar`, `obtenerMisResenas`, `crearResena`, `actualizarResena`, `eliminarResena`.
- `src/components/cliente/Estrellas.jsx` — estrellas de solo lectura y modo interactivo (1 a 5), accesibles por teclado.
- `src/components/cliente/FormularioResena.jsx` — alta y edición; valida la puntuación antes de enviar.
- `src/components/cliente/ResenaModal.jsx` — modal que monta el formulario recién al abrir, para inicializarlo con la reseña correcta.
- `src/components/cliente/ListaResenas.jsx` — promedio, listado público, bloque "Tu reseña" separado, paginación con "Ver más reseñas" y acciones de editar/eliminar.
- `src/pages/cliente/DetalleProducto.jsx` — reemplaza `RESENAS_DEMO` y el badge "demo" por datos reales; muestra el promedio en el encabezado y la lista debajo.
- `src/pages/cliente/DetallePedido.jsx` — en pedidos `entregado`, agrega una columna "Reseña" por ítem con "Calificar" o "Editar".
- `src/components/cliente/ListaPedidos.jsx` — botón "Calificar" en los pedidos entregados, que lleva al detalle.
- `src/utils/formatters.js` — `formatFechaRelativa` para "hace 2 días", "ayer", etc.

La elegibilidad del frontend es solo informativa: el backend vuelve a validar la compra entregada y la unicidad en cada alta.

## 5. Datos demo

### 5.1 Clientes y compras

Seeder `db/seeders/20261025000002-demo-clientes-compras.js` (marcador `SEED-RESENA`, idempotente):

- Usuarios `elmesia@demo.com`, `tetia@demo.com` y `cassie@demo.com`, contraseña `123456`, rol `CLIENTE`, sin apellido (para que el panel admin muestre exactamente "Elmesia", "Tetia" y "Cassie").
- 36 pedidos (12 por cliente) repartidos en los últimos 10 días, incluido hoy. La mayoría `entregado`; 2 `cancelado` (≈5,5 %).
- Cada pedido tiene 5 productos distintos con 1 a 3 unidades, sobre los productos activos de la base.
- 51 reseñas (3 por producto activo, una por cliente), con puntuaciones variadas para que los promedios queden entre 4,0 y 4,7.

Los usuarios demo usan `@demo.com` a propósito: el script `npm run limpiar:pruebas` borra los pedidos de `@test.com` y no debe tocar la demo.

### 5.2 Stock

Seeder `db/seeders/20261025000003-stock-150.js`:

- Deja `cantidad = 150` en todas las filas de `Stocks` de todas las sucursales.
- Los combos se derivan de su receta (`min(floor(150 / cantidad))`); como todas las recetas son 1×, también quedan en 150.
- El `down` restaura la base 25 (aproximado: los ajustes originales por sucursal no son reproducibles).

Se aplicó después de las compras demo, así que los pedidos sembrados no descontaron stock.

## 6. Tests

- `lib/services/resenas.test.js` — elegibilidad, unicidad, validaciones, agregados, edición y borrado.
- `lib/controllers/resena_controller.test.js` — mapeo de errores a HTTP y respuestas.

```bash
npm test -- resenas
```

La base de test es `unahur_desapp_test`; las migraciones se aplican con `npm run db:init` (transpila antes de migrar).

## 7. Operación

- Re-ejecutar el seeder demo: primero `npx sequelize db:seed:undo --seed db/seeders/20261025000002-demo-clientes-compras.js` y después `npx sequelize db:seed --seed db/seeders/20261025000002-demo-clientes-compras.js`.
- El script `scripts/limpiar-pedidos-de-prueba.js` incluye `Resenas` en `DEPENDIENTES`, así que borra las reseñas antes de los pedidos de prueba.
- No hay denormalización de promedios: si se borra una reseña, el siguiente listado ya refleja el nuevo promedio.
