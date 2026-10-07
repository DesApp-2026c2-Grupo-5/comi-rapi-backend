/**
 * Service: reasignacion_service
 *
 * T4 (plan de pedidos): reasignación MANUAL de un pedido a otra sucursal,
 * disparada por un ADMINISTRADOR. Difiere de la selección automática (T1):
 *   - Automática: al crear el pedido, sin intervención humana.
 *   - Manual: post-creación, por un admin, con validaciones completas.
 *
 * Reglas (mismas que la selección automática + trazabilidad):
 *   1. El pedido debe estar en pendiente | confirmado | en_preparacion.
 *   2. La nueva sucursal debe ser activa, tener stock suficiente y estar
 *      dentro de cobertura (≤5 km por ruta desde las coords del snapshot).
 *   3. No se puede reasignar a la MISMA sucursal.
 *   4. La transferencia de stock es atómica en transacción:
 *      reponer vieja → descontar nueva → update pedido → historial.
 *   5. El ETA se recalcula con la nueva sucursal (la cocina se mantiene).
 *   6. Trazabilidad: PedidoEstadoHistorial con observación
 *      "Reasignado de X a Y por admin Z".
 */

import db from '../models';
import {
  reponerStock,
  descontarStock,
  faltantesDePedido,
  StockInsuficienteError,
} from './stock';
import { calcularEta } from './eta_service';
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
 *   `adminEmail`: email del admin que reasigna (para trazabilidad).
 * @returns {Promise<object>} Instancia de Pedido actualizada (con la nueva
 *   sucursal y el ETA recalculado).
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
  // tipado que escapa al catch del controller como 500. La dirección se
  // obtiene aparte SOLO para el ETA (calcularEta la necesita).
  const nuevaSucursal = await Sucursal.findByPk(nuevaSucursalId, {
    transaction,
  });
  if (!nuevaSucursal || !nuevaSucursal.activa) {
    throw new ReasignacionError(
      'La sucursal destino no existe o está inactiva',
      404
    );
  }

  // 3b. Dirección de la sucursal destino (para el ETA y para el nombre en
  // la trazabilidad). Se consulta APARTE para no romper findByPk si la
  // asociación cambia en el futuro.
  const direccionSucursal = await db.Direccion.findOne({
    where: { sucursalId: nuevaSucursalId },
    transaction,
  });
  nuevaSucursal.direccion = direccionSucursal;

  // 4. Cobertura: ≤5 km por ruta desde las coords del snapshot
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

  // 9. Recalcular ETA con la nueva sucursal (FUERA de la transacción lo hace
  // el controller — el service solo expone los datos necesarios).
  const eta = await calcularEta({
    sucursal: nuevaSucursal,
    coordenadasEntrega: {
      latitud: Number(pedido.latitud),
      longitud: Number(pedido.longitud),
    },
  });
  if (eta) {
    await pedido.update(
      { etaMinutos: eta.etaMinutos, etaCalculadoEn: eta.etaCalculadoEn },
      { transaction }
    );
  }
  // eta === null → ORS falló: el pedido queda reasignado sin ETA recalculado.

  return pedido;
}
