/**
 * Service: estados_pedido
 *
 * Lógica de transición de estados de pedido (espejo del frontend src/services/estadosPedido.js).
 *
 * Flujo permitido:
 *   pendiente          → confirmado (vía pago/confirmación) | cancelado
 *   confirmado         → en_preparacion | cancelado
 *   en_preparacion     → listo_para_entregar
 *   listo_para_entregar→ en_camino
 *   en_camino          → entregado
 *   entregado          → (estado final)
 *   cancelado          → (estado final)
 *
 * Regla: un pedido solo puede cancelarse ANTES de iniciar la preparación
 * (estados pendiente y confirmado). Una vez que comenzó a prepararse, no se cancela.
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
  [ESTADOS_PEDIDO.PENDIENTE]: [
    ESTADOS_PEDIDO.CONFIRMADO,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.CONFIRMADO]: [
    ESTADOS_PEDIDO.EN_PREPARACION,
    ESTADOS_PEDIDO.CANCELADO,
  ],
  [ESTADOS_PEDIDO.EN_PREPARACION]: [ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR],
  [ESTADOS_PEDIDO.LISTO_PARA_ENTREGAR]: [ESTADOS_PEDIDO.EN_CAMINO],
  [ESTADOS_PEDIDO.EN_CAMINO]: [ESTADOS_PEDIDO.ENTREGADO],
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

/**
 * Autorización por rol para cambios de estado (plan-estados-pedido.md).
 * Primero valida la transición con `puedeTransicionar`; luego aplica la matriz:
 * - pendiente → confirmado: solo CLIENTE dueño (pago simulado).
 * - * → cancelado: CLIENTE dueño o ADMINISTRADOR.
 * - confirmado → en_preparacion → listo_para_entregar → en_camino → entregado:
 *   solo ADMINISTRADOR (en_camino → entregado es el fallback que simula al repartidor).
 */
export function puedeTransicionarConRol(
  estadoActual,
  nuevoEstado,
  rol,
  esDueño = false
) {
  if (!puedeTransicionar(estadoActual, nuevoEstado)) return false;
  if (
    estadoActual === ESTADOS_PEDIDO.PENDIENTE &&
    nuevoEstado === ESTADOS_PEDIDO.CONFIRMADO
  ) {
    return rol === 'CLIENTE' && esDueño;
  }
  if (nuevoEstado === ESTADOS_PEDIDO.CANCELADO) {
    return (rol === 'CLIENTE' && esDueño) || rol === 'ADMINISTRADOR';
  }
  return rol === 'ADMINISTRADOR';
}
