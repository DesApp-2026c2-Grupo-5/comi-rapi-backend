# Modelo de Dominio — Comi-Rapi

## 1. Objetivo del modelo

Este documento define el modelo de dominio del backend de **Comi-Rapi**, una plataforma de pedidos de comida rápida (delivery + sistema administrativo).

Su finalidad es servir como base aprobada por el equipo antes de diseñar el DER (diagrama entidad-relación) e implementar modelos, migraciones y endpoints. No contiene código, modelos Sequelize ni esquema SQL definitivo.

La fuente funcional principal del proyecto es `docs/enunciado.md`. `docs/historico/analisis-inicial.md` es material histórico y no modifica las decisiones de este documento.

## 2. Alcance

El dominio cubre:

- clientes y administradores;
- sucursales;
- catálogo de productos y categorías;
- personalización de productos;
- combos;
- carrito (estado temporal, no persistido);
- pedidos y su historial de estados;
- direcciones;
- stock por sucursal (Extensión 1);
- promociones (Extensión 1);
- parámetros del sistema;
- reportes (mediante agregaciones, sin tablas propias).

**No** incluye todavía las funcionalidades de la Propuesta 2 (calificaciones, notificaciones, repartidores), que se contemplan como evolución futura.

## 3. Principios de diseño

1. **Simplicidad**: no crear entidades que no tengan una responsabilidad concreta.
2. **Historicidad**: conservar en el pedido los datos vigentes al momento de confirmarlo (precios, nombres, dirección), sin depender de la mutabilidad del catálogo.
3. **Relacional**: representar con claves foráneas reales lo que en el frontend mock es texto o arrays.
4. **Escalabilidad medible**: preparar el dominio para crecer sin implementar entidades "por las dudas".
5. **Separación de responsabilidades**: estado actual vs. historial; reglas de negocio vs. entidades.

## 4. Entidades

| #   | Entidad                 | Responsabilidad                               |
| --- | ----------------------- | --------------------------------------------- |
| 1   | `Usuario`               | Actor autenticado (cliente o administrador)   |
| 2   | `Direccion`             | Dirección guardada por un usuario             |
| 3   | `Sucursal`              | Local físico                                  |
| 4   | `Categoria`             | Agrupar productos                             |
| 5   | `Producto`              | Artículo vendible (normal o combo)            |
| 6   | `ComboComponente`       | Composición de un combo                       |
| 7   | `OpcionGrupo`           | Grupo de opciones de personalización          |
| 8   | `Opcion`                | Opción concreta dentro de un grupo            |
| 9   | `ProductoOpcionGrupo`   | Vínculo producto ↔ grupo de opciones          |
| 10  | `Stock`                 | Disponibilidad de un producto en una sucursal |
| 11  | `Pedido`                | Pedido realizado por un cliente               |
| 12  | `PedidoItem`            | Línea de un pedido                            |
| 13  | `PedidoItemOpcion`      | Opción seleccionada en una línea              |
| 14  | `EstadoPedido`          | Catálogo de estados                           |
| 15  | `PedidoEstadoHistorial` | Trazabilidad de cambios de estado             |
| 16  | `Promocion`             | Beneficio aplicable al catálogo               |
| 17  | `PromocionProducto`     | Vínculo promoción ↔ producto                  |
| 18  | `PedidoPromocion`       | Promoción aplicada a un pedido                |
| 19  | `ParametroSistema`      | Configuración general del sistema             |

## 5. Atributos principales

### 5.1 Usuario

| Atributo          | Tipo / Notas                     |
| ----------------- | -------------------------------- |
| `id`              | PK                               |
| `nombre`          |                                  |
| `apellido`        |                                  |
| `email`           | único                            |
| `password`        | hash (posterior)                 |
| `telefono`        |                                  |
| `rol`             | enum: `CLIENTE`, `ADMINISTRADOR` |
| `activo`          | booleano                         |
| `fechaNacimiento` | `DATEONLY`, opcional             |
| `createdAt`       |                                  |
| `updatedAt`       |                                  |

`edad` es un atributo derivado/calculado a partir de `fechaNacimiento`; **no** se persiste.

Reglas:

- `email` debe ser único.
- `password` se almacenará posteriormente como hash.
- `rol` admite actualmente `CLIENTE` y `ADMINISTRADOR`. No agregar `REPARTIDOR` todavía (Propuesta 2 como evolución futura).

Relaciones:

- `Usuario 1:N Direccion`
- `Usuario 1:N Pedido`

No crear entidades separadas `Cliente` ni `Administrador`.

### 5.2 Direccion

| Atributo       | Tipo / Notas      |
| -------------- | ----------------- |
| `id`           | PK                |
| `usuarioId`    | FK → `Usuario.id` |
| `calle`        |                   |
| `altura`       |                   |
| `ciudad`       |                   |
| `codigoPostal` |                   |
| `referencia`   |                   |
| `latitud`      |                   |
| `longitud`     |                   |
| `alias`        |                   |
| `activa`       | booleano          |

Relación: `Direccion.usuarioId → Usuario.id`

Cardinalidad:

- Un usuario puede tener muchas direcciones.
- Una dirección pertenece a un usuario.

Importante: la dirección utilizada en un pedido **no debe depender de esta entidad para conservar el historial**. Al confirmar/generar el pedido, los datos se copian como snapshot dentro de `Pedido`. No crear `PedidoDireccion`.

### 5.3 Sucursal

| Atributo    | Tipo / Notas                      |
| ----------- | --------------------------------- |
| `id`        | PK                                |
| `nombre`    |                                   |
| `direccion` |                                   |
| `latitud`   |                                   |
| `longitud`  |                                   |
| `telefono`  |                                   |
| `horarios`  | información propia de la sucursal |
| `activa`    | booleano                          |

`horarios` se documenta como información de la sucursal, no como entidad independiente. No crear `HorarioSucursal`. La decisión podrá revisarse si se requiere gestionar horarios de forma estructurada.

Relaciones:

- `Sucursal 1:N Stock`
- `Sucursal 1:N Pedido`

### 5.4 Categoria

| Atributo      | Tipo / Notas |
| ------------- | ------------ |
| `id`          | PK           |
| `nombre`      | único        |
| `descripcion` |              |
| `activa`      | booleano     |

Reglas:

- `nombre` debe ser único.
- No existe jerarquía de categorías.

Relación: `Categoria 1:N Producto`

### 5.5 Producto

| Atributo      | Tipo / Notas              |
| ------------- | ------------------------- |
| `id`          | PK                        |
| `categoriaId` | FK → `Categoria.id`       |
| `nombre`      |                           |
| `descripcion` |                           |
| `precio`      | precio vigente            |
| `imagen`      |                           |
| `activo`      | booleano                  |
| `tipo`        | enum: `PRODUCTO`, `COMBO` |

El precio en `Producto` representa el precio vigente. El precio histórico de un pedido **no** debe obtenerse nuevamente desde `Producto`.

Relaciones:

- `Producto N:1 Categoria`
- `Producto 1:N ProductoOpcionGrupo`
- `Producto 1:N ComboComponente` (como combo)
- `Producto 1:N ComboComponente` (como componente)
- `Producto 1:N Stock`
- `Producto 1:N PedidoItem`

### 5.6 ComboComponente

| Atributo     | Tipo / Notas       |
| ------------ | ------------------ |
| `id`         | PK                 |
| `comboId`    | FK → `Producto.id` |
| `productoId` | FK → `Producto.id` |
| `cantidad`   |                    |

Relaciones:

- `comboId → Producto.id`
- `productoId → Producto.id`

```
Producto (tipo COMBO)
    |
    +--- Producto componente
    +--- Producto componente
    +--- Producto componente
```

Un combo es un `Producto`, no una entidad `Combo` separada. El combo posee su propio precio en `Producto.precio`, que **no** se calcula sumando los precios de sus componentes. La composición representa qué productos lo forman y en qué cantidad.

### 5.7 Personalización de productos

Se modela con tres entidades: `OpcionGrupo`, `Opcion` y `ProductoOpcionGrupo`. No crear entidades independientes para cada tipo de personalización.

#### 5.7.1 OpcionGrupo

| Atributo        | Tipo / Notas              |
| --------------- | ------------------------- |
| `id`            | PK                        |
| `nombre`        |                           |
| `tipoSeleccion` | enum: `UNICA`, `MULTIPLE` |
| `minimo`        |                           |
| `maximo`        |                           |
| `obligatorio`   | booleano                  |
| `activo`        | booleano                  |

Ejemplos conceptuales: Extras, Personalización, Acompañamientos, Condimentos.

#### 5.7.2 Opcion

| Atributo               | Tipo / Notas                 |
| ---------------------- | ---------------------------- |
| `id`                   | PK                           |
| `grupoId`              | FK → `OpcionGrupo.id`        |
| `nombre`               |                              |
| `precioAdicional`      |                              |
| `activo`               | booleano                     |
| `productoReferenciaId` | opcional, FK → `Producto.id` |

Relación: `Opcion.grupoId → OpcionGrupo.id`

`productoReferenciaId` puede usarse cuando la opción representa o referencia otro producto del catálogo.

#### 5.7.3 ProductoOpcionGrupo

| Atributo     | Tipo / Notas          |
| ------------ | --------------------- |
| `id`         | PK                    |
| `productoId` | FK → `Producto.id`    |
| `grupoId`    | FK → `OpcionGrupo.id` |

Restricción: `UNIQUE(productoId, grupoId)` — la combinación producto + grupo debe ser única.

Relaciones:

- `productoId → Producto.id`
- `grupoId → OpcionGrupo.id`

```
Producto N:N OpcionGrupo   (resuelta mediante ProductoOpcionGrupo)
```

El diseño debe permitir que diferentes productos tengan diferentes grupos de personalización.

### 5.8 Stock

| Atributo     | Tipo / Notas                   |
| ------------ | ------------------------------ |
| `sucursalId` | PK (parte), FK → `Sucursal.id` |
| `productoId` | PK (parte), FK → `Producto.id` |
| `cantidad`   |                                |
| `disponible` | booleano                       |

Clave: `(sucursalId, productoId)` — la combinación sucursal + producto debe ser única.

Interpretación:

- `disponible = false`: la sucursal no ofrece actualmente ese producto.
- `cantidad = 0`: el producto se ofrece pero no tiene stock.

El stock es independiente para cada sucursal.

### 5.9 Pedido

| Atributo      | Tipo / Notas                            |
| ------------- | --------------------------------------- |
| `id`          | PK                                      |
| `usuarioId`   | FK → `Usuario.id`                       |
| `sucursalId`  | FK → `Sucursal.id`                      |
| `fechaHora`   |                                         |
| `estadoId`    | FK → `EstadoPedido.id`                  |
| `costoEnvio`  |                                         |
| `total`       |                                         |
| `medioPago`   | enum inicial: `MERCADO_PAGO`, `TARJETA` |
| `observacion` |                                         |

Snapshot de dirección (fuente histórica de la dirección de entrega):

| Atributo snapshot |
| ----------------- |
| `calle`           |
| `altura`          |
| `ciudad`          |
| `codigoPostal`    |
| `referencia`      |
| `latitud`         |
| `longitud`        |

Relaciones:

- `Pedido.usuarioId → Usuario.id`
- `Pedido.sucursalId → Sucursal.id`
- `Pedido.estadoId → EstadoPedido.id`
- `Pedido 1:N PedidoItem`
- `Pedido 1:N PedidoEstadoHistorial`
- `Pedido 1:N PedidoPromocion`

El pago es simulado. La dirección almacenada en `Pedido` constituye la fuente histórica de la dirección de entrega.

### 5.10 PedidoItem

| Atributo         | Tipo / Notas       |
| ---------------- | ------------------ |
| `id`             | PK                 |
| `pedidoId`       | FK → `Pedido.id`   |
| `productoId`     | FK → `Producto.id` |
| `nombreProducto` | snapshot           |
| `precioUnitario` | snapshot           |
| `cantidad`       |                    |
| `subtotal`       |                    |
| `observacion`    |                    |

Relaciones:

- `PedidoItem.pedidoId → Pedido.id`
- `PedidoItem.productoId → Producto.id`

`nombreProducto` y `precioUnitario` son snapshots históricos. El pedido no debe reconstruirse con el nombre o precio actuales de `Producto`. Ejemplo: si un producto costaba $5000 al realizar el pedido y luego pasa a $6500, el pedido histórico continúa mostrando $5000.

### 5.11 PedidoItemOpcion

| Atributo          | Tipo / Notas         |
| ----------------- | -------------------- |
| `id`              | PK                   |
| `pedidoItemId`    | FK → `PedidoItem.id` |
| `opcionId`        | FK → `Opcion.id`     |
| `nombre`          | snapshot             |
| `precioAdicional` | snapshot             |
| `cantidad`        |                      |

Relaciones:

- `PedidoItemOpcion.pedidoItemId → PedidoItem.id`
- `PedidoItemOpcion.opcionId → Opcion.id`

`nombre` y `precioAdicional` son snapshots históricos, garantizando que cambios posteriores en una opción no modifiquen pedidos históricos.

### 5.12 EstadoPedido

| Atributo    | Tipo / Notas |
| ----------- | ------------ |
| `id`        | PK           |
| `nombre`    |              |
| `orden`     |              |
| `esInicial` | booleano     |
| `esFinal`   | booleano     |
| `activo`    | booleano     |

Estados iniciales previstos:

```
PENDIENTE
CONFIRMADO
EN_PREPARACION
LISTO
EN_CAMINO
ENTREGADO
CANCELADO
```

`EstadoPedido` permite administrar los estados generales solicitados por la consigna.

### 5.13 PedidoEstadoHistorial

| Atributo      | Tipo / Notas           |
| ------------- | ---------------------- |
| `id`          | PK                     |
| `pedidoId`    | FK → `Pedido.id`       |
| `estadoId`    | FK → `EstadoPedido.id` |
| `usuarioId`   | FK → `Usuario.id`      |
| `fechaHora`   |                        |
| `observacion` |                        |

Relaciones:

- `pedidoId → Pedido.id`
- `estadoId → EstadoPedido.id`
- `usuarioId → Usuario.id`

Permite conocer: qué estado tuvo el pedido, cuándo ingresó a él, opcionalmente qué usuario realizó el cambio y observaciones asociadas.

El estado actual se mantiene también en `Pedido.estadoId`:

- `Pedido.estadoId` = estado actual.
- `PedidoEstadoHistorial` = trazabilidad histórica.

Cada cambio de estado de un pedido debe actualizar el estado actual de `Pedido` y generar simultáneamente un registro en `PedidoEstadoHistorial`.

### 5.14 Promocion

| Atributo      | Tipo / Notas                                        |
| ------------- | --------------------------------------------------- |
| `id`          | PK                                                  |
| `nombre`      |                                                     |
| `descripcion` |                                                     |
| `tipo`        | enum inicial: `DESCUENTO_PORCENTUAL`, `DOS_POR_UNO` |
| `valor`       |                                                     |
| `fechaInicio` |                                                     |
| `fechaFin`    |                                                     |
| `activa`      | booleano                                            |

No implementar todavía: cupones, envío gratis, descuentos por monto, reglas por sucursal, motor genérico de reglas. La estructura debe permitir ampliar los tipos posteriormente.

### 5.15 PromocionProducto

| Atributo      | Tipo / Notas        |
| ------------- | ------------------- |
| `id`          | PK                  |
| `promocionId` | FK → `Promocion.id` |
| `productoId`  | FK → `Producto.id`  |

Restricción: `UNIQUE(promocionId, productoId)` — la combinación promoción + producto debe ser única.

Relaciones:

- `promocionId → Promocion.id`
- `productoId → Producto.id`

```
Promocion N:N Producto   (PromocionProducto)
```

Los combos, al ser productos, también pueden ser alcanzados por una promoción.

### 5.16 PedidoPromocion

| Atributo            | Tipo / Notas        |
| ------------------- | ------------------- |
| `id`                | PK                  |
| `pedidoId`          | FK → `Pedido.id`    |
| `promocionId`       | FK → `Promocion.id` |
| `descuentoAplicado` | snapshot            |

Restricción: `UNIQUE(pedidoId, promocionId)` — la combinación pedido + promoción debe ser única.

Relaciones:

- `pedidoId → Pedido.id`
- `promocionId → Promocion.id`

`descuentoAplicado` representa el beneficio efectivamente aplicado y debe conservarse como dato histórico. Permite reportes posteriores: promociones utilizadas, cantidad de usos e impacto económico.

### 5.17 ParametroSistema

| Atributo      | Tipo / Notas |
| ------------- | ------------ |
| `id`          | PK           |
| `clave`       | único        |
| `valor`       |              |
| `descripcion` |              |

Regla: `clave` debe ser única. No crear entidades específicas para cada parámetro.

## 6. Relaciones y cardinalidades

```
Usuario 1:N Direccion
Usuario 1:N Pedido

Categoria 1:N Producto

Producto N:N OpcionGrupo
      mediante ProductoOpcionGrupo

OpcionGrupo 1:N Opcion

Producto (COMBO) 1:N ComboComponente
Producto (componente) 1:N ComboComponente

Sucursal 1:N Stock
Producto 1:N Stock

Pedido N:1 Usuario
Pedido N:1 Sucursal
Pedido N:1 EstadoPedido

Pedido 1:N PedidoItem
PedidoItem 1:N PedidoItemOpcion

Pedido 1:N PedidoEstadoHistorial
EstadoPedido 1:N PedidoEstadoHistorial

Promocion N:N Producto
      mediante PromocionProducto

Pedido N:N Promocion
      mediante PedidoPromocion
```

| A                     | B                     | Cardinalidad | FK                                |
| --------------------- | --------------------- | ------------ | --------------------------------- |
| Usuario               | Direccion             | 1:N          | `Direccion.usuarioId`             |
| Usuario               | Pedido                | 1:N          | `Pedido.usuarioId`                |
| Categoria             | Producto              | 1:N          | `Producto.categoriaId`            |
| Producto              | ProductoOpcionGrupo   | 1:N          | `ProductoOpcionGrupo.productoId`  |
| OpcionGrupo           | ProductoOpcionGrupo   | 1:N          | `ProductoOpcionGrupo.grupoId`     |
| OpcionGrupo           | Opcion                | 1:N          | `Opcion.grupoId`                  |
| Producto (combo)      | ComboComponente       | 1:N          | `ComboComponente.comboId`         |
| Producto (componente) | ComboComponente       | 1:N          | `ComboComponente.productoId`      |
| Sucursal              | Stock                 | 1:N          | `Stock.sucursalId`                |
| Producto              | Stock                 | 1:N          | `Stock.productoId`                |
| Sucursal              | Pedido                | 1:N          | `Pedido.sucursalId`               |
| EstadoPedido          | Pedido                | 1:N          | `Pedido.estadoId`                 |
| Pedido                | PedidoItem            | 1:N          | `PedidoItem.pedidoId`             |
| Producto              | PedidoItem            | 1:N          | `PedidoItem.productoId`           |
| PedidoItem            | PedidoItemOpcion      | 1:N          | `PedidoItemOpcion.pedidoItemId`   |
| Opcion                | PedidoItemOpcion      | 1:N          | `PedidoItemOpcion.opcionId`       |
| Pedido                | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.pedidoId`  |
| EstadoPedido          | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.estadoId`  |
| Usuario               | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.usuarioId` |
| Promocion             | PromocionProducto     | 1:N          | `PromocionProducto.promocionId`   |
| Producto              | PromocionProducto     | 1:N          | `PromocionProducto.productoId`    |
| Pedido                | PedidoPromocion       | 1:N          | `PedidoPromocion.pedidoId`        |
| Promocion             | PedidoPromocion       | 1:N          | `PedidoPromocion.promocionId`     |

## 7. Reglas de negocio

### 7.1 Asignación de sucursal (regla de negocio, no entidad)

1. Obtener las sucursales activas.
2. Ordenarlas por proximidad geográfica a la dirección de entrega.
3. Comprobar si la sucursal más cercana dispone del stock necesario.
4. Si no dispone del stock, evaluar la siguiente sucursal más cercana.
5. Continuar hasta encontrar una sucursal capaz de satisfacer el pedido.
6. Si ninguna sucursal puede satisfacerlo, el pedido no puede confirmarse.

Además, un administrador puede reasignar manualmente la sucursal de un pedido como excepción operativa. No crear una entidad para esta regla.

### 7.2 Otras reglas

- `Usuario.email` único; `password` como hash.
- `Categoria.nombre` único; sin jerarquía de categorías.
- `ParametroSistema.clave` único.
- `Stock`: PK compuesta `(sucursalId, productoId)` única.
- El carrito es estado temporal y se revalida contra la BD al confirmar.
- **Combos y stock (decisión pendiente)**: un combo es un `Producto` cuya composición se define mediante `ComboComponente`. Su disponibilidad puede depender de la disponibilidad de sus componentes (por ejemplo, hamburguesa, papas y bebida), por lo que no alcanza necesariamente con consultar un stock independiente del combo. Queda pendiente definir la estrategia de verificación de stock para combos antes de implementar la lógica de stock y pedidos. No se agregan entidades ni se modifica la estructura.

## 8. Snapshots históricos

- **Dirección en `Pedido`**: al confirmar/generar el pedido se copian `calle`, `altura`, `ciudad`, `codigoPostal`, `referencia`, `latitud` y `longitud`. No depende de `Direccion` para conservar el historial.
- **Producto en `PedidoItem`**: `nombreProducto` y `precioUnitario` son copia del momento del pedido. No se reconstruyen desde `Producto`.
- **Opción en `PedidoItemOpcion`**: `nombre` y `precioAdicional` son copia del momento del pedido.
- **Promoción en `PedidoPromocion`**: `descuentoAplicado` conserva el beneficio efectivamente aplicado.

## 9. Decisiones importantes

- Una sola entidad `Usuario` con `rol` (sin `Cliente`/`Administrador` separados).
- Dirección histórica por snapshot dentro de `Pedido` (sin `PedidoDireccion`).
- `horarios` como información de `Sucursal` (sin `HorarioSucursal`).
- Combos como `Producto` con `tipo = COMBO` + `ComboComponente` (sin entidad `Combo`).
- Precio del combo es propio en `Producto.precio`, no suma de componentes.
- Personalización con `OpcionGrupo` + `Opcion` + `ProductoOpcionGrupo`.
- Stock por sucursal y producto con clave compuesta.
- ProductoOpcionGrupo, PromocionProducto y PedidoPromocion (asociativas N:M) usan id propio + UNIQUE sobre el par de FKs, no clave compuesta (a diferencia de Stock, que sí la usa por acceder siempre por el par sucursal+producto).
- Estado actual en `Pedido.estadoId` y trazabilidad en `PedidoEstadoHistorial`.
- Carrito no persistido.
- Promociones con tipos concretos iniciales (`DESCUENTO_PORCENTUAL`, `DOS_POR_UNO`).
- Reportes sin tablas propias.

## 10. Exclusiones / límites actuales

Este modelo **no** incluye:

- `Cliente` separado de `Usuario`
- `Administrador` separado de `Usuario`
- `Carrito`
- `CarritoItem`
- `HorarioSucursal`
- `PrecioHistorico`
- tablas específicas de reportes
- motor genérico de promociones
- `Cupon`
- `Repartidor`
- `Calificacion`
- `Notificacion`
- jerarquía de categorías
- máquina de estados formal
- entidad `Combo` separada

## 11. Consideraciones de escalabilidad futura

La Propuesta 2 **no** forma parte del modelo implementado actualmente, pero las decisiones actuales deben permitir agregar posteriormente calificaciones, notificaciones y repartidores. No crear esas entidades ahora.

La arquitectura futura podrá incorporar, por ejemplo:

- un rol `REPARTIDOR`;
- una entidad específica de repartidor asociada a `Usuario`;
- asignación de repartidores a pedidos;
- calificaciones asociadas a pedidos;
- notificaciones asociadas a usuarios/pedidos o cambios de estado.

## 12. Resumen general del modelo

| Entidad                 | Responsabilidad                    | Relaciones principales                                                                                                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Usuario`               | Actor autenticado                  | 1:N `Direccion`, 1:N `Pedido`                                                                                           |
| `Direccion`             | Dirección guardada                 | N:1 `Usuario`                                                                                                           |
| `Sucursal`              | Local físico                       | 1:N `Stock`, 1:N `Pedido`                                                                                               |
| `Categoria`             | Agrupar productos                  | 1:N `Producto`                                                                                                          |
| `Producto`              | Artículo vendible (normal o combo) | N:1 `Categoria`, 1:N `ProductoOpcionGrupo`, 1:N `ComboComponente`, 1:N `Stock`, 1:N `PedidoItem`                        |
| `ComboComponente`       | Composición de combo               | N:1 `Producto` (combo), N:1 `Producto` (componente)                                                                     |
| `OpcionGrupo`           | Grupo de opciones                  | 1:N `Opcion`                                                                                                            |
| `Opcion`                | Opción concreta                    | N:1 `OpcionGrupo`                                                                                                       |
| `ProductoOpcionGrupo`   | Vínculo producto ↔ grupo           | N:1 `Producto`, N:1 `OpcionGrupo`                                                                                       |
| `Stock`                 | Disponibilidad producto×sucursal   | N:1 `Sucursal`, N:1 `Producto`                                                                                          |
| `Pedido`                | Pedido realizado/registrado        | N:1 `Usuario`, N:1 `Sucursal`, N:1 `EstadoPedido`, 1:N `PedidoItem`, 1:N `PedidoEstadoHistorial`, 1:N `PedidoPromocion` |
| `PedidoItem`            | Línea de pedido                    | N:1 `Pedido`, N:1 `Producto`, 1:N `PedidoItemOpcion`                                                                    |
| `PedidoItemOpcion`      | Opción seleccionada                | N:1 `PedidoItem`, N:1 `Opcion`                                                                                          |
| `EstadoPedido`          | Catálogo de estados                | 1:N `Pedido`, 1:N `PedidoEstadoHistorial`                                                                               |
| `PedidoEstadoHistorial` | Trazabilidad de estados            | N:1 `Pedido`, N:1 `EstadoPedido`, N:1 `Usuario`                                                                         |
| `Promocion`             | Beneficio aplicable                | 1:N `PromocionProducto`, 1:N `PedidoPromocion`                                                                          |
| `PromocionProducto`     | Vínculo promoción ↔ producto       | N:1 `Promocion`, N:1 `Producto`                                                                                         |
| `PedidoPromocion`       | Promoción aplicada                 | N:1 `Pedido`, N:1 `Promocion`                                                                                           |
| `ParametroSistema`      | Configuración del sistema          | —                                                                                                                       |

## 13. Observaciones pendientes

Sin modificar el modelo documentado, se dejan señaladas las siguientes observaciones para que el equipo las valide en una etapa posterior:

- `Pedido.medioPago` admite `MERCADO_PAGO` y `TARJETA`; el enunciado no define explícitamente estos valores, por lo que conviene confirmar el listado final antes del DER.
- No se especifica el tipo/dominio de `Promocion.valor` (porcentaje, cantidad fija, etc.); conviene precisarlo al diseñar la implementación.
- `Pedido.estadoId` (estado actual) convive con el historial; se sugiere confirmar la regla de actualización consistente de ambos al generar cambios de estado.
- El tiempo estimado de entrega no requiere necesariamente almacenamiento persistente. Su cálculo deberá definirse como regla de negocio y podrá realizarse dinámicamente a partir del estado del pedido y/o parámetros del sistema. `PedidoEstadoHistorial` permite calcular tiempos reales e históricos, pero no representa por sí mismo una estimación futura.
