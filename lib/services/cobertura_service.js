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
 *      (distancia por ruta, parámetro `radioCoberturaKm` editable por el
 *      SUPERADMINISTRADOR). Las sucursales se obtienen de la BD
 *      (activas, con dirección geolocalizada); puede inyectarse la lista
 *      mediante `sucursales` (útil para tests y para reutilización futura).
 *
 * API:
 *   - evaluarZona(normalizada, zonas = ZONAS_COBERTURA)
 *       → zona coincidente | null  (función pura, sin efectos)
 *   - obtenerSucursalesActivas()
 *       → Promise<Array>  (sucursales activas con dirección geolocalizada)
 *   - evaluarCoberturaCoordenadas({ coordenadas, normalizada, sucursales })
 *       → Promise<{ dentroZona, zona, sucursal, coberturaDisponible, radioMaxKm, mensaje, coordenadas }>
 *       (evalúa zona + rutas sobre coordenadas YA geocodificadas: permite
 *       reutilizar la geocodificación del llamador sin una segunda llamada a
 *       Georef; no lanza error por regla de negocio incumplida)
 *   - validarCoberturaDireccion({ direccion, sucursales = null })
 *       → Promise<{ dentroZona, zona, sucursal, coberturaDisponible, radioMaxKm, mensaje, coordenadas }>
 *       (geocodifica y delega en evaluarCoberturaCoordenadas)
 *   - validarCoberturaParaDelivery({ coordenadas, normalizada, sucursales })
 *       → Promise<resultado>  (variante de validación del ABM de Direccion:
 *       igual que evaluarCoberturaCoordenadas, pero LANZA errores tipados si la
 *       dirección no es válida para delivery)
 *
 * Errores tipados del ABM (no se lanzan desde evaluarCoberturaCoordenadas/
 * validarCoberturaDireccion, solo desde validarCoberturaParaDelivery):
 *   - DireccionFueraDeZonaError: la dirección no pertenece a la zona geográfica
 *     de operación.
 *   - DireccionSinCoberturaError: dentro de la zona, pero sin sucursal activa
 *     dentro de la distancia máxima (incluye `distanciaMasCercanaMetros`).
 *
 * Nota: el resultado de la validación es un objeto detallado (no se lanza un
 * error por regla de negocio incumplida): quien lo consuma (validación del
 * pedido, endpoints de tareas posteriores) decide cómo tratarlo. Los errores
 * de infraestructura de Georef/ORS sí se propagan.
 */

import { ZONAS_COBERTURA } from '../config/cobertura-zonas';
import { geocodificarDireccion } from './geolocation_service';
import { calcularRuta } from './routing_service';
import { obtenerValor } from './parametros_service';
import db from '../models';

/**
 * Error tipado del ABM: la dirección no pertenece a la zona geográfica de
 * operación. Lo lanza `validarCoberturaParaDelivery`.
 */
export class DireccionFueraDeZonaError extends Error {
  constructor(mensaje) {
    super(
      mensaje ||
        'La dirección está fuera de la zona geográfica de operación del servicio'
    );
    this.name = 'DireccionFueraDeZonaError';
  }
}

/**
 * Error tipado del ABM: dentro de la zona de operación, pero sin sucursal
 * activa dentro de la distancia máxima. Lo lanza
 * `validarCoberturaParaDelivery`. Incluye `distanciaMasCercanaMetros` si hubo
 * sucursales activas geolocalizadas (para diagnóstico posterior).
 */
export class DireccionSinCoberturaError extends Error {
  constructor(mensaje, opciones = {}) {
    super(
      mensaje ||
        'No hay sucursales activas dentro de la distancia máxima de cobertura'
    );
    this.name = 'DireccionSinCoberturaError';
    if (opciones.distanciaMasCercanaMetros !== undefined) {
      this.distanciaMasCercanaMetros = opciones.distanciaMasCercanaMetros;
    }
  }
}

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
 * @param {number} radioMaxKm - Radio máximo de cobertura en kilómetros.
 * @returns {Promise<{ dentro: Array, masCercana: object|null }>}
 */
async function evaluarSucursales(sucursales, destino, radioMaxKm) {
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
  const radioMetros = radioMaxKm * 1000;
  const dentro = evaluadas.filter((e) => e.distanciaMetros <= radioMetros);
  return { dentro, masCercana: evaluadas[0] || null };
}

/**
 * T1 (plan maestro): devuelve TODAS las sucursales activas geolocalizadas
 * dentro del radio máximo, ORDENADAS por distancia real por ruta (la más
 * cercana primero). A diferencia de `evaluarCoberturaCoordenadas`, NO evalúa
 * zona: asume que la dirección ya fue validada (el ABM lo hace) y se limita
 * al ranking por distancia. Es la base para la selección de sucursal del
 * pedido (la más cercana con stock).
 * @param {object} destino - { latitud, longitud } de la dirección de entrega.
 * @returns {Promise<Array<{ sucursal, distanciaMetros }>>} Sucursales activas
 *   dentro del radio, ordenadas por distancia ascendente.
 * @throws {CredencialesInvalidasError|LimiteSolicitudesError|RutaInexistenteError|OrsError}
 */
export async function sucursalesEnCobertura(destino) {
  const activas = await obtenerSucursalesActivas();
  const radioMaxKm = await obtenerValor('radioCoberturaKm');
  const { dentro } = await evaluarSucursales(activas, destino, radioMaxKm);
  return dentro;
}

/**
 * Evalúa la cobertura geográfica sobre coordenadas YA geocodificadas: primero
 * la zona geográfica de operación y luego la existencia de al menos una
 * sucursal activa dentro de la distancia máxima (por ruta). Permite reutilizar
 * la geocodificación del llamador (ABM de Direccion) sin una segunda llamada a
 * Georef. No lanza error por regla de negocio incumplida.
 * @param {object} datos - { coordenadas, normalizada, sucursales = null }.
 *   `coordenadas`: { latitud, longitud } ya obtenidas de Georef.
 *   `normalizada`: datos territoriales normalizados de Georef (para la zona).
 *   `sucursales`: lista opcional de sucursales activas (inyección para tests);
 *   si no se pasa, se obtienen de la BD.
 * @returns {Promise<object>} Resultado detallado de la validación.
 * @throws {CredencialesInvalidasError|LimiteSolicitudesError|RutaInexistenteError|OrsError}
 *   Errores de OpenRouteService.
 */
export async function evaluarCoberturaCoordenadas({
  coordenadas,
  normalizada,
  sucursales = null,
} = {}) {
  // El radio máximo es un parámetro de negocio editable por el SUPERADMIN.
  const radioMaxKm = await obtenerValor('radioCoberturaKm');

  const zona = evaluarZona(normalizada);
  if (!zona) {
    return {
      dentroZona: false,
      zona: null,
      sucursal: null,
      coberturaDisponible: false,
      radioMaxKm,
      mensaje:
        'La dirección está fuera de la zona geográfica de operación del servicio',
      coordenadas,
    };
  }

  const activas = sucursales
    ? sucursales.filter((s) => s && s.activa !== false)
    : await obtenerSucursalesActivas();
  const { dentro, masCercana } = await evaluarSucursales(
    activas,
    coordenadas,
    radioMaxKm
  );

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
    radioMaxKm,
    mensaje: dentro.length
      ? `La dirección está dentro de la cobertura: sucursal más cercana a ${
          Math.round(masCercana.distanciaMetros / 100) / 10
        } km`
      : 'No hay sucursales activas dentro de la distancia máxima de cobertura',
    coordenadas,
  };
}

/**
 * Variante de validación del ABM de Direccion: igual que
 * `evaluarCoberturaCoordenadas`, pero lanza los errores tipados
 * `DireccionFueraDeZonaError` / `DireccionSinCoberturaError` si la dirección no
 * es válida para delivery.
 * @param {object} datos - { coordenadas, normalizada, sucursales = null }.
 * @returns {Promise<object>} Resultado detallado de la validación.
 * @throws {DireccionFueraDeZonaError} Dirección fuera de la zona de operación.
 * @throws {DireccionSinCoberturaError} Sin sucursal activa dentro del radio.
 * @throws {CredencialesInvalidasError|LimiteSolicitudesError|RutaInexistenteError|OrsError}
 *   Errores de OpenRouteService.
 */
export async function validarCoberturaParaDelivery({
  coordenadas,
  normalizada,
  sucursales = null,
} = {}) {
  const resultado = await evaluarCoberturaCoordenadas({
    coordenadas,
    normalizada,
    sucursales,
  });
  if (!resultado.dentroZona) {
    throw new DireccionFueraDeZonaError();
  }
  if (!resultado.coberturaDisponible) {
    throw new DireccionSinCoberturaError(undefined, {
      distanciaMasCercanaMetros: resultado.sucursal
        ? resultado.sucursal.distanciaMetros
        : null,
    });
  }
  return resultado;
}

/**
 * Valida la cobertura geográfica de una dirección para delivery: primero la
 * zona geográfica de operación y luego la existencia de al menos una sucursal
 * activa dentro de la distancia máxima (por ruta). Una dirección no es válida
 * para delivery si no supera la validación geográfica. Geocodifica la
 * dirección y delega en `evaluarCoberturaCoordenadas`.
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
  return evaluarCoberturaCoordenadas({
    coordenadas: {
      latitud: geocodificada.latitud,
      longitud: geocodificada.longitud,
    },
    normalizada: geocodificada.normalizada,
    sucursales,
  });
}
