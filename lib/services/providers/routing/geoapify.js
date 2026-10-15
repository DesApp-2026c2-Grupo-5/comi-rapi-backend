/**
 * Proveedor de routing: Geoapify — https://api.geoapify.com
 *
 * Segundo proveedor del contrato de routing (A1-2), seleccionable con
 * `ROUTING_PROVIDER=geoapify`. Mantiene el mismo contrato que ORS:
 *   - calcularRuta({ origen, destino }) → { distanciaMetros, duracionSegundos, geometria }
 *   - los mismos errores tipados del contrato (errors.js)
 *
 * Diferencias con ORS que este proveedor absorbe internamente:
 *   - Waypoints en orden `lat,lon` (Geoapify) vs `lon,lat` (ORS).
 *   - La API key viaja en el query param `apiKey` (no en header).
 *   - El resumen vive en `features[0].properties`: `distance` (metros) y
 *     `time` (segundos).
 *
 * Políticas: idénticas a ORS — un solo intento, sin retry ni cache, timeout
 * configurable (`GEOAPIFY_TIMEOUT_MS`).
 */

import fetch from 'node-fetch';
import config from '../../../config/config';
import {
  RoutingError,
  CredencialesInvalidasError,
  LimiteSolicitudesError,
  RutaInexistenteError,
} from './errors';
import { validarDatosRuta } from './validacion';

/**
 * Construye la query de Geoapify v1/routing.
 * Waypoints en orden lat,lon separados por `|` (distinto de ORS, que usa lon,lat).
 * @param {object} origen - { latitud, longitud }.
 * @param {object} destino - { latitud, longitud }.
 * @returns {string} Ruta relativa (ej. "/v1/routing?waypoints=...&mode=drive&apiKey=...").
 */
function construirQuery(origen, destino) {
  const params = new URLSearchParams();
  params.set(
    'waypoints',
    `${Number(origen.latitud)},${Number(origen.longitud)}|${Number(
      destino.latitud
    )},${Number(destino.longitud)}`
  );
  params.set('mode', config.geoapify.mode);
  params.set('apiKey', String(config.geoapify.apiKey).trim());
  return `/v1/routing?${params.toString()}`;
}

/**
 * Ejecuta la llamada HTTP a Geoapify y valida la estructura general de la
 * respuesta.
 * @param {string} ruta - Ruta relativa.
 * @returns {Promise<object>} Respuesta parseada de Geoapify (GeoJSON).
 * @throws {CredencialesInvalidasError} 401.
 * @throws {LimiteSolicitudesError} 429.
 * @throws {RutaInexistenteError} Respuesta sin features (sin ruta).
 * @throws {RoutingError} Timeout, conexión, otro HTTP o respuesta inválida.
 */
async function llamarGeoapify(ruta) {
  if (!config.geoapify.apiKey || !String(config.geoapify.apiKey).trim()) {
    throw new CredencialesInvalidasError(
      'GEOAPIFY_API_KEY no está configurada. Configurá tu clave de Geoapify en el archivo .env.local'
    );
  }

  let respuesta;
  try {
    respuesta = await fetch(`${config.geoapify.baseUrl}${ruta}`, {
      headers: { Accept: 'application/json' },
      timeout: config.geoapify.timeoutMs,
    });
  } catch (error) {
    const esTimeout = error && error.type === 'request-timeout';
    throw new RoutingError(
      esTimeout
        ? 'Timeout al consultar Geoapify'
        : 'Error de conexión con Geoapify',
      { causa: error && error.message }
    );
  }

  if (!respuesta.ok) {
    let mensaje = '';
    try {
      const cuerpo = await respuesta.json();
      mensaje =
        (cuerpo &&
          (cuerpo.message ||
            (cuerpo.error && cuerpo.error.message) ||
            cuerpo.error)) ||
        '';
      if (typeof mensaje !== 'string') {
        mensaje = '';
      }
    } catch (error) {
      mensaje = '';
    }
    const opciones = { status: respuesta.status, causa: mensaje };
    if (respuesta.status === 401) {
      throw new CredencialesInvalidasError(
        `Geoapify rechazó las credenciales (401)${
          mensaje ? `: ${mensaje}` : ''
        }`,
        opciones
      );
    }
    if (respuesta.status === 429) {
      throw new LimiteSolicitudesError(
        `Se superó el límite de solicitudes de Geoapify (429)${
          mensaje ? `: ${mensaje}` : ''
        }`,
        opciones
      );
    }
    throw new RoutingError(
      `Geoapify respondió con estado ${respuesta.status}`,
      opciones
    );
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (error) {
    throw new RoutingError('Geoapify respondió con JSON inválido', {
      causa: error && error.message,
    });
  }

  if (!datos || !Array.isArray(datos.features) || datos.features.length === 0) {
    throw new RutaInexistenteError('Geoapify no encontró una ruta');
  }

  return datos;
}

/**
 * Extrae y valida el resumen (distancia/duración) de la respuesta de Geoapify.
 * @param {object} datos - Respuesta GeoJSON de Geoapify.
 * @returns {object} { distanciaMetros, duracionSegundos, geometria }.
 * @throws {RoutingError} Si la respuesta no incluye el resumen.
 */
function extraerResumen(datos) {
  const ruta = datos.features[0];
  const propiedades = ruta && ruta.properties;
  if (
    !propiedades ||
    propiedades.distance === undefined ||
    propiedades.time === undefined
  ) {
    throw new RoutingError(
      'La respuesta de Geoapify no incluye distancia/duración'
    );
  }
  return {
    distanciaMetros: Number(propiedades.distance),
    duracionSegundos: Number(propiedades.time),
    geometria: ruta.geometry ?? null,
  };
}

/**
 * Calcula la ruta entre dos coordenadas delegando en Geoapify.
 * @param {object} datos - { origen: { latitud, longitud }, destino: { latitud, longitud } }.
 * @returns {Promise<object>} { distanciaMetros, duracionSegundos, geometria }.
 * @throws {Error} Coordenadas ausentes, inválidas o fuera de rango.
 * @throws {CredencialesInvalidasError} API key ausente o rechazada.
 * @throws {LimiteSolicitudesError} Límite de solicitudes.
 * @throws {RutaInexistenteError} Ruta no encontrada.
 * @throws {RoutingError} Timeout, conexión o respuesta inválida.
 */
export async function calcularRuta(datos) {
  validarDatosRuta(datos);
  const respuesta = await llamarGeoapify(
    construirQuery(datos.origen, datos.destino)
  );
  return extraerResumen(respuesta);
}
