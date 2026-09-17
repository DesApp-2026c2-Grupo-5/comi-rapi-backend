/**
 * Service: estados_pedido
 *
 * Lógica de transición de estados de pedido (espejo del frontend src/services/estadosPedido.js).
 *
 * Flujo permitido:
 *   pendiente          → confirmado (vía pago/confirmación, no admin)
 *   confirmado         → en_preparacion | cancelado
 *   en_preparacion     → listo_para_entregar | cancelado
 *   listo_para_entregar→ en_camino | cancelado
 *   en_camino          → entregado | cancelado
 *   entregado          → (estado final)
 *   cancelado          → (estado final)
 */

export const ESTADOS_PEDIDO = {
  PENDIENTE: 'pendiente',
  CONFIRMADO: 'confirmado',
  EN_PREPARACION: 'en_preparacion',
  LISTO_PARA_ENTREGAR: 'listo_para_entregar',
  EN_CAMINO: 'en_camino',
  ENTREGADO: 'entregado',
  CANCELADO: 'cancelado',
};

const transiciones = {
  [ESTADOS_PEDIDO.PENDIENTE]: [ESTADOS_PEDIDO.CONFIRMADO],
  [ESTADOS_PEDIDO.CONFIRMADO]: [
    ESTADOS_PEDIDO.EN_PREPARACION,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.EN_PREPARACION]: [
    ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR]: [
    ESTADOS_PEDIDO.EN_CAMINO,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.EN_CAMINO]: [
    ESTADOS_PEDIDO.ENTREGADO,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.ENTREGADO]: [],
  [ESTADOS_PEDIDO.CANCELADO]: [],
};

export const ESTADOS_PENDIENTES = [
  ESTADOS_PEDIDO.PENDIENTE,
  ESTADOS_PEDIDO.CONFIRMADO,
  ESTADOS_PEDIDO.EN_PREPARACION,
];

export function puedeTransicionar(estadoActual, nuevoEstado) {
  return transiciones[estadoActual]?.includes(nuevoEstado) || false;
}

export function obtenerEstadosSiguientes(estadoActual) {
  return transiciones[estadoActual] || [];
}

export function esEstadoValido(estado) {
  return Object.values(ESTADOS_PEDIDO).includes(estado);
}
