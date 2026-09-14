# Trabajo Práctico: Pedidos en casas de comidas rápidas

## Descripción General

Una importante cadena de comida rápida (análoga a McDonald’s, Burger King, Mostaza o similar) desea desarrollar una nueva plataforma digital para la gestión integral de pedidos de delivery.

La solución deberá contemplar tanto la aplicación utilizada por los clientes para realizar pedidos como un sistema administrativo que permita gestionar la información necesaria para el funcionamiento del negocio. A elección del grupo (ver más adelante) se puede agregar una tercera aplicación, la que usan los repartidores.

Todas las aplicaciones deberán compartir la misma base de datos.

Se deberá contemplar el proceso completo desde la configuración de productos hasta la entrega del pedido al cliente.

## Funcionalidades base

La implementación debe contemplar, como mínimo, los puntos que se describen a continuación.

### Gestión de Usuarios

Existen distintos tipos de usuarios.

#### Clientes

Son quienes realizan pedidos mediante la aplicación.

Podrán:

- Registrarse.
- Iniciar sesión.
- Recuperar contraseña.
- Modificar sus datos.
- Administrar sus direcciones.
- Consultar pedidos anteriores.
- Realizar nuevos pedidos.

#### Administradores

Gestionan toda la información necesaria para el funcionamiento del sistema.

El sistema nace con un administrador inicial.

Los administradores podrán crear nuevos administradores.

### Gestión de Sucursales

Cada sucursal representa un local físico.

De cada una interesa registrar, entre otros datos:

- Nombre.
- Dirección.
- Ubicación geográfica (latitud y longitud).
- Horarios de atención.
- Teléfono.
- Estado (activa/inactiva).

La aplicación deberá determinar desde qué sucursal preparar un pedido. Queda a criterio de cada grupo definir la estrategia utilizada para dicha asignación.

Algunos ejemplos podrían ser:

- Sucursal más cercana.
- Menor tiempo estimado.
- Disponibilidad de stock.
- Menor cantidad de pedidos pendientes.
- Combinación de varios criterios.

### Catálogo de Productos

Los administradores podrán gestionar el catálogo de productos.

Cada producto posee información como: nombre, descripción, categoría, precio, imagen, estado (disponible/no disponible).

Las categorías también deberán ser administrables.

Ejemplos de categorías posibles:

- Hamburguesas.
- Combos.
- Papas.
- Nuggets.
- Bebidas.
- Postres.
- Salsas.

Cada grupo deberá definir si algunos productos pueden tener configuraciones especiales, a tener en cuenta al realizar pedidos.

Por ejemplo:

- Ingredientes adicionales.
- Eliminación de ingredientes.
- Tamaños.
- Sabores.
- Promociones.

### Carrito de Compras

Los clientes podrán ir agregando productos al carrito.

Se debe contemplar que para cada producto incluido en un carrito, se pueda indicar:

- Cantidad.
- Observaciones.
- Configuraciones especiales (si correspondiera).

La aplicación calculará el importe total.

El cliente podrá modificar el carrito antes de confirmar el pedido.

### Realización de Pedidos

Al confirmar el pedido se deberán registrar, como mínimo:

- Cliente.
- Sucursal asignada.
- Dirección de entrega.
- Fecha y hora.
- Detalle de productos.
- Importe.
- Estado inicial.

Cada pedido atravesará diferentes estados, por ejemplo:

- Pendiente.
- Confirmado.
- En preparación.
- Listo para entregar.
- En camino.
- Entregado.
- Cancelado.

Los grupos podrán proponer variantes sobre esta lista de estados, si lo consideran conveniente.

### Geolocalización

Cada cliente podrá registrar una o varias direcciones. Además de la dirección textual deberá almacenarse la ubicación geográfica.

La aplicación utilizará dicha información para determinar desde qué sucursal preparar el pedido. También deberá mostrar al cliente las sucursales disponibles para su ubicación.

Como funcionalidad adicional y optativa, podrá mostrarse un mapa con:

- Ubicación del cliente.
- Sucursal asignada.
- Recorrido estimado.

No es obligatorio implementar navegación real.

### Seguimiento del Pedido

Una vez confirmado el pedido, el cliente podrá consultar su evolución.

El sistema mostrará:

- Qué sucursal está preparando/preparó el pedido.
- Estado actual.
- Fecha y hora de cada cambio de estado.
- Tiempo estimado de entrega.

Cada grupo podrá definir cómo calcula dicho tiempo.

### Historial

Los clientes podrán consultar:

- Pedidos realizados.
- Detalle de cada pedido.
- Importe.
- Fecha.
- Estado final.

También podrán repetir pedidos anteriores.

### Sistema Administrativo

Los administradores disponen de una aplicación independiente que comparte la misma base de datos con el sistema de delivery.

Desde allí podrán administrar mediante operaciones de alta, baja, modificación y consulta (CRUD/ABM), entre otras, las siguientes entidades:

- Productos.
- Categorías.
- Promociones.
- Sucursales.
- Stock.
- Administradores.
- Estados generales.
- Parámetros del sistema.

Los grupos podrán incorporar configuraciones adicionales que consideren necesarias.

### Reportes

El sistema administrativo deberá ofrecer, al menos, las siguientes consultas y estadísticas:

- Productos.
- Productos más vendidos.
- Productos menos vendidos.
- Productos sin stock.
- Productos con mayor facturación.

## Extensiones

Los grupos que quieran realizar una implementación más completa, y aspirar a las notas más altas, deberán agregar algunas funcionalidades adicionales a las recién descriptas.

A continuación presentamos dos propuestas de extensiones. Se espera que cada grupo que tome el desafío de construir una solución más potente elija una de ellas.

## Extensiones - Propuesta 1

### Stock

Cada sucursal administra su propio stock. Debe existir una forma de registrar el stock disponible para cada producto.

Cuando un cliente realiza un pedido, la aplicación deberá verificar la disponibilidad correspondiente.

No necesariamente todos los productos estarán disponibles en todas las sucursales.

La forma en que se reserva, descuenta o libera el stock queda abierta para ser definida por cada grupo.

También queda abierta la posibilidad de manejar distintos niveles de stock o alertas.

### Promociones

El sistema podrá administrar promociones.

Algunos ejemplos:

- Combos.
- Descuentos.
- 2x1.
- Cupones.
- Envío gratuito.

Las reglas de aplicación quedan abiertas para que cada grupo las defina.

### Reportes adicionales

Agregar los reportes que se detallan a continuación.

#### Pedidos

- Pedidos.
- Pedidos por día.
- Pedidos por sucursal.
- Pedidos por estado.
- Tiempo promedio de entrega.
- Pedidos cancelados.

#### Clientes

- Clientes con mayor cantidad de pedidos.
- Clientes nuevos por período.
- Clientes inactivos.

#### Sucursales

- Ventas por sucursal.
- Productos vendidos por sucursal.
- Cantidad de pedidos atendidos.

#### Promociones

- Promociones más utilizadas.
- Impacto sobre las ventas de una promoción.

## Extensiones - Propuesta 2

### Calificaciones

Luego de recibir un pedido, el cliente podrá realizar una valoración.

Podrá incluir puntuación y/o comentario.

Cada grupo decidirá cuáles puedan ser los efectos de estas calificaciones en las funcionalidades de la aplicación.

### Notificaciones

El sistema deberá informar al cliente los eventos importantes.

Por ejemplo:

- Pedido confirmado.
- Pedido en preparación.
- Pedido en camino.
- Pedido entregado.
- Cancelación.

La forma de implementación queda abierta, pudiendo utilizarse correo electrónico, notificaciones dentro de la aplicación u otro mecanismo.

### Repartidores

Se propone construir una tercera aplicación para uso de los repartidores.

Cuando un pedido queda listo para entregar, se asigna a un repartidor. Los criterios para esto se dejan a elección del grupo.

En la aplicación del repartidor aparecen los pedidos pendientes de entrega.

El repartidor marca cuando empieza un viaje, indicando qué pedidos está llevando, y cuando entrega cada pedido.

### Reportes adicionales

Agregar los reportes detallados para la Extensión 1, salvo los relacionados con promociones.