/**
 * Rutas de sucursales.
 *
 * Endpoints:
 *   GET    /api/sucursales        → sucursal_controller.index   (público)
 *   GET    /api/sucursales/:id    → sucursal_controller.show    (público)
 *   POST   /api/sucursales        → sucursal_controller.create  (ADMIN)
 *   PUT    /api/sucursales/:id    → sucursal_controller.update  (ADMIN)
 *   DELETE /api/sucursales/:id    → sucursal_controller.destroy (ADMIN)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/sucursales.js.
 * Rutas de escritura protegidas con verificarToken + permitirRoles(ROLES.ADMIN).
 */
