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
  ESTADOS_ENVIO,
} from './cupones';

// Se reexporta para no romper a quienes ya lo importaban de acá (vigía y
// tests). La definición única vive en `cupones.js`, que no importa este módulo.
export { ESTADOS_ENVIO };
import { enviarEmailCupon } from './email_service';
import { ESTADOS_PEDIDO } from './estados_pedido';
import { emitirCuponActualizado, emitirEmisionActualizada } from '../realtime';

const {
  Cupon,
  CuponEmision,
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

/**
 * Tipos de cliente para la selección automática. El formulario elige uno solo,
 * pero la API puede recibir varios. `NUEVO` se decide por fecha de registro y
 * `ACTIVO`/`INACTIVO` por actividad general de pedidos entregados: un cliente
 * nuevo con pedido en el período encaja en ambos, uno nuevo sin pedidos es sólo
 * `NUEVO`. El orden es el canónico para normalizar y para elegir la etiqueta de
 * un cliente que encaja en más de un tipo.
 */
export const TIPOS_CLIENTE = Object.freeze({
  NUEVO: 'NUEVO',
  ACTIVO: 'ACTIVO',
  INACTIVO: 'INACTIVO',
});
const TIPO_CLIENTE_PRIORIDAD = [
  TIPOS_CLIENTE.NUEVO,
  TIPOS_CLIENTE.INACTIVO,
  TIPOS_CLIENTE.ACTIVO,
];
/** Etiqueta del criterio original cuando no se marca ningún tipo. */
export const TIPO_CLIENTE_DEFAULT = 'COMPRADOR_PERIODO';

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
 * Normaliza los tipos de cliente seleccionados. Acepta un array o un string
 * (útil para formularios y query params), descarta repetidos y devuelve el
 * orden canónico. El formulario permite elegir uno solo, pero la API puede
 * recibir varios: el service los evalúa sin duplicar destinatarios ni cupones.
 * @param {unknown} valor
 * @returns {string[]}
 */
export const normalizarTiposCliente = (valor) => {
  const valores = Array.isArray(valor)
    ? valor
    : valor === null || valor === undefined || valor === ''
    ? []
    : [valor];
  const tipos = [
    ...new Set(
      valores.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
    ),
  ];
  const invalidos = tipos.filter(
    (tipo) => !TIPO_CLIENTE_PRIORIDAD.includes(tipo)
  );
  if (invalidos.length > 0) {
    throw new EmisionError(
      `Tipo de cliente inválido: ${invalidos.join(', ')}`,
      400,
      'tipo_cliente_invalido'
    );
  }
  // Se admiten varios tipos por API: NUEVO y ACTIVO no son excluyentes. El
  // return usa el orden canónico para que el snapshot y el hash del preview no
  // dependan del orden en que vinieron los tipos.
  return TIPO_CLIENTE_PRIORIDAD.filter((tipo) => tipos.includes(tipo));
};

/**
 * Normaliza el mínimo de unidades compradas exigido a los destinatarios.
 * Vacío equivale a "sin requisito" y se guarda como null para no confundirlo
 * con el campo `compraMinima` (monetario) del cupón.
 * @param {unknown} valor
 * @returns {number|null}
 */
export const normalizarMinUnidadesCompradas = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new EmisionError(
      'La compra mínima en unidades debe ser un número mayor o igual a cero',
      400,
      'min_unidades_invalido'
    );
  }
  return Math.trunc(numero);
};

/**
 * Valida que un email tenga formato basico y no este vacio.
 * Nota: Usuario no tiene campo de email verificado; "valido" = no vacio +
 * sintacticamente aceptable + usuario activo con rol CLIENTE.
 */
export const emailValido = (email) => {
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
  tiposCliente,
  minUnidadesCompradas,
  destinatariosIds,
  categoriaIds,
  productoIds,
  productoIdsResueltos,
  previewToken,
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
    tiposCliente: normalizarTiposCliente(tiposCliente),
    minUnidadesCompradas: normalizarMinUnidadesCompradas(minUnidadesCompradas),
    estadoPedido: ESTADO_PEDIDO_ENTREGADO,
    criterio: 'unidades de productos alcanzados, descendente',
  },
  destinatariosIds: Array.from(new Set(destinatariosIds || [])).map(Number),
  maxDestinatarios:
    maxDestinatarios !== null && maxDestinatarios !== undefined
      ? Number(maxDestinatarios)
      : null,
  // El token se guarda hasheado en la columna UNIQUE de la emisión; acá sólo
  // van los metadatos que permiten explicar el consumo sin exponer el token.
  previewToken: previewToken || null,
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

  const tiposCliente = normalizarTiposCliente(datos.tiposCliente);
  if (tiposCliente.length === 0) {
    throw new EmisionError(
      'Debe seleccionar un tipo de cliente',
      400,
      'tipo_cliente_requerido'
    );
  }
  const minUnidadesCompradas = normalizarMinUnidadesCompradas(
    datos.minUnidadesCompradas
  );
  if (periodoAnalisisDias === null) {
    throw new EmisionError(
      'El período de análisis es obligatorio para clasificar clientes',
      400,
      'periodo_requerido_para_tipos'
    );
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
    tiposCliente,
    minUnidadesCompradas,
    productoIds,
    categoriaIds,
  };
};

/**
 * Calcula el alcance resuelto: productos de las categorias seleccionadas +
 * productos explicitos. Excluye combos (tipo='COMBO').
 *
 * `incluirInactivos` se usa sólo para el historial: un producto dado de baja
 * después de la compra sigue siendo un producto de la categoría seleccionada y
 * debe contar para detectar INACTIVOS. El alcance vigente (período, ranking de
 * ACTIVO/NUEVO) mantiene el filtro `activo: true` de siempre.
 * @returns {{productoIdsResueltos: number[], categoriaIds: number[], productoIds: number[]}}
 */
export const resolverAlcanceProductos = async ({
  productoIds = [],
  categoriaIds = [],
  incluirInactivos = false,
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
        ...(incluirInactivos ? {} : { activo: true }),
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
  const tiposCliente = normalizarTiposCliente(datos.tiposCliente);
  const minUnidadesCompradas = normalizarMinUnidadesCompradas(
    datos.minUnidadesCompradas
  );
  if (tiposCliente.length > 0 && !desde) {
    throw new EmisionError(
      'El período de análisis es obligatorio para clasificar clientes',
      400,
      'periodo_requerido_para_tipos'
    );
  }

  const { productoIdsResueltos } = await resolverAlcanceProductos({
    productoIds: datos.productoIds,
    categoriaIds: datos.categoriaIds,
  });
  // Histórico: incluye productos dados de baja después de la compra. El alcance
  // vigente (período/ranking) sigue usando el resolver por defecto para no
  // cambiar los criterios de ACTIVO y NUEVO.
  const {
    productoIdsResueltos: productoIdsHistoricos,
  } = await resolverAlcanceProductos({
    productoIds: datos.productoIds,
    categoriaIds: datos.categoriaIds,
    incluirInactivos: true,
  });

  // Universo: clientes activos CLIENTE con email valido.
  const clientes = await Usuario.findAll({
    where: {
      rol: 'CLIENTE',
      activo: true,
    },
    attributes: ['id', 'nombre', 'apellido', 'email', 'createdAt'],
  });

  const clientesValidos = clientes.filter((c) => emailValido(c.email));
  const clienteIds = clientesValidos.map((c) => c.id);
  // La actividad es general, así que no se corta por el alcance del cupón.
  // Sólo no hay nada que hacer si no se resolvió ningún producto (por ejemplo,
  // una categoría que sólo contiene combos).
  if (
    clienteIds.length === 0 ||
    (productoIdsResueltos.length === 0 && productoIdsHistoricos.length === 0)
  ) {
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

  // Historial REAL de compras: Pedidos + PedidoItems, nunca MetricasCliente
  // ni métricas agregadas (no conservan el detalle por producto).
  // Sólo cuentan pedidos ENTREGADOS: cancelados, vencidos, pendientes y
  // cualquier otro estado quedan fuera. ENTREGADO y CANCELADO son estados
  // finales, así que un pedido cancelado nunca puede aparecer como entregado.
  const estadoEntregadoId = await idEstadoEntregado();
  const wherePedido = {
    usuarioId: { [Op.in]: clienteIds },
    estadoId: estadoEntregadoId,
  };
  if (desde) wherePedido.fechaHora = { [Op.gte]: desde, [Op.lte]: momento };

  const pedidos = await Pedido.findAll({
    where: wherePedido,
    attributes: ['id', 'usuarioId', 'fechaHora'],
  });

  // Actividad GENERAL en el período: cualquier pedido ENTREGADO cuenta, sin
  // importar qué productos o categorías compró. Es la base de ACTIVO/INACTIVO.
  const clientesConPedidoPeriodo = new Set(
    pedidos.map((p) => Number(p.usuarioId))
  );

  // Pedidos entregados anteriores: dan el historial general de INACTIVO y, con
  // las líneas del cupón, `unidadesPrevias`. Al clasificar como INACTIVO (sin
  // compras en el período) son la base del mínimo; para NUEVO/ACTIVO siguen
  // siendo sólo información y el mínimo se calcula dentro del período.
  const pedidosAnteriores = desde
    ? await Pedido.findAll({
        where: {
          usuarioId: { [Op.in]: clienteIds },
          estadoId: estadoEntregadoId,
          fechaHora: { [Op.lt]: desde },
        },
        attributes: ['id', 'usuarioId'],
      })
    : [];
  const clientesConPedidoAnterior = new Set(
    pedidosAnteriores.map((p) => Number(p.usuarioId))
  );
  const lineasAnteriores =
    pedidosAnteriores.length > 0
      ? await PedidoItem.findAll({
          where: {
            pedidoId: { [Op.in]: pedidosAnteriores.map((p) => p.id) },
            productoId: { [Op.in]: productoIdsHistoricos },
          },
          attributes: ['pedidoId', 'cantidad'],
        })
      : [];
  const pedidoAnteriorPorId = new Map(pedidosAnteriores.map((p) => [p.id, p]));
  const unidadesPreviasPorCliente = new Map();
  lineasAnteriores.forEach((linea) => {
    const pedido = pedidoAnteriorPorId.get(Number(linea.pedidoId));
    if (!pedido) return;
    const clienteId = Number(pedido.usuarioId);
    unidadesPreviasPorCliente.set(
      clienteId,
      (unidadesPreviasPorCliente.get(clienteId) || 0) + Number(linea.cantidad)
    );
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
      const clienteId = Number(c.id);
      const unidades = unidadesPorCliente.get(clienteId) || 0;
      const unidadesPrevias = unidadesPreviasPorCliente.get(clienteId) || 0;
      const unidadesHistoricas = unidades + unidadesPrevias;

      let tipoCliente;
      let tiposAplicables = [];
      if (tiposCliente.length === 0) {
        // Sin tipos marcados se conserva el criterio original: compradores
        // del período, ordenados por unidades (ver el sort de más abajo).
        if (unidades < 1) return null;
        tipoCliente = TIPO_CLIENTE_DEFAULT;
      } else {
        tiposAplicables = clasificarTiposCliente({
          creadoEn: c.createdAt,
          desde,
          momento,
          tienePedidoPeriodo: clientesConPedidoPeriodo.has(clienteId),
          tienePedidoAnterior: clientesConPedidoAnterior.has(clienteId),
        });
        const coincidentes = tiposAplicables.filter((tipo) =>
          tiposCliente.includes(tipo)
        );
        // Un cliente puede encajar en NUEVO y ACTIVO a la vez. Se conserva una
        // sola fila por cliente (y, por lo tanto, un solo cupón al emitir); la
        // etiqueta mostrada usa el orden canónico priorizado.
        if (coincidentes.length === 0) return null;
        tipoCliente = TIPO_CLIENTE_PRIORIDAD.find((tipo) =>
          coincidentes.includes(tipo)
        );
      }

      // El mínimo es un filtro de elegibilidad posterior a la clasificación.
      // NUEVO/ACTIVO lo cumplen con unidades del período (criterio original).
      // INACTIVO no tiene unidades en el período por definición, así que ahí se
      // mide sobre el historial del cupón: "mínimo 2" = compró 2 unidades en el
      // pasado. Sigue siendo una sola fila por cliente y el mismo criterio lo
      // usa la emisión porque respeta los destinatarios firmados en el preview.
      const unidadesParaMinimo =
        tipoCliente === TIPOS_CLIENTE.INACTIVO ? unidadesHistoricas : unidades;
      if (
        minUnidadesCompradas !== null &&
        unidadesParaMinimo < minUnidadesCompradas
      ) {
        return null;
      }

      return {
        usuarioId: c.id,
        nombre: c.nombre,
        apellido: c.apellido,
        email: c.email,
        unidades,
        unidadesPrevias,
        unidadesHistoricas,
        tipoCliente,
        tiposAplicables,
        ultimaCompra: ultimaCompraPorCliente.get(clienteId) || null,
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

  // Una fila por cliente aunque haya coincidido con varios tipos (NUEVO y
  // ACTIVO). El Set es una guardia extra para no firmar ni emitir duplicados.
  const destinatariosIds = [
    ...new Set(seleccionados.map((d) => d.usuarioId)),
  ].sort((a, b) => a - b);
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
        tiposCliente,
        minUnidadesCompradas,
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

/**
 * Clasificación por actividad GENERAL del cliente, independiente de los
 * productos/categorías del cupón:
 * - `ACTIVO`: al menos un pedido ENTREGADO dentro del período, sea cual sea el
 *   producto comprado.
 * - `INACTIVO`: ningún pedido ENTREGADO en el período pero sí al menos uno
 *   antes del período.
 * - `NUEVO`: se mantiene igual, se decide sólo por la fecha de registro.
 *
 * Un cliente nuevo con pedido en el período es NUEVO y ACTIVO a la vez; un
 * cliente nuevo sin pedidos es sólo NUEVO. Devuelve los tipos aplicables en
 * orden canónico; [] cuando no cae en ninguno.
 */
export const clasificarTiposCliente = ({
  creadoEn,
  desde,
  momento,
  tienePedidoPeriodo,
  tienePedidoAnterior,
}) => {
  if (!desde) return [];
  const fechaAlta = aFecha(creadoEn);
  const esNuevo = Boolean(
    fechaAlta && fechaAlta >= desde && fechaAlta <= momento
  );
  const tipos = [];
  if (esNuevo) tipos.push(TIPOS_CLIENTE.NUEVO);
  if (tienePedidoPeriodo) tipos.push(TIPOS_CLIENTE.ACTIVO);
  else if (tienePedidoAnterior) tipos.push(TIPOS_CLIENTE.INACTIVO);
  return TIPO_CLIENTE_PRIORIDAD.filter((tipo) => tipos.includes(tipo));
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

  // Calcular hash SHA-256 del token para registro de un solo uso. La unicidad
  // vive en `CuponEmisiones.previewTokenHash`: no hay tabla auxiliar de tokens.
  const tokenHash = crypto
    .createHash('sha256')
    .update(previewToken, 'utf8')
    .digest('hex');

  // Verificar que el token no haya sido consumido ya (fuera de transaccion para fallar rapido).
  const emisionConToken = await CuponEmision.findOne({
    where: { previewTokenHash: tokenHash },
    attributes: ['id', 'configuracionSnapshot'],
  });
  if (emisionConToken) {
    const tokenGuardado = emisionConToken.configuracionSnapshot?.previewToken;
    if (!tokenGuardado || tokenGuardado.usado !== false) {
      throw new EmisionError(
        'El previewToken ya fue consumido. Generá una nueva previsualización.',
        409,
        'preview_token_ya_usado'
      );
    }
    const expiraGuardada = aFecha(tokenGuardado.expiraEn);
    if (expiraGuardada && expiraGuardada < momento) {
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

  // Metadatos del preview consumido. El token en claro nunca se persiste: el
  // hash va en la columna UNIQUE y estos datos explican cuándo se consumió.
  const metadataPreviewToken = {
    tokenHash,
    usado: true,
    creadoEn: momento.toISOString(),
    expiraEn: expira.toISOString(),
    usadoEn: momento.toISOString(),
  };

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
        tiposCliente: normalizarTiposCliente(datos.tiposCliente),
        minUnidadesCompradas: normalizarMinUnidadesCompradas(
          datos.minUnidadesCompradas
        ),
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
      tiposCliente: datos.tiposCliente,
      minUnidadesCompradas: datos.minUnidadesCompradas,
      destinatariosIds,
      categoriaIds: datos.categoriaIds,
      productoIds: datos.productoIds,
      productoIdsResueltos: alcance.productoIdsResueltos,
      previewToken: metadataPreviewToken,
    });

    const transaction = await db.sequelize.transaction();
    try {
      const token = nuevoToken();
      const expiraBloqueo = new Date(momento.getTime() + DURACION_BLOQUEO_MS);

      let emision;
      try {
        emision = await CuponEmision.create(
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
            previewTokenHash: tokenHash,
          },
          { transaction }
        );
      } catch (error) {
        // Dos confirmaciones concurrentes pueden llegar hasta acá: la COLUMN
        // UNIQUE de previewTokenHash hace que la segunda falle y se convierta
        // en el mismo 409 de token ya consumido.
        if (
          error instanceof UniqueConstraintError &&
          (Object.prototype.hasOwnProperty.call(
            error.fields || {},
            'previewTokenHash'
          ) ||
            /previewTokenHash/i.test(String(error.message || '')))
        ) {
          throw new EmisionError(
            'El previewToken ya fue consumido por otra emisión concurrente. Generá una nueva previsualización.',
            409,
            'preview_token_ya_usado'
          );
        }
        throw error;
      }

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

      // Los cupones programados NO se notifican al crear la emisión: quedan
      // PENDIENTE y el vigía los envía cuando llega `fechaInicio` (sin avisos
      // para cancelados o vencidos). El bloqueo se libera igual; `reenviar`
      // también rechaza emisiones programadas para no adelantar el envío.
      const inicioEmision = aFecha(datos.fechaInicio);
      const programada =
        Boolean(inicioEmision) && inicioEmision.getTime() > momento.getTime();
      let enviados = 0;
      let fallidos = 0;
      const pares = programada
        ? []
        : cuponesCreados.map((cupon, i) => ({
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

      const estadoFinal = programada
        ? ESTADOS_EMISION.EN_PROCESO
        : fallidos === 0 && enviados === destinatarios.length
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

      // Avisos post-commit: el listado/detalle de emisiones se reconsulta por
      // REST y cada cliente propietario entera de sus cupones nuevos recién
      // cuando el correo salió. Los programados (PENDIENTE) los avisa el vigía;
      // los fallidos no aparecen en "Mis cupones" y no generan refrescos.
      emitirEmisionActualizada(emision.id);
      for (const cupon of cuponesCreados) {
        if (cupon.estadoEnvio === ESTADOS_ENVIO.ENVIADO) {
          emitirCuponActualizado(cupon.usuarioId, cupon.id, emision.id);
        }
      }

      return {
        emision: serializarEmision(emision),
        cupones: cuponesCreados.map((c) => serializarCuponAdmin(c)),
        enviados,
        fallidos,
        programada,
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
    if (aFecha(emision.fechaInicio) > momento) {
      throw new EmisionError(
        'La emisión está programada; los cupones se envían automáticamente al activarse',
        409,
        'emision_programada'
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

      // Solo reenvia pendientes/fallidos activos y vigentes: nunca notifica
      // cupones cancelados (activo=false), programados ni vencidos.
      const cupones = await Cupon.findAll({
        where: {
          emisionId,
          activo: true,
          fechaInicio: { [Op.lte]: momento },
          fechaFin: { [Op.gte]: momento },
          estadoEnvio: {
            [Op.in]: [ESTADOS_ENVIO.PENDIENTE, ESTADOS_ENVIO.FALLIDO],
          },
        },
        transaction,
        lock: transaction ? transaction.LOCK.UPDATE : undefined,
      });

      let reenviados = 0;
      let fallidos = 0;
      // Sólo se avisa por los cupones cuyo estado de envío cambió realmente.
      const cuponesAvisados = [];
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
          cuponesAvisados.push(cupon);
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
          cuponesAvisados.push(cupon);
        }
      }

      const conteo = await contarEstadoEmision(emisionId, { transaction });
      const estadoFinal = estadoEmisionDesdeConteo(conteo);

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
      emitirEmisionActualizada(emision.id);
      for (const cupon of cuponesAvisados) {
        if (cupon.estadoEnvio === ESTADOS_ENVIO.ENVIADO) {
          emitirCuponActualizado(cupon.usuarioId, cupon.id, emision.id);
        }
      }
      return { emision: serializarEmision(emision), reenviados, fallidos };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } finally {
    emisionesEnMemoria.delete(clave);
  }
};

export const contarEstadoEmision = async (emisionId, { transaction } = {}) => {
  const filas = await Cupon.findAll({
    // Los cupones dados de baja no cuentan como pendientes: no hay que
    // notificarlos ni dejar la emisión en CON_ERRORES por ellos.
    where: { emisionId, activo: true },
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

/** Estado final de una emisión a partir del conteo de envíos de sus cupones. */
export const estadoEmisionDesdeConteo = ({ fallidos, pendientes }) =>
  pendientes === 0 && fallidos === 0
    ? ESTADOS_EMISION.COMPLETADA
    : ESTADOS_EMISION.CON_ERRORES;

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
