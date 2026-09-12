/**
 * Controller: direccion_controller
 *
 * CRUD de direcciones de entrega de los clientes (baja lógica).
 *
 * Funciones esperadas:
 *   - index(req, res):   GET /api/direcciones
 *       - Para CLIENTE: solo sus direcciones ACTIVAS.
 *       - Para ADMIN: puede listar todas (query ?clienteId=).
 *       - Respuesta: { success: true, data: [...] }.
 *
 *   - show(req, res):    GET /api/direcciones/:id
 *       - Devuelve una dirección (validando propiedad si es CLIENTE).
 *
 *   - create(req, res):  POST /api/direcciones  (CLIENTE)
 *       - Body: { nombre, direccion, ciudad?, codigoPostal?, referencia?, esPrincipal? }
 *       - Regla: si es la única activa del cliente → pasa a ser principal automáticamente.
 *       - Si esPrincipal = true → desmarca las demás del cliente.
 *       - Respuesta: 201 { success: true, data: direccion }.
 *
 *   - update(req, res):  PUT /api/direcciones/:id  (CLIENTE)
 *       - Actualiza campos; si esPrincipal = true desmarca las demás.
 *
 *   - marcarPrincipal(req, res): PATCH /api/direcciones/:id/principal  (CLIENTE)
 *       - Marca la dirección como principal y desmarca el resto del mismo cliente.
 *       - Respuesta: { success: true, data: direccion }.
 *
 *   - destroy(req, res): DELETE /api/direcciones/:id  (CLIENTE)
 *       - Baja lógica: estado = 'inactivo'. Respuesta { success: true }.
 *
 * Regla espejo del frontend: DireccionContext.jsx (agregarDireccion, editarDireccion,
 * seleccionarDireccionPrincipal, eliminarDireccion).
 */
