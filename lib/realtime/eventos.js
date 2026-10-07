/**
 * Constantes del canal de tiempo real.
 *
 * El WebSocket es SOLO un sistema de notificaciones: avisa que algo cambió y
 * manda el mínimo indispensable (el `pedidoId`). Los datos se siguen
 * obteniendo por REST, que es la fuente de verdad junto con PostgreSQL.
 */

/** Room donde entran los administradores autenticados. */
export const ROOM_ADMINS = 'admins';

/** Nombres de evento, compartidos con el frontend. */
export const EVENTOS = {
  /** Cliente → pide entrar a la room de un pedido. Payload: { pedidoId }. */
  SUSCRIBIR_PEDIDO: 'suscribir_pedido',
  /** Cliente → deja de escuchar un pedido. Payload: { pedidoId }. */
  DESUSCRIBIR_PEDIDO: 'desuscribir_pedido',
  /** Backend → room `pedido:{id}` + `admins` + `sucursal:{id}`. Payload: { pedidoId }. */
  PEDIDO_ACTUALIZADO: 'pedido_actualizado',
};

/**
 * Nombre de la room privada de un pedido.
 * @param {number|string} pedidoId - Identificador del pedido.
 * @returns {string} Room `pedido:{id}`.
 */
export const roomPedido = (pedidoId) => `pedido:${pedidoId}`;

/**
 * Nombre de la room de una sucursal. Entran los ADMINISTRADORES asignados a
 * ella, de modo que cada local reciba sólo los pedidos de su sucursal.
 * @param {number|string} sucursalId - Identificador de la sucursal.
 * @returns {string} Room `sucursal:{id}`.
 */
export const roomSucursal = (sucursalId) => `sucursal:${sucursalId}`;
