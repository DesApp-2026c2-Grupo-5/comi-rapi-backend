/**
 * Service: distancias_service (A1-3)
 *
 * Escritura del caché de distancias por ruta (`DistanciasRutas`).
 *
 * `evaluarSucursales` (cobertura_service) es el único punto donde se computan
 * distancias en vivo: cada evaluación puebla el caché con un
 * INSERT ... ON CONFLICT DO UPDATE por par evaluado. Así el alta/preview de
 * direcciones — que hoy ya paga las llamadas al proveedor — deja las
 * distancias persistidas para que la selección de sucursal (A1-4) y el ETA
 * las reutilicen sin llamar al proveedor.
 *
 * Reglas del diseño (aprobadas en A1):
 *   - Clave: 4 coordenadas redondeadas + proveedor. La lectura filtra SIEMPRE
 *     por el proveedor activo: las distancias de un proveedor jamás se
 *     reutilizan para otro.
 *   - `redondearCoord` es la ÚNICA fuente de las claves (6 decimales ≈ 0,11 m):
 *     estabiliza pares que llegan como string decimal o como number.
 *   - Sin TTL, sin DELETE: coordenadas nuevas → claves nuevas; las filas
 *     viejas quedan inalcanzables, no incorrectas.
 *   - Best-effort: si la escritura falla, se warninguea y NO se rompe la
 *     validación en vivo — el cálculo real es la fuente de verdad, el caché
 *     es una optimización.
 */

import db from '../models';
import config from '../config/config';
import { calcularRuta } from './routing_service';

/**
 * Normaliza una coordenada para usarla como clave de caché.
 * @param {number|string} valor - Coordenada (number o string decimal).
 * @returns {number} Coordenada redondeada a 6 decimales (≈ 0,11 m).
 */
export function redondearCoord(valor) {
  return Math.round(Number(valor) * 1e6) / 1e6;
}

/**
 * Guarda (upsert) los pares evaluados en vivo para un destino de entrega.
 * @param {object} datos - { destino, pares, proveedor }.
 *   `destino`: { latitud, longitud } de la dirección de ENTREGA.
 *   `pares`: [{ sucursalId, origen: { latitud, longitud }, distanciaMetros,
 *   duracionSegundos }] — uno por sucursal evaluada.
 *   `proveedor`: opcional — si no viene se usa el activo (config.routing).
 * @returns {Promise<void>} Nunca rechaza: fallo de caché ≠ fallo de validación.
 */
export async function guardarDistancias({ destino, pares, proveedor } = {}) {
  if (
    !destino ||
    Number.isNaN(Number(destino.latitud)) ||
    Number.isNaN(Number(destino.longitud)) ||
    !Array.isArray(pares) ||
    pares.length === 0
  ) {
    return;
  }
  const nombreProveedor = proveedor || config.routing.proveedor || 'ors';
  const destinoLatitud = redondearCoord(destino.latitud);
  const destinoLongitud = redondearCoord(destino.longitud);
  const ahora = new Date();

  try {
    for (const par of pares) {
      await db.sequelize.query(
        `INSERT INTO "DistanciasRutas"
           ("origenLatitud", "origenLongitud", "destinoLatitud", "destinoLongitud",
            "sucursalId", "distanciaMetros", "duracionSegundos", "proveedor",
            "calculadoEn", "createdAt", "updatedAt")
         VALUES (:origenLatitud, :origenLongitud, :destinoLatitud, :destinoLongitud,
                 :sucursalId, :distanciaMetros, :duracionSegundos, :proveedor,
                 :calculadoEn, :calculadoEn, :calculadoEn)
         ON CONFLICT ("origenLatitud", "origenLongitud", "destinoLatitud",
                      "destinoLongitud", "proveedor")
         DO UPDATE SET
           "sucursalId" = EXCLUDED."sucursalId",
           "distanciaMetros" = EXCLUDED."distanciaMetros",
           "duracionSegundos" = EXCLUDED."duracionSegundos",
           "calculadoEn" = EXCLUDED."calculadoEn",
           "updatedAt" = EXCLUDED."updatedAt"`,
        {
          replacements: {
            origenLatitud: redondearCoord(par.origen.latitud),
            origenLongitud: redondearCoord(par.origen.longitud),
            destinoLatitud,
            destinoLongitud,
            sucursalId:
              par.sucursalId === undefined || par.sucursalId === null
                ? null
                : Number(par.sucursalId),
            distanciaMetros: Math.round(Number(par.distanciaMetros)),
            duracionSegundos: Math.round(Number(par.duracionSegundos)),
            proveedor: nombreProveedor,
            calculadoEn: ahora,
          },
        }
      );
    }
  } catch (error) {
    // Best-effort: el caché es una optimización. La validación en vivo ya
    // tiene el resultado real; la escritura del caché no puede romper nada.
    // eslint-disable-next-line no-console
    console.warn(
      `[distancias_service] No se pudo actualizar el caché de distancias: ${error.message}`
    );
  }
}

/**
 * Clave estable de un par de coordenadas para buscar en el caché.
 * @param {object} punto - { latitud, longitud }.
 * @returns {string} Clave "lat|lng" con 6 decimales.
 */
export function claveDeCoordenadas({ latitud, longitud } = {}) {
  return `${redondearCoord(latitud)}|${redondearCoord(longitud)}`;
}

/**
 * Lee del caché las distancias guardadas para un destino de entrega y un
 * conjunto de orígenes (sucursales), SOLO las del proveedor activo (A1-4).
 * @param {object} datos - { destino, origenes }.
 *   `destino`: { latitud, longitud } de la dirección de ENTREGA.
 *   `origenes`: [{ latitud, longitud }] de las sucursales activas.
 * @returns {Promise<Map>} Clave de origen → { distanciaMetros, duracionSegundos }.
 *   Los orígenes sin fila (o de otro proveedor) simplemente no están.
 */
export async function obtenerDistanciasCacheadas({ destino, origenes } = {}) {
  const mapa = new Map();
  if (!destino || !Array.isArray(origenes)) {
    return mapa;
  }
  const proveedor = config.routing.proveedor || 'ors';
  const destinoLatitud = redondearCoord(destino.latitud);
  const destinoLongitud = redondearCoord(destino.longitud);
  for (const origen of origenes) {
    if (!origen) {
      continue;
    }
    const fila = await db.DistanciaRuta.findOne({
      where: {
        origenLatitud: redondearCoord(origen.latitud),
        origenLongitud: redondearCoord(origen.longitud),
        destinoLatitud,
        destinoLongitud,
        proveedor,
      },
    });
    if (fila) {
      mapa.set(claveDeCoordenadas(origen), {
        distanciaMetros: Number(fila.distanciaMetros),
        duracionSegundos: Number(fila.duracionSegundos),
      });
    }
  }
  return mapa;
}

/**
 * Obtiene la distancia y duración de UN par origen→destino: primero el caché
 * del proveedor activo; si no está, la calcula en vivo y puebla el caché
 * (self-healing). Fail-closed: los errores del proveedor se propagan — nunca
 * se aproxima ni se devuelve un valor inventado (A1-4).
 * @param {object} datos - { origen, destino, sucursalId }.
 * @returns {Promise<{ distanciaMetros, duracionSegundos, deCache }>}
 * @throws {RoutingError|Error} Errores tipados del proveedor si el caché
 *   no tiene el par y el cálculo en vivo falla.
 */
export async function obtenerOCalcularDistancia({
  origen,
  destino,
  sucursalId = null,
} = {}) {
  const cache = await obtenerDistanciasCacheadas({
    destino,
    origenes: [origen],
  });
  const cacheada = cache.get(claveDeCoordenadas(origen));
  if (cacheada) {
    return { ...cacheada, deCache: true };
  }
  const ruta = await calcularRuta({ origen, destino });
  await guardarDistancias({
    destino,
    pares: [
      {
        sucursalId,
        origen,
        distanciaMetros: ruta.distanciaMetros,
        duracionSegundos: ruta.duracionSegundos,
      },
    ],
  });
  return {
    distanciaMetros: ruta.distanciaMetros,
    duracionSegundos: ruta.duracionSegundos,
    deCache: false,
  };
}
