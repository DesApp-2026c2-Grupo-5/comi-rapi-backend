/**
 * Service: seleccion_sucursal_service
 *
 * T1 del plan maestro de pedidos: selecciona la sucursal que debe atender un
 * pedido. Regla acordada (D1, ampliada con horarios):
 *   Elegible = activa ∧ ABIERTA para pedidos ∧ stock suficiente ∧ dentro de
 *   cobertura (radio `radioCoberturaKm`, 5 km por ruta por defecto).
 *   Entre elegibles: LA MÁS CERCANA POR RUTA.
 *   Si la más cercana está cerrada, se saltea y se prueba la siguiente.
 *   Si ninguna está abierta: error de "cerradas" con la próxima apertura.
 *   Si hay abiertas pero ninguna con stock: mensaje de stock con `faltantes`.
 *
 * "Abierta para pedidos" usa el horario REAL del local menos el margen global
 * `margenCierreMinutos` (ver `horarios_service`). Se evalúa con UN `ahora` por
 * request, en `America/Argentina/Buenos_Aires`.
 *
 * Reutiliza:
 *   - cobertura_service.sucursalesEnCobertura: ranking por distancia de ruta.
 *   - stock_service.faltantesDePedido: verifica si una sucursal puede
 *     satisfacer todos los items del pedido (combos incluidos).
 *
 * La usan los flujos de asignación:
 *   - Automática al crear el pedido (POST /pedidos).
 *   - Automática al confirmar el pago, cuando la sucursal original cerró o
 *     perdió la reserva de stock (`exceptoSucursalId`).
 *   - El flujo del ADMIN/SUPERADMIN valida con las mismas reglas al reasignar.
 *   - Los endpoints de disponibilidad (carrito y pago) usan `evaluarCandidatas`
 *     sin reservar ni asignar nada.
 */

import { sucursalesEnCobertura } from './cobertura_service';
import { faltantesDePedido } from './stock';
import { obtenerValor } from './parametros_service';
import {
  franjaVigente,
  formatearProximaApertura,
  mensajeCerrado,
  proximaAperturaEntre,
} from './horarios_service';

/**
 * Error tipado: ninguna sucursal activa dentro de cobertura puede atender el
 * pedido (sin stock, o ninguna abierta).
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
 * Error tipado: hay sucursales en cobertura, pero ninguna está tomando pedidos
 * ahora. Lleva la próxima apertura para que el mensaje sea útil.
 */
export class SinSucursalAbiertaError extends SinSucursalElegibleError {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'SinSucursalAbiertaError';
    this.proximaApertura = opciones.proximaApertura || null;
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
 * Evalúa todas las sucursales activas en cobertura SIN asignar nada: devuelve
 * el estado de cada una (abierta/cerrada, con/sin stock) y las viables
 * ordenadas por distancia. Es la base de la selección automática y de los
 * endpoints de disponibilidad del carrito y del pago.
 *
 * @param {object} datos - { lineas, coordenadas, exceptoSucursalId?, ahora?,
 *   margenMinutos?, transaction? }.
 * @returns {Promise<object>} { enCobertura, candidatas, viables,
 *   proximaApertura, margenMinutos, ahora }.
 *   `candidatas`: [{ sucursal, distanciaMetros, abierta, franja, faltantes,
 *   conStock }] respetando `exceptoSucursalId`.
 */
export async function evaluarCandidatas({
  lineas = [],
  coordenadas,
  exceptoSucursalId = null,
  ahora = new Date(),
  margenMinutos = null,
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

  const margen =
    margenMinutos === null || margenMinutos === undefined
      ? await obtenerValor('margenCierreMinutos')
      : Number(margenMinutos);

  // Ranking por distancia de ruta (ORS): solo sucursales activas geolocalizadas
  // dentro del radio máximo, ordenadas por distancia ascendente.
  const enCobertura = await sucursalesEnCobertura({
    latitud: coordenadas.latitud,
    longitud: coordenadas.longitud,
  });

  const candidatas = [];
  for (const entrada of enCobertura) {
    if (
      exceptoSucursalId !== null &&
      Number(entrada.sucursal.id) === Number(exceptoSucursalId)
    ) {
      continue;
    }
    const franja = franjaVigente(entrada.sucursal.horarios, {
      ahora,
      margenMinutos: margen,
    });
    const faltantes =
      lineas.length > 0
        ? await faltantesDePedido(lineas, entrada.sucursal.id, { transaction })
        : [];
    candidatas.push({
      sucursal: entrada.sucursal,
      distanciaMetros: entrada.distanciaMetros,
      abierta: franja !== null,
      franja,
      faltantes,
      conStock: faltantes.length === 0,
    });
  }

  const viables = candidatas.filter((c) => c.abierta && c.conStock);
  // La próxima apertura se calcula sobre TODAS las sucursales en cobertura
  // (incluida la excluida): es la información útil para el cliente.
  const proximaApertura = proximaAperturaEntre(
    enCobertura.map((e) => e.sucursal.horarios),
    { ahora }
  );

  return {
    enCobertura,
    candidatas,
    viables,
    proximaApertura,
    margenMinutos: margen,
    ahora,
  };
}

/**
 * Selecciona la sucursal que debe atender un pedido: la MÁS CERCANA por
 * ruta que esté ABIERTA y tenga stock suficiente, dentro de cobertura.
 * @param {object} datos - { lineas, coordenadas, sucursalPreferida?,
 *   exceptoSucursalId?, transaction?, ahora?, margenMinutos? }.
 *   `lineas`: items del pedido (con productoId, cantidad).
 *   `coordenadas`: { latitud, longitud } de la dirección de entrega (snapshot).
 *   `sucursalPreferida`: opcional — si el cliente/admin la envía, se valida
 *     que sea elegible (activa + abierta + stock + cobertura) y se respeta.
 *   `exceptoSucursalId`: opcional — excluye esa sucursal del ranking (la
 *     reasignación al pagar la usa para no volver a la original, que cerró o
 *     cuya reserva venció).
 * @returns {Promise<object>} Instancia de `Sucursal` con su `direccion`.
 * @throws {SinSucursalAbiertaError} Ninguna sucursal en cobertura está abierta.
 * @throws {SinSucursalElegibleError} Sin stock / sin cobertura.
 */
export async function seleccionarSucursal({
  lineas,
  coordenadas,
  sucursalPreferida = null,
  exceptoSucursalId = null,
  transaction = null,
  ahora = new Date(),
  margenMinutos = null,
} = {}) {
  const evaluacion = await evaluarCandidatas({
    lineas,
    coordenadas,
    exceptoSucursalId,
    ahora,
    margenMinutos,
    transaction,
  });
  const { candidatas, viables, proximaApertura } = evaluacion;

  if (evaluacion.enCobertura.length === 0) {
    throw new SinSucursalElegibleError(
      'No hay sucursales activas dentro de la cobertura de la dirección de entrega'
    );
  }

  // Si el cliente/admin pidió una sucursal específica, se valida que sea
  // elegible (está en la cobertura, está abierta y tiene stock) y se respeta.
  if (sucursalPreferida) {
    const candidata = candidatas.find(
      (e) => e.sucursal.id === sucursalPreferida.id
    );
    if (!candidata) {
      throw new SinSucursalElegibleError(
        'La sucursal solicitada no está dentro de la cobertura de la dirección de entrega'
      );
    }
    if (!candidata.abierta) {
      const proxima = proximaAperturaEntre([candidata.sucursal.horarios], {
        ahora,
      });
      throw new SinSucursalAbiertaError(
        `La sucursal solicitada no está tomando pedidos en este momento.${
          proxima
            ? ` Volvemos a abrir ${formatearProximaApertura(proxima)}.`
            : ''
        }`,
        { proximaApertura: proxima }
      );
    }
    if (!candidata.conStock) {
      throw new SinSucursalElegibleError(
        'La sucursal solicitada no tiene stock suficiente',
        { faltantes: candidata.faltantes }
      );
    }
    return candidata.sucursal;
  }

  // Selección automática: la MÁS CERCANA (ya ordenada) que esté abierta y
  // tenga stock. Si la reserva de la original venció (reasignación al pagar),
  // no se la vuelve a considerar: `exceptoSucursalId` la saltea.
  const abiertas = candidatas.filter((c) => c.abierta);
  if (abiertas.length === 0) {
    throw new SinSucursalAbiertaError(mensajeCerrado(proximaApertura), {
      proximaApertura,
    });
  }

  if (viables.length > 0) {
    return viables[0].sucursal;
  }

  // Ninguna abierta dentro de cobertura tiene todo el stock: los faltantes que
  // se informan son los de la mejor candidata abierta.
  let faltantesMejor = null;
  abiertas.forEach((candidata) => {
    if (
      faltantesMejor === null ||
      quedaMasCerca(candidata.faltantes, faltantesMejor)
    ) {
      faltantesMejor = candidata.faltantes;
    }
  });

  throw new SinSucursalElegibleError(
    'No hay sucursales disponibles con stock dentro de la cobertura',
    { faltantes: faltantesMejor }
  );
}
