/**
 * Rutas de productos.
 *
 * Endpoints:
 *   GET    /api/productos        → producto_controller.index   (público)
 *   GET    /api/productos/:id    → producto_controller.show    (público)
 *   POST   /api/productos        → producto_controller.create  (ADMIN)
 *   PUT    /api/productos/:id    → producto_controller.update  (ADMIN)
 *   DELETE /api/productos/:id    → producto_controller.destroy (ADMIN)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/productos.js (obtenerProductos, crearProducto, etc.).
 * Rutas de escritura protegidas con verificarToken + permitirRoles(ROLES.ADMIN).
 */
