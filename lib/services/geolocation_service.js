/**
 * Servicio: geolocation_service
 *
 * Geocodificación de direcciones argentinas vía Georef Argentina
 * (https://apis.datos.gob.ar/georef). Encapsula la comunicación HTTP con la API
 * pública, el parseo de la respuesta y los errores tipados. No contiene reglas de
 * negocio: devuelve un resultado plano para que controllers/services posteriores
 * decidan cómo usarlo (ABM de Direccion, cobertura, etc.).
 *
 * API:
 *   - geocodificarDireccion({ calle, altura, provincia, localidad })
 *       → Promise<{ latitud, longitud, nomenclatura, normalizada: { calle, provincia, departamento, localidad } }>
 *   - buscarDirecciones({ calle, altura, provincia, localidad })
 *       → Promise<Array>  (lista cruda de Georef, para desambiguación futura)
 *
 * Errores tipados:
 *   - GeorefError: errores HTTP (4xx/5xx), de conexión/timeout o respuesta
 *     inválida/incompleta de Georef.
 *   - DireccionNoEncontradaError (extiende GeorefError): Georef no encontró la
 *     dirección (total = 0).
 *   - DireccionAmbiguaError (extiende GeorefError): Georef devolvió más de un
 *     resultado. Incluye `resultados` (nomenclatura + ubicación) para que la
 *     tarea posterior de integración con el ABM decida qué hacer con ellos.
 *
 * Políticas:
 *   - Un solo intento, sin retry (respeta el ToS de Georef).
 *   - Timeout configurable (`config.georef.timeoutMs`).
 *   - Sin secretos: es una API pública. Se envía un header `User-Agent` de
 *     identificación del backend.
 *
 * Nota: solo `latitud`/`longitud` se persistirán en `Direccion` (tarea futura).
 * Los datos normalizados se devuelven pero no se persisten en esta etapa.
 */

import fetch from 'node-fetch';
import config from '../config/config';

export class GeorefError extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje);
    this.name = 'GeorefError';
    if (opciones.status !== undefined) {
      this.status = opciones.status;
    }
    if (opciones.causa !== undefined) {
      this.causa = opciones.causa;
    }
  }
}

export class DireccionNoEncontradaError extends GeorefError {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'DireccionNoEncontradaError';
  }
}

export class DireccionAmbiguaError extends GeorefError {
  constructor(mensaje, resultados = []) {
    super(mensaje);
    this.name = 'DireccionAmbiguaError';
    this.resultados = resultados;
  }
}

const CAMPOS = [
  'calle',
  'provincia',
  'departamento',
  'localidad_censal',
  'altura',
  'ubicacion',
  'nomenclatura',
].join(',');

const USER_AGENT = 'comi-rapi-backend';

function validarDatosDireccion(datos) {
  const faltantes = [];
  if (!datos || typeof datos !== 'object') {
    faltantes.push('los datos de la dirección');
  } else {
    if (!datos.calle || !String(datos.calle).trim()) faltantes.push('calle');
    if (
      datos.altura === undefined ||
      datos.altura === null ||
      datos.altura === ''
    ) {
      faltantes.push('altura');
    }
    if (!datos.provincia || !String(datos.provincia).trim()) {
      faltantes.push('provincia');
    }
    if (!datos.localidad || !String(datos.localidad).trim()) {
      faltantes.push('localidad');
    }
  }
  if (faltantes.length) {
    throw new Error(
      `Datos de dirección insuficientes para geocodificar. Faltan: ${faltantes.join(
        ', '
      )}`
    );
  }
}

function construirQuery(datos) {
  const params = new URLSearchParams();
  params.set(
    'direccion',
    `${String(datos.calle).trim()} ${String(datos.altura).trim()}`
  );
  params.set('provincia', String(datos.provincia).trim());
  params.set('localidad', String(datos.localidad).trim());
  params.set('campos', CAMPOS);
  params.set('max', String(config.georef.maxResultados));
  return `/api/direcciones?${params.toString()}`;
}

/**
 * Ejecuta la llamada HTTP a Georef y valida la estructura general de la respuesta.
 * @param {string} ruta - Ruta relativa (ej. "/api/direcciones?...").
 * @returns {Promise<object>} Respuesta parseada de Georef.
 * @throws {GeorefError} Ante errores de conexión, timeout, HTTP o respuesta inválida.
 */
async function llamarGeoref(ruta) {
  let respuesta;
  try {
    respuesta = await fetch(`${config.georef.baseUrl}${ruta}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      timeout: config.georef.timeoutMs,
    });
  } catch (error) {
    const esTimeout = error && error.type === 'request-timeout';
    throw new GeorefError(
      esTimeout
        ? 'Timeout al consultar Georef Argentina'
        : 'Error de conexión con Georef Argentina',
      { causa: error && error.message }
    );
  }

  if (!respuesta.ok) {
    let cuerpo = '';
    try {
      cuerpo = await respuesta.text();
    } catch (error) {
      cuerpo = '';
    }
    throw new GeorefError(
      `Georef Argentina respondió con estado ${respuesta.status}`,
      { status: respuesta.status, causa: cuerpo }
    );
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (error) {
    throw new GeorefError('Georef Argentina respondió con JSON inválido', {
      causa: error && error.message,
    });
  }

  if (!datos || !Array.isArray(datos.direcciones)) {
    throw new GeorefError(
      'Respuesta de Georef Argentina incompleta o inválida'
    );
  }

  return datos;
}

/**
 * Valida que el resultado de Georef incluya ubicación y lo normaliza.
 * @param {object} resultado - Resultado individual de `direcciones`.
 * @returns {object} { latitud, longitud, nomenclatura, normalizada }.
 * @throws {GeorefError} Si el resultado no incluye ubicación.
 */
function normalizarResultado(resultado) {
  const ubicacion = resultado && resultado.ubicacion;
  if (
    !resultado ||
    !ubicacion ||
    ubicacion.lat === undefined ||
    ubicacion.lon === undefined
  ) {
    throw new GeorefError(
      'El resultado de Georef Argentina no incluye ubicación (latitud/longitud)'
    );
  }
  return {
    latitud: Number(ubicacion.lat),
    longitud: Number(ubicacion.lon),
    nomenclatura: resultado.nomenclatura ?? null,
    normalizada: {
      calle: resultado.calle ? resultado.calle.nombre ?? null : null,
      provincia: resultado.provincia
        ? resultado.provincia.nombre ?? null
        : null,
      departamento: resultado.departamento
        ? resultado.departamento.nombre ?? null
        : null,
      localidad: resultado.localidad_censal
        ? resultado.localidad_censal.nombre ?? null
        : null,
    },
  };
}

/**
 * Interpreta la lista de resultados: no encontrada, ambigua o única.
 * @param {object} datos - Respuesta de Georef (con `direcciones` y `total`).
 * @returns {object} Resultado normalizado único.
 * @throws {DireccionNoEncontradaError} Si total = 0.
 * @throws {DireccionAmbiguaError} Si total > 1.
 * @throws {GeorefError} Si el resultado único no incluye ubicación.
 */
function interpretarResultados(datos) {
  const total = Number(datos.total) || datos.direcciones.length;
  if (total === 0) {
    throw new DireccionNoEncontradaError(
      'La dirección no fue encontrada en Georef Argentina'
    );
  }

  const resultados = datos.direcciones.map((r) => ({
    nomenclatura: r && r.nomenclatura ? r.nomenclatura : null,
    ubicacion:
      r && r.ubicacion ? { lat: r.ubicacion.lat, lon: r.ubicacion.lon } : null,
  }));

  if (total > 1) {
    throw new DireccionAmbiguaError(
      `La dirección es ambigua: Georef Argentina devolvió ${total} resultados`,
      resultados
    );
  }

  return normalizarResultado(datos.direcciones[0]);
}

/**
 * Busca direcciones en Georef Argentina y devuelve la lista cruda de resultados
 * (para desambiguación futura, sin interpretar).
 * @param {object} datos - { calle, altura, provincia, localidad }.
 * @returns {Promise<Array>} Lista cruda de resultados de Georef.
 */
export async function buscarDirecciones(datos) {
  validarDatosDireccion(datos);
  const respuesta = await llamarGeoref(construirQuery(datos));
  return respuesta.direcciones;
}

/**
 * Geocodifica una dirección argentina: devuelve latitud, longitud, nomenclatura
 * y los datos normalizados de Georef. Solo la ubicación se persistirá en
 * `Direccion` (tarea futura de integración con el ABM).
 * @param {object} datos - { calle, altura, provincia, localidad }.
 * @returns {Promise<object>} { latitud, longitud, nomenclatura, normalizada }.
 * @throws {Error} Datos de dirección insuficientes.
 * @throws {DireccionNoEncontradaError} Dirección no encontrada.
 * @throws {DireccionAmbiguaError} Resultados ambiguos.
 * @throws {GeorefError} Errores HTTP/conexión/timeout o respuesta inválida.
 */
export async function geocodificarDireccion(datos) {
  validarDatosDireccion(datos);
  const respuesta = await llamarGeoref(construirQuery(datos));
  return interpretarResultados(respuesta);
}
