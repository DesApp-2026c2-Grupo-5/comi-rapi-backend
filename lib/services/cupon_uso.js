/**
 * Service: cupon_uso
 *
 * Ciclo de vida de un `PedidoCupon` (reserva, confirmación y liberación).
 *
 * Vive aparte de `cupones.js` para que `reserva_pedidos.js` pueda liberar el
 * cupón al cancelar un pedido vencido sin crear un ciclo de imports: `cupones`
 * usa las reglas de vencimiento de `reserva_pedidos`, pero la liberación es una
 * operación de bajo nivel que solo depende de los modelos.
 */

import db from '../models';

const { PedidoCupon } = db;

/** Estados internos del uso de un cupón en un pedido. */
export const ESTADOS_PEDIDO_CUPON = Object.freeze({
  RESERVADO: 'RESERVADO',
  CONFIRMADO: 'CONFIRMADO',
  LIBERADO: 'LIBERADO',
});

/** Resultados posibles de `liberarCuponDePedido`. */
export const RESULTADOS_LIBERACION = Object.freeze({
  LIBERADO: 'liberado',
  SIN_CUPON: 'sin_cupon',
  YA_LIBERADO: 'ya_liberado',
  NO_RESERVADO: 'no_reservado',
});

const aFecha = (valor) => {
  if (valor instanceof Date) {
    return Number.isFinite(valor.getTime()) ? valor : null;
  }
  if (valor === null || valor === undefined || valor === '') return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
};

/**
 * Libera el uso del cupón asociado a un pedido. Es idempotente:
 *
 * - Si no hay cupón, devuelve `sin_cupon`.
 * - Si ya estaba LIBERADO, devuelve `ya_liberado` sin tocar `liberadoEn`.
 * - Tanto RESERVADO como CONFIRMADO pasan a LIBERADO. La cancelación de un
 *   pedido ya confirmado también debe devolver el cupón al cliente.
 *
 * La fila se bloquea con `SELECT ... FOR UPDATE` para que dos liberaciones
 * simultáneas del mismo pedido no compitan. Si el llamador ya tiene una
 * transacción, se reutiliza; si no, se abre una propia.
 *
 * @param {number|string} pedidoId
 * @param {{transaction?: object, ahora?: Date|string}} [opciones]
 * @returns {Promise<{liberado: boolean, motivo: string, pedidoId?: number,
 *   cuponId?: number}>}
 */
export async function liberarCuponDePedido(
  pedidoId,
  { transaction, ahora = new Date() } = {}
) {
  const ejecutar = async (t) => {
    const fila = await PedidoCupon.findOne({
      where: { pedidoId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!fila) {
      return {
        liberado: false,
        motivo: RESULTADOS_LIBERACION.SIN_CUPON,
      };
    }

    const referencia = {
      pedidoId: Number(fila.pedidoId),
      cuponId: Number(fila.cuponId),
    };

    if (fila.estado === ESTADOS_PEDIDO_CUPON.LIBERADO) {
      return {
        liberado: false,
        motivo: RESULTADOS_LIBERACION.YA_LIBERADO,
        ...referencia,
      };
    }
    // Un cupón CONFIRMADO se consumió definitivamente: no se libera aunque el
    // pedido se cancele posteriormente. Solo se liberan reservas previas a la
    // confirmación (estado RESERVADO).
    if (fila.estado !== ESTADOS_PEDIDO_CUPON.RESERVADO) {
      return {
        liberado: false,
        motivo: RESULTADOS_LIBERACION.NO_RESERVADO,
        ...referencia,
      };
    }

    const momento = aFecha(ahora) || new Date();
    await fila.update(
      {
        estado: ESTADOS_PEDIDO_CUPON.LIBERADO,
        liberadoEn: momento,
      },
      { transaction: t }
    );

    return {
      liberado: true,
      motivo: RESULTADOS_LIBERACION.LIBERADO,
      ...referencia,
    };
  };

  if (transaction) return ejecutar(transaction);

  const propia = await db.sequelize.transaction();
  try {
    const resultado = await ejecutar(propia);
    await propia.commit();
    return resultado;
  } catch (error) {
    await propia.rollback();
    throw error;
  }
}
