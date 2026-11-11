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
import {
  EVENTOS,
  ROOM_ADMINS,
  roomPedido,
  roomSucursal,
  roomUsuario,
} from './eventos';
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

/**
 * Notifica cambio en el catálogo (productos, categorías, promociones).
 * Payload mínimo: { tipo, id, accion }.
 * Broadcast a todos los conectados (público/usuarios logueados según auth, pero handshake ya limita).
 * Emisión post-commit.
 */
export const emitirCatalogoActualizado = (payload = {}) => {
  if (!io) return;
  // Agregar timestamp para comparación de versiones en el frontend
  const payloadConVersion = {
    ...payload,
    updatedAt: payload.data?.updatedAt || new Date().toISOString(),
  };
  console.log(
    '[DIAG BACKEND] emitirCatalogoActualizado',
    JSON.stringify(payloadConVersion)
  );
  io.emit(EVENTOS.CATALOGO_ACTUALIZADO, payloadConVersion);
};

/**
 * Notifica cambio en parámetros de negocio.
 * Payload mínimo: {}.
 * Broadcast. Emisión post-commit.
 */
export const emitirParametrosActualizados = (payload = {}) => {
  if (!io) return;
  io.emit(EVENTOS.PARAMETROS_ACTUALIZADOS, payload);
};

/**
 * Notifica un cambio en sucursales (alta, edición o baja lógica).
 * Broadcast a todos los conectados: la lista de sucursales activas es pública
 * y la usan clientes e invitados. El payload trae el elemento afectado
 * (`{ tipo, id, accion, data }`) para que el frontend actualice la caché sin
 * pedir la lista completa por REST.
 */
export const emitirSucursalActualizada = (payload = {}) => {
  if (!io) return;
  io.emit(EVENTOS.SUCURSAL_ACTUALIZADO, payload);
};

/**
 * Notifica cambio de stock en una sucursal.
 * Exclusivo a roomSucursal(sucursalId). Nunca a room global de admins.
 * Payload: { sucursalId, productoIds?, insumoIds? } con sólo los IDs cuyas
 * cantidades/disponibilidad cambiaron.
 */
export const emitirStockActualizado = (sucursalId, payload = {}) => {
  if (!io || !sucursalId) return;
  const destino = io.to(roomSucursal(sucursalId));
  destino.emit(EVENTOS.STOCK_ACTUALIZADO, { sucursalId, ...payload });
};

/**
 * Notifica que cambió el estado operativo de una sucursal (abrió o cerró).
 *
 * Es un broadcast: el catálogo re-evalúa el banner de "todas cerradas" y la
 * pantalla de pago re-consulta la disponibilidad del pedido. No lleva datos
 * obligatorios porque, igual que el resto del canal, la verdad se lee por REST.
 *
 * @param {object} [payload] - { sucursalId?, abierta?, ahora }.
 */
export const emitirSucursalEstado = (payload = {}) => {
  if (!io) return;
  io.emit(EVENTOS.SUCURSAL_ESTADO, payload);
};

/**
 * Notifica que se creó o cambió una queja (reclamo).
 *
 * Va a `admins` (SUPERADMINISTRADOR), a la room de la sucursal del pedido y a
 * la room del pedido. Las dos primeras alcanzan al negocio; la tercera es la que
 * hace que el CLIENTE dueño vea la respuesta del local sin recargar (la abre
 * `PedidoContext` al suscribirse al detalle). El payload es mínimo: el hilo y el
 * estado se leen por REST, que es la fuente de verdad.
 *
 * @param {number} quejaId - Queja creada o modificada.
 * @param {number} [sucursalId] - Sucursal del pedido reclamado.
 * @param {number} [pedidoId] - Pedido reclamado (room del cliente).
 */
export const emitirQuejaActualizada = (quejaId, sucursalId, pedidoId) => {
  if (!io || !quejaId) return;
  let destino = io.to(ROOM_ADMINS);
  if (sucursalId) destino = destino.to(roomSucursal(sucursalId));
  if (pedidoId) destino = destino.to(roomPedido(pedidoId));
  destino.emit(EVENTOS.QUEJA_ACTUALIZADA, { quejaId, pedidoId, sucursalId });
};

/**
 * Avisa a un usuario que su centro de notificaciones tiene una fila nueva.
 *
 * Es exclusivo de la room privada `usuario:{id}`: nadie más lo recibe. El
 * evento no reemplaza al listado por REST, sólo adelanta el refresco del badge
 * y del drawer.
 *
 * @param {number} usuarioId - Destinatario.
 * @param {{ notificacionId?: number, tipo?: string }} [payload]
 */
export const emitirNotificacionCreada = (usuarioId, payload = {}) => {
  if (!io || !usuarioId) return;
  io.to(roomUsuario(usuarioId)).emit(EVENTOS.NOTIFICACION_CREADA, payload);
};

/**
 * Notifica cambio en personalización por producto (elemento).
 * Broadcast global: la lista es pública (clientes/invitados la usan).
 * Payload: { tipo: 'personalizacion', id, accion, data }.
 * @param {object} payload - { id, accion: 'creado'|'actualizado'|'eliminado', data }
 */
export const emitirPersonalizacionActualizada = (payload = {}) => {
  if (!io) return;
  const payloadConVersion = {
    ...payload,
    tipo: 'personalizacion',
    updatedAt: payload.data?.updatedAt || new Date().toISOString(),
  };
  console.log(
    '[DIAG BACKEND] emitirPersonalizacionActualizada',
    JSON.stringify(payloadConVersion)
  );
  io.emit(EVENTOS.PERSONALIZACION_ACTUALIZADO, payloadConVersion);
};

/**
 * Notifica cambio en plantilla de personalización por categoría.
 * Broadcast global.
 * Payload: { tipo: 'personalizacion_categoria', id, accion, data }.
 * @param {object} payload - { id, accion: 'creado'|'actualizado'|'eliminado', data }
 */
export const emitirPersonalizacionCategoriaActualizada = (payload = {}) => {
  if (!io) return;
  const payloadConVersion = {
    ...payload,
    tipo: 'personalizacion_categoria',
    updatedAt: payload.data?.updatedAt || new Date().toISOString(),
  };
  console.log(
    '[DIAG BACKEND] emitirPersonalizacionCategoriaActualizada',
    JSON.stringify(payloadConVersion)
  );
  io.emit(EVENTOS.PERSONALIZACION_CATEGORIA_ACTUALIZADA, payloadConVersion);
};

/**
 * Notifica cambios de stock agrupando filas por sucursal.
 *
 * Recibe una lista de filas con forma `{ sucursalId, productoId?, insumoId?,
 * ingredienteId? }` (las que devuelven `descontarStockDePedido`,
 * `reponerStock`, `sincronizarCantidadDeProductos`,
 * `sincronizarCantidadDeCombos`, etc.) y emite un único `stock_actualizado`
 * por sucursal, con los ids deduplicados.
 *
 * Es la única forma recomendada de avisar desde los controllers: así los
 * payloads quedan completos (incluyen ingredientes y combos afectados) y no se
 * emite más de una vez por sucursal.
 *
 * @param {Array<{sucursalId, productoId?, insumoId?, ingredienteId?}>} filas
 */
export const emitirCambiosDeStock = (filas = []) => {
  if (!io || !Array.isArray(filas) || filas.length === 0) return;
  const porSucursal = new Map();
  for (const fila of filas) {
    const sucursalId = Number(fila?.sucursalId);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) continue;
    if (!porSucursal.has(sucursalId)) {
      porSucursal.set(sucursalId, {
        productoIds: new Set(),
        insumoIds: new Set(),
        ingredienteIds: new Set(),
      });
    }
    const acc = porSucursal.get(sucursalId);
    if (fila.productoId) acc.productoIds.add(Number(fila.productoId));
    if (fila.insumoId) acc.insumoIds.add(Number(fila.insumoId));
    if (fila.ingredienteId) acc.ingredienteIds.add(Number(fila.ingredienteId));
  }
  for (const [sucursalId, acc] of porSucursal) {
    const payload = { sucursalId };
    if (acc.productoIds.size > 0) {
      payload.productoIds = [...acc.productoIds];
    }
    if (acc.insumoIds.size > 0) {
      payload.insumoIds = [...acc.insumoIds];
    }
    if (acc.ingredienteIds.size > 0) {
      payload.ingredienteIds = [...acc.ingredienteIds];
    }
    emitirStockActualizado(sucursalId, payload);
  }
};

/** Cierra el canal de tiempo real y libera la instancia (tests). */
export const cerrarSocketIO = () => {
  if (!io) return Promise.resolve();
  const instancia = io;
  io = null;
  return new Promise((resolve) => instancia.close(resolve));
};

export { EVENTOS, ROOM_ADMINS, roomPedido, roomSucursal, roomUsuario };
