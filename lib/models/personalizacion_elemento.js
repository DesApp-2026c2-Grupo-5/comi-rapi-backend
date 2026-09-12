/**
 * Modelo: PersonalizacionElemento
 *
 * Define las opciones de personalización disponibles para cada producto.
 * Tipos:
 *   - 'extra': ingrediente adicional que cobra (precio requerido)
 *   - 'personalizar': modificación sin costo (precio null)
 *   - 'acompanar': acompañamiento que cobra y referencia a otro producto (precio + productoReferenciaId)
 *   - 'condimento': condimento gratuito (precio null)
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - productoId (INTEGER, FK → Productos.id, NOT NULL)
 *   - tipo (STRING, NOT NULL — 'extra' | 'personalizar' | 'acompanar' | 'condimento')
 *   - nombre (STRING, nullable — nombre del elemento)
 *   - precio (DECIMAL, nullable — precio adicional, null si es gratuito)
 *   - productoReferenciaId (INTEGER, FK → Productos.id, nullable — solo para tipo 'acompanar')
 *   - activo (BOOLEAN, default true)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Un PersonalizacionElemento pertenece a un Producto (belongsTo, alias: producto)
 *   - Un PersonalizacionElemento puede referenciar a otro Producto (belongsTo, alias: productoReferencia, nullable)
 *
 * Referencia: frontend src/services/seedData.js → personalizacionElementosMock
 *   Frontend api: obtenerElementos, obtenerPorProducto, crear, actualizar, eliminar
 *   Query param: ?productoId= para filtrar por producto
 */
