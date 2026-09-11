/**
 * Service: estados_pedido
 *
 * Lógica de transición de estados de pedido (espejo del frontend src/services/estadosPedido.js).
 *
 * Flujo permitido:
 *   pendiente          → (el pago/backend lo pasa a confirmado)
 *   confirmado         → en_preparacion | cancelado
 *   en_preparacion     → listo_para_entregar | cancelado
 *   listo_para_entregar→ en_camino | cancelado
 *   en_camino          → entregado | cancelado
 *   entregado          → (estado final)
 *   cancelado          → (estado final)
 *
 * Funciones esperadas:
 *   - puedeTransicionar(estadoActual, nuevoEstado) → boolean
 *   - obtenerEstadosSiguientes(estadoActual) → ['...', ...]
 *
 * Valores de estado (frontend src/utils/constants.js → ESTADOS_PEDIDO):
 *   pendiente, confirmado, en_preparacion, listo_para_entregar, en_camino, entregado, cancelado
 */
