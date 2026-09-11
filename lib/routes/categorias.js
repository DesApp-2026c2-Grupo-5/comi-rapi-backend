/**
 * Rutas de categorías de productos.
 *
 * Endpoints:
 *   GET    /api/categorias        → categoria_controller.index   (público)
 *   GET    /api/categorias/:id    → categoria_controller.show    (público)
 *   POST   /api/categorias        → categoria_controller.create  (ADMIN)
 *   PUT    /api/categorias/:id    → categoria_controller.update  (ADMIN)
 *   DELETE /api/categorias/:id    → categoria_controller.destroy (ADMIN)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/categorias.js (obtenerCategorias; el admin del sprint
 * agregará crear/editar/eliminar).
 * Rutas de escritura protegidas con verificarToken + permitirRoles(ROLES.ADMIN).
 */
