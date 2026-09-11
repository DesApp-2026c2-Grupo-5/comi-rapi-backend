/**
 * Controller: sucursal_controller
 *
 * CRUD de sucursales (lectura pública + gestión admin).
 *
 * Funciones esperadas:
 *   - index(req, res):   GET /api/sucursales
 *       - Lista todas las sucursales (o solo activas según query ?activas=true).
 *       - Respuesta: { success: true, data: [{ id, nombre, direccion, lat, lng, horario, telefono, estado }] }
 *
 *   - show(req, res):    GET /api/sucursales/:id
 *       - Devuelve una sucursal por id, 404 si no existe.
 *
 *   - create(req, res):  POST /api/sucursales   (ADMIN)
 *       - Body: { nombre, direccion, lat?, lng?, horario?, telefono?, estado? }
 *       - Valida lat entre -90/90 y lng entre -180/180 (LÍMITES del frontend).
 *       - Respuesta: 201 { success: true, data: sucursal }.
 *
 *   - update(req, res):  PUT /api/sucursales/:id   (ADMIN)
 *       - Actualiza campos parciales.
 *
 *   - destroy(req, res): DELETE /api/sucursales/:id   (ADMIN)
 *       - Borrado lógico: estado = 'inactivo'. Respuesta { success: true }.
 */
