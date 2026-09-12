/**
 * Rutas de pedidos.
 *
 * Endpoints:
 *   POST   /api/pedidos               → pedido_controller.create  (CLIENTE)
 *   GET    /api/pedidos               → pedido_controller.index   (CLIENTE: propios; ADMIN: todos)
 *   GET    /api/pedidos/:id           → pedido_controller.show
 *   PATCH  /api/pedidos/:id/estado    → pedido_controller.cambiarEstado (ADMIN / confirmación)
 *
 * Respuesta: { success: true, data: ... } | { success: false, error }
 *
 * Ver frontend: src/api/pedidos.js (crearPedido, obtenerPedidos, obtenerPedidoPorId, confirmarPedido).
 * Nota: 'confirmarPedido' del frontend equivale a transicionar a estado 'confirmado'.
 */
