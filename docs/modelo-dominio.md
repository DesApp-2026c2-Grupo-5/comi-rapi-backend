# Modelo de Dominio â€” Comi-Rapi

## 1. Objetivo del modelo

Este documento define el modelo de dominio del backend de **Comi-Rapi**, una plataforma de pedidos de comida rÃ¡pida (delivery + sistema administrativo).

Su finalidad es servir como base aprobada por el equipo antes de diseÃ±ar el DER (diagrama entidad-relaciÃ³n) e implementar modelos, migraciones y endpoints. No contiene cÃ³digo, modelos Sequelize ni esquema SQL definitivo.

La fuente funcional principal del proyecto es `docs/enunciado.md`. `docs/historico/analisis-inicial.md` es material histÃ³rico y no modifica las decisiones de este documento.

## 2. Alcance

El dominio cubre:

- clientes y administradores;
- sucursales;
- catÃ¡logo de productos y categorÃ­as;
- personalizaciÃ³n de productos;
- combos;
- carrito (estado temporal, no persistido);
- pedidos y su historial de estados;
- direcciones;
- stock por sucursal (ExtensiÃ³n 1);
- promociones (ExtensiÃ³n 1);
- reseÃ±as de productos y combos comprados;
- reclamos del cliente sobre pedidos entregados (`Queja`);
- centro de notificaciones persistido del cliente (`Notificacion`);
- parÃ¡metros del sistema;
- reportes (mediante agregaciones, sin tablas propias).

**No** incluye todavÃ­a las funcionalidades de la Propuesta 2 de repartidores, que se contemplan como evoluciÃ³n futura. Las reseÃ±as sÃ­ se incorporaron como `Resena`: reemplazan la idea de "calificaciÃ³n" de la Propuesta 2 y se limitan a producto + estrellas + comentario, sin repartidor. Los reclamos se incorporaron como `Queja` y las notificaciones como `Notificacion`, autorizados explÃ­citamente: son un canal de atenciÃ³n y de avisos sobre un pedido entregado y **no** habilitan `Repartidor` ni el rol `REPARTIDOR`.

## 3. Principios de diseÃ±o

1. **Simplicidad**: no crear entidades que no tengan una responsabilidad concreta.
2. **Historicidad**: conservar en el pedido los datos vigentes al momento de confirmarlo (precios, nombres, direcciÃ³n), sin depender de la mutabilidad del catÃ¡logo.
3. **Relacional**: representar con claves forÃ¡neas reales lo que en el frontend mock es texto o arrays.
4. **Escalabilidad medible**: preparar el dominio para crecer sin implementar entidades "por las dudas".
5. **SeparaciÃ³n de responsabilidades**: estado actual vs. historial; reglas de negocio vs. entidades.

## 4. Entidades

| #   | Entidad                 | Responsabilidad                                   |
| --- | ----------------------- | ------------------------------------------------- |
| 1   | `Usuario`               | Actor autenticado (cliente o administrador)       |
| 2   | `Direccion`             | DirecciÃ³n de un usuario o una sucursal           |
| 3   | `Sucursal`              | Local fÃ­sico                                     |
| 4   | `Categoria`             | Agrupar productos                                 |
| 5   | `Producto`              | ArtÃ­culo vendible (normal o combo)               |
| 6   | `ComboComponente`       | ComposiciÃ³n de un combo                          |
| 7   | `OpcionGrupo`           | Grupo de opciones de personalizaciÃ³n             |
| 8   | `Opcion`                | OpciÃ³n concreta dentro de un grupo               |
| 9   | `ProductoOpcionGrupo`   | VÃ­nculo producto â†” grupo de opciones           |
| 10  | `Stock`                 | Disponibilidad de un producto en una sucursal     |
| 11  | `Pedido`                | Pedido realizado por un cliente                   |
| 12  | `PedidoItem`            | LÃ­nea de un pedido                               |
| 13  | `PedidoItemOpcion`      | OpciÃ³n seleccionada en una lÃ­nea                |
| 14  | `EstadoPedido`          | CatÃ¡logo de estados                              |
| 15  | `PedidoEstadoHistorial` | Trazabilidad de cambios de estado                 |
| 16  | `Promocion`             | Beneficio aplicable al catÃ¡logo                  |
| 17  | `PromocionProducto`     | VÃ­nculo promociÃ³n â†” producto                  |
| 18  | `PedidoPromocion`       | PromociÃ³n aplicada a un pedido                   |
| 19  | `ParametroSistema`      | ConfiguraciÃ³n general del sistema                |
| 20  | `Resena`                | OpiniÃ³n de un cliente sobre un producto comprado |
| 21  | `Insumo`                | Extra o condimento con precio y baja lÃ³gica      |
| 22  | `InsumoStock`           | Existencia de un insumo en una sucursal           |
| 23  | `Queja`                 | Reclamo de un cliente sobre un pedido entregado   |
| 24  | `QuejaMensaje`          | Mensaje del hilo de un reclamo                    |
| 25  | `Notificacion`          | Aviso persistido para el centro del cliente       |
| 26  | `Ingrediente`           | Materia prima con unidad de medida                |
| 27  | `IngredienteStock`      | Existencia de un ingrediente en una sucursal      |
| 28  | `ProductoIngrediente`   | Receta: ingredientes y cantidades de un producto  |

## 5. Atributos principales

### 5.1 Usuario

| Atributo          | Tipo / Notas                                                |
| ----------------- | ----------------------------------------------------------- |
| `id`              | PK                                                          |
| `nombre`          |                                                             |
| `apellido`        |                                                             |
| `email`           | Ãºnico                                                      |
| `password`        | hash (posterior)                                            |
| `telefono`        |                                                             |
| `rol`             | enum: `CLIENTE`, `ADMINISTRADOR`, `SUPERADMINISTRADOR`      |
| `activo`          | booleano                                                    |
| `fechaNacimiento` | `DATEONLY`, opcional                                        |
| `fotoPerfilUrl`   | STRING, opcional                                            |
| `sucursalId`      | INTEGER, FK opcional â†’ `Sucursal.id` (solo ADMINISTRADOR) |
| `createdAt`       |                                                             |
| `updatedAt`       |                                                             |

`edad` es un atributo derivado/calculado a partir de `fechaNacimiento`; **no** se persiste.

Reglas:

- `email` debe ser Ãºnico.
- `password` se almacenarÃ¡ posteriormente como hash.
- `rol` admite `CLIENTE`, `ADMINISTRADOR` y `SUPERADMINISTRADOR`. No agregar `REPARTIDOR` todavÃ­a (Propuesta 2 como evoluciÃ³n futura).
- La sucursal no se guarda en `Usuario`: se asigna al `Pedido` como regla de negocio (proximidad + disponibilidad de stock), con reasignaciÃ³n manual del administrador como excepciÃ³n operativa.

Relaciones:

- `Usuario 1:N Direccion`
- `Usuario 1:N Pedido`

No crear entidades separadas `Cliente` ni `Administrador`.

### 5.2 Direccion

`Direccion` es la Ãºnica entidad que almacena los datos de ubicaciÃ³n (domicilio textual y, posteriormente, coordenadas) tanto de un **usuario** como de una **sucursal**. Puede pertenecer a un usuario o a una sucursal, pero **no a ambos simultÃ¡neamente ni a ninguno**.

| Atributo       | Tipo / Notas                  |
| -------------- | ----------------------------- |
| `id`           | PK                            |
| `usuarioId`    | FK opcional â†’ `Usuario.id`  |
| `sucursalId`   | FK opcional â†’ `Sucursal.id` |
| `calle`        | obligatorio                   |
| `altura`       | obligatorio                   |
| `provincia`    | obligatorio                   |
| `departamento` | opcional (iteraciÃ³n 1-geo)   |
| `localidad`    | opcional (iteraciÃ³n 1-geo)   |
| `codigoPostal` | opcional (iteraciÃ³n 1-geo)   |
| `nomenclatura` | opcional (iteraciÃ³n 1-geo)   |
| `referencia`   | opcional                      |
| `latitud`      | opcional                      |
| `longitud`     | opcional                      |
| `alias`        | opcional                      |
| `activa`       | booleano                      |

Relaciones:

- `Direccion.usuarioId â†’ Usuario.id` (opcional)
- `Direccion.sucursalId â†’ Sucursal.id` (opcional)

Cardinalidad:

- `Usuario 1:N Direccion`: un usuario puede tener muchas direcciones.
- `Sucursal 1:1 Direccion`: una sucursal tiene exactamente una direcciÃ³n.

Reglas:

- **Propietario exclusivo**: exactamente uno de `usuarioId` / `sucursalId` debe estar informado. Se garantiza a nivel de persistencia mediante el CHECK `CK_Direcciones_propietario` (`("usuarioId" IS NOT NULL)::int + ("sucursalId" IS NOT NULL)::int = 1`) y a nivel de modelo mediante una validaciÃ³n de instancia.
- `Usuario.id` y `Sucursal.id` son FKs con `ON DELETE RESTRICT`.
- **Campos obligatorios**: `calle`, `altura` y `provincia`. El `departamento` (partido) es obligatorio en la API cuando la provincia es Buenos Aires (desambiguaciÃ³n territorial). Se validan en la API de direcciones (cliente) y en la API de sucursales (admin, al crear/actualizar la direcciÃ³n de la sucursal).
- **Coordenadas no manuales**: `latitud` y `longitud` son opcionales y **no se ingresan manualmente** (ni por el admin ni por nadie): la API las rechaza. El servicio de geolocalizaciÃ³n `geolocation_service` (Georef Argentina) las calcula a partir de los datos de la direcciÃ³n (`calle`, `altura`, `provincia`, `departamento?`, `localidad?`); `direccion_service` las geocodifica y persiste al crear/editar (integraciÃ³n con el ABM implementada; ver `docs/reglas-negocio.md` Â§17). Ver `docs/reglas-negocio.md` Â§14.

> **Nota de cambio (IteraciÃ³n 1-geo, ampliada en IteraciÃ³n 2):** nuevo modelo territorial alineado con Georef (ver `docs/reglas-negocio.md` Â§18). Se agregan `departamento` (partido en Buenos Aires / comuna en CABA) y `nomenclatura` (direcciÃ³n normalizada por Georef). `localidad` pasa a ser **determinada por el backend** (localidad censal de Georef; ya no se exige al usuario) y `codigoPostal` pasa a ser opcional: **Georef no provee cÃ³digos postales** (verificado contra su API) y el proyecto no incorpora otros proveedores. Desde la IteraciÃ³n 2, `provincia`, `calle`, `departamento` y `localidad` se persisten **todos normalizados por Georef** (la fila refleja exactamente la direcciÃ³n resuelta); `nomenclatura` queda como dato geogrÃ¡fico complementario.

Importante: la direcciÃ³n utilizada en un pedido **no debe depender de esta entidad para conservar el historial**. Al confirmar/generar el pedido, los datos se copian como snapshot dentro de `Pedido`. No crear `PedidoDireccion`.

### 5.3 Sucursal

| Atributo   | Tipo / Notas |
| ---------- | ------------ |
| `id`       | PK           |
| `nombre`   |              |
| `telefono` |              |
| `activa`   | booleano     |

`Sucursal` **no** almacena `direccion` ni `latitud`/`longitud`: esos datos quedan centralizados en `Direccion` mediante la relaciÃ³n `Sucursal 1:1 Direccion` (FK `Direccion.sucursalId`). Antes de esta alineaciÃ³n, `Sucursal` los duplicaba como `direccion STRING` + coordenadas; dichas columnas fueron eliminadas.

### 5.3.1 HorarioSucursal

El horario de atenciÃ³n es **estructurado**. `Sucursales.horarios` (texto libre) se eliminÃ³ tras el backfill a `HorarioSucursal`:

| Atributo     | Tipo / Notas                                   |
| ------------ | ---------------------------------------------- |
| `id`         | PK                                             |
| `sucursalId` | FK â†’ `Sucursal.id` (`ON DELETE CASCADE`)     |
| `diaSemana`  | entero 1..7 (lunes = 1, domingo = 7, ISO-8601) |
| `apertura`   | `TIME` â€” hora real de apertura del local     |
| `cierre`     | `TIME` â€” hora real de cierre del local       |

Reglas:

- Varias franjas por dÃ­a y solapamientos permitidos: "abierta" es caer en cualquiera. Se rechazan franjas exactamente duplicadas (UNIQUE `(sucursalId, diaSemana, apertura, cierre)`) y `apertura = cierre`.
- `cierre <= apertura` representa una franja que **cruza la medianoche** (ej. 19:00â€“02:00) y pertenece al dÃ­a de apertura; se evalÃºan tambiÃ©n las franjas del dÃ­a anterior.
- Un dÃ­a sin franjas estÃ¡ cerrado. Para cerrar todo el local se usa `activa = false`, no la ausencia de franjas.
- La franja guarda el horario del local. El **corte de pedidos** se deriva restando el parÃ¡metro global `margenCierreMinutos` (default 30): el local cierra 23:00 y la pÃ¡gina deja de tomar pedidos 22:30.
- La evaluaciÃ³n se hace siempre en `America/Argentina/Buenos_Aires`.

Relaciones:

- `Sucursal 1:1 Direccion`
- `Sucursal 1:N HorarioSucursal`
- `Sucursal 1:N Stock`
- `Sucursal 1:N Pedido`

### 5.4 Categoria

| Atributo      | Tipo / Notas                                  |
| ------------- | --------------------------------------------- |
| `id`          | PK                                            |
| `nombre`      | Ãºnico                                        |
| `descripcion` |                                               |
| `imagen`      | ruta relativa en `public/imagenes/categorias` |
| `activa`      | booleano                                      |

Reglas:

- `nombre` debe ser Ãºnico.
- No existe jerarquÃ­a de categorÃ­as.

RelaciÃ³n: `Categoria 1:N Producto`

### 5.5 Producto

| Atributo      | Tipo / Notas              |
| ------------- | ------------------------- |
| `id`          | PK                        |
| `categoriaId` | FK â†’ `Categoria.id`     |
| `nombre`      |                           |
| `descripcion` |                           |
| `precio`      | precio vigente            |
| `imagen`      |                           |
| `activo`      | booleano                  |
| `tipo`        | enum: `PRODUCTO`, `COMBO` |

El precio en `Producto` representa el precio vigente. El precio histÃ³rico de un pedido **no** debe obtenerse nuevamente desde `Producto`.

Relaciones:

- `Producto N:1 Categoria`
- `Producto 1:N ProductoOpcionGrupo`
- `Producto 1:N ComboComponente` (como combo)
- `Producto 1:N ComboComponente` (como componente)
- `Producto 1:N ProductoIngrediente` (receta, sÃ³lo `tipo = PRODUCTO`)
- `Producto 1:N Stock`
- `Producto 1:N PedidoItem`

### 5.6 ComboComponente

| Atributo     | Tipo / Notas         |
| ------------ | -------------------- |
| `id`         | PK                   |
| `comboId`    | FK â†’ `Producto.id` |
| `productoId` | FK â†’ `Producto.id` |
| `cantidad`   |                      |

Relaciones:

- `comboId â†’ Producto.id`
- `productoId â†’ Producto.id`

```
Producto (tipo COMBO)
    |
    +--- Producto componente
    +--- Producto componente
    +--- Producto componente
```

Un combo es un `Producto`, no una entidad `Combo` separada. El combo posee su propio precio en `Producto.precio`, que **no** se calcula sumando los precios de sus componentes. La composiciÃ³n representa quÃ© productos lo forman y en quÃ© cantidad.

### 5.7 PersonalizaciÃ³n de productos

Se modela con tres entidades: `OpcionGrupo`, `Opcion` y `ProductoOpcionGrupo`. No crear entidades independientes para cada tipo de personalizaciÃ³n.

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

Ejemplos conceptuales: Extras, PersonalizaciÃ³n, AcompaÃ±amientos, Condimentos.

#### 5.7.2 Opcion

| Atributo               | Tipo / Notas                   |
| ---------------------- | ------------------------------ |
| `id`                   | PK                             |
| `grupoId`              | FK â†’ `OpcionGrupo.id`        |
| `nombre`               |                                |
| `precioAdicional`      |                                |
| `activo`               | booleano                       |
| `productoReferenciaId` | opcional, FK â†’ `Producto.id` |

RelaciÃ³n: `Opcion.grupoId â†’ OpcionGrupo.id`

`productoReferenciaId` puede usarse cuando la opciÃ³n representa o referencia otro producto del catÃ¡logo.

#### 5.7.3 ProductoOpcionGrupo

| Atributo     | Tipo / Notas            |
| ------------ | ----------------------- |
| `id`         | PK                      |
| `productoId` | FK â†’ `Producto.id`    |
| `grupoId`    | FK â†’ `OpcionGrupo.id` |

RestricciÃ³n: `UNIQUE(productoId, grupoId)` â€” la combinaciÃ³n producto + grupo debe ser Ãºnica.

Relaciones:

- `productoId â†’ Producto.id`
- `grupoId â†’ OpcionGrupo.id`

```
Producto N:N OpcionGrupo   (resuelta mediante ProductoOpcionGrupo)
```

El diseÃ±o debe permitir que diferentes productos tengan diferentes grupos de personalizaciÃ³n.

### 5.8 Stock

| Atributo     | Tipo / Notas                     |
| ------------ | -------------------------------- |
| `sucursalId` | PK (parte), FK â†’ `Sucursal.id` |
| `productoId` | PK (parte), FK â†’ `Producto.id` |
| `cantidad`   |                                  |
| `disponible` | booleano                         |

Clave: `(sucursalId, productoId)` â€” la combinaciÃ³n sucursal + producto debe ser Ãºnica.

InterpretaciÃ³n:

- `disponible = false`: la sucursal no ofrece actualmente ese producto.
- `cantidad = 0`: el producto se ofrece pero no tiene stock.

El stock es independiente para cada sucursal.

En un combo, `cantidad` es la cantidad de combos que se pueden armar con el stock
actual de sus componentes. No la carga el administrador: el backend la deriva de
la receta y la recalcula sola. Lo que sÃ­ se maneja a mano es `disponible`, para
sacarlo del catÃ¡logo de la sucursal. Ver Â§7.2 ("Combos y stock").

### 5.8.1 Insumo e InsumoStock (extensiÃ³n implementada)

Los extras y condimentos con stock propio se separan de `Producto`:

- `Insumo`: `id`, `nombre`, `tipo` (`extra` o `condimento`), `precio` (obligatorio
  en extra, `null` en condimento) y `activo` (baja lÃ³gica). UNIQUE `(nombre, tipo)`.
- `InsumoStock`: PK compuesta `(sucursalId, insumoId)`, `cantidad >= 0` y
  `disponible`. Misma semÃ¡ntica que `Stock`.

`PersonalizacionElementos` y `PersonalizacionCategorias` agregan `insumoId`
(nullable, FK â†’ `Insumo.id`), obligatorio en `extra`/`condimento`.

El detalle de reglas, endpoints y datos demo estÃ¡ en `docs/insumos.md`.

### 5.8.2 Ingrediente e IngredienteStock (stock por receta)

El stock real del catÃ¡logo deja de cargarse a mano en `Stock` y pasa a estar en
los ingredientes:

- `Ingrediente`: `id`, `nombre` (Ãºnico, sin distinguir mayÃºsculas),
  `unidadMedida` (`unidad`, `g`, `kg`, `ml`, `l`) y `activo` (baja lÃ³gica). No hay
  conversiÃ³n automÃ¡tica entre unidades: la unidad es la del ingrediente y se usa
  tal cual en la receta.
- `IngredienteStock`: PK compuesta `(sucursalId, ingredienteId)`,
  `cantidad DECIMAL(12,3) >= 0` y `disponible`. Misma semÃ¡ntica que `Stock`:
  `disponible = false` equivale a `0` para el cÃ¡lculo y la venta, y la ausencia de
  fila en la sucursal tambiÃ©n equivale a `0`.
- La `unidadMedida` no se puede cambiar si el ingrediente ya tiene stock o
  recetas cargadas, para no reinterpretar cantidades existentes.
- `Insumo`/`InsumoStock` siguen siendo independientes: los extras y condimentos no
  forman parte de la receta.

### 5.8.3 ProductoIngrediente (receta)

| Atributo        | Tipo / Notas                        |
| --------------- | ----------------------------------- |
| `productoId`    | PK (parte), FK â†’ `Producto.id`    |
| `ingredienteId` | PK (parte), FK â†’ `Ingrediente.id` |
| `cantidad`      | `DECIMAL(12,3) > 0`                 |
| `permiteQuitar` | booleano, default `true`            |

Clave: `(productoId, ingredienteId)` â€” no se repite un ingrediente en la misma
receta.

Reglas:

- La receta es **obligatoria** para todo `Producto` con `tipo = PRODUCTO` (al
  menos un ingrediente). Un `COMBO` no tiene receta de ingredientes: sigue
  derivando de `ComboComponente`.
- `cantidad` es lo que lleva **una unidad** del producto y se expresa en la
  `unidadMedida` del ingrediente.
- `permiteQuitar` define si el ingrediente aparece como opciÃ³n "Sin X" en el
  detalle. No altera el descuento de stock: siempre se descuenta la receta
  completa.
- Los ingredientes del detalle y las opciones "Sin X" se generan desde la receta.
  El campo viejo `ingredientes` de `PersonalizacionElemento` de tipo
  `personalizar` deja de cargarse a mano y pasa a sincronizarse desde acÃ¡.
- Sin receta, el producto tiene cantidad derivada `0` y no es vendible.

### 5.9 Pedido

| Atributo      | Tipo / Notas                            |
| ------------- | --------------------------------------- |
| `id`          | PK                                      |
| `usuarioId`   | FK â†’ `Usuario.id`                     |
| `sucursalId`  | FK â†’ `Sucursal.id`                    |
| `fechaHora`   |                                         |
| `estadoId`    | FK â†’ `EstadoPedido.id`                |
| `costoEnvio`  |                                         |
| `total`       |                                         |
| `medioPago`   | enum inicial: `MERCADO_PAGO`, `TARJETA` |
| `observacion` |                                         |

Snapshot de direcciÃ³n (fuente histÃ³rica de la direcciÃ³n de entrega):

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

- `Pedido.usuarioId â†’ Usuario.id`
- `Pedido.sucursalId â†’ Sucursal.id`
- `Pedido.estadoId â†’ EstadoPedido.id`
- `Pedido 1:N PedidoItem`
- `Pedido 1:N PedidoEstadoHistorial`
- `Pedido 1:N PedidoPromocion`

El pago es simulado. La direcciÃ³n almacenada en `Pedido` constituye la fuente histÃ³rica de la direcciÃ³n de entrega.

### 5.10 PedidoItem

| Atributo         | Tipo / Notas         |
| ---------------- | -------------------- |
| `id`             | PK                   |
| `pedidoId`       | FK â†’ `Pedido.id`   |
| `productoId`     | FK â†’ `Producto.id` |
| `nombreProducto` | snapshot             |
| `precioUnitario` | snapshot             |
| `cantidad`       |                      |
| `subtotal`       |                      |
| `observacion`    |                      |

Relaciones:

- `PedidoItem.pedidoId â†’ Pedido.id`
- `PedidoItem.productoId â†’ Producto.id`

`nombreProducto` y `precioUnitario` son snapshots histÃ³ricos. El pedido no debe reconstruirse con el nombre o precio actuales de `Producto`. Ejemplo: si un producto costaba $5000 al realizar el pedido y luego pasa a $6500, el pedido histÃ³rico continÃºa mostrando $5000.

### 5.11 PedidoItemOpcion

| Atributo          | Tipo / Notas           |
| ----------------- | ---------------------- |
| `id`              | PK                     |
| `pedidoItemId`    | FK â†’ `PedidoItem.id` |
| `opcionId`        | FK â†’ `Opcion.id`     |
| `nombre`          | snapshot               |
| `precioAdicional` | snapshot               |
| `cantidad`        |                        |

Relaciones:

- `PedidoItemOpcion.pedidoItemId â†’ PedidoItem.id`
- `PedidoItemOpcion.opcionId â†’ Opcion.id`

`nombre` y `precioAdicional` son snapshots histÃ³ricos, garantizando que cambios posteriores en una opciÃ³n no modifiquen pedidos histÃ³ricos.

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

| Atributo      | Tipo / Notas             |
| ------------- | ------------------------ |
| `id`          | PK                       |
| `pedidoId`    | FK â†’ `Pedido.id`       |
| `estadoId`    | FK â†’ `EstadoPedido.id` |
| `usuarioId`   | FK â†’ `Usuario.id`      |
| `fechaHora`   |                          |
| `observacion` |                          |

Relaciones:

- `pedidoId â†’ Pedido.id`
- `estadoId â†’ EstadoPedido.id`
- `usuarioId â†’ Usuario.id`

Permite conocer: quÃ© estado tuvo el pedido, cuÃ¡ndo ingresÃ³ a Ã©l, opcionalmente quÃ© usuario realizÃ³ el cambio y observaciones asociadas.

El estado actual se mantiene tambiÃ©n en `Pedido.estadoId`:

- `Pedido.estadoId` = estado actual.
- `PedidoEstadoHistorial` = trazabilidad histÃ³rica.

Cada cambio de estado de un pedido debe actualizar el estado actual de `Pedido` y generar simultÃ¡neamente un registro en `PedidoEstadoHistorial`.

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

No implementar todavÃ­a: cupones, envÃ­o gratis, descuentos por monto, reglas por sucursal, motor genÃ©rico de reglas. La estructura debe permitir ampliar los tipos posteriormente.

### 5.15 PromocionProducto

| Atributo      | Tipo / Notas          |
| ------------- | --------------------- |
| `id`          | PK                    |
| `promocionId` | FK â†’ `Promocion.id` |
| `productoId`  | FK â†’ `Producto.id`  |

RestricciÃ³n: `UNIQUE(promocionId, productoId)` â€” la combinaciÃ³n promociÃ³n + producto debe ser Ãºnica.

Relaciones:

- `promocionId â†’ Promocion.id`
- `productoId â†’ Producto.id`

```
Promocion N:N Producto   (PromocionProducto)
```

Los combos, al ser productos, tambiÃ©n pueden ser alcanzados por una promociÃ³n.

### 5.16 PedidoPromocion

| Atributo            | Tipo / Notas          |
| ------------------- | --------------------- |
| `id`                | PK                    |
| `pedidoId`          | FK â†’ `Pedido.id`    |
| `promocionId`       | FK â†’ `Promocion.id` |
| `descuentoAplicado` | snapshot              |

RestricciÃ³n: `UNIQUE(pedidoId, promocionId)` â€” la combinaciÃ³n pedido + promociÃ³n debe ser Ãºnica.

Relaciones:

- `pedidoId â†’ Pedido.id`
- `promocionId â†’ Promocion.id`

`descuentoAplicado` representa el beneficio efectivamente aplicado y debe conservarse como dato histÃ³rico. Permite reportes posteriores: promociones utilizadas, cantidad de usos e impacto econÃ³mico.

### 5.17 ParametroSistema

| Atributo      | Tipo / Notas |
| ------------- | ------------ |
| `id`          | PK           |
| `clave`       | Ãºnico       |
| `valor`       |              |
| `descripcion` |              |

Regla: `clave` debe ser Ãºnica. No crear entidades especÃ­ficas para cada parÃ¡metro.

### 5.18 Resena

| Atributo     | Tipo / Notas                                                     |
| ------------ | ---------------------------------------------------------------- |
| `id`         | PK                                                               |
| `usuarioId`  | FK â†’ `Usuario.id` (solo CLIENTE)                               |
| `productoId` | FK â†’ `Producto.id` (producto simple o combo)                   |
| `pedidoId`   | FK â†’ `Pedido.id` (pedido `entregado` que habilitÃ³ la reseÃ±a) |
| `puntuacion` | INTEGER, 1 a 5                                                   |
| `comentario` | TEXT, opcional, mÃ¡ximo 500 caracteres                           |
| `createdAt`  |                                                                  |
| `updatedAt`  |                                                                  |

Reglas: un cliente deja **una sola reseÃ±a por producto** (UNIQUE `usuarioId + productoId`); solo puede crearla si tiene un pedido `entregado` que incluya ese producto; puede editarla o eliminarla. El autor se muestra como "Nombre I." (nombre + inicial del apellido), nunca con email. No es la `Calificacion` de la Propuesta 2: no evalÃºa al repartidor ni al pedido en general.

### 5.19 Queja

| Atributo          | Tipo / Notas                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `id`              | PK                                                                                                    |
| `usuarioId`       | FK â†’ `Usuario.id` (solo CLIENTE autor del reclamo)                                                  |
| `pedidoId`        | FK â†’ `Pedido.id` (pedido propio y `entregado`), UNIQUE                                              |
| `motivo`          | ENUM: `PEDIDO_INCOMPLETO`, `PRODUCTO_EN_MAL_ESTADO`, `DEMORA_EN_LA_ENTREGA`, `ERROR_DE_COBRO`, `OTRO` |
| `detalle`         | TEXT, obligatorio, 10 a 1000 caracteres                                                               |
| `estado`          | ENUM: `PENDIENTE` (default), `EN_REVISION`, `RESUELTA`, `RECHAZADA`, `CERRADA`                        |
| `respuesta`       | TEXT, opcional, mÃ¡ximo 1000 caracteres (Ãºltima del negocio)                                         |
| `respondidoPorId` | FK â†’ `Usuario.id` (ADMINISTRADOR o SUPERADMINISTRADOR), opcional                                    |
| `respondidaEn`    | DATE, opcional (se completa al responder)                                                             |
| `cerradaEn`       | DATE, opcional (cierre del cliente)                                                                   |
| `createdAt`       |                                                                                                       |
| `updatedAt`       |                                                                                                       |

Hilo: `QuejaMensajes` (`quejaId`, `autorId`, `contenido`) guarda las respuestas del cliente (hasta 5) y del negocio.

Reglas: solo el CLIENTE dueÃ±o del pedido puede crear la queja, y Ãºnicamente si el pedido estÃ¡ `entregado`; **un pedido admite una sola queja** (UNIQUE `pedidoId`). El cliente consulta solo las suyas. El ADMINISTRADOR gestiona las quejas de pedidos de su sucursal y el SUPERADMINISTRADOR todas. Estados: `PENDIENTE â†’ EN_REVISION â†’ RESUELTA | RECHAZADA`; se puede resolver o rechazar directamente desde `PENDIENTE`. `RESUELTA` y `RECHAZADA` exigen `respuesta` y cierran la conversación: ni el negocio ni el cliente pueden seguir respondiendo. El cliente puede cerrar en cualquier momento: pasa a `CERRADA` (final). No confundir con `Resena`: la queja es un reclamo operativo con respuesta del negocio, no una opiniÃ³n pÃºblica.

### 5.20 Notificacion

| Atributo    | Tipo / Notas                                           |
| ----------- | ------------------------------------------------------ |
| `id`        | PK                                                     |
| `usuarioId` | FK â†’ `Usuario.id` (solo CLIENTE destinatario)        |
| `tipo`      | ENUM: `PEDIDO`, `QUEJA`, `SISTEMA` (default `SISTEMA`) |
| `titulo`    | STRING(160), obligatorio                               |
| `mensaje`   | TEXT, opcional                                         |
| `pedidoId`  | FK â†’ `Pedido.id`, opcional (destino del clic)        |
| `quejaId`   | FK â†’ `Queja.id`, opcional (destino del clic)         |
| `leida`     | BOOLEAN, default `false`                               |
| `leidaEn`   | DATE, opcional (se completa al marcar leÃ­da)          |
| `createdAt` |                                                        |
| `updatedAt` |                                                        |

Reglas: cada fila es un aviso dirigido a un Ãºnico usuario. Se generan por cambios de estado de un pedido y por respuestas o cambios de estado de un reclamo; el cliente no recibe aviso de sus propias acciones. El estado leÃ­do se persiste por usuario, asÃ­ que el contador es el mismo en cualquier dispositivo. No reemplaza a `Resena`, `Queja` ni `PedidoEstadoHistorial`; es un aviso derivado. El canal de tiempo real emite `notificacion_creada` a la room privada `usuario:{id}` y el listado se lee por REST. Detalle en `docs/notificaciones.md`.

## 6. Relaciones y cardinalidades

```
Usuario 1:N Direccion
Usuario 1:N Pedido

Sucursal 1:1 Direccion
Sucursal 1:N Usuario              (sucursal asignada al ADMINISTRADOR)
Sucursal 1:N HorarioSucursal      (franjas de atenciÃ³n por dÃ­a)

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
Producto 1:N ProductoIngrediente     (receta, sÃ³lo tipo PRODUCTO)
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
Usuario 1:N Queja                    (administrador que respondiÃ³)
Pedido 1:1 Queja                     (UNIQUE pedidoId)
Queja 1:N QuejaMensaje
Usuario 1:N QuejaMensaje             (autor del mensaje)

Usuario 1:N Notificacion
Pedido 1:N Notificacion
Queja 1:N Notificacion
```

| A                     | B                     | Cardinalidad        | FK                                |
| --------------------- | --------------------- | ------------------- | --------------------------------- | --------------------------------- |
| Usuario               | Direccion             | 1:N                 | `Direccion.usuarioId`             |
| Sucursal              | Direccion             | 1:1                 | `Direccion.sucursalId`            |
| Sucursal              | Usuario               | 1:N                 | `Usuario.sucursalId`              |
| Usuario               | Pedido                | 1:N                 | `Pedido.usuarioId`                |
| Categoria             | Producto              | 1:N                 | `Producto.categoriaId`            |
| Producto              | ProductoOpcionGrupo   | 1:N                 | `ProductoOpcionGrupo.productoId`  |
| OpcionGrupo           | ProductoOpcionGrupo   | 1:N                 | `ProductoOpcionGrupo.grupoId`     |
| OpcionGrupo           | Opcion                | 1:N                 | `Opcion.grupoId`                  |
| Producto (combo)      | ComboComponente       | 1:N                 | `ComboComponente.comboId`         |
| Producto (componente) | ComboComponente       | 1:N                 | `ComboComponente.productoId`      |
| Sucursal              | Stock                 | 1:N                 | `Stock.sucursalId`                |
| Producto              | Stock                 | 1:N                 | `Stock.productoId`                |
| Sucursal              | InsumoStock           | 1:N                 | `InsumoStock.sucursalId`          |
| Insumo                | InsumoStock           | 1:N                 | `InsumoStock.insumoId`            |
| Sucursal              | HorarioSucursal       | 1:N                 | `HorarioSucursal.sucursalId`      |
| Sucursal              | Pedido                | 1:N                 | `Pedido.sucursalId`               |
| EstadoPedido          | Pedido                | 1:N                 | `Pedido.estadoId`                 |
| Pedido                | PedidoItem            | 1:N                 | `PedidoItem.pedidoId`             |
| Producto              | PedidoItem            | 1:N                 | `PedidoItem.productoId`           |
| PedidoItem            | PedidoItemOpcion      | 1:N                 | `PedidoItemOpcion.pedidoItemId`   |
| Opcion                | PedidoItemOpcion      | 1:N                 | `PedidoItemOpcion.opcionId`       |
| Pedido                | PedidoEstadoHistorial | 1:N                 | `PedidoEstadoHistorial.pedidoId`  |
| EstadoPedido          | PedidoEstadoHistorial | 1:N                 | `PedidoEstadoHistorial.estadoId`  |
| Usuario               | PedidoEstadoHistorial | 1:N                 | `PedidoEstadoHistorial.usuarioId` |
| Promocion             | PromocionProducto     | 1:N                 | `PromocionProducto.promocionId`   |
| Producto              | PromocionProducto     | 1:N                 | `PromocionProducto.productoId`    |
| Pedido                | PedidoPromocion       | 1:N                 | `PedidoPromocion.pedidoId`        |
| Promocion             | PedidoPromocion       | 1:N                 | `PedidoPromocion.promocionId`     |
| Usuario               | Resena                | 1:N                 | `Resena.usuarioId`                |
| Producto              | Resena                | 1:N                 | `Resena.productoId`               |
| Pedido                | Resena                | 1:N                 | `Resena.pedidoId`                 |
| Usuario               | Queja                 | 1:N                 | `Queja.usuarioId`                 |
| Usuario               | Queja                 | 1:N                 | `Queja.respondidoPorId`           |
| Pedido                | Queja                 | 1:1                 | `Queja.pedidoId`                  |
| Queja                 | QuejaMensaje          | 1:N                 | `QuejaMensaje.quejaId`            |
| Usuario               | QuejaMensaje          | 1:N                 | `QuejaMensaje.autorId`            |
| Usuario               | Notificacion          | 1:N                 | `Notificacion.usuarioId`          |
| Pedido                | Notificacion          | 1:N                 | `Notificacion.pedidoId`           |
| Queja                 | Notificacion          | 1:N                 | `Notificacion.quejaId`            |
| 40                    | Sucursal              | IngredienteStock    | 1:N                               | IngredienteStock.sucursalId       |
| 41                    | Ingrediente           | IngredienteStock    | 1:N                               | IngredienteStock.ingredienteId    |
| 42                    | Producto              | ProductoIngrediente | 1:N                               | ProductoIngrediente.productoId    |
| 43                    | Ingrediente           | ProductoIngrediente | 1:N                               | ProductoIngrediente.ingredienteId |

## 7. Reglas de negocio

### 7.1 AsignaciÃ³n de sucursal (regla de negocio, no entidad)

1. Obtener las sucursales activas.
2. **Descartar las que estÃ¡n fuera del horario de atenciÃ³n** en el momento del pedido (franjas de `HorarioSucursal` menos el margen de cierre global). Si la mÃ¡s cercana estÃ¡ cerrada se saltea a la siguiente.
3. Ordenarlas por proximidad geogrÃ¡fica a la direcciÃ³n de entrega.
4. Comprobar si la sucursal mÃ¡s cercana dispone del stock necesario.
5. Si no dispone del stock, evaluar la siguiente sucursal mÃ¡s cercana.
6. Continuar hasta encontrar una sucursal capaz de satisfacer el pedido.
7. Si ninguna sucursal puede satisfacerlo, el pedido no puede confirmarse.

AdemÃ¡s, un administrador puede reasignar manualmente la sucursal de un pedido como excepciÃ³n operativa, siempre que el destino estÃ© abierto y tenga stock. No crear una entidad para esta regla.

### 7.2 Otras reglas

- `Usuario.email` Ãºnico; `password` como hash.
- `Direccion`: pertenece a un usuario o a una sucursal, nunca a ambos ni a ninguno (CHECK `CK_Direcciones_propietario`). La direcciÃ³n de una sucursal se gestiona mediante la API de sucursales; la de un usuario mediante la API de direcciones.
- **GeocodificaciÃ³n de direcciones**: el servicio `geolocation_service` (Georef Argentina) obtiene `latitud`/`longitud` a partir de los datos de la direcciÃ³n. Errores tipados: `GeorefError`, `DireccionNoEncontradaError`, `DireccionAmbiguaError`. Ver `docs/reglas-negocio.md` Â§14. La integraciÃ³n con el ABM de `Direccion` estÃ¡ implementada en `direccion_service` (ver `docs/reglas-negocio.md` Â§17).
- **CÃ¡lculo de rutas**: el servicio `routing_service` (OpenRouteService) calcula distancia/duraciÃ³n entre coordenadas (`calcularRuta({ origen, destino })`). Ver `docs/reglas-negocio.md` Â§15.
- **Cobertura geogrÃ¡fica**: el servicio `cobertura_service` determina si una direcciÃ³n es vÃ¡lida para delivery: zona geogrÃ¡fica de operaciÃ³n (configurable en `cobertura-zonas`) + al menos una sucursal activa dentro de la distancia mÃ¡xima por ruta (5 km inicial, configurable vÃ­a `COBERTURA_RADIO_MAX_KM`). Reutiliza `geolocation_service` y `routing_service`. Ver `docs/reglas-negocio.md` Â§16. La integraciÃ³n con el ABM de `Direccion` estÃ¡ implementada en `direccion_service` (ver Â§17); la asignaciÃ³n de sucursal por stock y el frontend de cobertura son tareas posteriores.
- `Categoria.nombre` Ãºnico; sin jerarquÃ­a de categorÃ­as.
- `ParametroSistema.clave` Ãºnico.
- **ReseÃ±as**: solo un CLIENTE con un pedido `entregado` que contenga el producto puede crearla, y solo una por producto (UNIQUE `usuarioId + productoId`). La puntuaciÃ³n es obligatoria (1 a 5) y el comentario opcional (mÃ¡ximo 500 caracteres). El autor puede editarla o eliminarla; el listado pÃºblico muestra "Nombre I." y nunca el email. El promedio y la cantidad se calculan sobre las reseÃ±as existentes.
- **Quejas**: solo el CLIENTE dueÃ±o de un pedido `entregado` puede reclamar, y solo una vez por pedido (UNIQUE `pedidoId`). `motivo` es un enum fijo y `detalle` es obligatorio (10 a 1000 caracteres). El cliente solo ve las propias; el ADMINISTRADOR ve las de su sucursal y el SUPERADMINISTRADOR todas. El cliente puede responder hasta 5 veces mientras la queja estÃ© `PENDIENTE` o `EN_REVISION` (en `RESUELTA`, `RECHAZADA` o `CERRADA` recibe 409) y cerrar en cualquier momento (`CERRADA`, final). `RESUELTA` y `RECHAZADA` exigen `respuesta` (mÃ¡ximo 1000 caracteres). Ver `docs/quejas.md`.
- `Stock`: PK compuesta `(sucursalId, productoId)` Ãºnica.
- **Insumos**: `Insumo` con UNIQUE `(nombre, tipo)`; `InsumoStock` con PK compuesta `(sucursalId, insumoId)` y `cantidad >= 0`. SÃ³lo `extra` y `condimento` se vinculan desde la personalizaciÃ³n (`insumoId`) y descuentan stock. "Agotado" = sin stock en ninguna sucursal activa. La baja de un insumo es lÃ³gica y no permite cambiar su `tipo` si ya estÃ¡ vinculado. Ver `docs/insumos.md`.
- **Ingredientes**: `Ingrediente.nombre` Ãºnico; `unidadMedida` en `unidad`, `g`, `kg`, `ml`, `l`; `IngredienteStock` con PK compuesta `(sucursalId, ingredienteId)` y `cantidad DECIMAL(12,3) >= 0`. La unidad no se cambia si el ingrediente ya tiene stock o recetas. La baja es lÃ³gica y no borra stock ni recetas.
- **Receta**: `ProductoIngrediente` con PK compuesta `(productoId, ingredienteId)`, `cantidad DECIMAL(12,3) > 0` y `permiteQuitar`. Es obligatoria para todo `Producto` `tipo = PRODUCTO`; un `COMBO` no la admite. No se repiten ingredientes en la misma receta.
- **Stock derivado de productos**: la cantidad de un `PRODUCTO` se calcula como `min(floor(stock del ingrediente / cantidad de la receta))` sobre todos los ingredientes de su receta. Un ingrediente inactivo, sin fila en la sucursal o con `disponible = false` aporta `0`. Sin receta, la cantidad es `0` y el producto no se vende. La cantidad es de solo lectura para el administrador; sÃ³lo puede cambiar `disponible`. El admin carga el stock de ingredientes por sucursal.
- **"Sin X" desde la receta**: los ingredientes del detalle salen de `ProductoIngrediente`. Las opciones "Sin X" se generan para los ingredientes con `permiteQuitar = true`; el checkbox se administra en el formulario del producto y no en el ABM de personalizaciÃ³n. `personalizar` deja de ser editable a mano y pasa a sincronizarse desde la receta. "Sin X" no cambia el descuento: se descuenta la receta completa.
- El carrito es estado temporal y se revalida contra la BD al confirmar.
- **Combos y stock (resuelto)**: un combo es un `Producto` cuya composiciÃ³n se define mediante `ComboComponente`. Su `cantidad` en `Stock` **se deriva del stock de sus componentes**, que a su vez se deriva de los ingredientes de cada producto simple:
  - Un combo tiene fila propia en `Stock` para estar en el catÃ¡logo de la sucursal y poder apagarse con `disponible`, pero su `cantidad` **no la carga el administrador**: es un espejo del mÃ¡ximo que arma la receta.
  - El mÃ¡ximo sale de la receta: `max = min(floor(cantidad del componente / cantidad que lleva la receta))`. Si al combo le falta un componente en esa sucursal, el mÃ¡ximo es 0.
  - El backend recalcula ese nÃºmero (`sincronizarCantidadDeCombos`) cuando cambia el stock o la disponibilidad de un componente, la receta del combo o la fila del combo, y tambiÃ©n al crear o cancelar un pedido: vender un componente simple baja los combos que lo usan en su receta. El valor se devuelve derivado en `GET /api/stock`. Si a un componente se le baja el stock o se da de baja, el combo se limita solo, sin scripts de reparaciÃ³n.
  - Si la fila del combo estÃ¡ apagada (`disponible = false`), no se vende aunque los componentes alcancen.
  - Vender un combo descuenta las dos cosas: su propia unidad y las unidades de cada componente segÃºn la receta. Como la cantidad del combo ya no es un tope, la protecciÃ³n contra sobreventa se apoya en el descuento atÃ³mico de los componentes.
  - No se agregan entidades ni se modifica la estructura: `Stock` conserva `(sucursalId, productoId, cantidad, disponible)` y `ComboComponente` `(id, comboId, productoId, cantidad)`.
- El stock se descuenta al crear el pedido y se repone al cancelarlo, dentro de la transacciÃ³n del pedido. Los descuentos son atÃ³micos (`UPDATE ... WHERE cantidad >= n`) para que dos pedidos simultÃ¡neos sobre la Ãºltima unidad no sobrevendan.

## 8. Snapshots histÃ³ricos

- **DirecciÃ³n en `Pedido`**: al confirmar/generar el pedido se copian `calle`, `altura`, `ciudad`, `codigoPostal`, `referencia`, `latitud` y `longitud`. No depende de `Direccion` para conservar el historial. Nota: el snapshot de `Pedido` conserva su propia columna `ciudad`; con la alineaciÃ³n de `Direccion` (que ahora usa `provincia`/`localidad`), la localidad se mapea a esa columna. Queda pendiente alinear el naming del snapshot en una etapa posterior.
- **Producto en `PedidoItem`**: `nombreProducto` y `precioUnitario` son copia del momento del pedido. No se reconstruyen desde `Producto`.
- **OpciÃ³n en `PedidoItemOpcion`**: `nombre` y `precioAdicional` son copia del momento del pedido.
- **PromociÃ³n en `PedidoPromocion`**: `descuentoAplicado` conserva el beneficio efectivamente aplicado.

## 9. Decisiones importantes

- Una sola entidad `Usuario` con `rol` (sin `Cliente`/`Administrador` separados).
- `Direccion` como Ãºnica entidad de ubicaciÃ³n (domicilio + coordenadas), compartida por usuarios y sucursales; `Sucursal 1:1 Direccion` (sin `direccion STRING` ni coordenadas en `Sucursal`).
- DirecciÃ³n histÃ³rica por snapshot dentro de `Pedido` (sin `PedidoDireccion`).
- `horarios` como entidad `HorarioSucursal` (franjas por dÃ­a), no como texto en `Sucursal`. El corte de pedidos se deriva del cierre real menos `margenCierreMinutos`.
- Combos como `Producto` con `tipo = COMBO` + `ComboComponente` (sin entidad `Combo`).
- Precio del combo es propio en `Producto.precio`, no suma de componentes.
- PersonalizaciÃ³n con `OpcionGrupo` + `Opcion` + `ProductoOpcionGrupo`.
- Stock por sucursal y producto con clave compuesta.
- Extras y condimentos como `Insumo` + `InsumoStock` (extensiÃ³n implementada), no como `Producto`.
- Stock real en `Ingrediente` + `IngredienteStock`, con la receta en `ProductoIngrediente`: la cantidad de productos y combos pasa a ser derivada y de solo lectura.
- Receta obligatoria para todo `Producto` `tipo = PRODUCTO`; un `COMBO` sigue derivando de `ComboComponente`.
- `personalizar` deja de ser una categorÃ­a editable del ABM: se genera desde la receta (`permiteQuitar`) y sigue existiendo como tipo interno para el cliente.
- ProductoOpcionGrupo, PromocionProducto y PedidoPromocion (asociativas N:M) usan id propio + UNIQUE sobre el par de FKs, no clave compuesta (a diferencia de Stock, que sÃ­ la usa por acceder siempre por el par sucursal+producto).
- Estado actual en `Pedido.estadoId` y trazabilidad en `PedidoEstadoHistorial`.
- Carrito no persistido.
- Promociones con tipos concretos iniciales (`DESCUENTO_PORCENTUAL`, `DOS_POR_UNO`).
- ReseÃ±as como `Resena` (producto + estrellas + comentario), no como la `Calificacion` de la Propuesta 2.
- Quejas como `Queja`: reclamo del cliente sobre un pedido entregado, con motivo, detalle, estado y respuesta del administrador. Una por pedido.
- Notificaciones como `Notificacion`: aviso persistido por usuario con estado leÃ­do en base, generado por cambios de pedidos y reclamos. No reemplaza a `Queja` ni a `PedidoEstadoHistorial`.
- Reportes sin tablas propias.

## 10. Exclusiones / lÃ­mites actuales

Este modelo **no** incluye:

- `Cliente` separado de `Usuario`
- `Administrador` separado de `Usuario`
- `Carrito`
- `CarritoItem`
- `PrecioHistorico`
- tablas especÃ­ficas de reportes
- motor genÃ©rico de promociones
- `Cupon`
- `Repartidor`
- jerarquÃ­a de categorÃ­as
- mÃ¡quina de estados formal
- entidad `Combo` separada

## 11. Consideraciones de escalabilidad futura

La Propuesta 2 de repartidores **no** forma parte del modelo implementado actualmente, pero las decisiones actuales deben permitir agregarla posteriormente. Las reseÃ±as ya estÃ¡n incluidas como `Resena`, las notificaciones como `Notificacion` y los reclamos como `Queja`; no crear `Calificacion` ni `Repartidor` ahora.

La arquitectura futura podrÃ¡ incorporar, por ejemplo:

- un rol `REPARTIDOR`;
- una entidad especÃ­fica de repartidor asociada a `Usuario`;
- asignaciÃ³n de repartidores a pedidos.

## 12. Resumen general del modelo

| Entidad                 | Responsabilidad                     | Relaciones principales                                                                                                      |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Usuario`               | Actor autenticado                   | 1:N `Direccion`, 1:N `Pedido`, N:1 `Sucursal` (opcional, solo ADMINISTRADOR)                                                |
| `Direccion`             | DirecciÃ³n de usuario o sucursal    | N:1 `Usuario` (opcional), 1:1 `Sucursal` (opcional)                                                                         |
| `Sucursal`              | Local fÃ­sico                       | 1:1 `Direccion`, 1:N `Stock`, 1:N `IngredienteStock`, 1:N `Pedido`, 1:N `Usuario` (administradores)                         |
| `Categoria`             | Agrupar productos                   | 1:N `Producto`                                                                                                              |
| `Producto`              | ArtÃ­culo vendible (normal o combo) | N:1 `Categoria`, 1:N `ProductoOpcionGrupo`, 1:N `ProductoIngrediente`, 1:N `ComboComponente`, 1:N `Stock`, 1:N `PedidoItem` |
| `ComboComponente`       | ComposiciÃ³n de combo               | N:1 `Producto` (combo), N:1 `Producto` (componente)                                                                         |
| `OpcionGrupo`           | Grupo de opciones                   | 1:N `Opcion`                                                                                                                |
| `Opcion`                | OpciÃ³n concreta                    | N:1 `OpcionGrupo`                                                                                                           |
| `ProductoOpcionGrupo`   | VÃ­nculo producto â†” grupo         | N:1 `Producto`, N:1 `OpcionGrupo`                                                                                           |
| `Stock`                 | Disponibilidad productoÃ—sucursal   | N:1 `Sucursal`, N:1 `Producto`                                                                                              |
| `Insumo`                | Extra o condimento con precio       | 1:N `InsumoStock`, 1:N `PersonalizacionElemento` (opcional)                                                                 |
| `InsumoStock`           | Existencia insumoÃ—sucursal         | N:1 `Sucursal`, N:1 `Insumo`                                                                                                |
| `Ingrediente`           | Materia prima con unidad            | 1:N `IngredienteStock`, 1:N `ProductoIngrediente`                                                                           |
| `IngredienteStock`      | Existencia ingredienteÃ—sucursal    | N:1 `Sucursal`, N:1 `Ingrediente`                                                                                           |
| `ProductoIngrediente`   | Receta productoÃ—ingrediente        | N:1 `Producto`, N:1 `Ingrediente`                                                                                           |
| `Pedido`                | Pedido realizado/registrado         | N:1 `Usuario`, N:1 `Sucursal`, N:1 `EstadoPedido`, 1:N `PedidoItem`, 1:N `PedidoEstadoHistorial`, 1:N `PedidoPromocion`     |
| `PedidoItem`            | LÃ­nea de pedido                    | N:1 `Pedido`, N:1 `Producto`, 1:N `PedidoItemOpcion`                                                                        |
| `PedidoItemOpcion`      | OpciÃ³n seleccionada                | N:1 `PedidoItem`, N:1 `Opcion`                                                                                              |
| `EstadoPedido`          | CatÃ¡logo de estados                | 1:N `Pedido`, 1:N `PedidoEstadoHistorial`                                                                                   |
| `PedidoEstadoHistorial` | Trazabilidad de estados             | N:1 `Pedido`, N:1 `EstadoPedido`, N:1 `Usuario`                                                                             |
| `Promocion`             | Beneficio aplicable                 | 1:N `PromocionProducto`, 1:N `PedidoPromocion`                                                                              |
| `PromocionProducto`     | VÃ­nculo promociÃ³n â†” producto    | N:1 `Promocion`, N:1 `Producto`                                                                                             |
| `PedidoPromocion`       | PromociÃ³n aplicada                 | N:1 `Pedido`, N:1 `Promocion`                                                                                               |
| `ParametroSistema`      | ConfiguraciÃ³n del sistema          | â€”                                                                                                                         |
| `Resena`                | OpiniÃ³n de un cliente              | N:1 `Usuario`, N:1 `Producto`, N:1 `Pedido`                                                                                 |
| `Queja`                 | Reclamo sobre pedido entregado      | N:1 `Usuario` (autor), N:1 `Usuario` (respondedor), 1:1 `Pedido`, 1:N `QuejaMensaje`                                        |
| `QuejaMensaje`          | Mensaje del hilo                    | N:1 `Queja`, N:1 `Usuario` (autor)                                                                                          |
| Notificacion            | Aviso del centro del cliente        | N:1 Usuario (destinatario), N:1 Pedido (opcional), N:1 Queja (opcional)                                                     |

## 13. Observaciones pendientes

Sin modificar el modelo documentado, se dejan seÃ±aladas las siguientes observaciones para que el equipo las valide en una etapa posterior:

- `Pedido.medioPago` admite `MERCADO_PAGO` y `TARJETA`; el enunciado no define explÃ­citamente estos valores, por lo que conviene confirmar el listado final antes del DER.
- No se especifica el tipo/dominio de `Promocion.valor` (porcentaje, cantidad fija, etc.); conviene precisarlo al diseÃ±ar la implementaciÃ³n.
- `Pedido.estadoId` (estado actual) convive con el historial; se sugiere confirmar la regla de actualizaciÃ³n consistente de ambos al generar cambios de estado.
- El tiempo estimado de entrega no requiere necesariamente almacenamiento persistente. Su cÃ¡lculo deberÃ¡ definirse como regla de negocio y podrÃ¡ realizarse dinÃ¡micamente a partir del estado del pedido y/o parÃ¡metros del sistema. `PedidoEstadoHistorial` permite calcular tiempos reales e histÃ³ricos, pero no representa por sÃ­ mismo una estimaciÃ³n futura.
