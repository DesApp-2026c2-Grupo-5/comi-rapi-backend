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
- reseñas de productos y combos comprados;
- reclamos del cliente sobre pedidos entregados (`Queja`);
- parámetros del sistema;
- reportes (mediante agregaciones, sin tablas propias).

**No** incluye todavía las funcionalidades de la Propuesta 2 (notificaciones y repartidores), que se contemplan como evolución futura. Las reseñas sí se incorporaron como `Resena`: reemplazan la idea de "calificación" de la Propuesta 2 y se limitan a producto + estrellas + comentario, sin repartidor ni notificación. Los reclamos se incorporaron como `Queja`, autorizados explícitamente: son un canal de atención sobre un pedido entregado y **no** habilitan `Notificacion` ni `Repartidor`.

## 3. Principios de diseño

1. **Simplicidad**: no crear entidades que no tengan una responsabilidad concreta.
2. **Historicidad**: conservar en el pedido los datos vigentes al momento de confirmarlo (precios, nombres, dirección), sin depender de la mutabilidad del catálogo.
3. **Relacional**: representar con claves foráneas reales lo que en el frontend mock es texto o arrays.
4. **Escalabilidad medible**: preparar el dominio para crecer sin implementar entidades "por las dudas".
5. **Separación de responsabilidades**: estado actual vs. historial; reglas de negocio vs. entidades.

## 4. Entidades

| #   | Entidad                 | Responsabilidad                                  |
| --- | ----------------------- | ------------------------------------------------ |
| 1   | `Usuario`               | Actor autenticado (cliente o administrador)      |
| 2   | `Direccion`             | Dirección de un usuario o una sucursal           |
| 3   | `Sucursal`              | Local físico                                     |
| 4   | `Categoria`             | Agrupar productos                                |
| 5   | `Producto`              | Artículo vendible (normal o combo)               |
| 6   | `ComboComponente`       | Composición de un combo                          |
| 7   | `OpcionGrupo`           | Grupo de opciones de personalización             |
| 8   | `Opcion`                | Opción concreta dentro de un grupo               |
| 9   | `ProductoOpcionGrupo`   | Vínculo producto ↔ grupo de opciones             |
| 10  | `Stock`                 | Disponibilidad de un producto en una sucursal    |
| 11  | `Pedido`                | Pedido realizado por un cliente                  |
| 12  | `PedidoItem`            | Línea de un pedido                               |
| 13  | `PedidoItemOpcion`      | Opción seleccionada en una línea                 |
| 14  | `EstadoPedido`          | Catálogo de estados                              |
| 15  | `PedidoEstadoHistorial` | Trazabilidad de cambios de estado                |
| 16  | `Promocion`             | Beneficio aplicable al catálogo                  |
| 17  | `PromocionProducto`     | Vínculo promoción ↔ producto                     |
| 18  | `PedidoPromocion`       | Promoción aplicada a un pedido                   |
| 19  | `ParametroSistema`      | Configuración general del sistema                |
| 20  | `Resena`                | Opinión de un cliente sobre un producto comprado |
| 21  | `Insumo`                | Extra o condimento con precio y baja lógica      |
| 22  | `InsumoStock`           | Existencia de un insumo en una sucursal          |
| 23  | `Queja`                 | Reclamo de un cliente sobre un pedido entregado  |
| 24  | `QuejaMensaje`          | Mensaje del hilo de un reclamo                   |
| 25  | `Ingrediente`           | Materia prima con unidad de medida               |
| 26  | `IngredienteStock`      | Existencia de un ingrediente en una sucursal     |
| 27  | `ProductoIngrediente`   | Receta: ingredientes y cantidades de un producto |

## 5. Atributos principales

### 5.1 Usuario

| Atributo          | Tipo / Notas                                              |
| ----------------- | --------------------------------------------------------- |
| `id`              | PK                                                        |
| `nombre`          |                                                           |
| `apellido`        |                                                           |
| `email`           | único                                                     |
| `password`        | hash (posterior)                                          |
| `telefono`        |                                                           |
| `rol`             | enum: `CLIENTE`, `ADMINISTRADOR`, `SUPERADMINISTRADOR`    |
| `activo`          | booleano                                                  |
| `fechaNacimiento` | `DATEONLY`, opcional                                      |
| `fotoPerfilUrl`   | STRING, opcional                                          |
| `sucursalId`      | INTEGER, FK opcional → `Sucursal.id` (solo ADMINISTRADOR) |
| `createdAt`       |                                                           |
| `updatedAt`       |                                                           |

`edad` es un atributo derivado/calculado a partir de `fechaNacimiento`; **no** se persiste.

Reglas:

- `email` debe ser único.
- `password` se almacenará posteriormente como hash.
- `rol` admite `CLIENTE`, `ADMINISTRADOR` y `SUPERADMINISTRADOR`. No agregar `REPARTIDOR` todavía (Propuesta 2 como evolución futura).
- La sucursal no se guarda en `Usuario`: se asigna al `Pedido` como regla de negocio (proximidad + disponibilidad de stock), con reasignación manual del administrador como excepción operativa.

Relaciones:

- `Usuario 1:N Direccion`
- `Usuario 1:N Pedido`

No crear entidades separadas `Cliente` ni `Administrador`.

### 5.2 Direccion

`Direccion` es la única entidad que almacena los datos de ubicación (domicilio textual y, posteriormente, coordenadas) tanto de un **usuario** como de una **sucursal**. Puede pertenecer a un usuario o a una sucursal, pero **no a ambos simultáneamente ni a ninguno**.

| Atributo       | Tipo / Notas                |
| -------------- | --------------------------- |
| `id`           | PK                          |
| `usuarioId`    | FK opcional → `Usuario.id`  |
| `sucursalId`   | FK opcional → `Sucursal.id` |
| `calle`        | obligatorio                 |
| `altura`       | obligatorio                 |
| `provincia`    | obligatorio                 |
| `departamento` | opcional (iteración 1-geo)  |
| `localidad`    | opcional (iteración 1-geo)  |
| `codigoPostal` | opcional (iteración 1-geo)  |
| `nomenclatura` | opcional (iteración 1-geo)  |
| `referencia`   | opcional                    |
| `latitud`      | opcional                    |
| `longitud`     | opcional                    |
| `alias`        | opcional                    |
| `activa`       | booleano                    |

Relaciones:

- `Direccion.usuarioId → Usuario.id` (opcional)
- `Direccion.sucursalId → Sucursal.id` (opcional)

Cardinalidad:

- `Usuario 1:N Direccion`: un usuario puede tener muchas direcciones.
- `Sucursal 1:1 Direccion`: una sucursal tiene exactamente una dirección.

Reglas:

- **Propietario exclusivo**: exactamente uno de `usuarioId` / `sucursalId` debe estar informado. Se garantiza a nivel de persistencia mediante el CHECK `CK_Direcciones_propietario` (`("usuarioId" IS NOT NULL)::int + ("sucursalId" IS NOT NULL)::int = 1`) y a nivel de modelo mediante una validación de instancia.
- `Usuario.id` y `Sucursal.id` son FKs con `ON DELETE RESTRICT`.
- **Campos obligatorios**: `calle`, `altura` y `provincia`. El `departamento` (partido) es obligatorio en la API cuando la provincia es Buenos Aires (desambiguación territorial). Se validan en la API de direcciones (cliente) y en la API de sucursales (admin, al crear/actualizar la dirección de la sucursal).
- **Coordenadas no manuales**: `latitud` y `longitud` son opcionales y **no se ingresan manualmente** (ni por el admin ni por nadie): la API las rechaza. El servicio de geolocalización `geolocation_service` (Georef Argentina) las calcula a partir de los datos de la dirección (`calle`, `altura`, `provincia`, `departamento?`, `localidad?`); `direccion_service` las geocodifica y persiste al crear/editar (integración con el ABM implementada; ver `docs/reglas-negocio.md` §17). Ver `docs/reglas-negocio.md` §14.

> **Nota de cambio (Iteración 1-geo, ampliada en Iteración 2):** nuevo modelo territorial alineado con Georef (ver `docs/reglas-negocio.md` §18). Se agregan `departamento` (partido en Buenos Aires / comuna en CABA) y `nomenclatura` (dirección normalizada por Georef). `localidad` pasa a ser **determinada por el backend** (localidad censal de Georef; ya no se exige al usuario) y `codigoPostal` pasa a ser opcional: **Georef no provee códigos postales** (verificado contra su API) y el proyecto no incorpora otros proveedores. Desde la Iteración 2, `provincia`, `calle`, `departamento` y `localidad` se persisten **todos normalizados por Georef** (la fila refleja exactamente la dirección resuelta); `nomenclatura` queda como dato geográfico complementario.

Importante: la dirección utilizada en un pedido **no debe depender de esta entidad para conservar el historial**. Al confirmar/generar el pedido, los datos se copian como snapshot dentro de `Pedido`. No crear `PedidoDireccion`.

### 5.3 Sucursal

| Atributo   | Tipo / Notas |
| ---------- | ------------ |
| `id`       | PK           |
| `nombre`   |              |
| `telefono` |              |
| `activa`   | booleano     |

`Sucursal` **no** almacena `direccion` ni `latitud`/`longitud`: esos datos quedan centralizados en `Direccion` mediante la relación `Sucursal 1:1 Direccion` (FK `Direccion.sucursalId`). Antes de esta alineación, `Sucursal` los duplicaba como `direccion STRING` + coordenadas; dichas columnas fueron eliminadas.

### 5.3.1 HorarioSucursal

El horario de atención es **estructurado**. `Sucursales.horarios` (texto libre) se eliminó tras el backfill a `HorarioSucursal`:

| Atributo     | Tipo / Notas                                   |
| ------------ | ---------------------------------------------- |
| `id`         | PK                                             |
| `sucursalId` | FK → `Sucursal.id` (`ON DELETE CASCADE`)       |
| `diaSemana`  | entero 1..7 (lunes = 1, domingo = 7, ISO-8601) |
| `apertura`   | `TIME` — hora real de apertura del local       |
| `cierre`     | `TIME` — hora real de cierre del local         |

Reglas:

- Varias franjas por día y solapamientos permitidos: "abierta" es caer en cualquiera. Se rechazan franjas exactamente duplicadas (UNIQUE `(sucursalId, diaSemana, apertura, cierre)`) y `apertura = cierre`.
- `cierre <= apertura` representa una franja que **cruza la medianoche** (ej. 19:00–02:00) y pertenece al día de apertura; se evalúan también las franjas del día anterior.
- Un día sin franjas está cerrado. Para cerrar todo el local se usa `activa = false`, no la ausencia de franjas.
- La franja guarda el horario del local. El **corte de pedidos** se deriva restando el parámetro global `margenCierreMinutos` (default 30): el local cierra 23:00 y la página deja de tomar pedidos 22:30.
- La evaluación se hace siempre en `America/Argentina/Buenos_Aires`.

Relaciones:

- `Sucursal 1:1 Direccion`
- `Sucursal 1:N HorarioSucursal`
- `Sucursal 1:N Stock`
- `Sucursal 1:N Pedido`

### 5.4 Categoria

| Atributo      | Tipo / Notas                                  |
| ------------- | --------------------------------------------- |
| `id`          | PK                                            |
| `nombre`      | único                                         |
| `descripcion` |                                               |
| `imagen`      | ruta relativa en `public/imagenes/categorias` |
| `activa`      | booleano                                      |

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
- `Producto 1:N ProductoIngrediente` (receta, sólo `tipo = PRODUCTO`)
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

En un combo, `cantidad` es la cantidad de combos que se pueden armar con el stock
actual de sus componentes. No la carga el administrador: el backend la deriva de
la receta y la recalcula sola. Lo que sí se maneja a mano es `disponible`, para
sacarlo del catálogo de la sucursal. Ver §7.2 ("Combos y stock").

### 5.8.1 Insumo e InsumoStock (extensión implementada)

Los extras y condimentos con stock propio se separan de `Producto`:

- `Insumo`: `id`, `nombre`, `tipo` (`extra` o `condimento`), `precio` (obligatorio
  en extra, `null` en condimento) y `activo` (baja lógica). UNIQUE `(nombre, tipo)`.
- `InsumoStock`: PK compuesta `(sucursalId, insumoId)`, `cantidad >= 0` y
  `disponible`. Misma semántica que `Stock`.

`PersonalizacionElementos` y `PersonalizacionCategorias` agregan `insumoId`
(nullable, FK → `Insumo.id`), obligatorio en `extra`/`condimento`.

El detalle de reglas, endpoints y datos demo está en `docs/insumos.md`.

### 5.8.2 Ingrediente e IngredienteStock (stock por receta)

El stock real del catálogo deja de cargarse a mano en `Stock` y pasa a estar en
los ingredientes:

- `Ingrediente`: `id`, `nombre` (único, sin distinguir mayúsculas),
  `unidadMedida` (`unidad`, `g`, `kg`, `ml`, `l`) y `activo` (baja lógica). No hay
  conversión automática entre unidades: la unidad es la del ingrediente y se usa
  tal cual en la receta.
- `IngredienteStock`: PK compuesta `(sucursalId, ingredienteId)`,
  `cantidad DECIMAL(12,3) >= 0` y `disponible`. Misma semántica que `Stock`:
  `disponible = false` equivale a `0` para el cálculo y la venta, y la ausencia de
  fila en la sucursal también equivale a `0`.
- La `unidadMedida` no se puede cambiar si el ingrediente ya tiene stock o
  recetas cargadas, para no reinterpretar cantidades existentes.
- `Insumo`/`InsumoStock` siguen siendo independientes: los extras y condimentos no
  forman parte de la receta.

### 5.8.3 ProductoIngrediente (receta)

| Atributo        | Tipo / Notas                      |
| --------------- | --------------------------------- |
| `productoId`    | PK (parte), FK → `Producto.id`    |
| `ingredienteId` | PK (parte), FK → `Ingrediente.id` |
| `cantidad`      | `DECIMAL(12,3) > 0`               |
| `permiteQuitar` | booleano, default `true`          |

Clave: `(productoId, ingredienteId)` — no se repite un ingrediente en la misma
receta.

Reglas:

- La receta es **obligatoria** para todo `Producto` con `tipo = PRODUCTO` (al
  menos un ingrediente). Un `COMBO` no tiene receta de ingredientes: sigue
  derivando de `ComboComponente`.
- `cantidad` es lo que lleva **una unidad** del producto y se expresa en la
  `unidadMedida` del ingrediente.
- `permiteQuitar` define si el ingrediente aparece como opción "Sin X" en el
  detalle. No altera el descuento de stock: siempre se descuenta la receta
  completa.
- Los ingredientes del detalle y las opciones "Sin X" se generan desde la receta.
  El campo viejo `ingredientes` de `PersonalizacionElemento` de tipo
  `personalizar` deja de cargarse a mano y pasa a sincronizarse desde acá.
- Sin receta, el producto tiene cantidad derivada `0` y no es vendible.

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

### 5.18 Resena

| Atributo     | Tipo / Notas                                                 |
| ------------ | ------------------------------------------------------------ |
| `id`         | PK                                                           |
| `usuarioId`  | FK → `Usuario.id` (solo CLIENTE)                             |
| `productoId` | FK → `Producto.id` (producto simple o combo)                 |
| `pedidoId`   | FK → `Pedido.id` (pedido `entregado` que habilitó la reseña) |
| `puntuacion` | INTEGER, 1 a 5                                               |
| `comentario` | TEXT, opcional, máximo 500 caracteres                        |
| `createdAt`  |                                                              |
| `updatedAt`  |                                                              |

Reglas: un cliente deja **una sola reseña por producto** (UNIQUE `usuarioId + productoId`); solo puede crearla si tiene un pedido `entregado` que incluya ese producto; puede editarla o eliminarla. El autor se muestra como "Nombre I." (nombre + inicial del apellido), nunca con email. No es la `Calificacion` de la Propuesta 2: no evalúa al repartidor ni al pedido en general.

### 5.19 Queja

| Atributo          | Tipo / Notas                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `id`              | PK                                                                                                    |
| `usuarioId`       | FK → `Usuario.id` (solo CLIENTE autor del reclamo)                                                    |
| `pedidoId`        | FK → `Pedido.id` (pedido propio y `entregado`), UNIQUE                                                |
| `motivo`          | ENUM: `PEDIDO_INCOMPLETO`, `PRODUCTO_EN_MAL_ESTADO`, `DEMORA_EN_LA_ENTREGA`, `ERROR_DE_COBRO`, `OTRO` |
| `detalle`         | TEXT, obligatorio, 10 a 1000 caracteres                                                               |
| `estado`          | ENUM: `PENDIENTE` (default), `EN_REVISION`, `RESUELTA`, `RECHAZADA`, `CERRADA`                        |
| `respuesta`       | TEXT, opcional, máximo 1000 caracteres (última del negocio)                                           |
| `respondidoPorId` | FK → `Usuario.id` (ADMINISTRADOR o SUPERADMINISTRADOR), opcional                                      |
| `respondidaEn`    | DATE, opcional (se completa al responder)                                                             |
| `cerradaEn`       | DATE, opcional (cierre del cliente)                                                                   |
| `createdAt`       |                                                                                                       |
| `updatedAt`       |                                                                                                       |

Hilo: `QuejaMensajes` (`quejaId`, `autorId`, `contenido`) guarda las respuestas del cliente (hasta 5) y del negocio.

Reglas: solo el CLIENTE dueño del pedido puede crear la queja, y únicamente si el pedido está `entregado`; **un pedido admite una sola queja** (UNIQUE `pedidoId`). El cliente consulta solo las suyas. El ADMINISTRADOR gestiona las quejas de pedidos de su sucursal y el SUPERADMINISTRADOR todas. Estados: `PENDIENTE → EN_REVISION → RESUELTA | RECHAZADA`; se puede resolver o rechazar directamente desde `PENDIENTE`. `RESUELTA` y `RECHAZADA` exigen `respuesta` y cierran del lado del negocio, pero el cliente puede reabrirlas respondiendo. El cliente puede cerrar en cualquier momento: pasa a `CERRADA` (final). No confundir con `Resena`: la queja es un reclamo operativo con respuesta del negocio, no una opinión pública.

## 6. Relaciones y cardinalidades

```
Usuario 1:N Direccion
Usuario 1:N Pedido

Sucursal 1:1 Direccion
Sucursal 1:N Usuario              (sucursal asignada al ADMINISTRADOR)
Sucursal 1:N HorarioSucursal      (franjas de atención por día)

Categoria 1:N Producto

Producto N:N OpcionGrupo
      mediante ProductoOpcionGrupo

OpcionGrupo 1:N Opcion

Producto (COMBO) 1:N ComboComponente
Producto (componente) 1:N ComboComponente

Sucursal 1:N Stock
Producto 1:N Stock

Sucursal 1:N InsumoStock
Insumo 1:N InsumoStock
Insumo 1:N PersonalizacionElemento   (opcional, extra/condimento)
Insumo 1:N PersonalizacionCategoria  (opcional, extra/condimento)

Sucursal 1:N IngredienteStock
Ingrediente 1:N IngredienteStock
Producto 1:N ProductoIngrediente     (receta, sólo tipo PRODUCTO)
Ingrediente 1:N ProductoIngrediente

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

Usuario 1:N Resena
Producto 1:N Resena
Pedido 1:N Resena

Usuario 1:N Queja                    (autor del reclamo)
Usuario 1:N Queja                    (administrador que respondió)
Pedido 1:1 Queja                     (UNIQUE pedidoId)
Queja 1:N QuejaMensaje
Usuario 1:N QuejaMensaje             (autor del mensaje)
```

| A                     | B                     | Cardinalidad | FK                                  |
| --------------------- | --------------------- | ------------ | ----------------------------------- |
| Usuario               | Direccion             | 1:N          | `Direccion.usuarioId`               |
| Sucursal              | Direccion             | 1:1          | `Direccion.sucursalId`              |
| Sucursal              | Usuario               | 1:N          | `Usuario.sucursalId`                |
| Usuario               | Pedido                | 1:N          | `Pedido.usuarioId`                  |
| Categoria             | Producto              | 1:N          | `Producto.categoriaId`              |
| Producto              | ProductoOpcionGrupo   | 1:N          | `ProductoOpcionGrupo.productoId`    |
| OpcionGrupo           | ProductoOpcionGrupo   | 1:N          | `ProductoOpcionGrupo.grupoId`       |
| OpcionGrupo           | Opcion                | 1:N          | `Opcion.grupoId`                    |
| Producto (combo)      | ComboComponente       | 1:N          | `ComboComponente.comboId`           |
| Producto (componente) | ComboComponente       | 1:N          | `ComboComponente.productoId`        |
| Sucursal              | Stock                 | 1:N          | `Stock.sucursalId`                  |
| Producto              | Stock                 | 1:N          | `Stock.productoId`                  |
| Sucursal              | InsumoStock           | 1:N          | `InsumoStock.sucursalId`            |
| Insumo                | InsumoStock           | 1:N          | `InsumoStock.insumoId`              |
| Sucursal              | IngredienteStock      | 1:N          | `IngredienteStock.sucursalId`       |
| Ingrediente           | IngredienteStock      | 1:N          | `IngredienteStock.ingredienteId`    |
| Producto              | ProductoIngrediente   | 1:N          | `ProductoIngrediente.productoId`    |
| Ingrediente           | ProductoIngrediente   | 1:N          | `ProductoIngrediente.ingredienteId` |
| Sucursal              | HorarioSucursal       | 1:N          | `HorarioSucursal.sucursalId`        |
| Sucursal              | Pedido                | 1:N          | `Pedido.sucursalId`                 |
| EstadoPedido          | Pedido                | 1:N          | `Pedido.estadoId`                   |
| Pedido                | PedidoItem            | 1:N          | `PedidoItem.pedidoId`               |
| Producto              | PedidoItem            | 1:N          | `PedidoItem.productoId`             |
| PedidoItem            | PedidoItemOpcion      | 1:N          | `PedidoItemOpcion.pedidoItemId`     |
| Opcion                | PedidoItemOpcion      | 1:N          | `PedidoItemOpcion.opcionId`         |
| Pedido                | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.pedidoId`    |
| EstadoPedido          | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.estadoId`    |
| Usuario               | PedidoEstadoHistorial | 1:N          | `PedidoEstadoHistorial.usuarioId`   |
| Promocion             | PromocionProducto     | 1:N          | `PromocionProducto.promocionId`     |
| Producto              | PromocionProducto     | 1:N          | `PromocionProducto.productoId`      |
| Pedido                | PedidoPromocion       | 1:N          | `PedidoPromocion.pedidoId`          |
| Promocion             | PedidoPromocion       | 1:N          | `PedidoPromocion.promocionId`       |
| Usuario               | Resena                | 1:N          | `Resena.usuarioId`                  |
| Producto              | Resena                | 1:N          | `Resena.productoId`                 |
| Pedido                | Resena                | 1:N          | `Resena.pedidoId`                   |
| Usuario               | Queja                 | 1:N          | `Queja.usuarioId`                   |
| Usuario               | Queja                 | 1:N          | `Queja.respondidoPorId`             |
| Pedido                | Queja                 | 1:1          | `Queja.pedidoId`                    |
| Queja                 | QuejaMensaje          | 1:N          | `QuejaMensaje.quejaId`              |
| Usuario               | QuejaMensaje          | 1:N          | `QuejaMensaje.autorId`              |

## 7. Reglas de negocio

### 7.1 Asignación de sucursal (regla de negocio, no entidad)

1. Obtener las sucursales activas.
2. **Descartar las que están fuera del horario de atención** en el momento del pedido (franjas de `HorarioSucursal` menos el margen de cierre global). Si la más cercana está cerrada se saltea a la siguiente.
3. Ordenarlas por proximidad geográfica a la dirección de entrega.
4. Comprobar si la sucursal más cercana dispone del stock necesario.
5. Si no dispone del stock, evaluar la siguiente sucursal más cercana.
6. Continuar hasta encontrar una sucursal capaz de satisfacer el pedido.
7. Si ninguna sucursal puede satisfacerlo, el pedido no puede confirmarse.

Además, un administrador puede reasignar manualmente la sucursal de un pedido como excepción operativa, siempre que el destino esté abierto y tenga stock. No crear una entidad para esta regla.

### 7.2 Otras reglas

- `Usuario.email` único; `password` como hash.
- `Direccion`: pertenece a un usuario o a una sucursal, nunca a ambos ni a ninguno (CHECK `CK_Direcciones_propietario`). La dirección de una sucursal se gestiona mediante la API de sucursales; la de un usuario mediante la API de direcciones.
- **Geocodificación de direcciones**: el servicio `geolocation_service` (Georef Argentina) obtiene `latitud`/`longitud` a partir de los datos de la dirección. Errores tipados: `GeorefError`, `DireccionNoEncontradaError`, `DireccionAmbiguaError`. Ver `docs/reglas-negocio.md` §14. La integración con el ABM de `Direccion` está implementada en `direccion_service` (ver `docs/reglas-negocio.md` §17).
- **Cálculo de rutas**: el servicio `routing_service` (OpenRouteService) calcula distancia/duración entre coordenadas (`calcularRuta({ origen, destino })`). Ver `docs/reglas-negocio.md` §15.
- **Cobertura geográfica**: el servicio `cobertura_service` determina si una dirección es válida para delivery: zona geográfica de operación (configurable en `cobertura-zonas`) + al menos una sucursal activa dentro de la distancia máxima por ruta (5 km inicial, configurable vía `COBERTURA_RADIO_MAX_KM`). Reutiliza `geolocation_service` y `routing_service`. Ver `docs/reglas-negocio.md` §16. La integración con el ABM de `Direccion` está implementada en `direccion_service` (ver §17); la asignación de sucursal por stock y el frontend de cobertura son tareas posteriores.
- `Categoria.nombre` único; sin jerarquía de categorías.
- `ParametroSistema.clave` único.
- **Reseñas**: solo un CLIENTE con un pedido `entregado` que contenga el producto puede crearla, y solo una por producto (UNIQUE `usuarioId + productoId`). La puntuación es obligatoria (1 a 5) y el comentario opcional (máximo 500 caracteres). El autor puede editarla o eliminarla; el listado público muestra "Nombre I." y nunca el email. El promedio y la cantidad se calculan sobre las reseñas existentes.
- **Quejas**: solo el CLIENTE dueño de un pedido `entregado` puede reclamar, y solo una vez por pedido (UNIQUE `pedidoId`). `motivo` es un enum fijo y `detalle` es obligatorio (10 a 1000 caracteres). El cliente solo ve las propias; el ADMINISTRADOR ve las de su sucursal y el SUPERADMINISTRADOR todas. El cliente puede responder hasta 5 veces (reabre a `PENDIENTE` si estaba resuelta o rechazada) y cerrar en cualquier momento (`CERRADA`, final). `RESUELTA` y `RECHAZADA` exigen `respuesta` (máximo 1000 caracteres). Ver `docs/quejas.md`.
- `Stock`: PK compuesta `(sucursalId, productoId)` única.
- **Insumos**: `Insumo` con UNIQUE `(nombre, tipo)`; `InsumoStock` con PK compuesta `(sucursalId, insumoId)` y `cantidad >= 0`. Sólo `extra` y `condimento` se vinculan desde la personalización (`insumoId`) y descuentan stock. "Agotado" = sin stock en ninguna sucursal activa. La baja de un insumo es lógica y no permite cambiar su `tipo` si ya está vinculado. Ver `docs/insumos.md`.
- **Ingredientes**: `Ingrediente.nombre` único; `unidadMedida` en `unidad`, `g`, `kg`, `ml`, `l`; `IngredienteStock` con PK compuesta `(sucursalId, ingredienteId)` y `cantidad DECIMAL(12,3) >= 0`. La unidad no se cambia si el ingrediente ya tiene stock o recetas. La baja es lógica y no borra stock ni recetas.
- **Receta**: `ProductoIngrediente` con PK compuesta `(productoId, ingredienteId)`, `cantidad DECIMAL(12,3) > 0` y `permiteQuitar`. Es obligatoria para todo `Producto` `tipo = PRODUCTO`; un `COMBO` no la admite. No se repiten ingredientes en la misma receta.
- **Stock derivado de productos**: la cantidad de un `PRODUCTO` se calcula como `min(floor(stock del ingrediente / cantidad de la receta))` sobre todos los ingredientes de su receta. Un ingrediente inactivo, sin fila en la sucursal o con `disponible = false` aporta `0`. Sin receta, la cantidad es `0` y el producto no se vende. La cantidad es de solo lectura para el administrador; sólo puede cambiar `disponible`. El admin carga el stock de ingredientes por sucursal.
- **"Sin X" desde la receta**: los ingredientes del detalle salen de `ProductoIngrediente`. Las opciones "Sin X" se generan para los ingredientes con `permiteQuitar = true`; el checkbox se administra en el formulario del producto y no en el ABM de personalización. `personalizar` deja de ser editable a mano y pasa a sincronizarse desde la receta. "Sin X" no cambia el descuento: se descuenta la receta completa.
- El carrito es estado temporal y se revalida contra la BD al confirmar.
- **Combos y stock (resuelto)**: un combo es un `Producto` cuya composición se define mediante `ComboComponente`. Su `cantidad` en `Stock` **se deriva del stock de sus componentes**, que a su vez se deriva de los ingredientes de cada producto simple:
  - Un combo tiene fila propia en `Stock` para estar en el catálogo de la sucursal y poder apagarse con `disponible`, pero su `cantidad` **no la carga el administrador**: es un espejo del máximo que arma la receta.
  - El máximo sale de la receta: `max = min(floor(cantidad del componente / cantidad que lleva la receta))`. Si al combo le falta un componente en esa sucursal, el máximo es 0.
  - El backend recalcula ese número (`sincronizarCantidadDeCombos`) cuando cambia el stock o la disponibilidad de un componente, la receta del combo o la fila del combo, y también al crear o cancelar un pedido: vender un componente simple baja los combos que lo usan en su receta. El valor se devuelve derivado en `GET /api/stock`. Si a un componente se le baja el stock o se da de baja, el combo se limita solo, sin scripts de reparación.
  - Si la fila del combo está apagada (`disponible = false`), no se vende aunque los componentes alcancen.
  - Vender un combo descuenta las dos cosas: su propia unidad y las unidades de cada componente según la receta. Como la cantidad del combo ya no es un tope, la protección contra sobreventa se apoya en el descuento atómico de los componentes.
  - No se agregan entidades ni se modifica la estructura: `Stock` conserva `(sucursalId, productoId, cantidad, disponible)` y `ComboComponente` `(id, comboId, productoId, cantidad)`.
- El stock se descuenta al crear el pedido y se repone al cancelarlo, dentro de la transacción del pedido. Los descuentos son atómicos (`UPDATE ... WHERE cantidad >= n`) para que dos pedidos simultáneos sobre la última unidad no sobrevendan.

## 8. Snapshots históricos

- **Dirección en `Pedido`**: al confirmar/generar el pedido se copian `calle`, `altura`, `ciudad`, `codigoPostal`, `referencia`, `latitud` y `longitud`. No depende de `Direccion` para conservar el historial. Nota: el snapshot de `Pedido` conserva su propia columna `ciudad`; con la alineación de `Direccion` (que ahora usa `provincia`/`localidad`), la localidad se mapea a esa columna. Queda pendiente alinear el naming del snapshot en una etapa posterior.
- **Producto en `PedidoItem`**: `nombreProducto` y `precioUnitario` son copia del momento del pedido. No se reconstruyen desde `Producto`.
- **Opción en `PedidoItemOpcion`**: `nombre` y `precioAdicional` son copia del momento del pedido.
- **Promoción en `PedidoPromocion`**: `descuentoAplicado` conserva el beneficio efectivamente aplicado.

## 9. Decisiones importantes

- Una sola entidad `Usuario` con `rol` (sin `Cliente`/`Administrador` separados).
- `Direccion` como única entidad de ubicación (domicilio + coordenadas), compartida por usuarios y sucursales; `Sucursal 1:1 Direccion` (sin `direccion STRING` ni coordenadas en `Sucursal`).
- Dirección histórica por snapshot dentro de `Pedido` (sin `PedidoDireccion`).
- `horarios` como entidad `HorarioSucursal` (franjas por día), no como texto en `Sucursal`. El corte de pedidos se deriva del cierre real menos `margenCierreMinutos`.
- Combos como `Producto` con `tipo = COMBO` + `ComboComponente` (sin entidad `Combo`).
- Precio del combo es propio en `Producto.precio`, no suma de componentes.
- Personalización con `OpcionGrupo` + `Opcion` + `ProductoOpcionGrupo`.
- Stock por sucursal y producto con clave compuesta.
- Extras y condimentos como `Insumo` + `InsumoStock` (extensión implementada), no como `Producto`.
- Stock real en `Ingrediente` + `IngredienteStock`, con la receta en `ProductoIngrediente`: la cantidad de productos y combos pasa a ser derivada y de solo lectura.
- Receta obligatoria para todo `Producto` `tipo = PRODUCTO`; un `COMBO` sigue derivando de `ComboComponente`.
- `personalizar` deja de ser una categoría editable del ABM: se genera desde la receta (`permiteQuitar`) y sigue existiendo como tipo interno para el cliente.
- ProductoOpcionGrupo, PromocionProducto y PedidoPromocion (asociativas N:M) usan id propio + UNIQUE sobre el par de FKs, no clave compuesta (a diferencia de Stock, que sí la usa por acceder siempre por el par sucursal+producto).
- Estado actual en `Pedido.estadoId` y trazabilidad en `PedidoEstadoHistorial`.
- Carrito no persistido.
- Promociones con tipos concretos iniciales (`DESCUENTO_PORCENTUAL`, `DOS_POR_UNO`).
- Reseñas como `Resena` (producto + estrellas + comentario), no como la `Calificacion` de la Propuesta 2.
- Quejas como `Queja`: reclamo del cliente sobre un pedido entregado, con motivo, detalle, estado y respuesta del administrador. Una por pedido.
- Reportes sin tablas propias.

## 10. Exclusiones / límites actuales

Este modelo **no** incluye:

- `Cliente` separado de `Usuario`
- `Administrador` separado de `Usuario`
- `Carrito`
- `CarritoItem`
- `PrecioHistorico`
- tablas específicas de reportes
- motor genérico de promociones
- `Cupon`
- `Repartidor`
- `Notificacion`
- jerarquía de categorías
- máquina de estados formal
- entidad `Combo` separada

## 11. Consideraciones de escalabilidad futura

La Propuesta 2 **no** forma parte del modelo implementado actualmente, pero las decisiones actuales deben permitir agregar posteriormente notificaciones y repartidores. Las reseñas ya están incluidas como `Resena`; no crear `Calificacion` ni las demás entidades ahora.

La arquitectura futura podrá incorporar, por ejemplo:

- un rol `REPARTIDOR`;
- una entidad específica de repartidor asociada a `Usuario`;
- asignación de repartidores a pedidos;
- notificaciones asociadas a usuarios/pedidos o cambios de estado.

## 12. Resumen general del modelo

| Entidad                 | Responsabilidad                    | Relaciones principales                                                                                                      |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Usuario`               | Actor autenticado                  | 1:N `Direccion`, 1:N `Pedido`, N:1 `Sucursal` (opcional, solo ADMINISTRADOR)                                                |
| `Direccion`             | Dirección de usuario o sucursal    | N:1 `Usuario` (opcional), 1:1 `Sucursal` (opcional)                                                                         |
| `Sucursal`              | Local físico                       | 1:1 `Direccion`, 1:N `Stock`, 1:N `IngredienteStock`, 1:N `Pedido`, 1:N `Usuario` (administradores)                         |
| `Categoria`             | Agrupar productos                  | 1:N `Producto`                                                                                                              |
| `Producto`              | Artículo vendible (normal o combo) | N:1 `Categoria`, 1:N `ProductoOpcionGrupo`, 1:N `ProductoIngrediente`, 1:N `ComboComponente`, 1:N `Stock`, 1:N `PedidoItem` |
| `ComboComponente`       | Composición de combo               | N:1 `Producto` (combo), N:1 `Producto` (componente)                                                                         |
| `OpcionGrupo`           | Grupo de opciones                  | 1:N `Opcion`                                                                                                                |
| `Opcion`                | Opción concreta                    | N:1 `OpcionGrupo`                                                                                                           |
| `ProductoOpcionGrupo`   | Vínculo producto ↔ grupo           | N:1 `Producto`, N:1 `OpcionGrupo`                                                                                           |
| `Stock`                 | Disponibilidad producto×sucursal   | N:1 `Sucursal`, N:1 `Producto`                                                                                              |
| `Insumo`                | Extra o condimento con precio      | 1:N `InsumoStock`, 1:N `PersonalizacionElemento` (opcional)                                                                 |
| `InsumoStock`           | Existencia insumo×sucursal         | N:1 `Sucursal`, N:1 `Insumo`                                                                                                |
| `Ingrediente`           | Materia prima con unidad           | 1:N `IngredienteStock`, 1:N `ProductoIngrediente`                                                                           |
| `IngredienteStock`      | Existencia ingrediente×sucursal    | N:1 `Sucursal`, N:1 `Ingrediente`                                                                                           |
| `ProductoIngrediente`   | Receta producto×ingrediente        | N:1 `Producto`, N:1 `Ingrediente`                                                                                           |
| `Pedido`                | Pedido realizado/registrado        | N:1 `Usuario`, N:1 `Sucursal`, N:1 `EstadoPedido`, 1:N `PedidoItem`, 1:N `PedidoEstadoHistorial`, 1:N `PedidoPromocion`     |
| `PedidoItem`            | Línea de pedido                    | N:1 `Pedido`, N:1 `Producto`, 1:N `PedidoItemOpcion`                                                                        |
| `PedidoItemOpcion`      | Opción seleccionada                | N:1 `PedidoItem`, N:1 `Opcion`                                                                                              |
| `EstadoPedido`          | Catálogo de estados                | 1:N `Pedido`, 1:N `PedidoEstadoHistorial`                                                                                   |
| `PedidoEstadoHistorial` | Trazabilidad de estados            | N:1 `Pedido`, N:1 `EstadoPedido`, N:1 `Usuario`                                                                             |
| `Promocion`             | Beneficio aplicable                | 1:N `PromocionProducto`, 1:N `PedidoPromocion`                                                                              |
| `PromocionProducto`     | Vínculo promoción ↔ producto       | N:1 `Promocion`, N:1 `Producto`                                                                                             |
| `PedidoPromocion`       | Promoción aplicada                 | N:1 `Pedido`, N:1 `Promocion`                                                                                               |
| `ParametroSistema`      | Configuración del sistema          | —                                                                                                                           |
| `Resena`                | Opinión de un cliente              | N:1 `Usuario`, N:1 `Producto`, N:1 `Pedido`                                                                                 |
| `Queja`                 | Reclamo sobre pedido entregado     | N:1 `Usuario` (autor), N:1 `Usuario` (respondedor), 1:1 `Pedido`, 1:N `QuejaMensaje`                                        |
| `QuejaMensaje`          | Mensaje del hilo                   | N:1 `Queja`, N:1 `Usuario` (autor)                                                                                          |

## 13. Observaciones pendientes

Sin modificar el modelo documentado, se dejan señaladas las siguientes observaciones para que el equipo las valide en una etapa posterior:

- `Pedido.medioPago` admite `MERCADO_PAGO` y `TARJETA`; el enunciado no define explícitamente estos valores, por lo que conviene confirmar el listado final antes del DER.
- No se especifica el tipo/dominio de `Promocion.valor` (porcentaje, cantidad fija, etc.); conviene precisarlo al diseñar la implementación.
- `Pedido.estadoId` (estado actual) convive con el historial; se sugiere confirmar la regla de actualización consistente de ambos al generar cambios de estado.
- El tiempo estimado de entrega no requiere necesariamente almacenamiento persistente. Su cálculo deberá definirse como regla de negocio y podrá realizarse dinámicamente a partir del estado del pedido y/o parámetros del sistema. `PedidoEstadoHistorial` permite calcular tiempos reales e históricos, pero no representa por sí mismo una estimación futura.
