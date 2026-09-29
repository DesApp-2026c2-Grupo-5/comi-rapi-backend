/**
 * Servicio: cobertura_service
 *
 * Reglas de negocio de cobertura geográfica: determina si una dirección es
 * válida para delivery. Reutiliza los servicios ya existentes sin duplicar su
 * lógica:
 *   - `geolocation_service` (Georef Argentina): dirección → coordenadas.
 *   - `routing_service` (OpenRouteService): coordenadas → distancia real por
 *     ruta (NO línea recta).
 *
 * Reglas (en orden de evaluación):
 *   1. La dirección debe geocodificarse: se envía a Georef con los datos
 *      obligatorios (calle, altura, provincia, localidad). Los errores tipados
 *      de Georef (`DireccionNoEncontradaError`, `DireccionAmbiguaError`,
 *      `GeorefError`) se propagan: una dirección no geocodificable no es
 *      válida para delivery.
 *   2. La dirección debe pertenecer a la zona geográfica de operación: se
 *      valida contra la configuración genérica de zonas de
 *      `../config/cobertura-zonas` usando los datos territoriales normalizados
 *      de Georef. Si no pertenece a ninguna zona, la dirección no es válida y
 *      NO se consultan sucursales ni rutas.
 *   3. Debe existir al menos una sucursal ACTIVA dentro de la distancia máxima
 *      (distancia por ruta, configurable vía `COBERTURA_RADIO_MAX_KM` /
 *      `config.cobertura.radioMaxKm`). Las sucursales se obtienen de la BD
 *      (activas, con dirección geolocalizada); puede inyectarse la lista
 *      mediante `sucursales` (útil para tests y para reutilización futura).
 *
 * API:
 *   - evaluarZona(normalizada, zonas = ZONAS_COBERTURA)
 *       → zona coincidente | null  (función pura, sin efectos)
 *   - obtenerSucursalesActivas()
 *       → Promise<Array>  (sucursales activas con dirección geolocalizada)
 *   - validarCoberturaDireccion({ direccion, sucursales = null })
 *       → Promise<{
 *           dentroZona, zona,
 *           sucursal: { id, nombre, distanciaMetros } | null,
 *           coberturaDisponible, radioMaxKm, mensaje,
 *           coordenadas: { latitud, longitud }
 *         }>
 *
 * Nota: el resultado de la validación es un objeto detallado (no se lanza un
 * error por regla de negocio incumplida): quien lo consuma (validación del
 * pedido, endpoints de tareas posteriores) decide cómo tratarlo. Los errores
 * de infraestructura de Georef/ORS sí se propagan.
 */

import config from '../config/config';
import { ZONAS_COBERTURA } from '../config/cobertura-zonas';
import { geocodificarDireccion } from './geolocation_service';
import { calcularRuta } from './routing_service';
import db from '../models';

/**
 * Normaliza un texto para comparaciones: minúsculas, sin acentos ni espacios
 * sobrantes. Permite comparar datos de Georef contra la configuración sin
 * depender de mayúsculas/acentos.
 * @param {*} valor
 * @returns {string}
 */
function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Evalúa a qué zona de operación pertenece una dirección a partir de los datos
 * territoriales normalizados de Georef (función pura). Una zona coincide si la
 * provincia está incluida y, si la zona define listas de departamentos o
 * localidades, el departamento/localidad también deben estarlo.
 * @param {object} normalizada - `normalizada` del resultado de Georef
 *   ({ calle, provincia, departamento, localidad }).
 * @param {Array} zonas - Configuración de zonas (`ZONAS_COBERTURA` por defecto).
 * @returns {object|null} Zona coincidente ({ nombre, ... }) o null si no hay.
 */
export function evaluarZona(normalizada, zonas = ZONAS_COBERTURA) {
  if (!normalizada || typeof normalizada !== 'object') {
    return null;
  }
  const provincia = normalizarTexto(normalizada.provincia);
  const departamento = normalizarTexto(normalizada.departamento);
  const localidad = normalizarTexto(normalizada.localidad);
  if (!provincia) {
    return null;
  }
  return (
    (zonas || []).find((zona) => {
      if (!zona || typeof zona !== 'object') return false;
      const provincias = (zona.provincias || []).map(normalizarTexto);
      if (!provincias.includes(provincia)) return false;
      const departamentos = (zona.departamentos || []).map(normalizarTexto);
      if (departamentos.length && !departamentos.includes(departamento)) {
        return false;
      }
      const localidades = (zona.localidades || []).map(normalizarTexto);
      if (localidades.length && !localidades.includes(localidad)) {
        return false;
      }
      return true;
    }) || null
  );
}

/**
 * Extrae las coordenadas de una sucursal (acepta dirección anidada o campos
 * directos). Devuelve null si la sucursal no tiene coordenadas.
 * @param {object} sucursal
 * @returns {object|null} { latitud, longitud } (numéricas) o null.
 */
function obtenerCoordenadasSucursal(sucursal) {
  if (!sucursal || typeof sucursal !== 'object') {
    return null;
  }
  const dir = sucursal.direccion || sucursal;
  const { latitud, longitud } = dir;
  if (latitud === undefined || latitud === null || latitud === '') {
    return null;
  }
  if (longitud === undefined || longitud === null || longitud === '') {
    return null;
  }
  const lat = Number(latitud);
  const lng = Number(longitud);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return { latitud: lat, longitud: lng };
}

/**
 * Obtiene las sucursales activas con su dirección geolocalizada (1:1 en
 * `Direcciones`). Se usan para calcular la distancia por ruta a la dirección
 * de entrega.
 * @returns {Promise<Array>} Sucursales con `direccion` incluida.
 */
export async function obtenerSucursalesActivas() {
  const sucursales = await db.Sucursal.findAll({
    where: { activa: true },
    include: [
      {
        model: db.Direccion,
        as: 'direccion',
        required: false,
      },
    ],
  });
  return (sucursales || []).filter(
    (sucursal) => obtenerCoordenadasSucursal(sucursal) !== null
  );
}

/**
 * Ordena y evalúa las sucursales activas por distancia real por ruta a la
 * dirección de entrega. Devuelve la más cercana y las que están dentro del
 * radio máximo.
 * @param {Array} sucursales - Sucursales activas con coordenadas.
 * @param {object} destino - { latitud, longitud } de la dirección de entrega.
 * @returns {Promise<{ dentro: Array, masCercana: object|null }>}
 */
async function evaluarSucursales(sucursales, destino) {
  const evaluadas = [];
  for (const sucursal of sucursales || []) {
    const origen = obtenerCoordenadasSucursal(sucursal);
    if (!origen) {
      continue;
    }
    const ruta = await calcularRuta({ origen, destino });
    evaluadas.push({ sucursal, distanciaMetros: ruta.distanciaMetros });
  }
  evaluadas.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  const radioMetros = config.cobertura.radioMaxKm * 1000;
  const dentro = evaluadas.filter((e) => e.distanciaMetros <= radioMetros);
  return { dentro, masCercana: evaluadas[0] || null };
}

/**
 * Valida la cobertura geográfica de una dirección para delivery: primero la
 * zona geográfica de operación y luego la existencia de al menos una sucursal
 * activa dentro de la distancia máxima (por ruta). Una dirección no es válida
 * para delivery si no supera la validación geográfica.
 * @param {object} datos - { direccion, sucursales = null }.
 *   `direccion`: { calle, altura, provincia, localidad } (datos obligatorios de
 *   Direccion; codigoPostal no se usa en la query de Georef).
 *   `sucursales`: lista opcional de sucursales activas (inyección para tests);
 *   si no se pasa, se obtienen de la BD.
 * @returns {Promise<object>} Resultado detallado de la validación.
 * @throws {Error} Datos de dirección insuficientes.
 * @throws {DireccionNoEncontradaError} Dirección no encontrada en Georef.
 * @throws {DireccionAmbiguaError} Dirección ambigua en Georef.
 * @throws {GeorefError} Errores HTTP/conexión/timeout de Georef.
 * @throws {CredencialesInvalidasError|LimiteSolicitudesError|RutaInexistenteError|OrsError}
 *   Errores de OpenRouteService.
 */
export async function validarCoberturaDireccion({
  direccion,
  sucursales = null,
} = {}) {
  const geocodificada = await geocodificarDireccion(direccion);
  const coordenadas = {
    latitud: geocodificada.latitud,
    longitud: geocodificada.longitud,
  };

  const zona = evaluarZona(geocodificada.normalizada);
  if (!zona) {
    return {
      dentroZona: false,
      zona: null,
      sucursal: null,
      coberturaDisponible: false,
      radioMaxKm: config.cobertura.radioMaxKm,
      mensaje:
        'La dirección está fuera de la zona geográfica de operación del servicio',
      coordenadas,
    };
  }

  const activas = sucursales
    ? sucursales.filter((s) => s && s.activa !== false)
    : await obtenerSucursalesActivas();
  const { dentro, masCercana } = await evaluarSucursales(activas, coordenadas);

  const sucursal = masCercana
    ? {
        id: masCercana.sucursal.id ?? masCercana.sucursal.sucursalId ?? null,
        nombre: masCercana.sucursal.nombre ?? null,
        distanciaMetros: masCercana.distanciaMetros,
      }
    : null;

  return {
    dentroZona: true,
    zona: zona.nombre,
    sucursal,
    coberturaDisponible: Boolean(dentro.length),
    radioMaxKm: config.cobertura.radioMaxKm,
    mensaje: dentro.length
      ? `La dirección está dentro de la cobertura: sucursal más cercana a ${
          Math.round(masCercana.distanciaMetros / 100) / 10
        } km`
      : 'No hay sucursales activas dentro de la distancia máxima de cobertura',
    coordenadas,
  };
}
