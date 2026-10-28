# Insumos, extras y condimentos con stock

Documento de referencia del catálogo de **insumos**: los extras y condimentos que
se ofrecen en la personalización de un producto y que ahora tienen existencia
propia por sucursal.

## 1. Por qué una entidad propia

Antes, un extra o un condimento era sólo una fila de
`PersonalizacionElementos`/`PersonalizacionCategorias` con un nombre y un precio.
No había forma de saber cuántos quedaban ni de descontarlos al vender. Modelarlos
como `Producto` habría sido peor: un sobre de ketchup no es un artículo del
catálogo, no tiene ficha, foto ni categoría, y no debería aparecer en la carta.

La extensión agrega dos entidades:

- `Insumo`: catálogo corporativo de extras y condimentos.
- `InsumoStock`: existencias por sucursal, con la misma PK compuesta que
  `Stock` (`sucursalId`, `insumoId`).

No reemplaza a `Stock` (productos y combos) ni a la personalización. Sólo los
tipos `extra` y `condimento` se vinculan a un insumo y descuentan stock. Los
`acompanar` (productos que se agregan) y los `personalizar` (ingredientes que se
quitan) siguen siendo configuración del producto.

## 2. Modelo

### 2.1 Insumo

| Atributo | Tipo            | Notas                                      |
| -------- | --------------- | ------------------------------------------ |
| `id`     | `INTEGER`       | PK                                         |
| `nombre` | `STRING`        | Obligatorio                                |
| `tipo`   | `ENUM`          | `extra` o `condimento`                     |
| `precio` | `DECIMAL(10,2)` | Obligatorio en extra; `null` en condimento |
| `activo` | `BOOLEAN`       | Baja lógica                                |

- UNIQUE `(nombre, tipo)`: el mismo nombre puede existir como extra y como
  condimento, pero no duplicarse dentro del mismo tipo. El service compara sin
  distinguir mayúsculas (`ILIKE`).
- Un condimento es gratis: cualquier precio que llegue se ignora y se guarda
  `null`.
- El precio del insumo es una referencia. El elemento de personalización tiene su
  propio `precio` y puede pisarlo.

### 2.2 InsumoStock

| Atributo     | Tipo      | Notas                          |
| ------------ | --------- | ------------------------------ |
| `sucursalId` | `INTEGER` | PK (parte), FK → `Sucursal.id` |
| `insumoId`   | `INTEGER` | PK (parte), FK → `Insumo.id`   |
| `cantidad`   | `INTEGER` | `>= 0` (CHECK)                 |
| `disponible` | `BOOLEAN` | Si la sucursal lo ofrece       |

- PK compuesta `(sucursalId, insumoId)`.
- `disponible = false` equivale a 0 para la venta, igual que en `Stock`.
- Al crear un insumo se crean filas en 0 en todas las sucursales activas. Las
  sucursales creadas después obtienen sus filas cuando el admin abre Stock (el
  listado las asegura) o al guardar una cantidad.
- Las filas no se borran al dar de baja un insumo: la baja es lógica y conserva
  el histórico.

### 2.3 Vínculo con la personalización

`PersonalizacionElementos` y `PersonalizacionCategorias` agregan `insumoId`
(nullable, FK → `Insumos.id`, `ON DELETE SET NULL`).

- Obligatorio cuando `tipo` es `extra` o `condimento`.
- `null` en `personalizar` y `acompanar`.
- No se puede cambiar el `tipo` de un insumo que ya está vinculado a un elemento
  o plantilla: el vínculo quedaría apuntando a la lista equivocada.

La migración `20261028000002-vincular-insumos-personalizacion.js` hace el
backfill: crea un insumo por cada `(nombre, tipo)` existente, linkea las filas y
deja 150 unidades en cada sucursal activa. Los insumos nuevos arrancan en 0.

## 3. Endpoints

### Catálogo

| Método   | Ruta               | Rol                | Descripción                                         |
| -------- | ------------------ | ------------------ | --------------------------------------------------- |
| `GET`    | `/api/insumos`     | Público            | Lista insumos activos; acepta `tipo`, `q`, `activo` |
| `GET`    | `/api/insumos/:id` | Público            | Detalle; un insumo inactivo da 404 al público       |
| `POST`   | `/api/insumos`     | SUPERADMINISTRADOR | Alta; crea stock en 0 en sucursales activas         |
| `PUT`    | `/api/insumos/:id` | SUPERADMINISTRADOR | Edición; permite reactivar con `activo: true`       |
| `DELETE` | `/api/insumos/:id` | SUPERADMINISTRADOR | Baja lógica (`activo = false`)                      |

`GET /api/insumos?activo=false` sólo tiene efecto para un usuario de gestión; el
público siempre ve activos.

### Stock por sucursal

| Método | Ruta                           | Rol                                | Descripción                        |
| ------ | ------------------------------ | ---------------------------------- | ---------------------------------- |
| `GET`  | `/api/stock/insumos`           | ADMINISTRADOR / SUPERADMINISTRADOR | Stock de la sucursal operativa     |
| `PUT`  | `/api/stock/insumos/:insumoId` | ADMINISTRADOR / SUPERADMINISTRADOR | Ajusta `cantidad` y/o `disponible` |

- La sucursal sale de la sesión (`sucursalOperativaDeSesion`), no de la URL. Un
  admin no puede tocar otra sucursal cambiando parámetros.
- Sin sucursal operativa el backend responde 403. El superadmin debe elegir un
  contexto (`POST /api/auth/sucursal-contexto`).
- `GET` acepta `?tipo=extra|condimento`.
- Un `PUT` emite `stock_actualizado` con `{ sucursalId, insumoIds }` para que la
  pantalla de Stock se actualice en vivo.
- No hay `DELETE` de insumos por sucursal: `GET` recrea las filas faltantes de
  los insumos activos. El botón "Quitar" de la pantalla de Stock usa el mismo
  `PUT` con `{ cantidad: 0, disponible: false }`: deja de ofrecerse en esa
  sucursal, pero conserva el insumo en el catálogo corporativo y se puede
  reactivar con el switch "Disponible".

## 4. Reglas de venta

- **Agotado**: un extra/condimento está agotado cuando no hay stock en ninguna
  sucursal activa (`stockTotal <= 0`) o cuando el insumo está dado de baja. El
  cliente no elige sucursal antes de comprar, así que el modal no puede mirar una
  sola sucursal.
- `GET /api/personalizacion` y las plantillas devuelven `stockTotal` y `agotado`
  por elemento, calculados con una consulta agregada por request
  (`lib/services/disponibilidad_insumos.js`).
- El modal muestra la opción agotada en gris, sin contador y con el texto
  "Agotado" debajo del nombre.
- Si un elemento con `minimo > 0` está agotado, no se puede cumplir la regla: el
  botón "Agregar" queda deshabilitado con un aviso. Las opciones agotadas con
  `minimo = 0` simplemente no se pueden elegir.
- **Descuento**: al crear el pedido se descuenta `cantidad` por unidad de línea y
  por opción, en la sucursal asignada, con `UPDATE ... WHERE cantidad >= n`
  (atómico). Si no alcanza, el pedido no se crea y el mensaje nombra el insumo.
- **Reposición**: al cancelar se devuelven las mismas cantidades. Si la fila ya
  no existe, se crea con la cantidad repuesta para no perderla.
- **Reasignación**: al mover un pedido a otra sucursal se descuenta en la nueva y
  se repone en la anterior, con las mismas validaciones.
- **Reservas vencidas**: si una fila de insumo se apaga o el insumo se da de baja
  antes del pago, el pedido pendiente se considera vencido y se reasigna. No se
  compara `cantidad`: el pedido ya consumió su reserva.
- **Cobertura**: `faltantesDePedido` incluye los insumos. Si ninguna sucursal con
  cobertura tiene stock, el mensaje aclara "en las sucursales que llegan a tu
  dirección" (flag `cobertura`).
- **Pedidos viejos**: los ítems sin `insumoId` en su snapshot se ignoran al
  cancelar o reasignar. No se reconstruye el pasado desde el catálogo actual.

### Snapshot

La personalización viaja como JSON en `PedidoItem.observacion`. Cada extra o
condimento conserva `{ nombre, cantidad, precio, insumoId }`. El `insumoId` se usa
sólo para descontar/reponer; el nombre y el precio son el snapshot histórico.

## 5. Datos demo

- `20261028000003-demo-insumos.js`: catálogo de 10 insumos (6 extras y 4
  condimentos) y 150 unidades por sucursal activa. Idempotente: upsert por
  `(nombre, tipo)` y por `(sucursalId, insumoId)`, y vuelve a linkear filas con
  `insumoId` nulo.
- La migración de vínculo ya deja 150 unidades para los insumos que crea. El
  seeder es la fuente explícita para una base nueva o para volver a dejar el
  catálogo demo en un estado conocido.

## 6. Frontend

- `src/api/insumos.js`: cliente del catálogo.
- `src/api/stock.js`: `obtenerStockInsumos` y `actualizarStockInsumo`.
- `/superadmin/insumos` (`GestionInsumos.jsx`): pestaña "Insumos" dentro de
  Catálogo, sólo SUPERADMINISTRADOR. Alta/edición en `FormularioInsumo.jsx`, baja
  lógica y reactivación.
- `GestionStock.jsx`: filtro principal Todos / Productos / Combos / Insumos y
  sub-filtro Todos / Extras / Condimentos. Las filas de insumos comparten tabla
  con los productos, muestran su tipo y permiten editar cantidad/disponibilidad.
  El botón "Quitar" de un insumo no borra la fila (se recrearía al listar): deja
  `cantidad = 0` y `disponible = false` en esa sucursal. El insumo sigue en el
  catálogo corporativo y se puede reactivar con el switch "Disponible".
- `FormularioPersonalizacion.jsx`: para extra/condimento reemplaza el nombre libre
  por un select de insumos. Precarga nombre y precio (el precio sigue siendo
  editable) y envía `insumoId`.
- `ProductoPersonalizarModal.jsx` y `GrupoOpciones.jsx`: render de agotados y
  bloqueo del botón cuando un mínimo obligatorio no se puede cumplir.

## 7. Tests

- `lib/services/insumos.integration.test.js`: validaciones, alta con filas en 0,
  duplicados, baja lógica, vínculo, listado y cálculo de agotado.
- `lib/services/stock.insumos.integration.test.js`: `insumosDeLineas`, faltantes,
  descuento/reposición, reservas vencidas y mensajes de cobertura.
- `lib/controllers/insumo_controller.test.js`: CRUD HTTP, permisos y scoping de
  `/api/stock/insumos` para admin y superadmin con/sin contexto.
