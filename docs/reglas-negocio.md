# Reglas de negocio — Comi-Rapi

Documento de apoyo para implementar la capa `services`. Extrae las reglas que se desprenden del modelo aprobado. No introduce reglas nuevas.

Fuentes: `docs/enunciado.md`, `docs/modelo-dominio.md`, `docs/DER.md`, `AGENTS.md`.

## 1. Usuarios y roles

- Existe una única entidad `Usuario`; `email` es único.
- El modelo actual contempla únicamente los roles `CLIENTE` y `ADMINISTRADOR`.
- Las funcionalidades y entidades adicionales de Propuesta 2 no forman parte de la implementación actual y quedan fuera del modelo definido para esta etapa, sin plantearlo como una exclusión permanente de futuras ampliaciones.
- El sistema nace con un administrador inicial; los administradores pueden crear otros administradores.
- `Usuario` posee `fechaNacimiento` (atributo persistido). `edad` se obtiene a partir de `fechaNacimiento` y **no** se almacena como dato persistido.

## 2. Catálogo y productos

- `Categoria 1:N Producto`; el `nombre` de categoría es único; sin jerarquía de categorías.
- `Producto` tiene precio vigente, imagen, descripción, categoría, estado (`activo`) y `tipo` (`PRODUCTO` | `COMBO`).
- El precio del producto es el vigente; el precio histórico de un pedido no se reconstruye desde `Producto`.

## 3. Combos

- Un combo es un `Producto` con `tipo = COMBO`; no existe entidad `Combo` separada.
- La composición se modela con `ComboComponente` (`comboId`, `productoId`, `cantidad`).
- El combo tiene precio propio en `Producto.precio`; no se calcula sumando los precios actuales de sus componentes.

## 4. Personalización

- Se modela con `OpcionGrupo`, `Opcion` y `ProductoOpcionGrupo`.
- `OpcionGrupo` define nombre, `tipoSeleccion` (`UNICA`/`MULTIPLE`), `minimo`, `maximo`, `obligatorio` y `activo`.
- `Opcion` pertenece a un grupo y tiene nombre, `precioAdicional`, `activo` y `productoReferenciaId` opcional.
- Distintos productos pueden tener distintos grupos de personalización.
- Las opciones pueden tener precio adicional y estar activas/inactivas.
- Los límites de selección se establecen por grupo mediante `minimo`/`maximo`.

## 5. Stock y sucursales

- El stock es por `Sucursal + Producto`; la combinación (`sucursalId`, `productoId`) es única.
- `cantidad = 0` significa producto ofrecido pero sin stock.
- `disponible = false` significa que la sucursal no ofrece actualmente ese producto.
- No todos los productos están disponibles en todas las sucursales.
- Al confirmar un pedido se debe verificar la disponibilidad correspondiente.
- Pendiente de definición: cómo se verifica el stock de un combo cuya disponibilidad depende de sus componentes. No agregar una entidad para resolverlo.

## 6. Asignación de sucursal

Regla de negocio, no entidad:

1. Obtener sucursales activas.
2. Ordenarlas por proximidad geográfica a la dirección de entrega.
3. Verificar stock de la más cercana.
4. Si no puede satisfacer el pedido, probar la siguiente.
5. Repetir hasta encontrar una sucursal capaz de cumplirlo.
6. Si ninguna puede, el pedido no se confirma.

- Un administrador puede reasignar manualmente la sucursal de un pedido como excepción operativa.

## 7. Direcciones

- `Direccion` es la única entidad que almacena los datos de ubicación (domicilio textual y geolocalización latitud/longitud), tanto para usuarios como para sucursales.
- `Usuario 1:N Direccion`: un usuario puede tener muchas direcciones.
- `Sucursal 1:1 Direccion`: cada sucursal tiene exactamente una dirección (FK `Direccion.sucursalId`). `Sucursal` ya no almacena `direccion` como string ni coordenadas propias.
- Una dirección pertenece a un usuario o a una sucursal, nunca a ambos simultáneamente ni a ninguno. Se garantiza a nivel de persistencia mediante el CHECK `CK_Direcciones_propietario`.
- **Campos obligatorios** al ingresar una dirección (cliente y admin, en la creación de la sucursal): `calle`, `altura`, `provincia`, `localidad` y `codigoPostal`. Se validan en la API y a nivel de modelo (`NOT NULL`).
- **Coordenadas no manuales**: `latitud`/`longitud` son opcionales y **no se ingresan manualmente** (ni por el admin ni por nadie): la API las rechaza. A futuro, un servicio de geolocalización del backend las calculará a partir de los datos de la dirección ingresados.
- La dirección de un usuario se gestiona mediante la API de direcciones; la dirección de una sucursal se gestiona mediante la API de sucursales (como objeto `direccion` anidado).
- La dirección puede modificarse o eliminarse tras un pedido.
- El pedido conserva un snapshot de la dirección al generarse/confirmarse: calle, altura, ciudad, codigoPostal, referencia, latitud y longitud.

## 8. Pedidos

- Al confirmar se registran usuario, sucursal asignada, dirección (snapshot), fecha/hora, detalle de productos, total y estado inicial.
- Al confirmar se revalidan las condiciones relevantes.
- El carrito es temporal y no se persiste.
- `Pedido` conserva `costoEnvio`, `total`, `medioPago`, `observacion` y el snapshot de dirección.
- La implementación actual simula el medio de pago.
- Pendiente de definición: valores definitivos de `medioPago`. Los valores utilizados actualmente son `MERCADO_PAGO` y `TARJETA`.

## 9. Estados e historial

- Estados previstos: `PENDIENTE`, `CONFIRMADO`, `EN_PREPARACION`, `LISTO`, `EN_CAMINO`, `ENTREGADO`, `CANCELADO`.
- `Pedido.estadoId` representa el estado actual.
- `PedidoEstadoHistorial` conserva la trazabilidad mediante estado, fecha/hora, usuario y observación.
- Cada cambio de estado debe actualizar `Pedido.estadoId` y generar simultáneamente un registro en `PedidoEstadoHistorial`.
- Pendiente de definición: reglas específicas de transición entre estados.

## 10. Snapshots históricos

- `PedidoItem` conserva `nombreProducto` y `precioUnitario`.
- `PedidoItemOpcion` conserva `nombre` y `precioAdicional`.
- `PedidoPromocion` conserva `descuentoAplicado`.
- Un pedido histórico debe mostrar los valores correspondientes al momento de la compra aunque posteriormente cambien productos, precios u opciones.

## 11. Promociones

- `Promocion` contempla inicialmente los tipos `DESCUENTO_PORCENTUAL` y `DOS_POR_UNO`.
- Existe relación N:M entre `Promocion` y `Producto` mediante `PromocionProducto`.
- Los combos, al ser productos, también pueden ser alcanzados por una promoción.
- `PedidoPromocion` registra la promoción aplicada a un pedido y conserva `descuentoAplicado` como snapshot.
- Pendiente de definición: dominio del campo `valor` de la promoción.
- No implementar ni documentar un motor genérico de reglas de promoción.

## 12. Parámetros del sistema

- `ParametroSistema` guarda configuraciones generales mediante `clave` única, `valor` y `descripcion`.
- No existen entidades específicas por parámetro.
- Pendiente de definición: cálculo del tiempo estimado de entrega (ETA). Puede definirse como una regla dinámica a partir del estado y/o parámetros, sin requerir necesariamente persistencia.

## 13. Reglas pendientes de definición

1. Verificación de stock de combos.
2. Valores definitivos de `medioPago`.
3. Dominio del `valor` de las promociones.
4. Cálculo del tiempo estimado de entrega (ETA).
5. Reglas de transición de estados.
