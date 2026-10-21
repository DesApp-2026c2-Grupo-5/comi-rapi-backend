/**
 * Service: reasignacion_service
 *
 * Reasignación MANUAL de un pedido a otra sucursal, disparada por el
 * SUPERADMINISTRADOR con contexto de sucursal (la ruta exige el contexto y que
 * el pedido pertenezca a esa sucursal; el ADMINISTRADOR de sucursal ya no
 * reasigna manualmente). Difiere de la selección automática (T1):
 *   - Automática: al crear el pedido, sin intervención humana.
 *   - Manual: post-creación, con validaciones completas.
 *
 * Reglas (mismas que la selección automática + trazabilidad):
 *   1. El pedido debe estar en pendiente | confirmado | en_preparacion.
 *   2. La nueva sucursal debe ser activa, tener stock suficiente y estar
 *      dentro de cobertura (radio vigente por ruta desde las coords del
 *      snapshot).
 *   3. No se puede reasignar a la MISMA sucursal.
 *   4. La transferencia de stock es atómica en transacción:
 *      reponer vieja → descontar nueva → update pedido → historial.
 *   5. El ETA se recalcula con la nueva sucursal FUERA de la transacción
 *      (post-commit, lo hace el controller): una falla del proveedor de
 *      rutas degrada a "sin ETA" sin bloquear la reasignación.
 *   6. Trazabilidad: PedidoEstadoHistorial con observación
 *      "Reasignado de X a Y por admin Z" (sin cambio de estado).
 */

import db from '../models';
import {
  reponerStock,
  descontarStock,
  faltantesDePedido,
  StockInsuficienteError,
} from './stock';
import { ESTADOS_PEDIDO } from './estados_pedido';
import { sucursalesEnCobertura } from './cobertura_service';

const { Sucursal, PedidoEstadoHistorial } = db;

export const ESTADOS_REASIGNABLES = [
  ESTADOS_PEDIDO.PENDIENTE,
  ESTADOS_PEDIDO.CONFIRMADO,
  ESTADOS_PEDIDO.EN_PREPARACION,
];

export class ReasignacionError extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ReasignacionError';
    this.status = status;
  }
}

/**
 * Reasigna manualmente un pedido a otra sucursal.
 * @param {object} datos - { pedido, nuevaSucursalId, adminEmail, transaction }.
 *   `pedido`: instancia de Pedido con items incluidos.
 *   `nuevaSucursalId`: id de la sucursal destino.
 *   `adminEmail`: email de quien reasigna (para trazabilidad).
 * @returns {Promise<object>} Instancia de Pedido actualizada (con la nueva
 *   sucursal). El ETA lo recalcula el controller después del commit.
 * @throws {ReasignacionError} Estado inválido / misma sucursal / fuera de cobertura.
 * @throws {StockInsuficienteError} La nueva sucursal no tiene stock suficiente.
 */
export async function reasignarPedido({
  pedido,
  nuevaSucursalId,
  adminEmail,
  transaction,
} = {}) {
  // 1. Estado habilitado
  const estadoActual = pedido.estadoActual
    ? pedido.estadoActual.nombre
    : undefined;
  if (!ESTADOS_REASIGNABLES.includes(estadoActual)) {
    throw new ReasignacionError(
      `No se puede reasignar un pedido en estado "${estadoActual}": solo se puede en pendiente, confirmado o en_preparacion`,
      403
    );
  }

  // 2. No la misma sucursal
  if (Number(pedido.sucursalId) === Number(nuevaSucursalId)) {
    throw new ReasignacionError(
      'El pedido ya está asignado a esa sucursal',
      400
    );
  }

  // 3. La nueva sucursal existe y está activa
  // Fix 404: SIN include de Direccion — si la asociación falla en runtime
  // (merge de dev puede cambiar el modelo), el findByPk lanza un error no
  // tipado que escapa al catch del controller como 500.
  const nuevaSucursal = await Sucursal.findByPk(nuevaSucursalId, {
    transaction,
  });
  if (!nuevaSucursal || !nuevaSucursal.activa) {
    throw new ReasignacionError(
      'La sucursal destino no existe o está inactiva',
      404
    );
  }

  // 4. Cobertura: radio vigente por ruta desde las coords del snapshot
  if (pedido.latitud === null || pedido.longitud === null) {
    throw new ReasignacionError(
      'El pedido no tiene coordenadas de entrega: no se puede validar la cobertura',
      422
    );
  }
  const enCobertura = await sucursalesEnCobertura({
    latitud: Number(pedido.latitud),
    longitud: Number(pedido.longitud),
  });
  const elegible = enCobertura.find((e) => e.sucursal.id === nuevaSucursalId);
  if (!elegible) {
    throw new ReasignacionError(
      'La sucursal destino está fuera de la cobertura de la dirección de entrega',
      422
    );
  }

  // 5. Stock suficiente en la nueva sucursal
  const items = (pedido.items || []).filter((i) => i.productoId);
  if (items.length > 0) {
    const faltantes = await faltantesDePedido(items, nuevaSucursalId, {
      transaction,
    });
    if (faltantes.length > 0) {
      throw new StockInsuficienteError(faltantes);
    }
  }

  // 6. Obtener el nombre de la sucursal vieja para la trazabilidad
  const viejaSucursal = await Sucursal.findByPk(pedido.sucursalId, {
    transaction,
  });

  // 7. Transferencia de stock + update en la MISMA transacción
  if (items.length > 0) {
    await reponerStock(items, pedido.sucursalId, { transaction });
    await descontarStock(items, nuevaSucursalId, { transaction });
  }
  await pedido.update({ sucursalId: nuevaSucursalId }, { transaction });

  // 8. Trazabilidad en el historial (sin cambio de estado, solo observación)
  await PedidoEstadoHistorial.create(
    {
      pedidoId: pedido.id,
      estadoId: pedido.estadoId,
      observacion: `Reasignado de "${viejaSucursal?.nombre}" a "${nuevaSucursal.nombre}" por admin ${adminEmail}`,
    },
    { transaction }
  );

  // El ETA se recalcula en el CONTROLLER, después del commit: calcularlo
  // acá mantendría la transacción (con locks sobre el stock de las dos
  // sucursales) esperando una red externa. Si el proveedor falla, el
  // pedido queda reasignado sin ETA recalculado (degradación, igual que en
  // la confirmación del pago).

  return pedido;
}
