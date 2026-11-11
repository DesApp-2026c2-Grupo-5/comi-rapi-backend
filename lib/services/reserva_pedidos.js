/**
 * Service: reserva_pedidos
 *
 * Regla: un pedido nace en estado PENDIENTE y, al crearse, descuenta el stock
 * de su sucursal. Esa es la "reserva" de las unidades. El cliente tiene un
 * plazo configurable (`minutosReservaStock`, default 15) para completar el pago.
 * Si no lo hace, el pedido se cancela automáticamente: se repone el stock y se
 * deja el historial en `cancelado`. El cliente vuelve al carrito con los mismos
 * productos y un único aviso simple ("Tiempo de pago excedido"), igual que
 * cuando la sucursal cierra sin alternativa (§22). No se crea una notificación
 * persistida en el centro del cliente: el plazo vencido no deja avisos extra.
 *
 * La fecha de creación (`Pedido.fechaHora`) es el inicio de la reserva: no hace
 * falta otra columna. El vencimiento se evalúa con un único `ahora` para que el
 * cálculo sea determinístico y testeable.
 *
 * El vigía (`reserva_vigia.js`) cancela los pedidos vencidos en segundo plano.
 * La confirmación del pago (`pedido_controller.cambiarEstado`) revalida el
 * plazo dentro de la misma transacción y con la fila bloqueada, así que un pago
 * nunca gana la carrera contra el vencimiento ni se repone el stock dos veces.
 */

import { Op } from 'sequelize';
import db from '../models';
import { ESTADOS_PEDIDO } from './estados_pedido';
import { obtenerValor } from './parametros_service';
import { reponerStock } from './stock';

const { EstadoPedido, Pedido, PedidoEstadoHistorial, PedidoItem } = db;

/** Texto que queda en `PedidoEstadoHistorial`: identifica la cancelación automática. */
export const OBSERVACION_CANCELACION_RESERVA =
  'Cancelado automáticamente: no se completó el pago dentro del plazo de reserva de stock.';

/** Tope de pedidos vencidos que procesa el vigía en cada pasada. */
const LOTE_MAXIMO = 100;

/**
 * Momento en que vence la reserva de un pedido.
 * @param {{fechaHora: Date|string}} pedido
 * @param {number} minutos - Plazo vigente.
 * @returns {Date|null} Fecha de vencimiento, o null si `fechaHora` no es válida.
 */
export function expiracionReserva(pedido, minutos) {
  const crudo = pedido && pedido.fechaHora;
  // Sin fecha (null, undefined o cadena vacía) no hay plazo que calcular. No
  // se debe caer al epoch: un pedido sin fecha quedaría "vencido" al instante.
  if (crudo === null || crudo === undefined || crudo === '') return null;
  const creado = new Date(crudo).getTime();
  if (!Number.isFinite(creado)) return null;
  return new Date(creado + Number(minutos) * 60 * 1000);
}

/**
 * Indica si la reserva de stock del pedido ya venció.
 * @param {{fechaHora: Date|string}} pedido
 * @param {number} minutos
 * @param {Date} [ahora]
 * @returns {boolean}
 */
export function reservaVencida(pedido, minutos, ahora = new Date()) {
  const expira = expiracionReserva(pedido, minutos);
  if (!expira) return false;
  return ahora.getTime() >= expira.getTime();
}

/**
 * Segundos que le quedan al cliente para pagar. Nunca devuelve negativos.
 * @param {{fechaHora: Date|string}} pedido
 * @param {number} minutos
 * @param {Date} [ahora]
 * @returns {number}
 */
export function segundosRestantesReserva(pedido, minutos, ahora = new Date()) {
  const expira = expiracionReserva(pedido, minutos);
  if (!expira) return 0;
  return Math.max(0, Math.ceil((expira.getTime() - ahora.getTime()) / 1000));
}

/**
 * Aplica la cancelación por reserva vencida DENTRO de una transacción ya
 * abierta. El llamador es responsable de haber bloqueado la fila del pedido y
 * de haber confirmado que sigue PENDIENTE y vencido.
 *
 * Deja el pedido en `cancelado`, registra el historial sin usuario (es una
 * decisión del sistema) y repone el stock. No genera notificación persistida:
 * el cliente solo ve el aviso simple al volver al carrito.
 *
 * @param {object} pedido - Instancia de `Pedido`.
 * @param {Array<object>} items - Líneas del pedido.
 * @param {{transaction: object}} opciones
 * @returns {Promise<{sucursalId: number, filasStock: Array}>}
 */
export async function cancelarReservaEnTransaccion(
  pedido,
  items,
  { transaction } = {}
) {
  const estadoCancelado = await EstadoPedido.findOne({
    where: { nombre: ESTADOS_PEDIDO.CANCELADO },
    transaction,
  });
  if (!estadoCancelado) {
    throw new Error(`Estado "${ESTADOS_PEDIDO.CANCELADO}" no configurado`);
  }

  await pedido.update({ estadoId: estadoCancelado.id }, { transaction });
  await PedidoEstadoHistorial.create(
    {
      pedidoId: pedido.id,
      estadoId: estadoCancelado.id,
      usuarioId: null,
      observacion: OBSERVACION_CANCELACION_RESERVA,
    },
    { transaction }
  );

  // Solo las líneas del catálogo tienen stock que reponer. `reponerStock`
  // también devuelve los insumos (extras/condimentos) y los combos recalculados.
  const lineas = (items || []).filter((item) => item.productoId);
  const filasStock = await reponerStock(lineas, pedido.sucursalId, {
    transaction,
  });

  return {
    sucursalId: Number(pedido.sucursalId),
    filasStock,
  };
}

/**
 * Cancela un pedido si su reserva venció y sigue PENDIENTE. Se ejecuta en su
 * propia transacción y bloquea la fila: si el cliente confirmó el pago o el
 * pedido ya cambió de estado, no hace nada.
 *
 * @param {number|string} pedidoId
 * @param {{ahora?: Date, minutos?: number}} [opciones]
 * @returns {Promise<object|null>} Resultado de la cancelación, o null si no correspondía.
 */
export async function cancelarPedidoVencido(
  pedidoId,
  { ahora = new Date(), minutos } = {}
) {
  const plazo =
    minutos !== undefined
      ? Number(minutos)
      : await obtenerValor('minutosReservaStock');
  const transaction = await db.sequelize.transaction();
  try {
    const pedido = await Pedido.findByPk(pedidoId, {
      attributes: ['id', 'usuarioId', 'sucursalId', 'fechaHora', 'estadoId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!pedido) {
      await transaction.rollback();
      return null;
    }
    const estado = await EstadoPedido.findByPk(pedido.estadoId, {
      transaction,
    });
    if (!estado || estado.nombre !== ESTADOS_PEDIDO.PENDIENTE) {
      await transaction.rollback();
      return null;
    }
    if (!reservaVencida(pedido, plazo, ahora)) {
      await transaction.rollback();
      return null;
    }

    const items = await PedidoItem.findAll({
      where: { pedidoId: pedido.id },
      transaction,
    });
    const cancelacion = await cancelarReservaEnTransaccion(pedido, items, {
      transaction,
    });
    await transaction.commit();
    return { pedidoId: Number(pedido.id), ...cancelacion };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Busca y cancela los pedidos PENDIENTES cuya reserva ya venció.
 * Pensado para el vigía; devuelve sólo los pedidos que efectivamente canceló
 * para que el llamador emita los eventos de tiempo real después del commit.
 *
 * @param {{ahora?: Date, minutos?: number}} [opciones]
 * @returns {Promise<Array<object>>}
 */
export async function cancelarPedidosVencidos({
  ahora = new Date(),
  minutos,
} = {}) {
  const plazo =
    minutos !== undefined
      ? Number(minutos)
      : await obtenerValor('minutosReservaStock');
  const estadoPendiente = await EstadoPedido.findOne({
    where: { nombre: ESTADOS_PEDIDO.PENDIENTE },
  });
  if (!estadoPendiente) return [];

  const limite = new Date(ahora.getTime() - plazo * 60 * 1000);
  const candidatos = await Pedido.findAll({
    where: {
      estadoId: estadoPendiente.id,
      fechaHora: { [Op.lte]: limite },
    },
    attributes: ['id'],
    order: [['fechaHora', 'ASC']],
    limit: LOTE_MAXIMO,
  });

  const cancelados = [];
  for (const candidato of candidatos) {
    const resultado = await cancelarPedidoVencido(candidato.id, {
      ahora,
      minutos: plazo,
    });
    if (resultado) cancelados.push(resultado);
  }
  return cancelados;
}
