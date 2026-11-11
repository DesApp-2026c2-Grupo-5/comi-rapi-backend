import { Op } from 'sequelize';
import db from '../models';
import { emitirQuejaActualizada } from '../realtime';
import { avisarNotificacion, notificarQueja } from './notificaciones';

const { EstadoPedido, Pedido, Queja, QuejaMensaje, Sucursal, Usuario } = db;

/** Único estado que habilita un reclamo: el pedido ya se recibió. */
export const ESTADO_RECLAMABLE = 'entregado';

export const MOTIVOS = [
  'PEDIDO_INCOMPLETO',
  'PRODUCTO_EN_MAL_ESTADO',
  'DEMORA_EN_LA_ENTREGA',
  'ERROR_DE_COBRO',
  'OTRO',
];

export const ESTADOS = [
  'PENDIENTE',
  'EN_REVISION',
  'RESUELTA',
  'RECHAZADA',
  'CERRADA',
];

/** Estados finales: no se reabren ni admiten más mensajes. */
const ESTADOS_FINALES = ['RESUELTA', 'RECHAZADA', 'CERRADA'];

/** Título del aviso que recibe el cliente cuando el negocio mueve el estado. */
const TITULOS_AVISO_ESTADO = {
  EN_REVISION: 'Tu reclamo está en revisión',
  RESUELTA: 'Tu reclamo fue resuelto',
  RECHAZADA: 'Tu reclamo fue rechazado',
};

/** Transiciones válidas desde cada estado. */
const TRANSICIONES = {
  PENDIENTE: ['EN_REVISION', 'RESUELTA', 'RECHAZADA'],
  EN_REVISION: ['RESUELTA', 'RECHAZADA'],
  RESUELTA: [],
  RECHAZADA: [],
  CERRADA: [],
};

const DETALLE_MIN = 10;
const DETALLE_MAX = 1000;
const RESPUESTA_MAX = 1000;
const LIMITE_DEFAULT = 10;
const LIMITE_MAX = 50;
/** Tope de respuestas del cliente para que el hilo no sea infinito. */
export const MAX_MENSAJES_CLIENTE = 5;

/**
 * Error de negocio de quejas. El controller traduce `codigo` al status HTTP:
 * 400 validación, 403 pedido no entregado, 404 no existe / fuera de alcance,
 * 409 ya existe una queja.
 */
export class QuejaError extends Error {
  constructor(mensaje, codigo = 400) {
    super(mensaje);
    this.name = 'QuejaError';
    this.codigo = codigo;
  }
}

const validarMotivo = (motivo) => {
  const valor = String(motivo || '')
    .trim()
    .toUpperCase();
  if (!MOTIVOS.includes(valor)) {
    throw new QuejaError(`El motivo debe ser uno de: ${MOTIVOS.join(', ')}`);
  }
  return valor;
};

const normalizarDetalle = (detalle) => {
  const texto = String(detalle || '').trim();
  if (texto.length < DETALLE_MIN) {
    throw new QuejaError(
      `El detalle debe tener al menos ${DETALLE_MIN} caracteres`
    );
  }
  if (texto.length > DETALLE_MAX) {
    throw new QuejaError(
      `El detalle no puede superar los ${DETALLE_MAX} caracteres`
    );
  }
  return texto;
};

const normalizarRespuesta = (respuesta) => {
  if (respuesta === undefined || respuesta === null) return null;
  const texto = String(respuesta).trim();
  if (!texto) return null;
  if (texto.length > RESPUESTA_MAX) {
    throw new QuejaError(
      `La respuesta no puede superar los ${RESPUESTA_MAX} caracteres`
    );
  }
  return texto;
};

const normalizarMensaje = (contenido) => {
  if (contenido === undefined || contenido === null) return null;
  const texto = String(contenido).trim();
  if (!texto) return null;
  if (texto.length > RESPUESTA_MAX) {
    throw new QuejaError(
      `El mensaje no puede superar los ${RESPUESTA_MAX} caracteres`
    );
  }
  return texto;
};

const validarEstado = (estado) => {
  const valor = String(estado || '')
    .trim()
    .toUpperCase();
  if (!ESTADOS.includes(valor)) {
    throw new QuejaError(`El estado debe ser uno de: ${ESTADOS.join(', ')}`);
  }
  return valor;
};

const serializarMensaje = (mensaje, queja) => ({
  id: mensaje.id,
  contenido: mensaje.contenido,
  autorId: mensaje.autorId,
  delCliente: mensaje.autorId === queja.usuarioId,
  creadaEn: mensaje.createdAt,
  autor: mensaje.autor
    ? {
        id: mensaje.autor.id,
        nombre: mensaje.autor.nombre,
        apellido: mensaje.autor.apellido,
      }
    : null,
});

const serializarQueja = (queja) => {
  const mensajes = (queja.mensajes || [])
    .map((mensaje) => serializarMensaje(mensaje, queja))
    .sort((a, b) => new Date(a.creadaEn) - new Date(b.creadaEn));

  return {
    id: queja.id,
    pedidoId: queja.pedidoId,
    motivo: queja.motivo,
    detalle: queja.detalle,
    estado: queja.estado,
    respuesta: queja.respuesta,
    respondidaEn: queja.respondidaEn,
    cerradaEn: queja.cerradaEn,
    creadaEn: queja.createdAt,
    actualizadaEn: queja.updatedAt,
    mensajes,
    respuestasCliente: mensajes.filter((mensaje) => mensaje.delCliente).length,
    maxRespuestasCliente: MAX_MENSAJES_CLIENTE,
    pedido: queja.pedido
      ? {
          id: queja.pedido.id,
          fechaHora: queja.pedido.fechaHora,
          total: queja.pedido.total,
        }
      : null,
  };
};

const serializarQuejaBandeja = (queja) => ({
  ...serializarQueja(queja),
  pedido: queja.pedido
    ? {
        ...serializarQueja(queja).pedido,
        sucursalId: queja.pedido.sucursalId,
        sucursal: queja.pedido.Sucursal
          ? {
              id: queja.pedido.Sucursal.id,
              nombre: queja.pedido.Sucursal.nombre,
            }
          : null,
      }
    : null,
  cliente: queja.autor
    ? {
        id: queja.autor.id,
        nombre: queja.autor.nombre,
        apellido: queja.autor.apellido,
        email: queja.autor.email,
      }
    : null,
  respondidoPor: queja.respondidoPor
    ? {
        id: queja.respondidoPor.id,
        nombre: queja.respondidoPor.nombre,
        apellido: queja.respondidoPor.apellido,
      }
    : null,
});

const incluirMensajes = {
  model: QuejaMensaje,
  as: 'mensajes',
  separate: true,
  order: [
    ['createdAt', 'ASC'],
    ['id', 'ASC'],
  ],
  attributes: ['id', 'contenido', 'autorId', 'createdAt'],
  include: [
    { model: Usuario, as: 'autor', attributes: ['id', 'nombre', 'apellido'] },
  ],
};

const incluirPedido = {
  model: Pedido,
  as: 'pedido',
  required: true,
  attributes: ['id', 'fechaHora', 'total', 'sucursalId'],
  include: [{ model: Sucursal, attributes: ['id', 'nombre'] }],
};

const buscarConPedido = async (id) =>
  Queja.findByPk(id, {
    include: [
      incluirPedido,
      incluirMensajes,
      {
        model: Usuario,
        as: 'autor',
        attributes: ['id', 'nombre', 'apellido', 'email'],
      },
      {
        model: Usuario,
        as: 'respondidoPor',
        attributes: ['id', 'nombre', 'apellido'],
      },
    ],
  });

/**
 * Verifica que el pedido exista, sea del cliente y esté entregado.
 *
 * @returns {Promise<object>} Pedido reclamable.
 */
const pedidoReclamable = async (usuarioId, pedidoId) => {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new QuejaError('El pedido es obligatorio');
  }

  const pedido = await Pedido.findByPk(id, {
    attributes: ['id', 'usuarioId', 'sucursalId'],
    include: [
      {
        model: EstadoPedido,
        as: 'estadoActual',
        required: true,
        attributes: ['nombre'],
      },
    ],
  });

  // Un pedido ajeno responde 404: no se filtra que exista.
  if (!pedido || pedido.usuarioId !== usuarioId) {
    throw new QuejaError('Pedido no encontrado', 404);
  }
  if (pedido.estadoActual.nombre !== ESTADO_RECLAMABLE) {
    throw new QuejaError('Solo podés reclamar sobre pedidos entregados', 403);
  }
  return pedido;
};

/**
 * Crea el reclamo de un pedido propio entregado.
 *
 * @param {{ usuarioId: number, pedidoId: number|string,
 *   motivo: string, detalle: string }} datos
 */
export const crearQueja = async ({ usuarioId, pedidoId, motivo, detalle }) => {
  const motivoValido = validarMotivo(motivo);
  const detalleValido = normalizarDetalle(detalle);

  const pedido = await pedidoReclamable(usuarioId, pedidoId);

  const existente = await Queja.findOne({
    where: { pedidoId: pedido.id },
    attributes: ['id'],
  });
  if (existente) {
    throw new QuejaError('Ese pedido ya tiene un reclamo', 409);
  }

  try {
    const queja = await Queja.create({
      usuarioId,
      pedidoId: pedido.id,
      motivo: motivoValido,
      detalle: detalleValido,
      estado: 'PENDIENTE',
    });
    // Post-commit: el admin de la sucursal y el superadmin actualizan el badge
    // de reclamos pendientes. El emisor no hace nada si no hay Socket.IO.
    emitirQuejaActualizada(queja.id, pedido.sucursalId, pedido.id);
    return serializarQueja(await buscarConPedido(queja.id));
  } catch (error) {
    // Dos pestañas pueden competir por el mismo pedido: el UNIQUE de la base
    // es la última palabra, no el chequeo previo.
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new QuejaError('Ese pedido ya tiene un reclamo', 409);
    }
    throw error;
  }
};

/**
 * Quejas del cliente, opcionalmente acotadas a un pedido.
 *
 * @param {number} usuarioId
 * @param {{ pedidoId?: number|string }} opciones
 */
export const misQuejas = async (usuarioId, { pedidoId } = {}) => {
  const where = { usuarioId };
  if (pedidoId !== undefined && pedidoId !== null && pedidoId !== '') {
    const id = Number(pedidoId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new QuejaError('El pedido indicado no es válido');
    }
    where.pedidoId = id;
  }

  const filas = await Queja.findAll({
    where,
    include: [incluirPedido, incluirMensajes],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  return filas.map(serializarQueja);
};

/**
 * Bandeja paginada. El ADMINISTRADOR queda acotado a su sucursal; el
 * SUPERADMINISTRADOR ve todo y puede filtrar con `sucursalId`.
 *
 * @param {{ rol: string, sucursalId?: number, estado?: string, q?: string,
 *   sucursalIdFiltro?: number|string, pagina?: number|string,
 *   limite?: number|string }} opciones
 */
export const listarQuejas = async ({
  rol,
  sucursalId,
  estado,
  q,
  sucursalIdFiltro,
  pagina = 1,
  limite = LIMITE_DEFAULT,
} = {}) => {
  const paginaNum = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(
    LIMITE_MAX,
    Math.max(1, Number.parseInt(limite, 10) || LIMITE_DEFAULT)
  );

  const where = {};
  if (estado !== undefined && estado !== null && estado !== '') {
    where.estado = validarEstado(estado);
  }

  // Alcance por sucursal: siempre sale de la sesión, nunca del query string,
  // salvo que un SUPERADMINISTRADOR filtre explícitamente.
  let sucursalAcotada = null;
  if (rol === 'ADMINISTRADOR') {
    sucursalAcotada = sucursalId || null;
  } else if (
    sucursalIdFiltro !== undefined &&
    sucursalIdFiltro !== null &&
    sucursalIdFiltro !== ''
  ) {
    const id = Number(sucursalIdFiltro);
    if (!Number.isInteger(id) || id <= 0) {
      throw new QuejaError('La sucursal indicada no es válida');
    }
    sucursalAcotada = id;
  }

  const wherePedido = {};
  if (sucursalAcotada) wherePedido.sucursalId = sucursalAcotada;

  const texto = String(q || '').trim();
  if (texto) {
    const condiciones = [];
    if (/^\d+$/.test(texto)) {
      condiciones.push({ pedidoId: Number(texto) });
    }
    const clientes = await Usuario.findAll({
      where: {
        [Op.or]: [
          { nombre: { [Op.iLike]: `%${texto}%` } },
          { apellido: { [Op.iLike]: `%${texto}%` } },
          { email: { [Op.iLike]: `%${texto}%` } },
        ],
      },
      attributes: ['id'],
      raw: true,
    });
    if (clientes.length) {
      condiciones.push({ usuarioId: { [Op.in]: clientes.map((c) => c.id) } });
    }
    if (!condiciones.length) {
      return {
        items: [],
        total: 0,
        pagina: paginaNum,
        limite: limiteNum,
        paginas: 0,
      };
    }
    where[Op.or] = condiciones;
  }

  const { count, rows } = await Queja.findAndCountAll({
    where,
    include: [
      {
        ...incluirPedido,
        where: wherePedido,
        include: [{ model: Sucursal, attributes: ['id', 'nombre'] }],
      },
      incluirMensajes,
      {
        model: Usuario,
        as: 'autor',
        attributes: ['id', 'nombre', 'apellido', 'email'],
      },
      {
        model: Usuario,
        as: 'respondidoPor',
        attributes: ['id', 'nombre', 'apellido'],
      },
    ],
    // La bandeja es un chat: la conversación con actividad más reciente va
    // arriba, no la que se creó última. `responderQueja` toca `updatedAt`
    // también cuando el cliente responde sin cambiar de estado.
    order: [
      ['updatedAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limiteNum,
    offset: (paginaNum - 1) * limiteNum,
    distinct: true,
  });

  return {
    items: rows.map(serializarQuejaBandeja),
    total: count,
    pagina: paginaNum,
    limite: limiteNum,
    paginas: Math.ceil(count / limiteNum),
  };
};

/**
 * Responde o cambia el estado de una queja. Una queja fuera del alcance del
 * ADMINISTRADOR responde 404 (no se filtra que exista).
 *
 * `estado` es opcional: sin estado se suma un mensaje al hilo sin mover la
 * máquina de estados. Es lo que usa la bandeja tipo chat para que el negocio
 * pueda seguir la conversación sin resolver o rechazar en cada mensaje.
 *
 * @param {number|string} id
 * @param {{ rol: string, sucursalId?: number, respondidoPorId: number,
 *   estado?: string, respuesta?: string }} datos
 */
export const actualizarQueja = async (
  id,
  { rol, sucursalId, respondidoPorId, estado, respuesta }
) => {
  const queja = await Queja.findByPk(id, {
    include: [incluirPedido],
  });
  if (!queja) throw new QuejaError('Queja no encontrada', 404);

  if (rol === 'ADMINISTRADOR' && queja.pedido.sucursalId !== sucursalId) {
    throw new QuejaError('Queja no encontrada', 404);
  }

  const estadoActual = queja.estado;
  if (ESTADOS_FINALES.includes(estadoActual)) {
    throw new QuejaError(
      'La queja ya está resuelta o cerrada y no admite más mensajes del negocio'
    );
  }

  const textoRespuesta = normalizarRespuesta(respuesta);
  const sinCambioDeEstado =
    estado === undefined || estado === null || String(estado).trim() === '';

  // Mensaje suelto: actualiza la última respuesta y el hilo, pero deja el
  // estado como está. El cliente sigue viendo el reclamo abierto.
  if (sinCambioDeEstado) {
    if (!textoRespuesta) {
      throw new QuejaError('El mensaje es obligatorio');
    }

    await QuejaMensaje.create({
      quejaId: queja.id,
      autorId: respondidoPorId,
      contenido: textoRespuesta,
    });
    await queja.update({
      respuesta: textoRespuesta,
      respondidoPorId,
      respondidaEn: new Date(),
    });

    // El centro del cliente suma un aviso por cada mensaje del negocio. El
    // emisor de socket va después de escribir: el evento sólo avisa que hay
    // algo nuevo, el hilo se lee por REST.
    const notificacion = await notificarQueja(queja, {
      titulo: 'Nuevo mensaje en tu reclamo',
      mensaje: textoRespuesta,
    });
    emitirQuejaActualizada(queja.id, queja.pedido.sucursalId, queja.pedidoId);
    avisarNotificacion(notificacion);
    return serializarQuejaBandeja(await buscarConPedido(queja.id));
  }

  const estadoNuevo = validarEstado(estado);
  if (estadoNuevo === estadoActual) {
    throw new QuejaError(`La queja ya está en estado ${estadoActual}`);
  }
  if (!TRANSICIONES[estadoActual].includes(estadoNuevo)) {
    throw new QuejaError(
      `No se puede pasar de ${estadoActual} a ${estadoNuevo}`
    );
  }

  const cierra = ESTADOS_FINALES.includes(estadoNuevo);
  if (cierra && !textoRespuesta) {
    throw new QuejaError(
      'La respuesta es obligatoria para resolver o rechazar la queja'
    );
  }

  const cambios = { estado: estadoNuevo };
  if (textoRespuesta) {
    cambios.respuesta = textoRespuesta;
    cambios.respondidoPorId = respondidoPorId;
    cambios.respondidaEn = new Date();
  }

  await queja.update(cambios);
  if (textoRespuesta) {
    await QuejaMensaje.create({
      quejaId: queja.id,
      autorId: respondidoPorId,
      contenido: textoRespuesta,
    });
  }
  // El badge de reclamos pendientes de la sucursal y del superadmin se
  // reconsulta por REST: resolver o rechazar descuenta del contador.
  const notificacion = await notificarQueja(queja, {
    titulo: TITULOS_AVISO_ESTADO[estadoNuevo] || 'Actualización de tu reclamo',
    mensaje: textoRespuesta || null,
  });
  emitirQuejaActualizada(queja.id, queja.pedido.sucursalId, queja.pedidoId);
  avisarNotificacion(notificacion);
  return serializarQuejaBandeja(await buscarConPedido(queja.id));
};

/**
 * Respuesta del cliente en el hilo. Solo se admite mientras la queja siga
 * abierta: al resolverla o rechazarla, el negocio cierra la conversación.
 *
 * @param {number|string} id
 * @param {{ usuarioId: number, contenido: string }} datos
 */
export const responderQueja = async (id, { usuarioId, contenido }) => {
  const texto = normalizarMensaje(contenido);
  if (!texto) {
    throw new QuejaError('El mensaje es obligatorio');
  }

  const queja = await Queja.findByPk(id, { include: [incluirPedido] });
  if (!queja || queja.usuarioId !== usuarioId) {
    throw new QuejaError('Queja no encontrada', 404);
  }
  if (ESTADOS_FINALES.includes(queja.estado)) {
    throw new QuejaError(
      queja.estado === 'CERRADA'
        ? 'La queja está cerrada y no admite respuestas'
        : 'La queja ya está resuelta o rechazada y no admite más respuestas del cliente',
      409
    );
  }

  const respuestas = await QuejaMensaje.count({
    where: { quejaId: queja.id, autorId: queja.usuarioId },
  });
  if (respuestas >= MAX_MENSAJES_CLIENTE) {
    throw new QuejaError(
      `Alcanzaste el máximo de ${MAX_MENSAJES_CLIENTE} respuestas; podés cerrar el reclamo`,
      409
    );
  }

  await QuejaMensaje.create({
    quejaId: queja.id,
    autorId: usuarioId,
    contenido: texto,
  });
  // La bandeja ordena por última actividad. La queja sigue PENDIENTE o
  // EN_REVISION (los estados finales ya se rechazaron arriba), así que no hay
  // cambio de estado que mueva `updatedAt`: se toca explícitamente para que la
  // conversación suba.
  queja.updatedAt = new Date();
  // `updatedAt` es un atributo autogenerado: asignarlo no lo marca como
  // cambiado, así que se fuerza para que el UPDATE realmente se ejecute.
  queja.changed('updatedAt', true);
  await queja.save({ fields: ['updatedAt'] });

  emitirQuejaActualizada(queja.id, queja.pedido.sucursalId, queja.pedidoId);
  return serializarQueja(await buscarConPedido(queja.id));
};

/**
 * Cierre del reclamo por el cliente. Es final.
 *
 * @param {number|string} id
 * @param {{ usuarioId: number }} datos
 */
export const cerrarQueja = async (id, { usuarioId }) => {
  const queja = await Queja.findByPk(id, { include: [incluirPedido] });
  if (!queja || queja.usuarioId !== usuarioId) {
    throw new QuejaError('Queja no encontrada', 404);
  }
  if (queja.estado === 'CERRADA') {
    throw new QuejaError('La queja ya está cerrada', 409);
  }

  await queja.update({ estado: 'CERRADA', cerradaEn: new Date() });
  emitirQuejaActualizada(queja.id, queja.pedido.sucursalId, queja.pedidoId);
  return serializarQueja(await buscarConPedido(queja.id));
};
