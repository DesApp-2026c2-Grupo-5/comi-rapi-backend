/**
 * Servicio: routing_service
 *
 * Cálculo de rutas (distancia y duración) vía OpenRouteService (ORS)
 * (https://api.openrouteservice.org, API externa con clave). Encapsula la
 * comunicación HTTP con ORS, el parseo de la respuesta y los errores tipados.
 * No contiene reglas de negocio ni integración con modelos/controllers: devuelve
 * un resultado plano para que servicios/controllers posteriores decidan cómo
 * usarlo (asignación de sucursal, cobertura, pedidos, etc.).
 *
 * Abstracción de proveedor: solo este archivo conoce a OpenRouteService.
 * En el futuro puede reemplazarse por OSRM (autoalojado) u otro proveedor sin
 * modificar la lógica de negocio.
 *
 * API:
 *   - calcularRuta({ origen: { latitud, longitud }, destino: { latitud, longitud } })
 *       → Promise<{ distanciaMetros, duracionSegundos, geometria }>
 *       (geometría: polyline del trazado que devuelve ORS; se devuelve solo en la
 *       respuesta del servicio, no se persiste ni se integra con el frontend)
 *
 * Errores tipados:
 *   - OrsError: errores generales (HTTP 400/5xx, conexión/timeout, respuesta
 *     inválida/incompleta) o falta de credenciales en la configuración.
 *   - CredencialesInvalidasError (extiende OrsError): API key ausente/inválida (401).
 *   - LimiteSolicitudesError (extiende OrsError): cuota/límite de solicitudes (429).
 *   - RutaInexistenteError (extiende OrsError): ORS no encontró una ruta (404).
 *
 * Políticas:
 *   - Un solo intento, sin retry ni cache (alcance académico).
 *   - Timeout configurable (`config.ors.timeoutMs`).
 *   - La API key se envía por header `Authorization` (NO en la URL/query params).
 *   - Nota: ORS usa orden `lon,lat`; este servicio convierte internamente las
 *     coordenadas (`latitud`/`longitud`) a ese orden.
 */

import fetch from 'node-fetch';
import config from '../config/config';

export class OrsError extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje);
    this.name = 'OrsError';
    if (opciones.status !== undefined) {
      this.status = opciones.status;
    }
    if (opciones.causa !== undefined) {
      this.causa = opciones.causa;
    }
  }
}

export class CredencialesInvalidasError extends OrsError {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'CredencialesInvalidasError';
  }
}

export class LimiteSolicitudesError extends OrsError {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'LimiteSolicitudesError';
  }
}

export class RutaInexistenteError extends OrsError {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'RutaInexistenteError';
  }
}

const LIMITES_LAT = { MIN: -90, MAX: 90 };
const LIMITES_LNG = { MIN: -180, MAX: 180 };

/**
 * Valida que las coordenadas estén presentes, sean numéricas y estén en rango.
 * @param {string} nombre - "origen" o "destino".
 * @param {object} punto - { latitud, longitud }.
 * @throws {Error} Coordenadas ausentes, inválidas o fuera de rango.
 */
function validarPunto(nombre, punto) {
  if (!punto || typeof punto !== 'object') {
    throw new Error(`El punto ${nombre} es obligatorio`);
  }
  const { latitud, longitud } = punto;
  if (latitud === undefined || latitud === null || latitud === '') {
    throw new Error(`La latitud del punto ${nombre} es obligatoria`);
  }
  if (longitud === undefined || longitud === null || longitud === '') {
    throw new Error(`La longitud del punto ${nombre} es obligatoria`);
  }
  const lat = Number(latitud);
  const lng = Number(longitud);
  if (Number.isNaN(lat) || lat < LIMITES_LAT.MIN || lat > LIMITES_LAT.MAX) {
    throw new Error(
      `La latitud del punto ${nombre} debe estar entre ${LIMITES_LAT.MIN} y ${LIMITES_LAT.MAX}`
    );
  }
  if (Number.isNaN(lng) || lng < LIMITES_LNG.MIN || lng > LIMITES_LNG.MAX) {
    throw new Error(
      `La longitud del punto ${nombre} debe estar entre ${LIMITES_LNG.MIN} y ${LIMITES_LNG.MAX}`
    );
  }
}

function validarDatosRuta({ origen, destino }) {
  validarPunto('origen', origen);
  validarPunto('destino', destino);
}

/**
 * Construye la URL de la solicitud a ORS v2 directions.
 * ORS usa orden lon,lat (inverso a las coordenadas de Georef).
 * @param {object} origen - { latitud, longitud }.
 * @param {object} destino - { latitud, longitud }.
 * @returns {string} Ruta relativa (ej. "/v2/directions/driving-car?start=...&end=...").
 */
function construirQuery(origen, destino) {
  const params = new URLSearchParams();
  params.set('start', `${Number(origen.longitud)},${Number(origen.latitud)}`);
  params.set('end', `${Number(destino.longitud)},${Number(destino.latitud)}`);
  return `/v2/directions/${config.ors.profile}?${params.toString()}`;
}

/**
 * Ejecuta la llamada HTTP a ORS y valida la estructura general de la respuesta.
 * @param {string} ruta - Ruta relativa.
 * @returns {Promise<object>} Respuesta parseada de ORS (GeoJSON).
 * @throws {CredencialesInvalidasError} 401.
 * @throws {LimiteSolicitudesError} 429.
 * @throws {RutaInexistenteError} 404.
 * @throws {OrsError} Timeout, conexión, 400/5xx o respuesta inválida.
 */
async function llamarOrs(ruta) {
  if (!config.ors.apiKey || !String(config.ors.apiKey).trim()) {
    throw new CredencialesInvalidasError(
      'ORS_API_KEY no está configurada. Configurá tu clave de OpenRouteService en el archivo .env.local'
    );
  }

  let respuesta;
  try {
    respuesta = await fetch(`${config.ors.baseUrl}${ruta}`, {
      headers: {
        Authorization: String(config.ors.apiKey).trim(),
        // ORS rechaza "Accept: application/json" (406): exige application/geo+json.
        Accept: 'application/geo+json, application/json',
      },
      timeout: config.ors.timeoutMs,
    });
  } catch (error) {
    const esTimeout = error && error.type === 'request-timeout';
    throw new OrsError(
      esTimeout
        ? 'Timeout al consultar OpenRouteService'
        : 'Error de conexión con OpenRouteService',
      { causa: error && error.message }
    );
  }

  if (!respuesta.ok) {
    let mensaje = '';
    try {
      const cuerpo = await respuesta.json();
      mensaje =
        cuerpo && cuerpo.error && cuerpo.error.message
          ? cuerpo.error.message
          : '';
    } catch (error) {
      mensaje = '';
    }
    const opciones = { status: respuesta.status, causa: mensaje };
    if (respuesta.status === 401) {
      throw new CredencialesInvalidasError(
        `OpenRouteService rechazó las credenciales (401)${
          mensaje ? `: ${mensaje}` : ''
        }`,
        opciones
      );
    }
    if (respuesta.status === 429) {
      throw new LimiteSolicitudesError(
        `Se superó el límite de solicitudes de OpenRouteService (429)${
          mensaje ? `: ${mensaje}` : ''
        }`,
        opciones
      );
    }
    if (respuesta.status === 404) {
      throw new RutaInexistenteError(
        `OpenRouteService no encontró una ruta (404)${
          mensaje ? `: ${mensaje}` : ''
        }`,
        opciones
      );
    }
    throw new OrsError(
      `OpenRouteService respondió con estado ${respuesta.status}`,
      opciones
    );
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (error) {
    throw new OrsError('OpenRouteService respondió con JSON inválido', {
      causa: error && error.message,
    });
  }

  if (!datos || !Array.isArray(datos.features) || datos.features.length === 0) {
    throw new OrsError('Respuesta de OpenRouteService incompleta o inválida');
  }

  return datos;
}

/**
 * Extrae y valida el resumen (distancia/duración) de la respuesta de ORS.
 * @param {object} datos - Respuesta GeoJSON de ORS.
 * @returns {object} { distanciaMetros, duracionSegundos, geometria }.
 * @throws {OrsError} Si la respuesta no incluye el resumen.
 */
function extraerResumen(datos) {
  const ruta = datos.features[0];
  const resumen = ruta && ruta.properties && ruta.properties.summary;
  if (
    !resumen ||
    resumen.distance === undefined ||
    resumen.duration === undefined
  ) {
    throw new OrsError(
      'La respuesta de OpenRouteService no incluye distancia/duración'
    );
  }
  return {
    distanciaMetros: Number(resumen.distance),
    duracionSegundos: Number(resumen.duration),
    geometria: ruta.geometry ?? null,
  };
}

/**
 * Calcula la ruta entre dos coordenadas: devuelve distancia (metros), duración
 * (segundos) y la geometría (polyline) que devuelve OpenRouteService. La
 * geometría se devuelve solo en la respuesta del servicio: no se persiste ni se
 * integra con el frontend en esta etapa.
 * @param {object} datos - { origen: { latitud, longitud }, destino: { latitud, longitud } }.
 * @returns {Promise<object>} { distanciaMetros, duracionSegundos, geometria }.
 * @throws {Error} Coordenadas ausentes, inválidas o fuera de rango.
 * @throws {CredencialesInvalidasError} API key ausente o rechazada.
 * @throws {LimiteSolicitudesError} Límite de solicitudes.
 * @throws {RutaInexistenteError} Ruta no encontrada.
 * @throws {OrsError} Timeout, conexión o respuesta inválida.
 */
export async function calcularRuta(datos) {
  validarDatosRuta(datos);
  const respuesta = await llamarOrs(
    construirQuery(datos.origen, datos.destino)
  );
  return extraerResumen(respuesta);
}
