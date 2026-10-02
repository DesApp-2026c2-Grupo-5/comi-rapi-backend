/**
 * Servicio: geo_catalogo_service
 *
 * Iteración 3: catálogo territorial de Georef Argentina para los selects en
 * cascada del frontend (provincia → partido/comuna → localidad) y el
 * autocompletado de calles. El frontend nunca llama a Georef directamente:
 * este proxy es el único punto de contacto (arquitectura del proyecto).
 *
 * Justificación de los endpoints (ver docs/reglas-negocio.md §19): las
 * calles y las localidades no pueden ser listas estáticas razonables
 * (miles de registros), y el select en cascada necesita los datos oficiales
 * con los que el backend consulta Georef al geocodificar (misma nomenclatura
 * en todo el flujo).
 *
 * Cache en memoria obligatoria (ToS de Georef): los catálogos territoriales
 * son casi estáticos (TTL largo); el autocompletado se cachea con TTL corto
 * (el usuario repite prefijos al teclear). Sin dependencias nuevas: Map y
 * Date (compatibles con Node 14).
 *
 * API:
 *   - obtenerDepartamentos(provincia)
 *       → Promise<Array<{ id, nombre }>>  (partidos de PBA / comunas de CABA)
 *   - obtenerLocalidades({ provincia, departamento? })
 *       → Promise<Array<{ id, nombre }>>  (localidades BAHRA; en CABA son los
 *         barrios — unidades que el usuario SÍ conoce y que además son el
 *         filtro `localidad` aceptado por /api/direcciones)
 *   - buscarCalles({ provincia, departamento?, localidad?, nombre })
 *       → Promise<Array<{ id, nombre, categoria }>>  (autocompletado)
 *   - obtenerZonas()
 *       → Array<{ nombre, provincias, departamentos }>  (deriva de la
 *         configuración `cobertura-zonas`; el aviso de cobertura del
 *         frontend usa la MISMA fuente de verdad que la validación real)
 *
 * Errores: los de infraestructura de Georef (`GeorefError`) se propagan
 * (el error handler los traduce a 503). La validación de parámetros vive en
 * la ruta (HTTP 400).
 */

import { llamarGeoref } from './geolocation_service';
import { ZONAS_COBERTURA } from '../config/cobertura-zonas';

// Catálogos casi estáticos: 24 h. Autocompletado: 5 min (prefijos repetidos).
const TTL_CATALOGO_MS = 24 * 60 * 60 * 1000;
const TTL_CALLES_MS = 5 * 60 * 1000;

const cache = new Map();

/**
 * Vacía el cache del catálogo. Uso previsto: tests (aislar cada caso) y
 * depuración; en ejecución normal el cache vence solo por TTL.
 */
export function limpiarCache() {
  cache.clear();
}

/**
 * Consulta Georef con cache en memoria por clave compuesta.
 * @param {string} ruta - Ruta relativa de la API de Georef.
 * @param {string} campoEsperado - Clave del array en la respuesta.
 * @param {string} claveCache - Clave compuesta de la entrada de cache.
 * @param {number} ttlMs - Vigencia de la entrada, en milisegundos.
 * @returns {Promise<Array>} Lista de entidades de Georef.
 * @throws {GeorefError} Errores de conexión/HTTP/estructura.
 */
async function consultar(ruta, campoEsperado, claveCache, ttlMs) {
  const entrada = cache.get(claveCache);
  if (entrada && Date.now() < entrada.expira) {
    return entrada.valor;
  }
  const respuesta = await llamarGeoref(ruta, campoEsperado);
  cache.set(claveCache, {
    valor: respuesta[campoEsperado],
    expira: Date.now() + ttlMs,
  });
  return respuesta[campoEsperado];
}

function construirParams(params) {
  const urlSearchParams = new URLSearchParams();
  Object.entries(params).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null && String(valor).trim()) {
      urlSearchParams.set(clave, String(valor).trim());
    }
  });
  return urlSearchParams;
}

/**
 * Departamentos de una provincia: partidos en Buenos Aires, comunas en CABA
 * (unidad intermedia universal de Georef).
 * @param {string} provincia - Nombre oficial de la provincia.
 * @returns {Promise<Array<{ id, nombre }>>}
 */
export async function obtenerDepartamentos(provincia) {
  const params = construirParams({
    provincia,
    campos: 'estandar',
    max: 200,
  });
  return consultar(
    `/api/departamentos?${params}`,
    'departamentos',
    `departamentos|${String(provincia).trim().toLowerCase()}`,
    TTL_CATALOGO_MS
  );
}

/**
 * Localidades (BAHRA) de una provincia, opcionalmente filtradas por
 * departamento/partido/comuna. En CABA son los barrios.
 * @param {object} datos - { provincia, departamento? }.
 * @returns {Promise<Array<{ id, nombre }>>}
 */
export async function obtenerLocalidades({ provincia, departamento } = {}) {
  const params = construirParams({
    provincia,
    departamento,
    campos: 'estandar',
    max: 300,
  });
  return consultar(
    `/api/localidades?${params}`,
    'localidades',
    `localidades|${String(provincia).trim().toLowerCase()}|${String(
      departamento || ''
    )
      .trim()
      .toLowerCase()}`,
    TTL_CATALOGO_MS
  );
}

/**
 * Autocompletado de calles por nombre (parcial), dentro de una provincia y
 * opcionalmente un departamento y/o localidad (acota los resultados).
 * @param {object} datos - { provincia, departamento?, localidad?, nombre }.
 * @returns {Promise<Array<{ id, nombre, categoria }>>}
 */
export async function buscarCalles({
  provincia,
  departamento,
  localidad,
  nombre,
} = {}) {
  const params = construirParams({
    provincia,
    departamento,
    localidad,
    nombre,
    campos: 'estandar',
    max: 10,
  });
  return consultar(
    `/api/calles?${params}`,
    'calles',
    `calles|${String(provincia).trim().toLowerCase()}|${String(
      departamento || ''
    )
      .trim()
      .toLowerCase()}|${String(localidad || '')
      .trim()
      .toLowerCase()}|${String(nombre).trim().toLowerCase()}`,
    TTL_CALLES_MS
  );
}

/**
 * Zonas de operación (cobertura), derivadas de la MISMA configuración que
 * usa `cobertura_service` al validar direcciones. Sin llamada HTTP.
 * @returns {Array<{ nombre, provincias, departamentos }>}
 */
export function obtenerZonas() {
  return (ZONAS_COBERTURA || []).map((zona) => ({
    nombre: zona.nombre,
    provincias: zona.provincias,
    departamentos: zona.departamentos || [],
  }));
}
