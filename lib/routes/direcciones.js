/**
 * Rutas de direcciones de clientes.
 *
 * Endpoints:
 *   GET    /api/direcciones               → direccion_controller.index
 *   GET    /api/direcciones/:id           → direccion_controller.show
 *   POST   /api/direcciones               → direccion_controller.create (CLIENTE)
 *   PUT    /api/direcciones/:id           → direccion_controller.update (CLIENTE)
 *   PATCH  /api/direcciones/:id/principal → direccion_controller.marcarPrincipal (CLIENTE)
 *   DELETE /api/direcciones/:id           → direccion_controller.destroy (CLIENTE)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/context/DireccionContext.jsx
 *   (cargarDirecciones, agregarDireccion, editarDireccion, eliminarDireccion, seleccionarDireccionPrincipal).
 */
