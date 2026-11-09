import db from '../models';
import { emitirNotificacionCreada } from '../realtime';

const { Notificacion, Pedido } = db;

const LIMITE_DEFAULT = 20;
const LIMITE_MAX = 50;

/** Tipos válidos: mismo ENUM que la tabla y el modelo. */
export const TIPOS = ['PEDIDO', 'QUEJA', 'SISTEMA'];

/**
 * Error de negocio del centro de notificaciones. El controller traduce
 * `codigo` al status HTTP: 400 validación, 404 no existe / fuera de alcance.
 */
export class NotificacionError extends Error {
  constructor(mensaje, codigo = 400) {
    super(mensaje);
    this.name = 'NotificacionError';
    this.codigo = codigo;
  }
}

const serializar = (notificacion) => {
  const json = notificacion.toJSON ? notificacion.toJSON() : notificacion;
  return {
    id: json.id,
    tipo: json.tipo,
    titulo: json.titulo,
    mensaje: json.mensaje,
    pedidoId: json.pedidoId,
    quejaId: json.quejaId,
    leida: Boolean(json.leida),
    leidaEn: json.leidaEn,
    creadaEn: json.createdAt,
  };
};

/**
 * Textos del aviso que recibe el cliente por cada estado del pedido. Viven acá
 * y no en el controller para que cambiar el mensaje no exija tocar la
 * transición de estados.
 */
const MENSAJES_ESTADO = {
  confirmado: {
    titulo: 'Pedido confirmado',
    mensaje: 'Recibimos tu pago y el pedido ya entró en la cocina.',
  },
  en_preparacion: {
    titulo: 'Tu pedido está en preparación',
    mensaje: 'La sucursal está preparando tu pedido.',
  },
  listo_para_entregar: {
    titulo: 'Tu pedido está listo',
    mensaje: 'El pedido está listo y espera salir a entrega.',
  },
  en_camino: {
    titulo: 'Tu pedido está en camino',
    mensaje: 'El pedido salió de la sucursal y va hacia tu dirección.',
  },
  entregado: {
    titulo: 'Pedido entregado',
    mensaje: 'Tu pedido fue entregado. ¡Que lo disfrutes!',
  },
  cancelado: {
    titulo: 'Pedido cancelado',
    mensaje: 'El pedido fue cancelado.',
  },
};

/**
 * Crea el aviso de un pedido para su dueño. Pensado para ejecutarse DENTRO de
 * la transacción que cambia el estado: si la transacción falla, la
 * notificación tampoco queda.
 *
 * @param {{ id: number, usuarioId: number }} pedido
 * @param {string} estado - Nombre del estado nuevo (`confirmado`, ...).
 * @param {{ transaction?: object, mensaje?: string, titulo?: string }} [opciones]
 * @returns {Promise<object|null>} Fila creada, o null si el estado no tiene texto.
 */
export const notificarEstadoPedido = async (
  pedido,
  estado,
  { transaction, mensaje, titulo } = {}
) => {
  const base = MENSAJES_ESTADO[estado];
  if (!base && !titulo) return null;
  return Notificacion.create(
    {
      usuarioId: pedido.usuarioId,
      tipo: 'PEDIDO',
      titulo: titulo || base.titulo,
      mensaje: mensaje || base.mensaje,
      pedidoId: pedido.id,
    },
    { transaction }
  );
};

/**
 * Crea el aviso de un reclamo para el cliente dueño. Se usa cuando el negocio
 * responde o cambia el estado del reclamo: las acciones del propio cliente no
 * se auto-notifican.
 *
 * @param {object} queja - Fila de Queja (con `pedidoId` y `usuarioId`).
 * @param {{ titulo: string, mensaje?: string, transaction?: object }} datos
 */
export const notificarQueja = async (queja, { titulo, mensaje, transaction }) =>
  Notificacion.create(
    {
      usuarioId: queja.usuarioId,
      tipo: 'QUEJA',
      titulo,
      mensaje: mensaje || null,
      quejaId: queja.id,
      pedidoId: queja.pedidoId,
    },
    { transaction }
  );

/**
 * Emite por socket la notificación recién creada. Se llama SIEMPRE después del
 * commit (o de la escritura, cuando no hay transacción): el evento sólo avisa
 * que hay algo nuevo y el cliente re-consulta el listado por REST.
 *
 * @param {object|null} notificacion - Fila creada (o null, no hace nada).
 */
export const avisarNotificacion = (notificacion) => {
  if (!notificacion) return;
  emitirNotificacionCreada(notificacion.usuarioId, {
    notificacionId: notificacion.id,
    tipo: notificacion.tipo,
  });
};

/**
 * Listado paginado del usuario autenticado.
 *
 * @param {number} usuarioId
 * @param {{ tipo?: string, soloNoLeidas?: boolean|string, pagina?: number|string,
 *   limite?: number|string }} [opciones]
 * @returns {Promise<{ items: object[], total: number, noLeidas: number,
 *   pagina: number, limite: number, paginas: number }>}
 */
export const listarNotificaciones = async (
  usuarioId,
  { tipo, soloNoLeidas, pagina = 1, limite = LIMITE_DEFAULT } = {}
) => {
  const paginaNum = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(
    LIMITE_MAX,
    Math.max(1, Number.parseInt(limite, 10) || LIMITE_DEFAULT)
  );

  const where = { usuarioId };
  if (tipo) {
    const tipoNum = String(tipo).trim().toUpperCase();
    if (!TIPOS.includes(tipoNum)) {
      throw new NotificacionError(
        `El tipo debe ser uno de: ${TIPOS.join(', ')}`
      );
    }
    where.tipo = tipoNum;
  }
  // El frontend manda `1`/`true` para ver sólo las pendientes.
  if (
    soloNoLeidas === true ||
    soloNoLeidas === '1' ||
    soloNoLeidas === 'true'
  ) {
    where.leida = false;
  }

  const { count, rows } = await Notificacion.findAndCountAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limiteNum,
    offset: (paginaNum - 1) * limiteNum,
  });

  const noLeidas = await Notificacion.count({
    where: { usuarioId, leida: false },
  });

  return {
    items: rows.map(serializar),
    total: count,
    noLeidas,
    pagina: paginaNum,
    limite: limiteNum,
    paginas: Math.ceil(count / limiteNum),
  };
};

/**
 * Cuenta las notificaciones no leídas del usuario. Es lo que alimenta el badge
 * del header y por eso se mantiene barato (índice `usuarioId + leida`).
 *
 * @param {number} usuarioId
 * @returns {Promise<number>}
 */
export const contarNoLeidas = (usuarioId) =>
  Notificacion.count({ where: { usuarioId, leida: false } });

/**
 * Marca una notificación como leída. La busqueda incluye `usuarioId` para que
 * nadie pueda tocar avisos ajenos (se responde 404 y no se filtra que exista).
 *
 * @param {number|string} id
 * @param {number} usuarioId
 * @returns {Promise<object>} Fila serializada.
 */
export const marcarLeida = async (id, usuarioId) => {
  const notificacion = await Notificacion.findOne({
    where: { id, usuarioId },
  });
  if (!notificacion) {
    throw new NotificacionError('Notificación no encontrada', 404);
  }
  if (!notificacion.leida) {
    await notificacion.update({ leida: true, leidaEn: new Date() });
  }
  return serializar(notificacion);
};

/**
 * Marca todas las pendientes del usuario. Devuelve cuántas cambiaron para que
 * el frontend pueda refrescar el badge sin otra llamada.
 *
 * @param {number} usuarioId
 * @returns {Promise<{ actualizadas: number }>}
 */
export const marcarTodasLeidas = async (usuarioId) => {
  const [actualizadas] = await Notificacion.update(
    { leida: true, leidaEn: new Date() },
    { where: { usuarioId, leida: false } }
  );
  return { actualizadas };
};

/**
 * Resuelve el dueño de un pedido para notificarlo desde otros puntos del
 * sistema (por ejemplo, una cancelación automática). Devuelve null si el
 * pedido no existe.
 *
 * @param {number|string} pedidoId
 */
export const usuarioDePedido = async (pedidoId) => {
  const pedido = await Pedido.findByPk(pedidoId, {
    attributes: ['id', 'usuarioId'],
  });
  return pedido ? pedido.usuarioId : null;
};
