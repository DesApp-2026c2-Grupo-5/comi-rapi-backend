/**
 * Punto único de entrada del canal de tiempo real.
 *
 * El WebSocket NO reemplaza a la API REST: solo notifica que un pedido cambió
 * y manda únicamente el `pedidoId`. Los datos se siguen leyendo por REST, que
 * junto con PostgreSQL es la fuente de verdad.
 *
 * Los emisores son seguros de usar cuando no hay servidor escuchando (por
 * ejemplo en los tests de controllers), en cuyo caso no hacen nada.
 */
import { Server } from 'socket.io';
import config from '../config/config';
import { configurarConexion } from './conexion';
import { EVENTOS, ROOM_ADMINS, roomPedido, roomSucursal } from './eventos';
/** @type {import('socket.io').Server|null} */
let io = null;

/**
 * Adjunta Socket.IO al servidor HTTP. Idempotente: si ya está inicializado,
 * devuelve la instancia existente.
 *
 * @param {import('http').Server} server - Servidor HTTP de Express.
 * @returns {import('socket.io').Server} Instancia de Socket.IO.
 */
export const configurarSocketIO = (server) => {
  if (io) return io;
  io = new Server(server, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
  });
  return configurarConexion(io);
};

/** @returns {import('socket.io').Server|null} Instancia activa, o null. */
export const obtenerIO = () => io;

/**
 * Notifica que un pedido cambió de estado (o de medio de pago).
 * Se llama solo después de que la transacción en PostgreSQL haya commiteado.
 *
 * Va a la room del pedido (el cliente dueño), a `admins` (SUPERADMINISTRADOR) y
 * a la room de la sucursal del pedido, para que sólo los administradores de ese
 * local reciban el aviso.
 *
 * No existe un evento "pedido creado": todo pedido nace `pendiente` y el
 * panel de administración no muestra los pendientes, así que avisar al crearse
 * no le aportaría nada. El admin se entera cuando el pedido pasa a
 * `confirmado`, que es justo cuando entra en su lista.
 *
 * @param {number} pedidoId - Pedido modificado.
 * @param {number} [sucursalId] - Sucursal del pedido (room del local).
 */
export const emitirPedidoActualizado = (pedidoId, sucursalId) => {
  if (!io || !pedidoId) return;
  // `to()` no muta el operador: devuelve uno nuevo, así que hay que encadenar o
  // reasignar. La unión de rooms evita entregar el evento dos veces a un mismo
  // socket que esté en más de una (p. ej. un admin suscrito a un pedido).
  let destino = io.to(ROOM_ADMINS).to(roomPedido(pedidoId));
  if (sucursalId) destino = destino.to(roomSucursal(sucursalId));
  destino.emit(EVENTOS.PEDIDO_ACTUALIZADO, { pedidoId });
};

/** Cierra el canal de tiempo real y libera la instancia (tests). */
export const cerrarSocketIO = () => {
  if (!io) return Promise.resolve();
  const instancia = io;
  io = null;
  return new Promise((resolve) => instancia.close(resolve));
};

export { EVENTOS, ROOM_ADMINS, roomPedido, roomSucursal };
