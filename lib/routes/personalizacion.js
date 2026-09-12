/**
 * Rutas de personalización de productos.
 *
 * Endpoints:
 *   GET    /api/personalizacion            → personalizacion_controller.index   (público; ?productoId=)
 *   GET    /api/personalizacion/:id        → personalizacion_controller.show    (público)
 *   POST   /api/personalizacion            → personalizacion_controller.create  (ADMIN)
 *   PUT    /api/personalizacion/:id        → personalizacion_controller.update  (ADMIN)
 *   DELETE /api/personalizacion/:id        → personalizacion_controller.destroy (ADMIN)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/personalizacion.js
 *   (obtenerElementos, obtenerPorProducto, crearElemento, actualizarElemento, eliminarElemento).
 */
