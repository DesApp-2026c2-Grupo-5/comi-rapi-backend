# Análisis Inicial - pedicomApp

> Documento de análisis funcional y técnico derivado del enunciado (doc/enunciado.md).
> Objetivo: plataforma web responsiva de pedidos de delivery para una cadena de comida rápida,
> con aplicación para clientes y sistema administrativo, compartiendo una misma base de datos.
> Frontend (React/JS) y Backend (Node.js) en carpetas separadas `frontend/` y `backend/`,
> comunicados mediante API REST.

---

## 1. Funcionalidades a desarrollar

A continuación se listan las funcionalidades requeridas, vinculadas con citas concretas del enunciado.

### 1.1 Gestión de Usuarios

- **Clientes**: registro, login, recuperación de contraseña, modificación de datos, administración de direcciones, consulta de pedidos anteriores y realización de nuevos pedidos.
  - *"Podrán: Registrarse. Iniciar sesión. Recuperar contraseña. Modificar sus datos. Administrar sus direcciones. Consultar pedidos anteriores. Realizar nuevos pedidos."* (líns. 27-33)
- **Administradores**: gestionan toda la información del sistema, con un administrador inicial precargado y capacidad de crear otros administradores.
  - *"El sistema nace con un administrador inicial."* (lín. 39)
  - *"Los administradores podrán crear nuevos administradores."* (lín. 41)
- Todos los usuarios deben autenticarse; se requiere control de roles (cliente / administrador, y a futuro repartidor).
  - *"Existen distintos tipos de usuarios."* (lín. 19)

### 1.2 Gestión de Sucursales

- Cada sucursal es un local físico con: nombre, dirección, ubicación geográfica (latitud/longitud), horarios de atención, teléfono y estado (activa/inactiva).
  - *"De cada una interesa registrar, entre otros datos: Nombre. Dirección. Ubicación geográfica (latitud y longitud). Horarios de atención. Teléfono. Estado (activa/inactiva)."* (líns. 48-54)
- El sistema debe determinar desde qué sucursal preparar cada pedido (estrategia a definir, ej. sucursal más cercana).
  - *"La aplicación deberá determinar desde qué sucursal preparar un pedido."* (lín. 56)

### 1.3 Catálogo de Productos y Categorías

- Los administradores gestionan el catálogo: nombre, descripción, categoría, precio, imagen, estado (disponible/no disponible).
  - *"Cada producto posee información como: nombre, descripción, categoría, precio, imagen, estado (disponible/no disponible)."* (lín. 70)
- Las categorías son administrables (Hamburguesas, Combos, Papas, Nuggets, Bebidas, Postres, Salsas, etc.).
  - *"Las categorías también deberán ser administrables."* (lín. 72)
- Configuraciones especiales por producto (ingredientes adicionales, eliminación, tamaños, sabores, promociones).
  - *"Cada grupo deberá definir si algunos productos pueden tener configuraciones especiales..."* (lín. 84)

### 1.4 Carrito de Compras

- El cliente agrega productos al carrito con cantidad, observaciones y configuraciones especiales; el sistema calcula el total y permite modificar antes de confirmar.
  - *"Se debe contemplar que para cada producto incluido en un carrito, se pueda indicar: Cantidad. Observaciones. Configuraciones especiales..."* (líns. 98-102)
  - *"La aplicación calculará el importe total."* / *"El cliente podrá modificar el carrito antes de confirmar el pedido."* (líns. 104, 106)

### 1.5 Realización de Pedidos

- Al confirmar se registra: cliente, sucursal asignada, dirección de entrega, fecha/hora, detalle de productos, importe y estado inicial.
  - *"Al confirmar el pedido se deberán registrar, como mínimo: Cliente. Sucursal asignada. Dirección de entrega. Fecha y hora. Detalle de productos. Importe. Estado inicial."* (líns. 110-118)
- Ciclo de estados: Pendiente, Confirmado, En preparación, Listo para entregar, En camino, Entregado, Cancelado.
  - *"Cada pedido atravesará diferentes estados..."* (líns. 120-128)

### 1.6 Geolocalización

- El cliente registra una o varias direcciones con ubicación geográfica; se usa para asignar sucursal y mostrar sucursales disponibles para su ubicación.
  - *"Cada cliente podrá registrar una o varias direcciones... Además de la dirección textual deberá almacenarse la ubicación geográfica."* (lín. 134)
  - *"También deberá mostrar al cliente las sucursales disponibles para su ubicación."* (lín. 136)
- (Optativo) Mapa con ubicación del cliente, sucursal asignada y recorrido estimado.
  - *"Como funcionalidad adicional y optativa, podrá mostrarse un mapa..."* (líns. 138-144)

### 1.7 Seguimiento del Pedido

- Tras confirmar, el cliente consulta: sucursal, estado actual, fecha/hora de cada cambio y tiempo estimado de entrega.
  - *"El sistema mostrará: Qué sucursal está preparando/preparó el pedido. Estado actual. Fecha y hora de cada cambio de estado. Tiempo estimado de entrega."* (líns. 150-155)

### 1.8 Historial

- El cliente consulta pedidos realizados, detalle, importe, fecha y estado final; puede repetir pedidos anteriores.
  - *"Los clientes podrán consultar: Pedidos realizados. Detalle de cada pedido. Importe. Fecha. Estado final."* (líns. 161-167)
  - *"También podrán repetir pedidos anteriores."* (lín. 169)

### 1.9 Sistema Administrativo (CRUD/ABM)

- Aplicación independiente que comparte la BD y permite ABM de: Productos, Categorías, Promociones, Sucursales, Stock, Administradores, Estados generales, Parámetros del sistema.
  - *"Desde allí podrán administrar mediante operaciones de alta, baja, modificación y consulta (CRUD/ABM)... Productos. Categorías. Promociones. Sucursales. Stock. Administradores. Estados generales. Parámetros del sistema."* (líns. 175-184)

### 1.10 Reportes (base)

- Consultas/estadísticas: productos, más vendidos, menos vendidos, sin stock, mayor facturación.
  - *"Productos. Productos más vendidos. Productos menos vendidos. Productos sin stock. Productos con mayor facturación."* (líns. 192-196)

### 1.11 Extensiones (a definir según alcance)

**Propuesta 1**
- Stock por sucursal con verificación de disponibilidad al pedir.
  - *"Cada sucursal administra su propio stock... Cuando un cliente realiza un pedido, la aplicación deberá verificar la disponibilidad."* (líns. 208-210)
- Promociones (combos, descuentos, 2x1, cupones, envío gratuito).
  - *"El sistema podrá administrar promociones."* (lín. 220)
- Reportes adicionales: pedidos, clientes, sucursales, promociones.
  - *"Reportes adicionales"* (líns. 232-260)

**Propuesta 2**
- Calificaciones (puntuación/comentario) tras recibir el pedido.
  - *"Luego de recibir un pedido, el cliente podrá realizar una valoración."* (lín. 266)
- Notificaciones de eventos (confirmado, en preparación, en camino, entregado, cancelación).
  - *"El sistema deberá informar al cliente los eventos importantes."* (lín. 274)
- App de repartidores: asignación de pedidos listos, marcar inicio de viaje y entrega.
  - *"Se propone construir una tercera aplicación para uso de los repartidores."* (lín. 288)
- Reportes adicionales de la Extensión 1 (excepto promociones).
  - *"Agregar los reportes detallados para la Extensión 1, salvo los relacionados con promociones."* (lín. 298)

> **Decisión sugerida de alcance:** implementar base completa + **Extensión 1 (Stock, Promociones, Reportes adicionales)** por ser transversal al catálogo y administrativo, dejando Propuesta 2 (repartidores/notificaciones/calificaciones) como fase opcional posterior.

---

## 2. Mapa inicial de páginas sugeridas (App Web)

### 2.1 Aplicación de Cliente

| Ruta sugerida | Página | Funcionalidad vinculada |
|---|---|---|
| `/` | Inicio / Landing | Catálogo destacado, acceso a login/registro |
| `/registro` | Registro de cliente | 1.1 |
| `/login` | Inicio de sesión | 1.1 |
| `/recuperar-password` | Recuperar contraseña | 1.1 |
| `/cuenta` | Mis datos | 1.1 (Modificar sus datos) |
| `/cuenta/direcciones` | Mis direcciones | 1.1 / 1.6 |
| `/catalogo` | Catálogo de productos | 1.3 |
| `/producto/:id` | Detalle + configuraciones especiales | 1.3 / 1.4 |
| `/carrito` | Carrito de compras | 1.4 |
| `/checkout` | Confirmación de pedido | 1.5 |
| `/seguimiento/:id` | Seguimiento del pedido | 1.7 |
| `/historial` | Historial de pedidos | 1.8 |
| `/historial/:id` | Detalle de pedido anterior + repetir | 1.8 |
| `/mapa` (optativo) | Mapa de sucursales / recorrido | 1.6 |

### 2.2 Aplicación Administrativa

| Ruta sugerida | Página | Funcionalidad vinculada |
|---|---|---|
| `/admin/login` | Login administrador | 1.1 |
| `/admin` | Dashboard | Resumen |
| `/admin/productos` | ABM Productos | 1.3 / 1.9 |
| `/admin/categorias` | ABM Categorías | 1.3 / 1.9 |
| `/admin/promociones` | ABM Promociones | Ext. 1 |
| `/admin/sucursales` | ABM Sucursales | 1.2 / 1.9 |
| `/admin/stock` | Gestión de stock por sucursal | Ext. 1 |
| `/admin/administradores` | ABM Administradores | 1.1 / 1.9 |
| `/admin/estados` | ABM Estados generales | 1.9 |
| `/admin/parametros` | Parámetros del sistema | 1.9 |
| `/admin/pedidos` | Gestión de pedidos y estados | 1.5 |
| `/admin/reportes` | Reportes (base + Ext. 1) | 1.10 / Ext. 1 |

---

## 3. Esquema inicial de endpoints (API REST)

Base URL: `/api`

### 3.1 Autenticación y Usuarios

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/auth/registro` | Registrar cliente |
| POST | `/auth/login` | Iniciar sesión (cliente/admin) |
| POST | `/auth/recuperar-password` | Solicitar recuperación |
| POST | `/auth/restablecer-password` | Restablecer contraseña |
| GET | `/clientes/perfil` | Datos del cliente (auth) |
| PUT | `/clientes/perfil` | Modificar datos |
| GET | `/clientes/direcciones` | Listar direcciones |
| POST | `/clientes/direcciones` | Crear dirección (con lat/lng) |
| PUT | `/clientes/direcciones/:id` | Modificar dirección |
| DELETE | `/clientes/direcciones/:id` | Eliminar dirección |
| GET | `/admin/administradores` | Listar administradores |
| POST | `/admin/administradores` | Crear administrador |
| PUT | `/admin/administradores/:id` | Modificar administrador |
| DELETE | `/admin/administradores/:id` | Eliminar administrador |

### 3.2 Sucursales

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/sucursales` | Listar sucursales (filtro estado) |
| GET | `/sucursales/cercanas?lat=&lng=` | Sucursales disponibles para una ubicación |
| GET | `/sucursales/:id` | Detalle de sucursal |
| POST | `/admin/sucursales` | Crear sucursal |
| PUT | `/admin/sucursales/:id` | Modificar sucursal |
| DELETE | `/admin/sucursales/:id` | (In)activar sucursal |

### 3.3 Catálogo

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/categorias` | Listar categorías |
| POST | `/admin/categorias` | Crear categoría |
| PUT | `/admin/categorias/:id` | Modificar categoría |
| DELETE | `/admin/categorias/:id` | Eliminar categoría |
| GET | `/productos` | Listar productos (filtros: cat, estado, sucursal) |
| GET | `/productos/:id` | Detalle + configuraciones especiales |
| POST | `/admin/productos` | Crear producto |
| PUT | `/admin/productos/:id` | Modificar producto |
| DELETE | `/admin/productos/:id` | (Des)activar producto |
| GET | `/admin/estados` | Listar estados generales |
| POST | `/admin/estados` | Crear estado |
| PUT | `/admin/estados/:id` | Modificar estado |
| DELETE | `/admin/estados/:id` | Eliminar estado |
| GET | `/admin/parametros` | Listar parámetros |
| PUT | `/admin/parametros/:id` | Modificar parámetros |

### 3.4 Carrito y Pedidos

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/carrito` | Obtener carrito actual |
| POST | `/carrito/items` | Agregar item (cantidad, obs, config) |
| PUT | `/carrito/items/:id` | Modificar item |
| DELETE | `/carrito/items/:id` | Quitar item |
| POST | `/pedidos` | Confirmar pedido (asigna sucursal, calcula total) |
| GET | `/pedidos/mios` | Pedidos del cliente (historial) |
| GET | `/pedidos/:id` | Detalle de pedido + trazabilidad de estados |
| GET | `/pedidos/:id/seguimiento` | Estado actual, tiempos, sucursal |
| POST | `/pedidos/:id/repetir` | Repetir pedido anterior |
| PUT | `/admin/pedidos/:id/estado` | Cambiar estado (flujo de pedido) |
| GET | `/admin/pedidos` | Listar pedidos (filtros) |

### 3.5 Stock y Promociones (Extensión 1)

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/admin/stock?sucursal=&producto=` | Consultar stock |
| POST | `/admin/stock` | Registrar/actualizar stock |
| PUT | `/admin/stock/:id` | Ajuste de stock |
| GET | `/promociones` | Listar promociones vigentes |
| POST | `/admin/promociones` | Crear promoción |
| PUT | `/admin/promociones/:id` | Modificar promoción |
| DELETE | `/admin/promociones/:id` | Eliminar promoción |

### 3.6 Reportes

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/admin/reportes/productos` | Catálogo y métricas de productos |
| GET | `/admin/reportes/productos/mas-vendidos` | 1.10 |
| GET | `/admin/reportes/productos/menos-vendidos` | 1.10 |
| GET | `/admin/reportes/productos/sin-stock` | 1.10 |
| GET | `/admin/reportes/productos/mayor-facturacion` | 1.10 |
| GET | `/admin/reportes/pedidos` | Ext. 1: pedidos, por día, sucursal, estado, cancelados, tiempo promedio |
| GET | `/admin/reportes/clientes` | Ext. 1: top pedidos, nuevos, inactivos |
| GET | `/admin/reportes/sucursales` | Ext. 1: ventas, productos, cantidad atendidos |
| GET | `/admin/reportes/promociones` | Ext. 1: más usadas, impacto |

---

## 4. Notas de arquitectura (resumen)

- **Backend (Node.js):** Express + ORM (Sequelize/Prisma) sobre base relacional; autenticación con JWT; control de roles por tipo de usuario; middleware de validación.
- **Frontend (React/JS):** SPA con React Router, estado global (Context/Redux), consumo de API REST vía fetch/axios, diseño responsivo (CSS Grid/Flex + media queries o librería UI).
- **Modelo de datos sugerido:** Usuario, Direccion, Sucursal, Categoria, Producto, ProductoConfiguracion, Carrito, CarritoItem, Pedido, PedidoItem, PedidoEstadoHistorial, Stock, Promocion, ParametroSistema.
- **Estrategia de asignación de sucursal (inicial):** sucursal activa más cercana a la dirección de entrega (cálculo de distancia por coordenadas), con fallback por disponibilidad de stock.
