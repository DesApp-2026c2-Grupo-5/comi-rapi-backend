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
 * La usan los DOS flujos de asignación:
 *   - Automática al crear el pedido (POST /pedidos).
 *   - Automática al confirmar el pago, cuando la sucursal original perdió la
 *     reserva de stock: mismas reglas D1, excluyendo la original vía
 *     `exceptoSucursalId` (la reserva venció, ya no es elegible).
 *   - El flujo del ADMIN (T4) valida con las mismas reglas al reasignar.
 *
 * Si ninguna candidata evaluada tiene stock, el error lleva los `faltantes`
 * de la mejor candidata (la que menos productos debe y, a la vez, la que más
 * unidades ofrece de esos faltantes): con eso el controller arma el mensaje
 * al cliente sin volver a consultar la base.
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

/** Cuántas unidades de los productos faltantes ofrece cada lista. */
function unidadesFaltantes(faltantes) {
  return faltantes.reduce((total, f) => total + Number(f.hay ?? 0), 0);
}

/**
 * Si `candidata` deja al pedido más cerca que `actual`: menos productos
 * faltantes y, a igual cantidad, más unidades disponibles de esos productos.
 * El desempate importa: con un producto en 4 y en 10, las dos sucursales
 * tienen el mismo faltante, así que empatan por cantidad y gana la de 10:
 * al cliente se le informa el máximo que puede conseguir.
 */
function quedaMasCerca(candidata, actual) {
  if (candidata.length !== actual.length) {
    return candidata.length < actual.length;
  }
  return unidadesFaltantes(candidata) > unidadesFaltantes(actual);
}

/**
 * Selecciona la sucursal que debe atender un pedido: la MÁS CERCANA por
 * ruta que tenga stock suficiente, dentro de cobertura.
 * @param {object} datos - { lineas, coordenadas, sucursalPreferida?, exceptoSucursalId?, transaction? }.
 *   `lineas`: items del pedido (con productoId, cantidad).
 *   `coordenadas`: { latitud, longitud } de la dirección de entrega (del snapshot).
 *   `sucursalPreferida`: opcional — si el cliente/admin la envía, se valida
 *     que sea elegible (activa + stock + cobertura) y se respeta.
 *   `exceptoSucursalId`: opcional — excluye esa sucursal del ranking (la
 *     reasignación al pagar la usa para no volver a la original, cuya
 *     reserva de stock ya venció).
 * @returns {Promise<object>} Instancia de `Sucursal` con su `direccion` (coords).
 * @throws {SinSucursalElegibleError} Si ninguna sucursal cumple. Cuando se
 *   evaluaron candidatas con stock insuficiente, el error lleva `faltantes`
 *   (los de la mejor candidata) para armar el mensaje al cliente.
 */
export async function seleccionarSucursal({
  lineas,
  coordenadas,
  sucursalPreferida = null,
  exceptoSucursalId = null,
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
  // Si la reserva de la original venció (reasignación al pagar), no se la
  // vuelve a considerar: `exceptoSucursalId` la saltea.
  let faltantesMejor = null;
  for (const candidata of enCobertura) {
    if (
      exceptoSucursalId !== null &&
      Number(candidata.sucursal.id) === Number(exceptoSucursalId)
    ) {
      continue;
    }
    const faltantes = await faltantesDePedido(
      lineas,
      candidata.sucursal.id,
      transaction
    );
    if (faltantes.length === 0) {
      return candidata.sucursal;
    }
    if (faltantesMejor === null || quedaMasCerca(faltantes, faltantesMejor)) {
      faltantesMejor = faltantes;
    }
  }

  // Ninguna dentro de cobertura tiene todo el stock: los faltantes que se
  // informan son los de la mejor candidata (si se evaluó alguna).
  throw new SinSucursalElegibleError(
    'No hay sucursales disponibles con stock dentro de la cobertura',
    { faltantes: faltantesMejor }
  );
}
