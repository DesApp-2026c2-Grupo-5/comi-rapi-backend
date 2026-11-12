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
  /** Catálogo cambió: productos/categorías/promociones (soft-delete incluido). */
  CATALOGO_ACTUALIZADO: 'catalogo_actualizado',
  /** Parámetros de negocio cambiaron. */
  PARAMETROS_ACTUALIZADOS: 'parametros_actualizados',
  /** Stock cambió en una sucursal. Exclusivo a roomSucursal(id). */
  STOCK_ACTUALIZADO: 'stock_actualizado',
  /** Sucursal creada, editada o dada de baja. Broadcast con el elemento afectado. */
  SUCURSAL_ACTUALIZADO: 'sucursal_actualizado',
  /**
   * Cambió el estado operativo de una sucursal (abrió o cerró). Broadcast:
   * lo consume el catálogo (banner de cerradas) y la pantalla de pago (para
   * auto-cancelar si la sucursal del pedido cerró sin alternativa).
   * Payload: { sucursalId?, abierta?, ahora }.
   */
  SUCURSAL_ESTADO: 'sucursal_estado',
  /**
   * Se creó o cambió una queja (reclamo). Va a `admins` y a la room de la
   * sucursal del pedido. Payload: { quejaId, pedidoId, sucursalId }. El badge
   * del navbar reconsulta el total pendiente por REST.
   */
  QUEJA_ACTUALIZADA: 'queja_actualizada',
  /**
   * Se creó una notificación para un usuario (CLIENTE). Va exclusivamente a la
   * room privada `usuario:{id}`. Payload: { notificacionId, tipo }. El listado
   * y el contador se re-consultan por REST.
   */
  NOTIFICACION_CREADA: 'notificacion_creada',

  /**
   * Personalización por producto: elemento creado, actualizado o desactivado.
   * Broadcast global (la lista es pública). Payload: { tipo, id, accion, data }.
   */
  PERSONALIZACION_ACTUALIZADO: 'personalizacion_actualizado',

  /**
   * Plantilla de personalización por categoría: creada, actualizada o desactivada.
   * Broadcast global. Payload: { tipo, id, accion, data }.
   */
  PERSONALIZACION_CATEGORIA_ACTUALIZADA: 'personalizacion_categoria_actualizada',
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

/**
 * Nombre de la room privada de un usuario. Cada socket autenticado entra a la
 * de su propia sesión, así las notificaciones del centro no se filtran entre
 * cuentas.
 * @param {number|string} usuarioId - Identificador del usuario.
 * @returns {string} Room `usuario:{id}`.
 */
export const roomUsuario = (usuarioId) => `usuario:${usuarioId}`;
