/**
 * Service: cupon_emisiones
 *
 * Orquesta la creacion de emisiones de cupones personalizados:
 * 1. preview: calcula destinatarios elegibles sin persistir nada.
 * 2. emitir: crea CuponEmision, genera un cupón por cliente aprobado, envia
 *    emails y registra el resultado de cada envio.
 * 3. reenviar: reenvia solo cupones PENDIENTE/FALLIDO de una emision, sin
 *    generar codigos ni cupones nuevos.
 *
 * No mantiene el concepto de campaña. Cada emision es autocontenida y
 * conserva la configuracion, el alcance resuelto y los destinatarios
 * aprobados en `configuracionSnapshot`.
 */

import crypto from 'crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import db from '../models';
import {
  generarCodigosDisponibles,
  derivarEstadoCupon,
  contarUsosCupones,
} from './cupones';
import { enviarEmailCupon } from './email_service';
import { ESTADOS_PEDIDO } from './estados_pedido';

const {
  Cupon,
  CuponEmision,
  CuponPreviewToken,
  Usuario,
  Pedido,
  PedidoItem,
  PedidoCupon,
  EstadoPedido,
  Categoria,
  Producto,
} = db;

export const ESTADOS_EMISION = Object.freeze({
  EN_PROCESO: 'EN_PROCESO',
  COMPLETADA: 'COMPLETADA',
  CON_ERRORES: 'CON_ERRORES',
});

export const ESTADOS_ENVIO = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  ENVIADO: 'ENVIADO',
  FALLIDO: 'FALLIDO',
});

export const MOTIVOS_EMISION = Object.freeze({
  INVALIDO: 'emision_invalida',
  CONFLICTO_DESTINATARIOS: 'conflicto_destinatarios',
  SIN_PRODUCTOS_ALCANZADOS: 'sin_productos_alcanzados',
  USUARIO_NO_ELEGIBLE: 'usuario_no_elegible',
  BLOQUEO_PERDIDO: 'bloqueo_perdido',
});

export const ESTADO_PEDIDO_ENTREGADO = ESTADOS_PEDIDO.ENTREGADO;

/** Vigencia del lease mientras corre una emisión. */
export const DURACION_BLOQUEO_MS = 10 * 60 * 1000;
/** Cada cuántos envíos se renueva el lease. */
const RENOVAR_CADA = 25;
/** Guardia local contra reingresos concurrentes. */
const emisionesEnMemoria = new Set();

export class EmisionError extends Error {
  constructor(mensaje, codigo = 400, motivo = MOTIVOS_EMISION.INVALIDO) {
    super(mensaje);
    this.name = 'EmisionError';
    this.codigo = codigo;
    this.motivo = motivo;
  }
}

const nuevoToken = () => crypto.randomBytes(32).toString('hex');

/** Secreto para firmar los previewToken. En producción es obligatorio; fuera
 * de producción se permite una clave de desarrollo unicamente para tests y
 * entorno local, sin exponer secretos en codigo fuente. */
const NODE_ENV = process.env.NODE_ENV || 'development';
const esProduccion = NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (esProduccion && !SESSION_SECRET) {
  throw new Error('SESSION_SECRET es obligatorio en entorno de producción.');
}
const PREVIEW_TOKEN_SECRET =
  SESSION_SECRET || 'comi-rapi-preview-token-dev-key';

/** Vigencia del previewToken: 30 minutos. */
const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Firma un previewToken con HMAC-SHA256 vinculado a la configuracion y a los
 * destinatarios aprobados.
 * @param {object} payload - { configuracionHash, destinatariosIds, expiraEn }
 * @returns {string} Token en formato `${payloadBase64}.${firmaBase64}`
 */
const firmarPreviewToken = (payload) => {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const firma = crypto
    .createHmac('sha256', PREVIEW_TOKEN_SECRET)
    .update(payloadB64, 'utf8')
    .digest('base64url');
  return `${payloadB64}.${firma}`;
};

/**
 * Valida un previewToken y devuelve el payload si la firma es correcta y no
 * ha expirado.
 * @param {string} token
 * @returns {{valido: boolean, payload?: object, motivo?: string}}
 */
const validarPreviewToken = (token) => {
  if (!token || typeof token !== 'string') {
    return { valido: false, motivo: 'token_ausente' };
  }
  const partes = token.split('.');
  if (partes.length !== 2) {
    return { valido: false, motivo: 'token_mal_formado' };
  }
  const [payloadB64, firma] = partes;
  const firmaEsperada = crypto
    .createHmac('sha256', PREVIEW_TOKEN_SECRET)
    .update(payloadB64, 'utf8')
    .digest('base64url');
  if (firma !== firmaEsperada) {
    return { valido: false, motivo: 'firma_invalida' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valido: false, motivo: 'payload_invalido' };
  }
  if (!payload || !payload.expiraEn) {
    return { valido: false, motivo: 'payload_sin_expiracion' };
  }
  if (Date.now() > Number(payload.expiraEn)) {
    return { valido: false, motivo: 'token_vencido' };
  }
  return { valido: true, payload };
};

const aFecha = (valor) => {
  if (valor instanceof Date)
    return Number.isFinite(valor.getTime()) ? valor : null;
  if (valor == null || valor === '') return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Valida que un email tenga formato basico y no este vacio.
 * Nota: Usuario no tiene campo de email verificado; "valido" = no vacio +
 * sintacticamente aceptable + usuario activo con rol CLIENTE.
 */
const emailValido = (email) => {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim();
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
};

/**
 * Construye el snapshot de configuracion que se congela en la emision.
 * Incluye destinatariosIds y alcance resuelto.
 */
const construirSnapshotConfiguracion = ({
  nombre,
  descripcion,
  tipoDescuento,
  valorDescuento,
  compraMinima,
  descuentoMaximo,
  fechaInicio,
  fechaFin,
  usosPermitidos,
  periodoAnalisisDias,
  maxDestinatarios,
  destinatariosIds,
  categoriaIds,
  productoIds,
  productoIdsResueltos,
}) => ({
  nombre,
  descripcion,
  descuento: {
    tipo: tipoDescuento,
    valor: Number(valorDescuento),
    maximo:
      descuentoMaximo === null || descuentoMaximo === undefined
        ? null
        : Number(descuentoMaximo),
    compraMinima: Number(compraMinima) || 0,
  },
  fechaInicio,
  fechaFin,
  usosPermitidos: Math.max(1, Math.trunc(Number(usosPermitidos)) || 1),
  alcance: {
    categoriaIds: Array.from(new Set(categoriaIds || [])).map(Number),
    productoIds: Array.from(new Set(productoIds || [])).map(Number),
    productoIdsResueltos: Array.from(new Set(productoIdsResueltos || [])).map(
      Number
    ),
  },
  seleccion: {
    periodoAnalisisDias:
      periodoAnalisisDias !== null && periodoAnalisisDias !== undefined
        ? Number(periodoAnalisisDias)
        : null,
    estadoPedido: ESTADO_PEDIDO_ENTREGADO,
    criterio: 'unidades de productos alcanzados, descendente',
  },
  destinatariosIds: Array.from(new Set(destinatariosIds || [])).map(Number),
  maxDestinatarios:
    maxDestinatarios !== null && maxDestinatarios !== undefined
      ? Number(maxDestinatarios)
      : null,
  creadoEn: new Date().toISOString(),
});

/**
 * Valida y normaliza los datos de creacion de una emision.
 */
export const validarDatosEmision = (datos = {}) => {
  const nombre = String(datos.nombre || '').trim();
  if (!nombre) throw new EmisionError('El nombre es obligatorio', 400);

  const tipoDescuento = datos.tipoDescuento;
  if (!['PORCENTAJE', 'MONTO_FIJO'].includes(tipoDescuento)) {
    throw new EmisionError('Tipo de descuento invalido', 400);
  }

  const valorDescuento = Number(datos.valorDescuento);
  if (!Number.isFinite(valorDescuento) || valorDescuento < 0) {
    throw new EmisionError('Valor del descuento invalido', 400);
  }
  if (tipoDescuento === 'PORCENTAJE' && valorDescuento > 100) {
    throw new EmisionError('El descuento porcentual no puede superar 100', 400);
  }

  const compraMinima = Number(datos.compraMinima) || 0;
  const descuentoMaximo =
    datos.descuentoMaximo === null ||
    datos.descuentoMaximo === undefined ||
    datos.descuentoMaximo === ''
      ? null
      : Number(datos.descuentoMaximo);

  const momento = new Date();

  const fechaInicio = aFecha(datos.fechaInicio);
  if (!fechaInicio) throw new EmisionError('Fecha de inicio invalida', 400);
  if (fechaInicio.getTime() < momento.getTime()) {
    throw new EmisionError(
      'La fecha de inicio no puede ser anterior a la fecha actual',
      400
    );
  }
  const fechaFin = aFecha(datos.fechaFin);
  if (!fechaFin) throw new EmisionError('Fecha de fin invalida', 400);
  if (fechaFin.getTime() < momento.getTime()) {
    throw new EmisionError(
      'La fecha de fin no puede ser anterior a la fecha actual',
      400
    );
  }
  if (fechaFin.getTime() < fechaInicio.getTime()) {
    throw new EmisionError(
      'La fecha de fin no puede ser anterior a la de inicio',
      400
    );
  }

  const maxDestinatarios =
    datos.maxDestinatarios === null ||
    datos.maxDestinatarios === undefined ||
    datos.maxDestinatarios === ''
      ? null
      : Math.trunc(Number(datos.maxDestinatarios));
  if (maxDestinatarios !== null && maxDestinatarios < 1) {
    throw new EmisionError('maxDestinatarios debe ser mayor a 0', 400);
  }

  const periodoAnalisisDias =
    datos.periodoAnalisisDias === null ||
    datos.periodoAnalisisDias === undefined ||
    datos.periodoAnalisisDias === ''
      ? null
      : Math.trunc(Number(datos.periodoAnalisisDias));
  if (periodoAnalisisDias !== null && periodoAnalisisDias < 1) {
    throw new EmisionError('periodoAnalisisDias debe ser mayor a 0', 400);
  }

  const productoIds = Array.from(
    new Set((datos.productoIds || []).map(Number).filter(Number.isFinite))
  );
  const categoriaIds = Array.from(
    new Set((datos.categoriaIds || []).map(Number).filter(Number.isFinite))
  );
  if (productoIds.length === 0 && categoriaIds.length === 0) {
    throw new EmisionError(
      'Debe seleccionar al menos un producto o una categoria',
      400
    );
  }

  return {
    nombre,
    descripcion: datos.descripcion || null,
    tipoDescuento,
    valorDescuento,
    compraMinima,
    descuentoMaximo,
    fechaInicio,
    fechaFin,
    usosPermitidos: 1,
    periodoAnalisisDias,
    maxDestinatarios,
    productoIds,
    categoriaIds,
  };
};

/**
 * Calcula el alcance resuelto: productos de las categorias seleccionadas +
 * productos explicitos. Excluye combos (tipo='COMBO').
 * @returns {{productoIdsResueltos: number[], categoriaIds: number[], productoIds: number[]}}
 */
export const resolverAlcanceProductos = async ({
  productoIds = [],
  categoriaIds = [],
} = {}) => {
  const prodSet = new Set(productoIds.map(Number).filter(Number.isFinite));
  const catSet = new Set(categoriaIds.map(Number).filter(Number.isFinite));

  // Productos explícitos: solo los que existen y no son combos. Así un ID
  // inexistente o un combo enviado por API no se cuela en el alcance.
  let productosExplicitos = [];
  if (prodSet.size > 0) {
    const filas = await db.Producto.findAll({
      where: {
        id: { [Op.in]: Array.from(prodSet) },
        tipo: { [Op.ne]: 'COMBO' },
      },
      attributes: ['id'],
    });
    productosExplicitos = filas.map((f) => Number(f.id));
  }

  // Productos de las categorías seleccionadas.
  let productosCategoria = [];
  if (catSet.size > 0) {
    const filas = await db.Producto.findAll({
      where: {
        categoriaId: { [Op.in]: Array.from(catSet) },
        activo: true,
        tipo: { [Op.ne]: 'COMBO' },
      },
      attributes: ['id'],
    });
    productosCategoria = filas.map((f) => Number(f.id));
  }

  const resuelto = new Set([...productosExplicitos, ...productosCategoria]);
  return {
    productoIds: Array.from(prodSet),
    categoriaIds: Array.from(catSet),
    productoIdsResueltos: Array.from(resuelto).sort((a, b) => a - b),
  };
};

/**
 * Preview de destinatarios elegibles sin persistir nada.
 * Calcula unidades compradas de productos alcanzados en pedidos ENTREGADOS
 * dentro del periodo configurado. Orden descendente por unidades.
 *
 * @param {object} datos - configuracion de la emision (ya validada).
 * @param {{ahora?: Date|string}} opciones
 * @returns {{destinatarios: Array<{usuarioId,nombre,apellido,email,unidades,ultimaCompra}>,
 *   total: number, solicitados: number, truncado: boolean, alcance: {...}}}
 */
export const previewDestinatarios = async (
  datos,
  { ahora = new Date() } = {}
) => {
  const momento = aFecha(ahora) || new Date();
  const periodoDias = datos.periodoAnalisisDias;
  const desde = periodoDias
    ? new Date(momento.getTime() - periodoDias * DIA_MS)
    : null;

  const { productoIdsResueltos } = await resolverAlcanceProductos({
    productoIds: datos.productoIds,
    categoriaIds: datos.categoriaIds,
  });

  // Universo: clientes activos CLIENTE con email valido.
  const clientes = await Usuario.findAll({
    where: {
      rol: 'CLIENTE',
      activo: true,
    },
    attributes: ['id', 'nombre', 'apellido', 'email'],
  });

  const clientesValidos = clientes.filter((c) => emailValido(c.email));
  const clienteIds = clientesValidos.map((c) => c.id);
  if (clienteIds.length === 0 || productoIdsResueltos.length === 0) {
    return {
      destinatarios: [],
      total: 0,
      solicitados: datos.maxDestinatarios || 0,
      truncado: false,
      alcance: {
        productoIdsResueltos,
        categoriaIds: datos.categoriaIds,
        productoIds: datos.productoIds,
      },
    };
  }

  // Pedidos entregados del periodo.
  const wherePedido = {
    usuarioId: { [Op.in]: clienteIds },
    estadoId: await idEstadoEntregado(),
  };
  if (desde) wherePedido.fechaHora = { [Op.gte]: desde };

  const pedidos = await Pedido.findAll({
    where: wherePedido,
    attributes: ['id', 'usuarioId', 'fechaHora'],
  });

  // Lineas de esos pedidos con productos alcanzados.
  const pedidoIds = pedidos.map((p) => p.id);
  const lineas =
    pedidoIds.length > 0
      ? await PedidoItem.findAll({
          where: {
            pedidoId: { [Op.in]: pedidoIds },
            productoId: { [Op.in]: productoIdsResueltos },
          },
          attributes: ['pedidoId', 'productoId', 'cantidad'],
        })
      : [];

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const unidadesPorCliente = new Map();
  const ultimaCompraPorCliente = new Map();

  lineas.forEach((l) => {
    const pedido = pedidoPorId.get(Number(l.pedidoId));
    if (!pedido) return;
    const clienteId = Number(pedido.usuarioId);
    const prev = unidadesPorCliente.get(clienteId) || 0;
    unidadesPorCliente.set(clienteId, prev + Number(l.cantidad));
    const fecha = new Date(pedido.fechaHora);
    const prevUlt = ultimaCompraPorCliente.get(clienteId);
    if (!prevUlt || fecha > prevUlt)
      ultimaCompraPorCliente.set(clienteId, fecha);
  });

  const elegibles = clientesValidos
    .map((c) => {
      const unidades = unidadesPorCliente.get(Number(c.id)) || 0;
      if (unidades < 1) return null;
      return {
        usuarioId: c.id,
        nombre: c.nombre,
        apellido: c.apellido,
        email: c.email,
        unidades,
        ultimaCompra: ultimaCompraPorCliente.get(Number(c.id)) || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.unidades !== a.unidades) return b.unidades - a.unidades;
      const fa = a.ultimaCompra ? new Date(a.ultimaCompra).getTime() : 0;
      const fb = b.ultimaCompra ? new Date(b.ultimaCompra).getTime() : 0;
      if (fb !== fa) return fb - fa;
      return a.usuarioId - b.usuarioId;
    });

  // Sin clientes elegibles no se emite nada y tampoco se entrega un token:
  // la interfaz debe mostrar el aviso y permitir volver a la configuración.
  if (elegibles.length === 0) {
    return {
      destinatarios: [],
      total: 0,
      solicitados: datos.maxDestinatarios || 0,
      truncado: false,
      alcance: {
        productoIdsResueltos,
        categoriaIds: datos.categoriaIds,
        productoIds: datos.productoIds,
      },
    };
  }

  const max = datos.maxDestinatarios;
  const truncado = max != null && elegibles.length > max;
  const seleccionados = truncado ? elegibles.slice(0, max) : elegibles;

  const destinatariosIds = seleccionados
    .map((d) => d.usuarioId)
    .sort((a, b) => a - b);
  const expiraEn = Date.now() + PREVIEW_TOKEN_TTL_MS;
  const configuracionHash = crypto
    .createHmac('sha256', PREVIEW_TOKEN_SECRET)
    .update(
      JSON.stringify({
        tipoDescuento: datos.tipoDescuento,
        valorDescuento: datos.valorDescuento,
        compraMinima: datos.compraMinima,
        descuentoMaximo: datos.descuentoMaximo,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        periodoAnalisisDias: datos.periodoAnalisisDias,
        productoIds: datos.productoIds,
        categoriaIds: datos.categoriaIds,
        destinatariosIds,
      })
    )
    .digest('hex');
  const previewToken = firmarPreviewToken({
    configuracionHash,
    destinatariosIds,
    expiraEn,
  });

  return {
    destinatarios: seleccionados,
    total: elegibles.length,
    solicitados: max != null ? max : elegibles.length,
    truncado,
    previewToken,
    previewExpiraEn: new Date(expiraEn).toISOString(),
    creadoEn: new Date().toISOString(),
    alcance: {
      productoIdsResueltos,
      categoriaIds: datos.categoriaIds,
      productoIds: datos.productoIds,
    },
  };
};

const idEstadoEntregado = async () => {
  const estado = await EstadoPedido.findOne({
    where: { nombre: ESTADO_PEDIDO_ENTREGADO },
    attributes: ['id'],
  });
  if (!estado)
    throw new EmisionError('Estado de pedido ENTREGADO no configurado', 500);
  return Number(estado.id);
};

/**
 * Emite una emision de cupones.
 * Respeta exactamente los destinatarios aprobados (destinatariosIds):
 * no vuelve a ejecutar el ranking. Valida el previewToken (configuracion +
 * destinatariosIds + expiracion).
 *
 * @param {object} datos - { nombre, descripcion, tipoDescuento, valorDescuento,
 *   compraMinima, descuentoMaximo, fechaInicio, fechaFin, periodoAnalisisDias,
 *   maxDestinatarios, productoIds, categoriaIds, destinatariosIds,
 *   previewToken, previewExpiraEn, creadoEn }
 * @param {{usuarioId, ahora, enviarEmail}} opciones
 * @returns {{emision, cupones, enviados, fallidos}}
 */
export const emitir = async (
  datos,
  { usuarioId, ahora = new Date(), enviarEmail = enviarEmailCupon } = {}
) => {
  if (!usuarioId) {
    throw new EmisionError('Usuario requerido', 400, 'usuario_requerido');
  }

  const momento = aFecha(ahora) || new Date();

  // Validar previewToken: firma HMAC vinculada a la configuracion y a los
  // destinatarios aprobados, con vencimiento y proteccion contra reutilizacion.
  const {
    previewToken,
    previewExpiraEn,
    destinatariosIds: destinatariosIdsSolicitados,
  } = datos;
  if (!previewToken) {
    throw new EmisionError('previewToken requerido', 409, 'preview_requerido');
  }
  const validacionToken = validarPreviewToken(previewToken);
  if (!validacionToken.valido) {
    throw new EmisionError(
      `previewToken invalido: ${validacionToken.motivo}`,
      409,
      'preview_token_invalido'
    );
  }

  // Calcular hash SHA-256 del token para registro de un solo uso.
  const tokenHash = crypto
    .createHash('sha256')
    .update(previewToken, 'utf8')
    .digest('hex');

  // Verificar que el token no haya sido consumido ya (fuera de transaccion para fallar rapido).
  const tokenExistente = await CuponPreviewToken.findOne({
    where: { tokenHash },
    attributes: ['id', 'usado', 'expiraEn'],
  });
  if (tokenExistente) {
    if (tokenExistente.usado) {
      throw new EmisionError(
        'El previewToken ya fue consumido. Generá una nueva previsualización.',
        409,
        'preview_token_ya_usado'
      );
    }
    if (
      tokenExistente.expiraEn &&
      new Date(tokenExistente.expiraEn) < momento
    ) {
      throw new EmisionError(
        'El preview ha expirado. Generá una nueva previsualización.',
        409,
        'preview_expirado'
      );
    }
  }

  const expira = aFecha(previewExpiraEn);
  if (!expira || momento.getTime() > expira.getTime()) {
    throw new EmisionError(
      'El preview ha expirado. Generá una nueva previsualización.',
      409,
      'preview_expirado'
    );
  }

  // Recomputar el hash de configuracion con los datos recibidos y comparar
  // contra el payload del token para garantizar que no se alteró la configuración.
  const destinatariosIdsNormalizados = Array.from(
    new Set(
      (destinatariosIdsSolicitados || []).map(Number).filter(Number.isFinite)
    )
  ).sort((a, b) => a - b);
  const configuracionHashActual = crypto
    .createHmac('sha256', PREVIEW_TOKEN_SECRET)
    .update(
      JSON.stringify({
        tipoDescuento: datos.tipoDescuento,
        valorDescuento: datos.valorDescuento,
        compraMinima: datos.compraMinima,
        descuentoMaximo: datos.descuentoMaximo,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        periodoAnalisisDias: datos.periodoAnalisisDias,
        productoIds: datos.productoIds,
        categoriaIds: datos.categoriaIds,
        destinatariosIds: destinatariosIdsNormalizados,
      })
    )
    .digest('hex');
  if (configuracionHashActual !== validacionToken.payload.configuracionHash) {
    throw new EmisionError(
      'La configuracion de la emisión no coincide con la previsualización firmada. Generá un nuevo preview.',
      409,
      'configuracion_no_coincide'
    );
  }

  // Los destinatarios aprobados deben coincidir exactamente con los del token.
  const destinatariosIdsToken = Array.from(
    new Set(
      (validacionToken.payload.destinatariosIds || [])
        .map(Number)
        .filter(Number.isFinite)
    )
  );
  const idsSolicitadosSet = new Set(destinatariosIdsNormalizados);
  const idsTokenSet = new Set(destinatariosIdsToken);
  const idsDiferentes =
    idsSolicitadosSet.size !== idsTokenSet.size ||
    [...idsSolicitadosSet].some((id) => !idsTokenSet.has(id));
  if (idsDiferentes) {
    throw new EmisionError(
      'Los destinatarios aprobados no coinciden con la previsualización firmada. Generá un nuevo preview.',
      409,
      'destinatarios_no_coinciden'
    );
  }

  const destinatariosIds = destinatariosIdsNormalizados;

  // Recalcular alcance resuelto para congelar en la emision.
  const alcance = await resolverAlcanceProductos({
    productoIds: datos.productoIds,
    categoriaIds: datos.categoriaIds,
  });
  if (alcance.productoIdsResueltos.length === 0) {
    throw new EmisionError(
      'No hay productos alcanzados para esta configuración',
      400,
      'sin_productos_alcanzados'
    );
  }

  if (destinatariosIds.length === 0) {
    throw new EmisionError(
      'No hay destinatarios aprobados',
      400,
      'sin_destinatarios'
    );
  }

  // Validar que cada destinatario sea cliente activo con email valido.
  const destinatarios = await Usuario.findAll({
    where: { id: { [Op.in]: destinatariosIds }, rol: 'CLIENTE', activo: true },
    attributes: ['id', 'nombre', 'apellido', 'email'],
  });
  const destinatariosPorId = new Map(
    destinatarios.map((d) => [Number(d.id), d])
  );
  const invalidos = destinatariosIds.filter((id) => {
    const d = destinatariosPorId.get(id);
    return !d || !emailValido(d.email);
  });
  if (invalidos.length > 0) {
    throw new EmisionError(
      `Destinatarios no elegibles: ${invalidos.join(', ')}`,
      409,
      'usuario_no_elegible'
    );
  }

  const clave = `emision:${datos.nombre}`;
  if (emisionesEnMemoria.has(clave)) {
    throw new EmisionError(
      'Ya hay una emisión en proceso',
      409,
      'emision_en_proceso'
    );
  }
  emisionesEnMemoria.add(clave);

  try {
    const configuracionSnapshot = construirSnapshotConfiguracion({
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      tipoDescuento: datos.tipoDescuento,
      valorDescuento: datos.valorDescuento,
      compraMinima: datos.compraMinima,
      descuentoMaximo: datos.descuentoMaximo,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      usosPermitidos: 1,
      periodoAnalisisDias: datos.periodoAnalisisDias,
      maxDestinatarios: datos.maxDestinatarios,
      destinatariosIds,
      categoriaIds: datos.categoriaIds,
      productoIds: datos.productoIds,
      productoIdsResueltos: alcance.productoIdsResueltos,
    });

    const transaction = await db.sequelize.transaction();
    try {
      // Consumir el previewToken: marcarlo como usado dentro de la misma
      // transaccion que crea la emisión. Si la transaccion falla, el token
      // queda sin consumir y se puede reintentar con un nuevo preview.
      const expiraEn = new Date(momento.getTime() + PREVIEW_TOKEN_TTL_MS);
      try {
        if (tokenExistente) {
          await tokenExistente.update(
            { usado: true, usadoEn: momento },
            { transaction }
          );
        } else {
          await CuponPreviewToken.create(
            {
              tokenHash,
              usado: true,
              expiraEn,
              creadoEn: momento,
              usadoEn: momento,
            },
            { transaction }
          );
        }
      } catch (error) {
        // Dos confirmaciones concurrentes pueden intentar crear el mismo
        // previewToken. La restricción UNIQUE(tokenHash) hace que la segunda
        // falle con SequelizeUniqueConstraintError; se convierte en 409.
        if (error instanceof UniqueConstraintError) {
          await transaction.rollback();
          throw new EmisionError(
            'El previewToken ya fue consumido por otra emisión concurrente. Generá una nueva previsualización.',
            409,
            'preview_token_ya_usado'
          );
        }
        throw error;
      }

      const token = nuevoToken();
      const expiraBloqueo = new Date(momento.getTime() + DURACION_BLOQUEO_MS);

      const emision = await CuponEmision.create(
        {
          creadaPorUsuarioId: Number(usuarioId),
          nombre: datos.nombre,
          descripcion: datos.descripcion || null,
          tipoDescuento: datos.tipoDescuento,
          valorDescuento: Number(datos.valorDescuento),
          compraMinima: Number(datos.compraMinima) || 0,
          descuentoMaximo:
            datos.descuentoMaximo === null ||
            datos.descuentoMaximo === undefined
              ? null
              : Number(datos.descuentoMaximo),
          fechaInicio: datos.fechaInicio,
          fechaFin: datos.fechaFin,
          maxDestinatarios:
            datos.maxDestinatarios === null ||
            datos.maxDestinatarios === undefined
              ? null
              : Number(datos.maxDestinatarios),
          periodoAnalisisDias:
            datos.periodoAnalisisDias === null ||
            datos.periodoAnalisisDias === undefined
              ? null
              : Number(datos.periodoAnalisisDias),
          cantidadElegibles: destinatarios.length,
          cantidadCupones: 0,
          cantidadEnviados: 0,
          cantidadFallidos: 0,
          estado: ESTADOS_EMISION.EN_PROCESO,
          configuracionSnapshot,
          bloqueoToken: token,
          bloqueoExpiraEn: expiraBloqueo,
        },
        { transaction }
      );

      // Generar codigos unicos para cada destinatario.
      const codigos = await generarCodigosDisponibles(destinatarios.length, {
        transaction,
      });
      const filasCupon = destinatarios.map((dest, indice) => ({
        emisionId: emision.id,
        usuarioId: dest.id,
        codigo: codigos[indice],
        tipoDescuento: datos.tipoDescuento,
        valorDescuento: Number(datos.valorDescuento),
        compraMinima: Number(datos.compraMinima) || 0,
        descuentoMaximo:
          datos.descuentoMaximo === null || datos.descuentoMaximo === undefined
            ? null
            : Number(datos.descuentoMaximo),
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        usosPermitidos: 1,
        activo: true,
        estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
        alcanceSnapshot: {
          global: false,
          categoriaIds: datos.categoriaIds,
          productoIds: datos.productoIds,
          productoIdsResueltos: alcance.productoIdsResueltos,
        },
      }));
      const cuponesCreados = await Cupon.bulkCreate(filasCupon, {
        returning: true,
        transaction,
      });

      // Enviar emails.
      let enviados = 0;
      let fallidos = 0;
      const pares = cuponesCreados.map((cupon, i) => ({
        cupon,
        usuario: destinatarios[i],
      }));
      for (let i = 0; i < pares.length; i += 1) {
        if (i > 0 && i % RENOVAR_CADA === 0) {
          await renovarBloqueoEmision(emision.id, token, {
            duracionBloqueoMs: DURACION_BLOQUEO_MS,
          });
        }
        const { cupon, usuario } = pares[i];
        try {
          if (!usuario || !emailValido(usuario.email)) {
            throw new Error('El cliente no tiene email valido');
          }
          const resultado = await enviarEmail({
            destinatario: usuario.email,
            nombre: usuario.nombre,
            cupon: cupon.toJSON ? cupon.toJSON() : cupon,
            emision: {
              nombre: emision.nombre,
              descripcion: emision.descripcion,
            },
          });
          if (resultado && resultado.enviado === false) {
            throw new Error(resultado.motivo || 'No se pudo enviar el email');
          }
          await cupon.update(
            {
              estadoEnvio: ESTADOS_ENVIO.ENVIADO,
              enviadoEn: momento,
              errorEnvio: null,
            },
            { transaction }
          );
          enviados += 1;
        } catch (error) {
          await cupon.update(
            {
              estadoEnvio: ESTADOS_ENVIO.FALLIDO,
              enviadoEn: null,
              errorEnvio: String(error.message || error),
            },
            { transaction }
          );
          fallidos += 1;
        }
      }

      const estadoFinal =
        fallidos === 0 && enviados === destinatarios.length
          ? ESTADOS_EMISION.COMPLETADA
          : fallidos > 0 && enviados > 0
          ? ESTADOS_EMISION.CON_ERRORES
          : ESTADOS_EMISION.COMPLETADA;

      await emision.update(
        {
          cantidadCupones: cuponesCreados.length,
          cantidadEnviados: enviados,
          cantidadFallidos: fallidos,
          estado: estadoFinal,
          bloqueoToken: null,
          bloqueoExpiraEn: null,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        emision: serializarEmision(emision),
        cupones: cuponesCreados.map((c) => serializarCuponAdmin(c)),
        enviados,
        fallidos,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } finally {
    emisionesEnMemoria.delete(clave);
  }
};

const renovarBloqueoEmision = async (
  emisionId,
  token,
  { duracionBloqueoMs = DURACION_BLOQUEO_MS } = {}
) => {
  const expira = new Date(Date.now() + duracionBloqueoMs);
  const [afectadas] = await CuponEmision.update(
    { bloqueoExpiraEn: expira },
    { where: { id: emisionId, bloqueoToken: token } }
  );
  return Number(afectadas) === 1;
};

const serializarEmision = (emision) => {
  if (!emision) return null;
  const json = emision.toJSON ? emision.toJSON() : { ...emision };
  return {
    ...json,
    valorDescuento: Number(json.valorDescuento),
    compraMinima: Number(json.compraMinima),
    descuentoMaximo:
      json.descuentoMaximo === null || json.descuentoMaximo === undefined
        ? null
        : Number(json.descuentoMaximo),
  };
};

const serializarCuponAdmin = (cupon) => {
  if (!cupon) return null;
  const json = cupon.toJSON ? cupon.toJSON() : { ...cupon };
  return {
    ...json,
    valorDescuento: Number(json.valorDescuento),
    compraMinima: Number(json.compraMinima),
    descuentoMaximo:
      json.descuentoMaximo === null || json.descuentoMaximo === undefined
        ? null
        : Number(json.descuentoMaximo),
    usosPermitidos: Number(json.usosPermitidos),
    estadoEnvio: json.estadoEnvio,
  };
};

/**
 * Reenvia emails de una emision existente. Solo toca cupones activos con
 * estadoEnvio PENDIENTE o FALLIDO. No genera codigos ni cupones nuevos.
 */
export const reenviarEmision = async (
  emisionId,
  { ahora = new Date(), enviarEmail = enviarEmailCupon } = {}
) => {
  const momento = aFecha(ahora) || new Date();
  const clave = `reenvio:${emisionId}`;
  if (emisionesEnMemoria.has(clave)) {
    throw new EmisionError(
      'La emisión ya se está procesando',
      409,
      'emision_en_proceso'
    );
  }
  emisionesEnMemoria.add(clave);

  try {
    const emision = await CuponEmision.findByPk(emisionId);
    if (!emision) {
      throw new EmisionError(
        'Emisión no encontrada',
        404,
        'emision_no_encontrada'
      );
    }

    const token = nuevoToken();
    const expira = new Date(momento.getTime() + DURACION_BLOQUEO_MS);
    const transaction = await db.sequelize.transaction();
    try {
      const [afectadas] = await CuponEmision.update(
        {
          bloqueoToken: token,
          bloqueoExpiraEn: expira,
          estado: ESTADOS_EMISION.EN_PROCESO,
        },
        { where: { id: emisionId }, transaction }
      );
      if (Number(afectadas) !== 1) {
        throw new EmisionError(
          'La emisión perdió el bloqueo',
          409,
          MOTIVOS_EMISION.BLOQUEO_PERDIDO
        );
      }

      // Solo reenvia pendientes/fallidos activos de esta emisión.
      const cupones = await Cupon.findAll({
        where: {
          emisionId,
          activo: true,
          estadoEnvio: {
            [Op.in]: [ESTADOS_ENVIO.PENDIENTE, ESTADOS_ENVIO.FALLIDO],
          },
        },
        transaction,
        lock: transaction ? transaction.LOCK.UPDATE : undefined,
      });

      let reenviados = 0;
      let fallidos = 0;
      for (const cupon of cupones) {
        const usuario = await Usuario.findByPk(cupon.usuarioId, {
          transaction,
        });
        try {
          if (!usuario || !emailValido(usuario.email)) {
            throw new Error('El cliente no tiene email valido');
          }
          const resultado = await enviarEmail({
            destinatario: usuario.email,
            nombre: usuario.nombre,
            cupon: cupon.toJSON ? cupon.toJSON() : cupon,
            emision: {
              nombre: emision.nombre,
              descripcion: emision.descripcion,
            },
          });
          if (resultado && resultado.enviado === false) {
            throw new Error(resultado.motivo || 'No se pudo enviar el email');
          }
          await cupon.update(
            {
              estadoEnvio: ESTADOS_ENVIO.ENVIADO,
              enviadoEn: momento,
              errorEnvio: null,
            },
            { transaction }
          );
          reenviados += 1;
        } catch (error) {
          await cupon.update(
            {
              estadoEnvio: ESTADOS_ENVIO.FALLIDO,
              enviadoEn: null,
              errorEnvio: String(error.message || error),
            },
            { transaction }
          );
          fallidos += 1;
        }
      }

      const conteo = await contarEstadoEmision(emisionId, { transaction });
      const estadoFinal =
        conteo.pendientes === 0 && conteo.fallidos === 0
          ? ESTADOS_EMISION.COMPLETADA
          : ESTADOS_EMISION.CON_ERRORES;

      await emision.update(
        {
          cantidadEnviados: conteo.enviados,
          cantidadFallidos: conteo.fallidos,
          estado: estadoFinal,
          bloqueoToken: null,
          bloqueoExpiraEn: null,
        },
        { transaction }
      );

      await transaction.commit();
      return { emision: serializarEmision(emision), reenviados, fallidos };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } finally {
    emisionesEnMemoria.delete(clave);
  }
};

const contarEstadoEmision = async (emisionId, { transaction } = {}) => {
  const filas = await Cupon.findAll({
    where: { emisionId },
    attributes: ['estadoEnvio'],
    transaction,
  });
  let enviados = 0,
    fallidos = 0,
    pendientes = 0;
  filas.forEach((f) => {
    if (f.estadoEnvio === ESTADOS_ENVIO.ENVIADO) enviados += 1;
    else if (f.estadoEnvio === ESTADOS_ENVIO.FALLIDO) fallidos += 1;
    else pendientes += 1;
  });
  return { enviados, fallidos, pendientes, total: filas.length };
};

/**
 * Datos propios de una emisión, sin cupones ni datos complementarios.
 * El snapshot se entrega tal como quedó congelado al emitir: los nombres
 * legibles del alcance viven en `obtenerCuponesDeEmision`, que es la lectura
 * que alimenta la pantalla de detalle.
 *
 * @param {number|string} emisionId
 * @returns {Promise<object|null>}
 */
export const obtenerEmision = async (emisionId) => {
  const emision = await CuponEmision.findByPk(emisionId, {
    include: [
      {
        model: Usuario,
        as: 'creadaPor',
        attributes: ['id', 'nombre', 'apellido', 'email'],
      },
    ],
  });
  if (!emision) return null;
  return serializarEmision(emision);
};

/**
 * Datos complementarios del detalle de una emisión: sus cupones (cliente,
 * beneficio, vigencia, estado de envío, usos y estado de vigencia derivado) y
 * los nombres legibles del alcance persistido en el snapshot. Ninguno de estos
 * datos está presente en el listado ni en `obtenerEmision`.
 *
 * @param {number|string} emisionId
 * @param {{ahora?: Date|string}} [opciones]
 * @returns {Promise<object|null>}
 */
export const obtenerCuponesDeEmision = async (
  emisionId,
  { ahora = new Date() } = {}
) => {
  const emision = await CuponEmision.findByPk(emisionId, {
    attributes: ['id', 'configuracionSnapshot'],
  });
  if (!emision) return null;

  const cupones = await Cupon.findAll({
    where: { emisionId },
    include: [
      {
        model: Usuario,
        as: 'usuario',
        attributes: ['id', 'nombre', 'apellido', 'email'],
      },
    ],
    order: [['id', 'ASC']],
  });

  // Usos (reservados / confirmados / liberados) a partir de PedidoCupon.
  const cuponIds = cupones.map((c) => Number(c.id)).filter(Number.isFinite);
  const usosPorCupon = {};
  if (cuponIds.length > 0) {
    const filasUso = await PedidoCupon.findAll({
      where: { cuponId: { [Op.in]: cuponIds } },
      attributes: ['cuponId', 'estado'],
    });
    filasUso.forEach((f) => {
      const k = Number(f.cuponId);
      if (!usosPorCupon[k]) {
        usosPorCupon[k] = { reservados: 0, confirmados: 0, liberados: 0 };
      }
      if (f.estado === 'RESERVADO') usosPorCupon[k].reservados += 1;
      else if (f.estado === 'CONFIRMADO') usosPorCupon[k].confirmados += 1;
      else if (f.estado === 'LIBERADO') usosPorCupon[k].liberados += 1;
    });
  }

  const momentoServicio = aFecha(ahora) || new Date();
  const cuponesSerializados = cupones.map((c) => {
    const json = c.toJSON ? c.toJSON() : { ...c };
    const uso = usosPorCupon[Number(json.id)] || {
      reservados: 0,
      confirmados: 0,
      liberados: 0,
    };
    return {
      ...json,
      valorDescuento: Number(json.valorDescuento),
      compraMinima: Number(json.compraMinima),
      descuentoMaximo:
        json.descuentoMaximo === null || json.descuentoMaximo === undefined
          ? null
          : Number(json.descuentoMaximo),
      usosPermitidos: Number(json.usosPermitidos),
      estadoEnvio: json.estadoEnvio,
      uso,
      estado: derivarEstadoCupon(json, {
        ahora: momentoServicio,
        usosConfirmados: uso.confirmados,
        reservasVigentes: uso.reservados,
      }),
    };
  });

  // Nombres del alcance congelado, resueltos desde el snapshot (nunca desde el
  // catálogo actual) para no reconstruir histórico.
  const snapshot = emision.configuracionSnapshot || {};
  const alcance = snapshot.alcance || {};
  const productoIds = Array.from(
    new Set(
      (alcance.productoIdsResueltos || []).map(Number).filter(Number.isFinite)
    )
  );
  const categoriaIds = Array.from(
    new Set((alcance.categoriaIds || []).map(Number).filter(Number.isFinite))
  );

  let productos = [];
  let categorias = [];
  if (productoIds.length > 0) {
    const filas = await Producto.findAll({
      where: { id: { [Op.in]: productoIds } },
      attributes: ['nombre'],
      order: [['nombre', 'ASC']],
    });
    productos = filas.map((f) => f.nombre);
  }
  if (categoriaIds.length > 0) {
    const filas = await Categoria.findAll({
      where: { id: { [Op.in]: categoriaIds } },
      attributes: ['nombre'],
      order: [['nombre', 'ASC']],
    });
    categorias = filas.map((f) => f.nombre);
  }

  return {
    emisionId: Number(emision.id),
    cupones: cuponesSerializados,
    alcance: {
      productos,
      categorias,
      esGlobal:
        Boolean(alcance.global) ||
        (productoIds.length === 0 && categoriaIds.length === 0),
    },
  };
};

/**
 * Listado administrativo de emisiones con filtros y paginación.
 * Filtros: estado, activa (desactivada => nombre inactivo), desde, hasta,
 * pagina, limite. El estado derivado no se persiste, se lee de la columna
 * estado de CuponEmisiones. Cada ítem incluye `cuponesPorEstado` con el
 * conteo de cupones por estado de vigencia (DISPONIBLE, EN_USO, USADO,
 * VENCIDO, ANULADO, PROGRAMADO), derivado del snapshot y los usos actuales.
 */
export const listarEmisiones = async ({
  estado,
  desde,
  hasta,
  pagina = 1,
  limite = 20,
} = {}) => {
  const paginaNum = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(
    100,
    Math.max(1, Number.parseInt(limite, 10) || 20)
  );

  const where = {};
  if (estado) where.estado = estado;
  if (desde || hasta) {
    where.fechaInicio = {};
    if (desde) where.fechaInicio[Op.gte] = new Date(desde);
    if (hasta) where.fechaFin = { [Op.lte]: new Date(hasta) };
  }

  const emisiones = await CuponEmision.findAll({
    where,
    include: [
      {
        model: Usuario,
        as: 'creadaPor',
        attributes: ['id', 'nombre', 'apellido', 'email'],
      },
    ],
    order: [['id', 'DESC']],
  });

  const total = emisiones.length;
  const inicio = (paginaNum - 1) * limiteNum;
  const paginaEmisiones = emisiones.slice(inicio, inicio + limiteNum);

  // --- Estados de vigencia de los cupones de cada emisión de esta página. ---
  const cuponIdsPorEmision = {};
  const cuponesDeEmisiones = {};
  const cuponesPorEstado = {};
  if (paginaEmisiones.length > 0) {
    const cupones = await Cupon.findAll({
      where: {
        emisionId: { [Op.in]: paginaEmisiones.map((e) => Number(e.id)) },
      },
      attributes: [
        'id',
        'emisionId',
        'activo',
        'fechaInicio',
        'fechaFin',
        'usosPermitidos',
      ],
    });
    cupones.forEach((c) => {
      const emId = Number(c.emisionId);
      if (!cuponesDeEmisiones[emId]) cuponesDeEmisiones[emId] = [];
      cuponesDeEmisiones[emId].push(c.toJSON ? c.toJSON() : { ...c });
      if (!cuponIdsPorEmision[emId]) cuponIdsPorEmision[emId] = [];
      cuponIdsPorEmision[emId].push(Number(c.id));
    });

    const todosLosCuponIds = Object.values(cuponIdsPorEmision).flat();
    const usos = await contarUsosCupones(todosLosCuponIds, {
      ahora: new Date(),
    });

    paginaEmisiones.forEach((emision) => {
      const emId = Number(emision.id);
      const conteo = {
        DISPONIBLE: 0,
        EN_USO: 0,
        USADO: 0,
        VENCIDO: 0,
        ANULADO: 0,
        PROGRAMADO: 0,
      };
      (cuponesDeEmisiones[emId] || []).forEach((c) => {
        const estadoCupon = derivarEstadoCupon(c, {
          ahora: new Date(),
          usos: usos.get(Number(c.id)) || {
            usosConfirmados: 0,
            reservasVigentes: 0,
            usosActivos: 0,
          },
        });
        conteo[estadoCupon] = (conteo[estadoCupon] || 0) + 1;
      });
      cuponesPorEstado[emId] = conteo;
    });
  }

  return {
    items: paginaEmisiones.map((emision) => ({
      ...serializarEmision(emision),
      cuponesPorEstado: cuponesPorEstado[Number(emision.id)] || {
        DISPONIBLE: 0,
        EN_USO: 0,
        USADO: 0,
        VENCIDO: 0,
        ANULADO: 0,
        PROGRAMADO: 0,
      },
    })),
    total,
    pagina: paginaNum,
    limite: limiteNum,
    paginas: Math.ceil(total / limiteNum),
  };
};

export { serializarEmision };
