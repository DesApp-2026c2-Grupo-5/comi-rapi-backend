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
import { calcularRuta } from './routing_service';

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
    const ruta = await calcularRuta({
      origen: {
        latitud: Number(direccion.latitud),
        longitud: Number(direccion.longitud),
      },
      destino: {
        latitud: Number(coordenadasEntrega.latitud),
        longitud: Number(coordenadasEntrega.longitud),
      },
    });

    const viajeMin = Math.ceil(ruta.duracionSegundos / 60);
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
