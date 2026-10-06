/**
 * Service: seleccion_sucursal_service
 *
 * T1 del plan maestro de pedidos: selecciona la sucursal que debe atender un
 * pedido. Regla acordada (D1):
 *   Elegible = activa ∧ stock suficiente ∧ dentro de cobertura (≤5 km por ruta).
 *   Entre elegibles: LA MÁS CERCANA POR RUTA.
 *   Si ninguna: 422 "No hay sucursales disponibles con stock dentro de la cobertura".
 *
 * Reutiliza:
 *   - cobertura_service.sucursalesEnCobertura: ranking por distancia de ruta
 *     (ya consulta ORS y ordena ascendente).
 *   - stock_service.faltantesDePedido: verifica si una sucursal puede
 *     satisfacer todos los items del pedido (combos incluidos).
 *
 * NOTA: el flujo del ADMIN también la usa cuando confirma la reasignación
 * (T4): las reglas de validación son las mismas.
 */

import { sucursalesEnCobertura } from './cobertura_service';
import { faltantesDePedido } from './stock';

/**
 * Error tipado: ninguna sucursal activa dentro de cobertura tiene stock
 * suficiente para atender el pedido.
 */
export class SinSucursalElegibleError extends Error {
  constructor(mensaje, opciones = {}) {
    super(
      mensaje ||
        'No hay sucursales disponibles con stock dentro de la cobertura'
    );
    this.name = 'SinSucursalElegibleError';
    if (opciones.faltantes) {
      this.faltantes = opciones.faltantes;
    }
  }
}

/**
 * Selecciona la sucursal que debe atender un pedido: la MÁS CERCANA por
 * ruta que tenga stock suficiente, dentro de cobertura.
 * @param {object} datos - { lineas, coordenadas, sucursalPreferida?, transaction? }.
 *   `lineas`: items del pedido (con productoId, cantidad).
 *   `coordenadas`: { latitud, longitud } de la dirección de entrega (del snapshot).
 *   `sucursalPreferida`: opcional — si el cliente/admin la envía, se valida
 *     que sea elegible (activa + stock + cobertura) y se respeta.
 * @returns {Promise<object>} Instancia de `Sucursal` con su `direccion` (coords).
 * @throws {SinSucursalElegibleError} Si ninguna sucursal cumple.
 */
export async function seleccionarSucursal({
  lineas,
  coordenadas,
  sucursalPreferida = null,
  transaction = null,
} = {}) {
  if (
    !coordenadas ||
    coordenadas.latitud == null ||
    coordenadas.longitud == null
  ) {
    throw new SinSucursalElegibleError(
      'La dirección de entrega no tiene coordenadas: no se puede seleccionar una sucursal'
    );
  }

  // Ranking por distancia de ruta (ORS): solo sucursales activas geolocalizadas
  // dentro del radio máximo, ordenadas por distancia ascendente.
  const enCobertura = await sucursalesEnCobertura({
    latitud: coordenadas.latitud,
    longitud: coordenadas.longitud,
  });

  if (enCobertura.length === 0) {
    throw new SinSucursalElegibleError(
      'No hay sucursales activas dentro de la cobertura de la dirección de entrega'
    );
  }

  // Si el cliente/admin pidió una sucursal específica, se valida que sea
  // elegible (está en el ranking de cobertura Y tiene stock) y se respeta.
  if (sucursalPreferida) {
    const candidata = enCobertura.find(
      (e) => e.sucursal.id === sucursalPreferida.id
    );
    if (!candidata) {
      throw new SinSucursalElegibleError(
        'La sucursal solicitada no está dentro de la cobertura de la dirección de entrega'
      );
    }
    const faltantes = await faltantesDePedido(
      lineas,
      sucursalPreferida.id,
      transaction
    );
    if (faltantes.length > 0) {
      throw new SinSucursalElegibleError(
        'La sucursal solicitada no tiene stock suficiente',
        { faltantes }
      );
    }
    return candidata.sucursal;
  }

  // Selección automática: la MÁS CERCANA (ya ordenada) que tenga stock.
  for (const candidata of enCobertura) {
    const faltantes = await faltantesDePedido(
      lineas,
      candidata.sucursal.id,
      transaction
    );
    if (faltantes.length === 0) {
      return candidata.sucursal;
    }
  }

  // Ninguna dentro de cobertura tiene todo el stock.
  throw new SinSucursalElegibleError(
    'No hay sucursales disponibles con stock dentro de la cobertura'
  );
}
