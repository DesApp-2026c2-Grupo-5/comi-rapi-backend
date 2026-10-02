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
 *   - geocodificarDireccion({ calle, altura, provincia, departamento?, localidad? })
 *       → Promise<{ latitud, longitud, nomenclatura, normalizada: { calle, provincia, departamento, localidad } }>
 *   - resolverDireccion({ calle, altura, provincia, departamento?, localidad? })
 *       → Promise<{ estado: 'unica'|'ambigua'|'no_encontrada', resultado?, opciones? }>
 *       (Iteración 3: variante del preview; no lanza por no encontrada/ambigua)
 *   - buscarDirecciones({ calle, altura, provincia, departamento?, localidad? })
 *       → Promise<Array>  (lista cruda de Georef, para desambiguación futura)
 *   - llamarGeoref(ruta, campoEsperado = 'direcciones')
 *       → Promise<object>  (comunicación HTTP reutilizable; la usa el catálogo territorial)
 *
 * Iteración 1-geo (modelo territorial, verificado contra la API de Georef):
 *   - `departamento` es la unidad territorial intermedia de Georef (partido
 *     en Buenos Aires, comuna en CABA) y el endpoint /api/direcciones la
 *     acepta como filtro. Es opcional en la query: solo se envía si viene.
 *   - `localidad` también es opcional (en CABA la localidad censal es única
 *     y sin valor discriminante; con partido+calle+altura Georef resuelve).
 *   - Interpretación con deduplicación por identidad territorial: resultados
 *     que comparten (provincia, departamento, localidad censal, calle) son el
 *     mismo lugar en la práctica (segmentos de la misma calle a pocos metros)
 *     y NO se consideran ambiguos: se toma el primero (orden de relevancia
 *     de Georef). Solo si quedan identidades territoriales distintas se
 *     lanza `DireccionAmbiguaError` con `opciones` (agrupadas por
 *     identidad, sin coordenadas) para que el usuario elija una y reintente.
 *
 * Errores tipados:
 *   - GeorefError: errores HTTP (4xx/5xx), de conexión/timeout o respuesta
 *     inválida/incompleta de Georef.
 *   - DireccionNoEncontradaError (extiende GeorefError): Georef no encontró la
 *     dirección (total = 0).
 *   - DireccionAmbiguaError (extiende GeorefError): Georef devolvió más de
 *     una identidad territorial. Incluye `opciones` (agrupadas por
 *     identidad, sin coordenadas) para que el usuario elija una, además de
 *     `resultados` (crudos) para compatibilidad.
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
  constructor(mensaje, opciones = [], resultados = []) {
    super(mensaje);
    this.name = 'DireccionAmbiguaError';
    // Iteración 1-geo: opciones agrupadas por identidad territorial (sin
    // coordenadas) para que el frontend las muestre y el usuario elija.
    this.opciones = opciones;
    // Resultados crudos (nomenclatura + ubicación), conservados para
    // compatibilidad con usos internos/diagnóstico.
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

// Iteración 1-geo: `localidad` y `departamento` son opcionales en la query
// (con provincia+calle+altura Georef resuelve; el partido/comuna desambigua).
// Obligatorios: calle, altura y provincia.
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
  // Iteración 1-geo: filtros territoriales opcionales (solo si vienen
  // informados; en CABA el usuario no ingresa partido/comuna).
  if (datos.departamento !== undefined && String(datos.departamento).trim()) {
    params.set('departamento', String(datos.departamento).trim());
  }
  if (datos.localidad !== undefined && String(datos.localidad).trim()) {
    params.set('localidad', String(datos.localidad).trim());
  }
  params.set('campos', CAMPOS);
  params.set('max', String(config.georef.maxResultados));
  return `/api/direcciones?${params.toString()}`;
}

/**
 * Ejecuta la llamada HTTP a Georef y valida la estructura general de la respuesta.
 * Iteración 3: se generaliza con `campoEsperado` para reutilizarla desde el
 * catálogo territorial (departamentos, localidades, calles) sin duplicar la
 * comunicación con Georef.
 * @param {string} ruta - Ruta relativa (ej. "/api/direcciones?...").
 * @param {string} campoEsperado - Clave del array esperado en la respuesta
 *   (ej. "direcciones", "departamentos").
 * @returns {Promise<object>} Respuesta parseada de Georef.
 * @throws {GeorefError} Ante errores de conexión, timeout, HTTP o respuesta inválida.
 */
export async function llamarGeoref(ruta, campoEsperado = 'direcciones') {
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

  if (!datos || !Array.isArray(datos[campoEsperado])) {
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
 * Clave de identidad territorial de un resultado de Georef: dos resultados
 * con la misma clave son el mismo lugar en la práctica (segmentos de una
 * misma calle dentro del mismo partido/comuna, a pocos metros entre sí —
 * caso verificado en vivo: "General Villegas 5329" en Tres de Febrero).
 * @param {object} resultado - Resultado individual de `direcciones`.
 * @returns {string}
 */
function identidadTerritorial(resultado) {
  const partes = [
    resultado && resultado.provincia ? resultado.provincia.nombre : '',
    resultado && resultado.departamento ? resultado.departamento.nombre : '',
    resultado && resultado.localidad_censal
      ? resultado.localidad_censal.nombre
      : '',
    resultado && resultado.calle ? resultado.calle.nombre : '',
  ];
  return partes
    .map((p) =>
      String(p ?? '')
        .trim()
        .toLowerCase()
    )
    .join('|');
}

/**
 * Convierte un resultado de Georef en una opción seleccionable por el
 * usuario (sin coordenadas: el frontend solo necesita identificar la
 * identidad territorial para reintentar con ella).
 * @param {object} resultado - Resultado individual de `direcciones`.
 * @returns {object} { nomenclatura, provincia, departamento, localidad }
 */
function aOpcion(resultado) {
  return {
    nomenclatura:
      resultado && resultado.nomenclatura ? resultado.nomenclatura : null,
    // Iteración 3: calle oficial de Georef, para que el reintento (o el
    // preview del frontend) sea determinista sin re-enviar texto libre.
    calle: resultado && resultado.calle ? resultado.calle.nombre ?? null : null,
    provincia:
      resultado && resultado.provincia
        ? resultado.provincia.nombre ?? null
        : null,
    departamento:
      resultado && resultado.departamento
        ? resultado.departamento.nombre ?? null
        : null,
    localidad:
      resultado && resultado.localidad_censal
        ? resultado.localidad_censal.nombre ?? null
        : null,
  };
}

/**
 * Agrupa los resultados de Georef por identidad territorial, conservando el
 * primero de cada grupo (orden de relevancia). Compartida por
 * `interpretarResultados` (flujo del ABM, lanza errores) y
 * `resolverDireccion` (preview, no lanza).
 * @param {Array} direcciones - Resultados crudos de Georef.
 * @returns {Array} Un resultado por identidad territorial.
 */
function agruparPorIdentidad(direcciones) {
  const porIdentidad = new Map();
  direcciones.forEach((r) => {
    const clave = identidadTerritorial(r);
    if (!porIdentidad.has(clave)) {
      porIdentidad.set(clave, r);
    }
  });
  return [...porIdentidad.values()];
}

/**
 * Interpreta la lista de resultados: no encontrada, ambigua o única.
 * Iteración 1-geo: los resultados se deduplican por identidad territorial
 * (provincia + departamento + localidad censal + calle). Una sola identidad
 * no es ambigua aunque Georef devuelva varios segmentos de la misma calle:
 * se toma el primero (orden de relevancia). Varias identidades → ambigua
 * con `opciones` para que el usuario elija y reintente.
 * @param {object} datos - Respuesta de Georef (con `direcciones` y `total`).
 * @returns {object} Resultado normalizado único.
 * @throws {DireccionNoEncontradaError} Si total = 0.
 * @throws {DireccionAmbiguaError} Si hay más de una identidad territorial.
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

  const identidades = agruparPorIdentidad(datos.direcciones);

  if (identidades.length > 1) {
    throw new DireccionAmbiguaError(
      `La dirección es ambigua: Georef Argentina devolvió ${identidades.length} ubicaciones distintas`,
      identidades.map(aOpcion),
      resultados
    );
  }

  return normalizarResultado(identidades[0]);
}

/**
 * Iteración 3: resuelve una dirección SIN lanzar errores por reglas de
 * negocio (no encontrada / ambigua). Es la variante del preview del
 * frontend: resuelve la ambigüedad ANTES de guardar y de validar cobertura.
 * Devuelve siempre un objeto con `estado`:
 *   - 'no_encontrada': Georef no encontró la dirección.
 *   - 'ambigua': varias identidades territoriales; `opciones` agrupadas
 *     (nomenclatura, calle oficial, provincia, partido/comuna, localidad).
 *   - 'unica': resultado normalizado (latitud/longitud, nomenclatura,
 *     normalizada).
 * Los errores de infraestructura (GeorefError) sí se propagan.
 * @param {object} datos - { calle, altura, provincia, departamento?, localidad? }.
 * @returns {Promise<{ estado: string, resultado: object|null, opciones: Array }>}
 * @throws {Error} Datos insuficientes (calle, altura, provincia).
 * @throws {GeorefError} Errores HTTP/conexión/timeout o respuesta inválida.
 */
export async function resolverDireccion(datos) {
  validarDatosDireccion(datos);
  const respuesta = await llamarGeoref(construirQuery(datos));
  if (!respuesta.direcciones.length) {
    return { estado: 'no_encontrada', resultado: null, opciones: [] };
  }
  const identidades = agruparPorIdentidad(respuesta.direcciones);
  if (identidades.length > 1) {
    return {
      estado: 'ambigua',
      resultado: null,
      opciones: identidades.map(aOpcion),
    };
  }
  return {
    estado: 'unica',
    resultado: normalizarResultado(identidades[0]),
    opciones: [],
  };
}

/**
 * Busca direcciones en Georef Argentina y devuelve la lista cruda de resultados
 * (para desambiguación futura, sin interpretar).
 * @param {object} datos - { calle, altura, provincia, departamento?, localidad? }.
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
 * @param {object} datos - { calle, altura, provincia, departamento?, localidad? }.
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
