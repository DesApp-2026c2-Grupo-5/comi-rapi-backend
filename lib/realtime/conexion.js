/**
 * Conexiones de Socket.IO: autenticación por sesión y control de acceso a las
 * rooms.
 *
 * El canal reutiliza la sesión server-side que ya usa la API REST (cookie
 * HttpOnly `comirapi.sid`, store en PostgreSQL). No hay JWT: el handshake
 * viaja con la misma cookie que el resto de las peticiones.
 *
 * Reglas de acceso:
 *   - Sin sesión válida el handshake se rechaza: no se entra a ninguna room.
 *   - Los ADMINISTRADORES entran automáticamente a la room `admins`.
 *   - Un pedido concreto solo se escucha si se pide explícitamente Y el backend
 *     confirma que el usuario es el dueño del pedido o un administrador. La
 *     autorización nunca se delega al cliente.
 */
import db from '../models';
import { resolverUsuarioDeSesion } from '../middlewares/auth';
import sessionMiddleware from '../middlewares/session';
import { EVENTOS, ROOM_ADMINS, roomPedido } from './eventos';

/**
 * Verifica si `usuario` puede recibir los cambios del pedido `pedidoId`.
 * Aplica la misma regla que `GET /api/pedidos/:id`: los administradores ven
 * cualquier pedido, el cliente solo los propios.
 *
 * @param {object} usuario - Datos públicos del usuario autenticado.
 * @param {number|string} pedidoId - Identificador del pedido.
 * @returns {Promise<{ok: boolean, error?: string}>} Resultado de la autorización.
 */
const autorizarPedido = async (usuario, pedidoId) => {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: 'Pedido no encontrado' };
  }
  const pedido = await db.Pedido.findByPk(id, {
    attributes: ['id', 'usuarioId'],
  });
  if (!pedido) return { ok: false, error: 'Pedido no encontrado' };
  const esAdmin = usuario.rol === 'ADMINISTRADOR';
  if (!esAdmin && pedido.usuarioId !== usuario.id) {
    return { ok: false, error: 'Acceso denegado' };
  }
  return { ok: true };
};

const responder = (ack, payload) => {
  if (typeof ack === 'function') ack(payload);
};

/**
 * Registra middlewares y handlers de conexión en una instancia de Socket.IO.
 *
 * @param {import('socket.io').Server} io - Instancia ya creada.
 * @returns {import('socket.io').Server} La misma instancia, por comodidad.
 */
export const configurarConexion = (io) => {
  // La sesión se lee durante el handshake (Engine.IO), no como middleware de
  // Express: así `socket.request.session` queda disponible en la conexión.
  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    try {
      const usuario = await resolverUsuarioDeSesion(socket.request.session);
      if (!usuario) return next(new Error('No autorizado'));
      socket.data.usuario = usuario;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    const { usuario } = socket.data;

    if (usuario.rol === 'ADMINISTRADOR') {
      socket.join(ROOM_ADMINS);
    }

    socket.on(EVENTOS.SUSCRIBIR_PEDIDO, async (payload, ack) => {
      const pedidoId = payload && payload.pedidoId;
      try {
        const { ok, error } = await autorizarPedido(usuario, pedidoId);
        if (!ok) return responder(ack, { success: false, error });
        socket.join(roomPedido(Number(pedidoId)));
        return responder(ack, { success: true, pedidoId: Number(pedidoId) });
      } catch (e) {
        return responder(ack, { success: false, error: e.message });
      }
    });

    socket.on(EVENTOS.DESUSCRIBIR_PEDIDO, (payload, ack) => {
      const pedidoId = payload && payload.pedidoId;
      const id = Number(pedidoId);
      if (Number.isInteger(id) && id > 0) socket.leave(roomPedido(id));
      return responder(ack, { success: true, pedidoId: id });
    });
  });

  return io;
};
