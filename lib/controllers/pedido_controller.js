/**
 * Controller: pedido_controller
 *
 * Creación y consulta de pedidos, más transiciones de estado.
 *
 * Funciones esperadas:
 *   - create(req, res):  POST /api/pedidos   (CLIENTE)
 *       - Body: { productos: [{ productoId?, nombre, cantidad, precio, personalizacion? }],
 *                sucursalId, direccionEntrega?, total? }
 *       - Reglas de negocio:
 *           * El total se calcula en el backend (o se valida el enviado).
 *           * Asignación de sucursal óptima si no viene sucursalId
 *             (ver services/asignacion_sucursal.js).
 *           * Se crean Pedido + LineasPedido + HistorialEstadoPedido inicial ('pendiente')
 *             dentro de una transacción.
 *       - Respuesta: 201 { success: true, data: pedido }.
 *
 *   - index(req, res):   GET /api/pedidos
 *       - Para ADMIN: todos los pedidos con sucursal, cliente e historial (opcional ?sucursalId=).
 *       - Para CLIENTE: solo los pedidos del usuario logueado (req.usuario.id).
 *
 *   - show(req, res):    GET /api/pedidos/:id
 *       - Devuelve un pedido con productos, sucursal, cliente e historialEstados.
 *       - CLIENTE solo puede ver sus propios pedidos.
 *
 *   - cambiarEstado(req, res):  PATCH /api/pedidos/:id/estado   (ADMIN o flujo confirmación)
 *       - Body: { estado }
 *       - Valida la transición contra services/estados_pedido.js
 *         (pendiente → confirmado → en_preparacion → listo_para_entregar → en_camino → entregado, o cancelado).
 *       - Registra el nuevo estado en HistorialEstadoPedido.
 *       - Respuesta: { success: true, data: pedido actualizado }.
 */
