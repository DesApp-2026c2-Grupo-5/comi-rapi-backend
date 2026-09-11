/**
 * Controller: personalizacion_controller
 *
 * CRUD de elementos de personalización por producto (gestión admin).
 *
 * Funciones esperadas:
 *   - index(req, res):   GET /api/personalizacion
 *       - Query opcional: ?productoId= → filtra elementos de un producto.
 *       - Respuesta: { success: true, data: [...] }.
 *
 *   - show(req, res):    GET /api/personalizacion/:id
 *       - Devuelve un elemento por id, 404 si no existe.
 *
 *   - create(req, res):  POST /api/personalizacion   (ADMIN)
 *       - Body: { productoId, tipo, nombre?, precio?, productoReferenciaId?, activo? }
 *       - Validaciones (espejo del frontend src/api/personalizacion.js):
 *           * No duplicar productoId + tipo + (nombre o productoReferenciaId)
 *             → 400 'Ya existe un elemento igual para este producto y categoría'.
 *           * Si tipo === 'acompanar', productoReferenciaId no puede ser igual a productoId.
 *           * tipo 'extra'/'acompanar' → precio requerido; 'personalizar'/'condimento' → precio null.
 *       - Respuesta: 201 { success: true, data: elemento }.
 *
 *   - update(req, res):  PUT /api/personalizacion/:id   (ADMIN)
 *       - Mismas validaciones que create evitando el propio id.
 *
 *   - destroy(req, res): DELETE /api/personalizacion/:id   (ADMIN)
 *       - Borrado real o lógico (marca activo = false). Respuesta { success: true }.
 */
