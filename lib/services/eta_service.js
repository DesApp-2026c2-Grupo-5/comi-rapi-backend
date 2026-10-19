/**
 * Service: eta_service
 *
 * T2: cálculo del tiempo estimado de entrega.
 *
 *   ETA = tiempo de cocina (config.pedidos.tiempoCocinaMin, fijo 30 min)
 *       + tiempo de viaje (ORS duracionSegundos, convertido a minutos)
 *
 * Se calcula AL CONFIRMAR el pedido (pendiente→confirmado): es el momento en
 * que la sucursal es definitiva (la reserva de stock puede reasignarla al
 * pagar). Si la sucursal cambia (reasignación automática o manual), el ETA
 * se recalcula con la nueva sucursal (la cocina se mantiene).
 *
 * Degración: si ORS falla (timeout, caída, sin credenciales), `etaMinutos`
 * queda null y el pago NUNCA se bloquea — el pedido se confirma igual. El
 * error se loguea para diagnóstico.
 *
 * Reutiliza routing_service.calcularRuta (devuelve
 * duracionSegundos; hasta ahora no se usaba): el viaje es la duración real por
 * ruta desde la sucursal asignada hasta las coordenadas de entrega del
 * snapshot del pedido (persistidas por T0).
 */

import config from '../config/config';
import { obtenerOCalcularDistancia } from './distancias_service';

/**
 * Calcula la HORA ABSOLUTA de llegada estimada (A6): ahora + duración del
 * viaje. Se persiste al pasar el pedido a `en_camino` y es el ancla del
 * "quedan X min" que ve el cliente.
 *
 * La duración sale del caché de distancias si el par ya fue calculado (alta de
 * la dirección, selección, reasignación); si no está, se calcula en vivo y se
 * cachea (self-healing). Degrada a null igual que calcularEta: el paso a
 * en_camino NUNCA se bloquea por una falla del proveedor.
 *
 * @param {object} datos - { sucursal, coordenadasEntrega }.
 *   `sucursal`: instancia de Sucursal con su Direccion (coords) incluida.
 *   `coordenadasEntrega`: { latitud, longitud } del snapshot del pedido.
 * @returns {Promise<{ horaEstimadaLlegada: Date } | null>} Null si no se pudo
 *   calcular (sin coords, proveedor caído): degradación sin bloquear.
 */
export async function calcularHoraLlegada({
  sucursal,
  coordenadasEntrega,
} = {}) {
  if (!sucursal || !coordenadasEntrega) {
    return null;
  }

  const direccion = sucursal.direccion || sucursal;
  if (
    !direccion ||
    direccion.latitud === null ||
    direccion.latitud === undefined ||
    direccion.longitud === null ||
    direccion.longitud === undefined
  ) {
    return null;
  }

  try {
    const { duracionSegundos } = await obtenerOCalcularDistancia({
      origen: {
        latitud: Number(direccion.latitud),
        longitud: Number(direccion.longitud),
      },
      destino: {
        latitud: Number(coordenadasEntrega.latitud),
        longitud: Number(coordenadasEntrega.longitud),
      },
      sucursalId: sucursal.id,
    });

    return {
      horaEstimadaLlegada: new Date(Date.now() + duracionSegundos * 1000),
    };
  } catch (error) {
    // Degradación: el proveedor falló (timeout, caída, credenciales). El
    // pedido queda en_camino sin hora estimada — el front muestra "—" y el
    // repartidor sigue su curso. El error ya fue logueado por el service.
    // eslint-disable-next-line no-console
    console.warn(
      `[eta_service] No se pudo calcular la hora de llegada (proveedor falló): ${error.message}`
    );
    return null;
  }
}

/**
 * Calcula el ETA de un pedido: cocina + viaje por ruta.
 * @param {object} datos - { sucursal, coordenadasEntrega }.
 *   `sucursal`: instancia de Sucursal con su Direccion (coords) incluida.
 *   `coordenadasEntrega`: { latitud, longitud } del snapshot del pedido.
 * @returns {Promise<{ etaMinutos: number, etaCalculadoEn: Date } | null>}
 *   Null si no se pudo calcular (sin coords, ORS caído): degradación sin
 *   bloquear la confirmación.
 */
export async function calcularEta({ sucursal, coordenadasEntrega } = {}) {
  if (!sucursal || !coordenadasEntrega) {
    return null;
  }

  const direccion = sucursal.direccion || sucursal;
  if (
    !direccion ||
    direccion.latitud === null ||
    direccion.latitud === undefined ||
    direccion.longitud === null ||
    direccion.longitud === undefined
  ) {
    return null;
  }

  try {
    // A1-4: la duración del viaje sale del caché de distancias si el par ya
    // fue calculado (alta de la dirección, selección, reasignación); si no
    // está, se calcula en vivo y se guarda (self-healing).
    const { duracionSegundos } = await obtenerOCalcularDistancia({
      origen: {
        latitud: Number(direccion.latitud),
        longitud: Number(direccion.longitud),
      },
      destino: {
        latitud: Number(coordenadasEntrega.latitud),
        longitud: Number(coordenadasEntrega.longitud),
      },
      sucursalId: sucursal.id,
    });

    const viajeMin = Math.ceil(duracionSegundos / 60);
    const etaMinutos = config.pedidos.tiempoCocinaMin + viajeMin;

    return {
      etaMinutos,
      etaCalculadoEn: new Date(),
    };
  } catch (error) {
    // Degración: ORS falló (timeout, caída, credenciales). El pedido se
    // confirma igual con etaMinutos null — el front muestra "—" y listo.
    // eslint-disable-next-line no-console
    console.warn(
      `[eta_service] No se pudo calcular el ETA (ORS falló): ${error.message}`
    );
    return null;
  }
}
