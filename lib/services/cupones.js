/**
 * Service: cupones
 *
 * Reglas de dominio de los cupones emitidos por una campaña:
 * - estado visible derivado (ANULADO / VENCIDO / USADO / EN_USO / DISPONIBLE),
 * - cálculo del descuento sobre el carrito,
 * - generación de códigos individuales únicos,
 * - liberación idempotente de la reserva de un pedido.
 *
 * La integración con el alta/confirmación de pedidos (crear `PedidoCupon`,
 * descontar stock, responder 409, etc.) se hace en una etapa posterior. Acá
 * viven las piezas puras y las consultas de conteo necesarias para revalidar.
 */

import crypto from 'crypto';
import { Op } from 'sequelize';
import db from '../models';
import { ESTADOS_PEDIDO } from './estados_pedido';
import { obtenerValor } from './parametros_service';
import { reservaVencida } from './reserva_pedidos';
import {
  ESTADOS_PEDIDO_CUPON,
  liberarCuponDePedido,
  RESULTADOS_LIBERACION,
} from './cupon_uso';

export { ESTADOS_PEDIDO_CUPON, liberarCuponDePedido, RESULTADOS_LIBERACION };

const { Cupon, EstadoPedido, Pedido, PedidoCupon, Usuario } = db;

/** Paginación del listado administrativo de cupones. */
const LIMITE_DEFAULT = 20;
const LIMITE_MAX = 100;

/** Estados visibles del cupón, en el orden exacto de prioridad. */
export const ESTADOS_CUPON = Object.freeze({
  ANULADO: 'ANULADO',
  VENCIDO: 'VENCIDO',
  USADO: 'USADO',
  EN_USO: 'EN_USO',
  PROGRAMADO: 'PROGRAMADO',
  DISPONIBLE: 'DISPONIBLE',
});

/** Motivos estables para que el controller/frontend distingan el rechazo. */
export const MOTIVOS_CUPON = Object.freeze({
  INVALIDO: 'cupon_invalido',
  ANULADO: 'cupon_anulado',
  VENCIDO: 'cupon_vencido',
  USADO: 'cupon_usado',
  EN_USO: 'cupon_en_uso',
  PROGRAMADO: 'cupon_programado',
  COMPRA_MINIMA: 'compra_minima_no_alcanzada',
  YA_APLICADO: 'cupon_ya_aplicado',
  NO_APLICA: 'cupon_no_aplica_a_carrito',
});

/** Resultados posibles de `liberarCuponDePedido`. */
const MOTIVO_POR_ESTADO = {
  [ESTADOS_CUPON.ANULADO]: {
    mensaje: 'El cupón fue anulado',
    motivo: MOTIVOS_CUPON.ANULADO,
  },
  [ESTADOS_CUPON.VENCIDO]: {
    mensaje: 'El cupón está vencido',
    motivo: MOTIVOS_CUPON.VENCIDO,
  },
  [ESTADOS_CUPON.USADO]: {
    mensaje: 'El cupón ya alcanzó su límite de usos',
    motivo: MOTIVOS_CUPON.USADO,
  },
  [ESTADOS_CUPON.EN_USO]: {
    mensaje: 'El cupón está reservado en otro pedido',
    motivo: MOTIVOS_CUPON.EN_USO,
  },
  [ESTADOS_CUPON.PROGRAMADO]: {
    mensaje: 'El cupón aún no ha comenzado: fecha de inicio futura',
    motivo: MOTIVOS_CUPON.PROGRAMADO,
  },
};

/** Alfabeto sin caracteres ambiguos (I, O, 0, 1) para dictar el código. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_CODIGO = 10;
export const PREFIJO_CODIGO = 'CR';

/**
 * Error de negocio de cupones. `codigo` es el status HTTP sugerido y `motivo`
 * permite distinguir el rechazo sin parsear el mensaje.
 */
export class CuponError extends Error {
  constructor(mensaje, codigo = 400, motivo = MOTIVOS_CUPON.INVALIDO) {
    super(mensaje);
    this.name = 'CuponError';
    this.codigo = codigo;
    this.motivo = motivo;
  }
}

const aFecha = (valor) => {
  if (valor instanceof Date) {
    return Number.isFinite(valor.getTime()) ? valor : null;
  }
  if (valor === null || valor === undefined || valor === '') return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

const numeroNoNegativo = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
};

const redondear = (valor) => Math.round(Number(valor) * 100) / 100;

const normalizarCodigo = (codigo) =>
  String(codigo === null || codigo === undefined ? '' : codigo)
    .trim()
    .toUpperCase();

const aEnteroPositivo = (valor, campo) => {
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero) || numero < 1) {
    throw new CuponError(`${campo} debe ser un entero mayor a 0`);
  }
  return numero;
};

/**
 * Deriva el estado visible del cupón con la prioridad exacta:
 * ANULADO > VENCIDO > USADO > EN_USO > DISPONIBLE.
 *
 * Las reservas vencidas/abandonadas no deben venir en `reservasVigentes`; para
 * calcularlas desde la base se usa `contarUsosCupon`.
 *
 * @param {object} cupon - Cupón con snapshot de vigencia y `usosPermitidos`.
 * @param {{ahora?: Date|string, usosConfirmados?: number,
 *   reservasVigentes?: number}} [opciones]
 * @returns {string} Uno de `ESTADOS_CUPON`.
 */
export function derivarEstadoCupon(
  cupon,
  { ahora = new Date(), usosConfirmados = 0, reservasVigentes = 0 } = {}
) {
  // ANULADO gana incluso si además está vencido o usado.
  if (!cupon || cupon.activo === false) return ESTADOS_CUPON.ANULADO;

  const inicio = aFecha(cupon.fechaInicio);
  const fin = aFecha(cupon.fechaFin);
  const momento = aFecha(ahora) || new Date();

  // Fecha inválida no habilita el cupón: se trata como vencido.
  if (!inicio || !fin) return ESTADOS_CUPON.VENCIDO;

  // Antes de la fecha de inicio: PROGRAMADO.
  if (momento.getTime() < inicio.getTime()) return ESTADOS_CUPON.PROGRAMADO;

  // Después de la fecha de fin: VENCIDO.
  if (momento.getTime() > fin.getTime()) return ESTADOS_CUPON.VENCIDO;

  const permitidos = Math.max(
    1,
    Math.trunc(numeroNoNegativo(cupon.usosPermitidos)) || 1
  );
  const confirmados = Math.max(
    0,
    Math.trunc(numeroNoNegativo(usosConfirmados))
  );
  const reservas = Math.max(0, Math.trunc(numeroNoNegativo(reservasVigentes)));

  if (confirmados >= permitidos) return ESTADOS_CUPON.USADO;
  if (confirmados + reservas >= permitidos) return ESTADOS_CUPON.EN_USO;
  return ESTADOS_CUPON.DISPONIBLE;
}

/**
 * Indica si un `PedidoCupon` es una reserva que todavía consume el cupón.
 *
 * Debe estar RESERVADO, el pedido debe seguir PENDIENTE y no debe haber vencido
 * el plazo de reserva (`minutosReservaStock`, medido desde `Pedido.fechaHora`).
 * Las reservas de pedidos abandonados/expirados no cuentan.
 *
 * @param {object} pedidoCupon - Fila de `PedidoCupon`, con `pedido` incluido.
 * @param {{ahora?: Date|string, minutosReserva: number, pedido?: object}} opciones
 * @returns {boolean}
 */
export function esReservaVigente(
  pedidoCupon,
  { ahora = new Date(), minutosReserva, pedido } = {}
) {
  if (!pedidoCupon || pedidoCupon.estado !== ESTADOS_PEDIDO_CUPON.RESERVADO) {
    return false;
  }

  const datosPedido = pedido || pedidoCupon.pedido;
  if (!datosPedido) return false;

  const nombreEstado =
    (datosPedido.estadoActual && datosPedido.estadoActual.nombre) ||
    (typeof datosPedido.estado === 'string'
      ? datosPedido.estado
      : datosPedido.estado && datosPedido.estado.nombre);

  if (nombreEstado !== ESTADOS_PEDIDO.PENDIENTE) return false;

  const plazo = Number(minutosReserva);
  if (!Number.isFinite(plazo) || plazo < 0) return false;

  const momento = aFecha(ahora) || new Date();
  return !reservaVencida(datosPedido, plazo, momento);
}

/**
 * Cuenta los usos que consumen el cupón ahora mismo:
 * - `usosConfirmados`: pedidos cuyo pago se confirmó.
 * - `reservasVigentes`: pedidos pendientes con reserva no vencida.
 *
 * Las reservas vencidas, los pedidos cancelados y los usos LIBERADO no cuentan.
 * `excluirPedidoId` permite revalidar un cupón al confirmar el pago sin que la
 * propia reserva del pedido lo bloquee como `EN_USO`.
 *
 * @param {number|string} cuponId
 * @param {{ahora?: Date|string, minutosReserva?: number,
 *   excluirPedidoId?: number|string, transaction?: object}} [opciones]
 * @returns {Promise<{usosConfirmados: number, reservasVigentes: number,
 *   usosActivos: number}>}
 */
export async function contarUsosCupon(
  cuponId,
  { ahora = new Date(), minutosReserva, excluirPedidoId, transaction } = {}
) {
  if (cuponId === null || cuponId === undefined || cuponId === '') {
    return { usosConfirmados: 0, reservasVigentes: 0, usosActivos: 0 };
  }

  const filas = await PedidoCupon.findAll({
    where: {
      cuponId,
      estado: {
        [Op.in]: [
          ESTADOS_PEDIDO_CUPON.RESERVADO,
          ESTADOS_PEDIDO_CUPON.CONFIRMADO,
        ],
      },
      ...(excluirPedidoId !== undefined && excluirPedidoId !== null
        ? { pedidoId: { [Op.ne]: excluirPedidoId } }
        : {}),
    },
    attributes: ['id', 'estado', 'pedidoId'],
    include: [
      {
        model: Pedido,
        as: 'pedido',
        required: true,
        attributes: ['id', 'fechaHora'],
        include: [
          {
            model: EstadoPedido,
            as: 'estadoActual',
            required: true,
            attributes: ['id', 'nombre'],
          },
        ],
      },
    ],
    transaction,
  });

  const reservadas = filas.filter(
    (fila) => fila.estado === ESTADOS_PEDIDO_CUPON.RESERVADO
  );
  let plazo = minutosReserva;
  if (reservadas.length > 0 && plazo === undefined) {
    plazo = await obtenerValor('minutosReservaStock');
  }

  let usosConfirmados = 0;
  let reservasVigentes = 0;
  filas.forEach((fila) => {
    if (fila.estado === ESTADOS_PEDIDO_CUPON.CONFIRMADO) {
      usosConfirmados += 1;
    } else if (esReservaVigente(fila, { ahora, minutosReserva: plazo })) {
      reservasVigentes += 1;
    }
  });

  return {
    usosConfirmados,
    reservasVigentes,
    usosActivos: usosConfirmados + reservasVigentes,
  };
}

/**
 * Calcula el estado visible de un cupón consultando sus usos en la base.
 *
 * @param {object} cupon - Instancia/plain object de `Cupon`.
 * @param {{ahora?: Date|string, minutosReserva?: number,
 *   transaction?: object}} [opciones]
 * @returns {Promise<string>}
 */
export async function obtenerEstadoCupon(
  cupon,
  { ahora = new Date(), minutosReserva, transaction } = {}
) {
  if (!cupon) return derivarEstadoCupon(cupon, { ahora });
  if (cupon.id === null || cupon.id === undefined) {
    return derivarEstadoCupon(cupon, {
      ahora,
      usosConfirmados: cupon.usosConfirmados,
      reservasVigentes: cupon.reservasVigentes,
    });
  }

  const usos = await contarUsosCupon(cupon.id, {
    ahora,
    minutosReserva,
    transaction,
  });
  return derivarEstadoCupon(cupon, { ahora, ...usos });
}

/**
 * Valida que el cupón pueda usarse ahora y devuelve su estado.
 *
 * @param {object} cupon
 * @param {{ahora?: Date|string, usosConfirmados?: number,
 *   reservasVigentes?: number}} [opciones]
 * @returns {string} `DISPONIBLE` si pasa.
 * @throws {CuponError} Con `motivo` específico cuando no está disponible.
 */
export function validarCuponDisponible(cupon, opciones = {}) {
  if (!cupon) {
    throw new CuponError('Cupón inválido', 400, MOTIVOS_CUPON.INVALIDO);
  }
  const estado = derivarEstadoCupon(cupon, opciones);
  if (estado !== ESTADOS_CUPON.DISPONIBLE) {
    const detalle = MOTIVO_POR_ESTADO[estado];
    throw new CuponError(detalle.mensaje, 409, detalle.motivo);
  }
  return estado;
}

/**
 * Rechaza un segundo cupón sobre el mismo pedido. La regla también está
 * protegida por el UNIQUE de `PedidoCupones.pedidoId`.
 *
 * @param {object|null} pedidoCuponExistente
 */
export function validarCuponUnico(pedidoCuponExistente) {
  if (pedidoCuponExistente) {
    throw new CuponError(
      'El pedido ya tiene un cupón aplicado',
      409,
      MOTIVOS_CUPON.YA_APLICADO
    );
  }
}

/**
 * Calcula el descuento del cupón sobre el carrito.
 *
 * Reglas:
 * - Si el cupón tiene alcance (alcanceSnapshot.global === false), la compra
 *   mínima y la base se calculan únicamente sobre los productos alcanzados.
 * - Si es alcance global (cupones históricos), se usa todo el carrito.
 * - Las promociones se aplican primero sobre las líneas alcanzadas.
 * - El envío nunca forma parte de la base ni se descuenta.
 * - El descuento se limita por descuentoMaximo y por la base.
 * - Un pedido admite un solo cupón (ver validarCuponUnico).
 *
 * @param {{lineas?: Array<{productoId, subtotal}>,
 *   descuentoPromocionesPorLinea?: Array<{indice, descuento}>,
 *   subtotalItems?: number, descuentoPromociones?: number,
 *   cupon: object, ahora?: Date|string, usosConfirmados?: number,
 *   reservasVigentes?: number}} datos
 * @returns {{estado: string, subtotalItems: number,
 *   descuentoPromociones: number, baseCalculo: number,
 *   descuentoAplicado: number, subtotalNeto: number, subtotalAlcanzado: number}}
 * @throws {CuponError} Si el cupón no está disponible, no alcanza la compra
 *   mínima o no aplica a los productos del carrito.
 */
export function calcularDescuentoCupon({
  lineas = null,
  descuentoPromocionesPorLinea = null,
  subtotalItems,
  descuentoPromociones = 0,
  cupon,
  ahora = new Date(),
  usosConfirmados = 0,
  reservasVigentes = 0,
} = {}) {
  const estado = validarCuponDisponible(cupon, {
    ahora,
    usosConfirmados,
    reservasVigentes,
  });

  const alcance = cupon.alcanceSnapshot || { global: true };
  const esAlcanceGlobal = alcance.global === true;

  let subtotalAlcanzado;
  let descuentoPromocionAlcanzado;

  if (!esAlcanceGlobal && Array.isArray(lineas)) {
    const productoIdsResueltos = new Set(
      Array.isArray(alcance.productoIdsResueltos)
        ? alcance.productoIdsResueltos
        : []
    );

    const promoPorIndice = new Map();
    if (Array.isArray(descuentoPromocionesPorLinea)) {
      descuentoPromocionesPorLinea.forEach((p) => {
        promoPorIndice.set(Number(p.indice), Number(p.descuento) || 0);
      });
    }

    subtotalAlcanzado = 0;
    descuentoPromocionAlcanzado = 0;
    lineas.forEach((linea, indice) => {
      const esAlcanzado =
        productoIdsResueltos.size === 0 ||
        productoIdsResueltos.has(Number(linea.productoId));
      if (!esAlcanzado) return;
      const subtotal = Number(linea.subtotal) || 0;
      subtotalAlcanzado += subtotal;
      descuentoPromocionAlcanzado += promoPorIndice.get(indice) || 0;
    });

    subtotalAlcanzado = redondear(subtotalAlcanzado);
    descuentoPromocionAlcanzado = redondear(descuentoPromocionAlcanzado);

    // Si el carrito no tiene productos alcanzados, el cupón no aplica.
    if (subtotalAlcanzado === 0 && lineas.length > 0) {
      throw new CuponError(
        'El cupón no aplica a los productos del carrito',
        409,
        MOTIVOS_CUPON.NO_APLICA
      );
    }
  } else {
    // Modo legacy: alcance global sobre todo el carrito.
    subtotalAlcanzado = redondear(numeroNoNegativo(subtotalItems));
    descuentoPromocionAlcanzado = redondear(
      Math.min(numeroNoNegativo(descuentoPromociones), subtotalAlcanzado)
    );
  }

  const minimo = numeroNoNegativo(cupon.compraMinima);
  if (subtotalAlcanzado < minimo) {
    throw new CuponError(
      `La compra mínima para este cupón es $${minimo}`,
      409,
      MOTIVOS_CUPON.COMPRA_MINIMA
    );
  }

  const baseCalculo = redondear(
    Math.max(0, subtotalAlcanzado - descuentoPromocionAlcanzado)
  );

  let calculado;
  if (cupon.tipoDescuento === 'PORCENTAJE') {
    calculado = baseCalculo * (numeroNoNegativo(cupon.valorDescuento) / 100);
  } else if (cupon.tipoDescuento === 'MONTO_FIJO') {
    calculado = numeroNoNegativo(cupon.valorDescuento);
  } else {
    throw new CuponError(
      'El tipo de descuento del cupón es inválido',
      400,
      MOTIVOS_CUPON.INVALIDO
    );
  }

  const tope =
    cupon.descuentoMaximo === null || cupon.descuentoMaximo === undefined
      ? Infinity
      : numeroNoNegativo(cupon.descuentoMaximo);
  const descuentoAplicado = redondear(
    Math.min(Math.max(0, calculado), tope, baseCalculo)
  );

  return {
    estado,
    subtotalItems: esAlcanceGlobal
      ? subtotalAlcanzado
      : redondear(numeroNoNegativo(subtotalItems)),
    descuentoPromociones: esAlcanceGlobal
      ? descuentoPromocionAlcanzado
      : redondear(numeroNoNegativo(descuentoPromociones)),
    subtotalAlcanzado,
    descuentoPromocionAlcanzado,
    baseCalculo,
    descuentoAplicado,
    subtotalNeto: redondear(baseCalculo - descuentoAplicado),
  };
}

/**
 * Busca y reserva un cupón para un pedido nuevo dentro de la transacción que
 * crea el pedido.
 *
 * La fila del cupón se bloquea con `SELECT ... FOR UPDATE`: dos altas
 * simultáneas que usen el mismo cupón multiuso se serializan y la segunda ve
 * los usos de la primera. Solo el cliente dueño del cupón puede usarlo.
 *
 * @param {{codigo: string, usuarioId: number|string,
 *   lineas?: Array<{productoId, subtotal}>,
 *   descuentoPromocionesPorLinea?: Array<{indice, descuento}>,
 *   subtotalItems?: number, descuentoPromociones?: number,
 *   ahora?: Date|string, transaction: object}} datos
 * @returns {Promise<{cupon: object, calculo: object, usos: object}>}
 * @throws {CuponError} Si el código no existe, no es del cliente o no está
 *   disponible / no alcanza la compra mínima.
 */
export async function reservarCuponParaPedido({
  codigo,
  usuarioId,
  lineas = null,
  descuentoPromocionesPorLinea = null,
  subtotalItems,
  descuentoPromociones = 0,
  ahora = new Date(),
  transaction,
} = {}) {
  const normalizado = normalizarCodigo(codigo);
  if (!normalizado) {
    throw new CuponError(
      'Ingresá un código de cupón',
      400,
      MOTIVOS_CUPON.INVALIDO
    );
  }

  const cupon = await Cupon.findOne({
    where: { codigo: normalizado },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  // No se revela si el código existe pero pertenece a otro cliente.
  if (!cupon || Number(cupon.usuarioId) !== Number(usuarioId)) {
    throw new CuponError('Cupón inválido', 404, MOTIVOS_CUPON.INVALIDO);
  }

  const usos = await contarUsosCupon(cupon.id, { ahora, transaction });
  const calculo = calcularDescuentoCupon({
    lineas,
    descuentoPromocionesPorLinea,
    subtotalItems,
    descuentoPromociones,
    cupon,
    ahora,
    usosConfirmados: usos.usosConfirmados,
    reservasVigentes: usos.reservasVigentes,
  });

  return { cupon, calculo, usos };
}

/**
 * Revalida el cupón de un pedido al confirmar el pago.
 *
 * Se excluye la propia reserva del conteo de usos para que el pedido no se
 * bloquee a sí mismo cuando el cupón tiene un único uso. La fila del cupón se
 * bloquea para serializar la revalidación con otras altas/confirmaciones.
 *
 * @param {{pedidoCupon: object, ahora?: Date|string,
 *   transaction?: object}} datos
 * @returns {Promise<{valido: boolean, estado: string|null, motivo: string|null,
 *   cupon?: object, usos?: object}>}
 */
export async function revalidarReservaCupon({
  pedidoCupon,
  ahora = new Date(),
  transaction,
} = {}) {
  if (!pedidoCupon) {
    return {
      valido: false,
      estado: null,
      motivo: MOTIVOS_CUPON.INVALIDO,
    };
  }

  const cupon = await Cupon.findByPk(pedidoCupon.cuponId, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!cupon) {
    return {
      valido: false,
      estado: null,
      motivo: MOTIVOS_CUPON.INVALIDO,
    };
  }

  const usos = await contarUsosCupon(cupon.id, {
    ahora,
    excluirPedidoId: pedidoCupon.pedidoId,
    transaction,
  });
  const estado = derivarEstadoCupon(cupon, { ahora, ...usos });
  if (estado === ESTADOS_CUPON.DISPONIBLE) {
    return { valido: true, estado, motivo: null, cupon, usos };
  }

  return {
    valido: false,
    estado,
    motivo: MOTIVO_POR_ESTADO[estado]?.motivo || MOTIVOS_CUPON.INVALIDO,
    cupon,
    usos,
  };
}

/**
 * Marca como CONFIRMADO el uso del cupón de un pedido pagado. Es idempotente:
 * si ya estaba CONFIRMADO no vuelve a tocar `confirmadoEn`; si estaba LIBERADO
 * no hace nada.
 *
 * @param {object} pedidoCupon
 * @param {{ahora?: Date|string, transaction?: object}} [opciones]
 * @returns {Promise<object|null>} La fila confirmada, o null si no correspondía.
 */
export async function confirmarReservaCupon(
  pedidoCupon,
  { ahora = new Date(), transaction } = {}
) {
  if (!pedidoCupon) return null;
  if (pedidoCupon.estado === ESTADOS_PEDIDO_CUPON.CONFIRMADO) {
    return pedidoCupon;
  }
  if (pedidoCupon.estado !== ESTADOS_PEDIDO_CUPON.RESERVADO) return null;

  await pedidoCupon.update(
    {
      estado: ESTADOS_PEDIDO_CUPON.CONFIRMADO,
      confirmadoEn: ahora,
    },
    { transaction }
  );
  return pedidoCupon;
}

/**
 * Genera un código individual legible (sin I, O, 0 ni 1).
 *
 * @param {{longitud?: number, prefijo?: string,
 *   randomBytes?: (cantidad: number) => Buffer|number[]}} [opciones]
 * @returns {string} Código con formato `CR-XXXXXXXXXX` por defecto.
 */
export function generarCodigoCupon({
  longitud = LONGITUD_CODIGO,
  prefijo = PREFIJO_CODIGO,
  randomBytes = crypto.randomBytes,
} = {}) {
  const largo = Math.trunc(Number(longitud));
  if (!Number.isFinite(largo) || largo < 6 || largo > 48) {
    throw new CuponError(
      'La longitud del código debe estar entre 6 y 48 caracteres'
    );
  }

  const bytes = randomBytes(largo);
  if (!bytes || bytes.length < largo) {
    throw new CuponError('No se pudo generar el código del cupón', 500);
  }

  let cuerpo = '';
  for (let indice = 0; indice < largo; indice += 1) {
    cuerpo += ALFABETO_CODIGO[bytes[indice] % ALFABETO_CODIGO.length];
  }

  const inicio = normalizarCodigo(prefijo);
  return inicio ? `${inicio}-${cuerpo}` : cuerpo;
}

/**
 * Genera una lista de códigos únicos dentro del lote y contra `existentes`.
 * Útil para tests y para callers que ya tienen el conjunto de códigos tomados.
 *
 * @param {number} cantidad
 * @param {{existentes?: Array<string>|Set<string>, longitud?: number,
 *   prefijo?: string, generar?: () => string, maxIntentos?: number}} [opciones]
 * @returns {Array<string>}
 */
export function generarCodigosUnicos(
  cantidad,
  {
    existentes = [],
    longitud,
    prefijo,
    generar = () => generarCodigoCupon({ longitud, prefijo }),
    maxIntentos,
  } = {}
) {
  const total = aEnteroPositivo(cantidad, 'La cantidad de códigos');
  const limite = Math.max(total, Math.trunc(Number(maxIntentos)) || total * 50);
  const usados = new Set(
    Array.from(existentes || [])
      .map(normalizarCodigo)
      .filter(Boolean)
  );
  const codigos = [];
  let intentos = 0;

  while (codigos.length < total && intentos < limite) {
    intentos += 1;
    const codigo = normalizarCodigo(generar());
    if (!codigo || usados.has(codigo)) continue;
    usados.add(codigo);
    codigos.push(codigo);
  }

  if (codigos.length < total) {
    throw new CuponError(
      'No se pudieron generar suficientes códigos únicos',
      500
    );
  }
  return codigos;
}

/**
 * Genera códigos que tampoco existen todavía en `Cupones`. Cada candidato se
 * valida contra la base antes de devolverlo.
 *
 * @param {number} cantidad
 * @param {{existentes?: Array<string>|Set<string>, longitud?: number,
 *   prefijo?: string, generar?: (opciones?: object) => string,
 *   maxIntentos?: number, transaction?: object}} [opciones]
 * @returns {Promise<Array<string>>}
 */
export async function generarCodigosDisponibles(
  cantidad,
  {
    existentes = [],
    longitud,
    prefijo,
    generar = generarCodigoCupon,
    maxIntentos,
    transaction,
  } = {}
) {
  const total = aEnteroPositivo(cantidad, 'La cantidad de códigos');
  const limite = Math.max(total, Math.trunc(Number(maxIntentos)) || total * 50);
  const tomados = new Set(
    Array.from(existentes || [])
      .map(normalizarCodigo)
      .filter(Boolean)
  );
  const codigos = [];
  let intentos = 0;

  while (codigos.length < total && intentos < limite) {
    intentos += 1;
    const codigo = normalizarCodigo(generar({ longitud, prefijo }));
    if (!codigo || tomados.has(codigo)) continue;

    tomados.add(codigo);
    const existente = await Cupon.findOne({
      where: { codigo },
      attributes: ['id'],
      transaction,
    });
    if (!existente) codigos.push(codigo);
  }

  if (codigos.length < total) {
    throw new CuponError(
      'No se pudieron generar códigos disponibles para los cupones',
      500
    );
  }
  return codigos;
}

/**
 * Cuenta en lote los usos de varios cupones (una sola consulta para los usos y,
 * como mucho, una para el parámetro de reserva). Se usa en los listados
 * administrativos para no caer en N+1.
 *
 * @param {Array<number|string>} cuponIds
 * @param {{ahora?: Date|string, minutosReserva?: number}} [opciones]
 * @returns {Promise<Map<number, {usosConfirmados: number,
 *   reservasVigentes: number, usosActivos: number}>>}
 */
export async function contarUsosCupones(
  cuponIds,
  { ahora = new Date(), minutosReserva } = {}
) {
  const mapa = new Map(
    cuponIds.map((id) => [
      Number(id),
      { usosConfirmados: 0, reservasVigentes: 0, usosActivos: 0 },
    ])
  );
  if (cuponIds.length === 0) return mapa;

  const filas = await PedidoCupon.findAll({
    where: {
      cuponId: { [Op.in]: cuponIds },
      estado: {
        [Op.in]: [
          ESTADOS_PEDIDO_CUPON.RESERVADO,
          ESTADOS_PEDIDO_CUPON.CONFIRMADO,
        ],
      },
    },
    attributes: ['id', 'cuponId', 'estado'],
    include: [
      {
        model: Pedido,
        as: 'pedido',
        required: true,
        attributes: ['id', 'fechaHora'],
        include: [
          {
            model: EstadoPedido,
            as: 'estadoActual',
            required: true,
            attributes: ['id', 'nombre'],
          },
        ],
      },
    ],
  });

  let plazo = minutosReserva;
  if (
    plazo === undefined &&
    filas.some((fila) => fila.estado === ESTADOS_PEDIDO_CUPON.RESERVADO)
  ) {
    plazo = await obtenerValor('minutosReservaStock');
  }

  filas.forEach((fila) => {
    const conteo = mapa.get(Number(fila.cuponId));
    if (!conteo) return;
    if (fila.estado === ESTADOS_PEDIDO_CUPON.CONFIRMADO) {
      conteo.usosConfirmados += 1;
    } else if (esReservaVigente(fila, { ahora, minutosReserva: plazo })) {
      conteo.reservasVigentes += 1;
    }
  });

  mapa.forEach((conteo) => {
    conteo.usosActivos = conteo.usosConfirmados + conteo.reservasVigentes;
  });
  return mapa;
}

const numeroDecimal = (valor) =>
  valor === null || valor === undefined ? null : Number(valor);

/**
 * Serializa un cupón para la administración, con el estado derivado y el
 * detalle de usos. Los DECIMAL se exponen como números.
 *
 * @param {object} cupon - Instancia/plain object de `Cupon`.
 * @param {{ahora?: Date|string, usos?: {usosConfirmados: number,
 *   reservasVigentes: number, usosActivos: number}}} [opciones]
 * @returns {object}
 */
export function serializarCuponAdmin(cupon, { ahora = new Date(), usos } = {}) {
  if (!cupon) return null;
  const json = cupon.toJSON ? cupon.toJSON() : { ...cupon };
  const conteo = usos || {
    usosConfirmados: Number(json.usosConfirmados) || 0,
    reservasVigentes: Number(json.reservasVigentes) || 0,
    usosActivos: Number(json.usosActivos) || 0,
  };

  return {
    ...json,
    valorDescuento: Number(json.valorDescuento),
    compraMinima: Number(json.compraMinima),
    descuentoMaximo: numeroDecimal(json.descuentoMaximo),
    usosPermitidos: Number(json.usosPermitidos),
    estado: derivarEstadoCupon(json, { ahora, ...conteo }),
    usosConfirmados: conteo.usosConfirmados,
    reservasVigentes: conteo.reservasVigentes,
    usosActivos: conteo.usosActivos,
    usosRestantes: Math.max(
      0,
      (Number(json.usosPermitidos) || 1) - conteo.usosActivos
    ),
  };
}

/**
 * Listado administrativo de cupones, con filtros y paginación.
 *
 * El estado visible no se persiste (se deriva), así que el filtro por `estado`
 * se aplica en memoria después de calcular los usos. Los filtros que sí son
 * columnas (`emisionId`, `activo`) se resuelven en SQL.
 *
 * @param {{emisionId?: number|string, activo?: boolean|string,
 *   estado?: string, pagina?: number|string, limite?: number|string,
 *   ahora?: Date|string}} [opciones]
 * @returns {Promise<{items: object[], total: number, pagina: number,
 *   limite: number, paginas: number}>}
 */
export async function listarCuponesAdmin({
  emisionId,
  activo,
  estado,
  pagina = 1,
  limite = LIMITE_DEFAULT,
  ahora = new Date(),
} = {}) {
  const paginaNum = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const limiteNum = Math.min(
    LIMITE_MAX,
    Math.max(1, Number.parseInt(limite, 10) || LIMITE_DEFAULT)
  );

  const where = {};
  if (emisionId !== undefined && emisionId !== null && emisionId !== '') {
    where.emisionId = emisionId;
  }
  if (activo !== undefined && activo !== null && activo !== '') {
    where.activo =
      activo === true || activo === 'true' || activo === '1' || activo === 1;
  }

  const cupones = await Cupon.findAll({
    where,
    include: [
      {
        model: Usuario,
        as: 'usuario',
        attributes: ['id', 'nombre', 'apellido', 'email'],
        required: false,
      },
    ],
    order: [['id', 'DESC']],
  });

  const conteos = await contarUsosCupones(
    cupones.map((cupon) => cupon.id),
    { ahora }
  );

  const estadoBuscado = String(estado || '')
    .trim()
    .toUpperCase();
  const serializados = cupones
    .map((cupon) =>
      serializarCuponAdmin(cupon, {
        ahora,
        usos: conteos.get(Number(cupon.id)),
      })
    )
    .filter((cupon) => !estadoBuscado || cupon.estado === estadoBuscado);

  const total = serializados.length;
  const inicio = (paginaNum - 1) * limiteNum;
  return {
    items: serializados.slice(inicio, inicio + limiteNum),
    total,
    pagina: paginaNum,
    limite: limiteNum,
    paginas: Math.ceil(total / limiteNum),
  };
}

/**
 * Busca un cupón o lanza 404.
 * @param {number|string} id
 * @returns {Promise<object>} Instancia de `Cupon`.
 */
export async function obtenerCuponAdmin(id) {
  const cupon = await Cupon.findByPk(id, {
    include: [
      {
        model: Usuario,
        as: 'usuario',
        attributes: ['id', 'nombre', 'apellido', 'email'],
        required: false,
      },
    ],
  });
  if (!cupon) {
    throw new CuponError('Cupón no encontrado', 404, MOTIVOS_CUPON.INVALIDO);
  }
  return cupon;
}

/**
 * Detalle administrativo de un cupón, con el estado derivado y sus usos.
 * @param {number|string} id
 * @param {{ahora?: Date|string}} [opciones]
 * @returns {Promise<object>}
 */
export async function detalleCuponAdmin(id, { ahora = new Date() } = {}) {
  const cupon = await obtenerCuponAdmin(id);
  const conteos = await contarUsosCupones([cupon.id], { ahora });
  return serializarCuponAdmin(cupon, {
    ahora,
    usos: conteos.get(Number(cupon.id)),
  });
}

/**
 * Listado de cupones de un cliente (para "Mis cupones").
 * Filtra por `usuarioId` y deriva el estado visible de cada cupón.
 * No aplica paginación: el cliente suele tener pocos cupones.
 *
 * @param {number|string} usuarioId
 * @param {{ahora?: Date|string}} [opciones]
 * @returns {Promise<Array<object>>}
 */
export async function listarCuponesCliente(
  usuarioId,
  { ahora = new Date() } = {}
) {
  const cupones = await Cupon.findAll({
    where: { usuarioId },
    include: [
      {
        model: db.CuponEmision,
        as: 'emision',
        attributes: ['id', 'nombre'],
        required: false,
      },
    ],
    order: [['id', 'DESC']],
  });

  if (cupones.length === 0) return [];

  const conteos = await contarUsosCupones(
    cupones.map((cupon) => cupon.id),
    { ahora }
  );

  return cupones.map((cupon) =>
    serializarCuponAdmin(cupon, {
      ahora,
      usos: conteos.get(Number(cupon.id)),
    })
  );
}

/**
 * Baja o reactivación individual de un cupón. Es el único campo editable: el
 * resto del cupón es un snapshot de la campaña y no debe cambiar.
 *
 * @param {number|string} id
 * @param {boolean} activo
 * @param {{ahora?: Date|string}} [opciones]
 * @returns {Promise<object>} Cupón serializado.
 */
export async function cambiarActivoCupon(
  id,
  activo,
  { ahora = new Date() } = {}
) {
  if (typeof activo !== 'boolean') {
    throw new CuponError('activo debe ser true o false');
  }
  const cupon = await obtenerCuponAdmin(id);
  if (cupon.activo !== activo) {
    await cupon.update({ activo });
  }
  const conteos = await contarUsosCupones([cupon.id], { ahora });
  return serializarCuponAdmin(cupon, {
    ahora,
    usos: conteos.get(Number(cupon.id)),
  });
}
