/**
 * Controller: producto_controller
 *
 * CRUD de productos (el catálogo público es lectura; la gestión es admin).
 *
 * Funciones esperadas:
 *   - index(req, res):       GET /api/productos
 *       - Lista todos los productos ACTIVOS (borrado lógico), con su categoria incluida.
 *       - Respuesta: { success: true, data: [{ id, nombre, precio, categoria, imagen, descripcion }] }
 *       - Nota: el frontend usa 'categoria' como string/nombre (frontend seedData.js).
 *
 *   - show(req, res):        GET /api/productos/:id
 *       - Devuelve un producto por id (activo o no), 404 si no existe.
 *
 *   - create(req, res):      POST /api/productos   (ADMIN)
 *       - Body: { nombre, precio, imagen?, descripcion?, categoriaId | categoria }
 *       - Acepta 'categoria' como nombre (string) resolviéndolo contra el modelo Categoria.
 *       - Respuesta: 201 { success: true, data: producto }.
 *
 *   - update(req, res):      PUT /api/productos/:id   (ADMIN)
 *       - Body: campos parciales a actualizar.
 *       - Respuesta: { success: true, data: producto actualizado }.
 *
 *   - destroy(req, res):     DELETE /api/productos/:id   (ADMIN)
 *       - Borrado LÓGICO: marca activo = false.
 *       - Respuesta: { success: true }.
 */
