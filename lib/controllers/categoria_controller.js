/**
 * Controller: categoria_controller
 *
 * CRUD de categorías de productos (lectura pública + gestión admin para el sprint).
 *
 * Funciones esperadas:
 *   - index(req, res):   GET /api/categorias
 *       - Devuelve todas las categorías: { success: true, data: [...] }.
 *       - Cada categoría: { id, nombre, descripcion }.
 *
 *   - show(req, res):    GET /api/categorias/:id
 *       - Devuelve una categoría por id, 404 si no existe.
 *
 *   - create(req, res):  POST /api/categorias   (ADMIN)
 *       - Body: { nombre, descripcion? }
 *       - Validar que 'nombre' no esté duplicado (unique) → 400 'Ya existe esa categoría'.
 *       - Respuesta: 201 { success: true, data: categoria }.
 *
 *   - update(req, res):  PUT /api/categorias/:id   (ADMIN)
 *       - Actualiza { nombre?, descripcion? } validando duplicado de nombre (excluyendo el propio id).
 *       - Respuesta: { success: true, data: categoria actualizada }.
 *
 *   - destroy(req, res): DELETE /api/categorias/:id   (ADMIN)
 *       - Respuesta { success: true }.
 *       - Precauciones:
 *           * Si tiene Productos asociados, decidir entre: rechazar el borrado
 *             (400 'La categoría tiene productos asociados') o borrado en cascada según
 *             regla del producto (categoriaId cascade).
 *       - Nota: en el frontend los productos guardan 'categoria' como nombre, por lo que
 *         renombrar/eliminar una categoría exige sincronizar los productos afectados.
 *
 * Referencia frontend: src/api/categorias.js (por ahora solo obtenerCategorias;
 * el panel admin de categorías del sprint agregará crear/editar/eliminar).
 */
