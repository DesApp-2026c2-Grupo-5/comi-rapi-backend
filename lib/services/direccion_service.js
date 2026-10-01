/**
 * Servicio: direccion_service
 *
 * Orquestación del ABM de `Direccion` (usuario y sucursal): validación de
 * datos, geocodificación (GeolocationService/Georef), validación de cobertura
 * (CoberturaService, que reutiliza Georef y RoutingService) y persistencia.
 * Los controllers quedan delgados: traducen HTTP↔dominio y delegan aquí.
 *
 * Reglas de negocio (dirección de USUARIO, entrega):
 *   1. Validar datos de entrada.
 *   2. Geocodificar: los errores tipados de Georef se propagan.
 *   3. Validar cobertura (zona de operación + sucursal activa dentro de la
 *      distancia máxima por ruta, configurable). Si falla, la dirección no se
 *      persiste (errores tipados `DireccionFueraDeZonaError` /
 *      `DireccionSinCoberturaError`).
 *   4. Persistir con `latitud`/`longitud` obtenidas por el backend (nunca
 *      manuales).
 *
 * Reglas de negocio (dirección de SUCURSAL, origen):
 *   - Geocodificación obligatoria: una sucursal sin coordenadas no puede ser
 *     utilizada por `CoberturaService`. Si Georef falla, no se persiste nada.
 *   - Sin validación de zona/cobertura: la zona de operación es una regla para
 *     direcciones de entrega; la sucursal es el origen del delivery.
 *   - La persistencia (sucursal + dirección) se realiza dentro de la
 *     transacción del controller; las llamadas externas (Georef) ocurren
 *     ANTES de iniciar la transacción.
 *
 * Re-geocodificación en actualización:
 *   - `CAMPOS_UBICACION` (calle, altura, provincia, localidad): si cambia
 *     alguno, se vuelve a geocodificar (y a validar cobertura en el flujo de
 *     usuario) y se actualizan las coordenadas.
 *   - `codigoPostal` NO dispara re-geocodificación: Georef no lo usa en la
 *     query, por lo que no afecta la ubicación obtenida.
 *   - Cambios solo en `alias`/`referencia` (o sin cambios reales): se
 *     actualiza sin llamar a proveedores externos. La detección compara los
 *     datos enviados contra los persistidos (normalizando `altura`), lo que
 *     evita llamadas innecesarias cuando el frontend reenvía el objeto
 *     `direccion` completo sin modificarlo.
 *
 * Errores tipados:
 *   - `ErrorValidacionDireccion`: datos de entrada inválidos/insuficientes
 *     (el error handler lo traduce a HTTP 400).
 *   - De Georef: `DireccionNoEncontradaError`, `DireccionAmbiguaError`,
 *     `GeorefError` (se propagan; el error handler los traduce a HTTP).
 *   - De cobertura: `DireccionFueraDeZonaError`, `DireccionSinCoberturaError`.
 *   - De ORS: `OrsError` y subclases (se propagan).
 */

import db from '../models';
import { geocodificarDireccion } from './geolocation_service';
import { validarCoberturaParaDelivery } from './cobertura_service';

const { Direccion } = db;

/**
 * Campos que afectan la ubicación: si cambia alguno en una actualización, hay
 * que volver a geocodificar. `codigoPostal` no está incluido (Georef no lo usa
 * en la query); `alias`/`referencia`/`activa` tampoco.
 */
export const CAMPOS_UBICACION = ['calle', 'altura', 'provincia', 'localidad'];

/**
 * Error tipado de validación de entrada de `Direccion`. El error handler lo
 * traduce a HTTP 400 con el mensaje del campo correspondiente.
 */
export class ErrorValidacionDireccion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacionDireccion';
  }
}

// latitud/longitud no se ingresan manualmente (ni por admin ni por nadie):
// las calcula el backend mediante GeolocationService (Georef).
function validarCoordenadasNoManuales(datos) {
  if (datos.latitud !== undefined || datos.longitud !== undefined) {
    return 'La latitud y la longitud no se ingresan manualmente: las calcula el backend';
  }
  return null;
}

function validarAltura(altura) {
  if (altura === undefined || altura === null || altura === '') {
    return 'La altura es obligatoria';
  }
  const num = Number(altura);
  if (!Number.isInteger(num) || num < 0) {
    return 'La altura debe ser un número entero mayor o igual a 0';
  }
  return null;
}

/**
 * Valida un campo de texto: obligatorio en creación (con el mensaje exacto,
 * respetando la concordancia de género); en actualización parcial solo se
 * valida si fue provisto (y no puede quedar vacío).
 * @param {*} valor
 * @param {string} mensajeObligatorio - Mensaje cuando falta en creación.
 * @param {string} nombreCampo - Nombre del campo (para el mensaje parcial).
 * @param {boolean} parcial
 * @returns {string|null} Mensaje de error o null si es válido.
 */
function validarCampoTexto(valor, mensajeObligatorio, nombreCampo, parcial) {
  const provisto = valor !== undefined;
  const vacio = !valor || !String(valor).trim();
  if (parcial) {
    if (!provisto) return null;
    return vacio ? `${nombreCampo} no puede quedar vacío` : null;
  }
  return vacio ? mensajeObligatorio : null;
}

/**
 * Valida y normaliza los datos de una dirección. Acumula TODOS los errores de
 * campo y los lanza en un único mensaje unido por '; ' (en lugar de informar
 * solo el primero).
 * @param {object} datos - Datos crudos del body.
 * @param {object} opciones - { parcial = false }: en actualización parcial,
 *   solo se validan/normalizan los campos provistos.
 * @returns {object} Valores normalizados (solo los campos provistos si parcial).
 * @throws {ErrorValidacionDireccion} Datos inválidos o insuficientes (con todos
 *   los mensajes de error acumulados).
 */
export function validarDatosDireccion(datos, { parcial = false } = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorValidacionDireccion(
      'Los datos de la dirección son obligatorios'
    );
  }
  const errores = [];
  const errorCoordenadas = validarCoordenadasNoManuales(datos);
  if (errorCoordenadas) {
    errores.push(errorCoordenadas);
  }

  const valores = {};

  const errorCalle = validarCampoTexto(
    datos.calle,
    'La calle es obligatoria',
    'La calle',
    parcial
  );
  if (errorCalle) {
    errores.push(errorCalle);
  }
  if (datos.calle !== undefined) {
    valores.calle = String(datos.calle).trim();
  }

  if (!parcial || datos.altura !== undefined) {
    const errorAltura = validarAltura(datos.altura);
    if (errorAltura) {
      errores.push(errorAltura);
    }
    if (datos.altura !== undefined) {
      valores.altura = Number(datos.altura);
    }
  }

  const camposTexto = [
    ['provincia', 'La provincia es obligatoria', 'La provincia'],
    ['localidad', 'La localidad es obligatoria', 'La localidad'],
    ['codigoPostal', 'El código postal es obligatorio', 'El código postal'],
  ];
  camposTexto.forEach(([campo, mensajeObligatorio, nombreCampo]) => {
    const error = validarCampoTexto(
      datos[campo],
      mensajeObligatorio,
      nombreCampo,
      parcial
    );
    if (error) {
      errores.push(error);
    }
    if (datos[campo] !== undefined) {
      valores[campo] = String(datos[campo]).trim();
    }
  });

  if (datos.referencia !== undefined) {
    const referencia =
      datos.referencia === null ? null : String(datos.referencia).trim();
    valores.referencia = referencia || null;
  }
  if (datos.alias !== undefined) {
    const alias = datos.alias === null ? null : String(datos.alias).trim();
    valores.alias = alias || null;
  }

  if (errores.length) {
    throw new ErrorValidacionDireccion(errores.join('; '));
  }

  return valores;
}

/**
 * Detecta si algún campo de ubicación cambió realmente respecto de la
 * dirección persistida (normalizando `altura` a número).
 * @param {object} valores - Valores normalizados provistos (pueden ser parciales).
 * @param {object} existente - Instancia/objeto de `Direccion` persistida.
 * @returns {boolean}
 */
function cambioUbicacion(valores, existente) {
  return CAMPOS_UBICACION.some((campo) => {
    if (valores[campo] === undefined) return false;
    const actual =
      campo === 'altura' ? Number(existente.altura) : existente[campo];
    return valores[campo] !== actual;
  });
}

/**
 * Prepara una dirección para persistir: valida los datos, detecta cambios
 * reales (si hay dirección existente) y geocodifica cuando corresponde. Las
 * llamadas externas (Georef) ocurren aquí, sin transacción abierta.
 * @param {object} datos - { datos, existente = null, exigirCobertura = false }.
 *   `existente`: dirección persistida (dispara validación parcial y detección
 *   de cambios; solo re-geocodifica si cambió un campo de ubicación).
 *   `exigirCobertura`: true para direcciones de usuario (entrega): valida zona
 *   + cobertura; false para direcciones de sucursal (solo coordenadas).
 * @returns {Promise<{ valores: object, coordenadas: { latitud, longitud }|null }>}
 *   `coordenadas` es null si no se geocodificó (cambio sin campos de ubicación).
 * @throws {ErrorValidacionDireccion} Datos inválidos o insuficientes.
 * @throws {DireccionNoEncontradaError|DireccionAmbiguaError|GeorefError}
 *   Errores de Georef.
 * @throws {DireccionFueraDeZonaError|DireccionSinCoberturaError}
 *   Cobertura incumplida (solo con `exigirCobertura`).
 * @throws {CredencialesInvalidasError|LimiteSolicitudesError|RutaInexistenteError|OrsError}
 *   Errores de ORS.
 */
export async function prepararDireccion({
  datos,
  existente = null,
  exigirCobertura = false,
} = {}) {
  const parcial = Boolean(existente);
  const valores = validarDatosDireccion(datos, { parcial });

  const reGeocodificar = !existente || cambioUbicacion(valores, existente);
  let coordenadas = null;
  if (reGeocodificar) {
    const datosGeocodificacion = {
      calle: valores.calle ?? String(existente.calle).trim(),
      altura: valores.altura ?? Number(existente.altura),
      provincia: valores.provincia ?? String(existente.provincia).trim(),
      localidad: valores.localidad ?? String(existente.localidad).trim(),
    };
    const geocodificada = await geocodificarDireccion(datosGeocodificacion);
    coordenadas = {
      latitud: geocodificada.latitud,
      longitud: geocodificada.longitud,
    };
    if (exigirCobertura) {
      await validarCoberturaParaDelivery({
        coordenadas,
        normalizada: geocodificada.normalizada,
      });
    }
  }

  return { valores, coordenadas };
}

/**
 * Crea una dirección de usuario (entrega): valida, geocodifica, valida
 * cobertura y persiste con las coordenadas obtenidas. Solo se persiste si
 * supera todas las reglas.
 * @param {object} datos - { usuarioId, datos }.
 * @returns {Promise<object>} Instancia de `Direccion` creada.
 * @throws Ídem `prepararDireccion` con `exigirCobertura: true`.
 */
export async function crearDireccionDeUsuario({ usuarioId, datos } = {}) {
  const { valores, coordenadas } = await prepararDireccion({
    datos,
    exigirCobertura: true,
  });
  return Direccion.create({
    usuarioId,
    ...valores,
    ...coordenadas,
    activa: true,
  });
}

/**
 * Actualiza una dirección de usuario (entrega): valida parcialmente, detecta
 * cambios reales, re-geocodifica y re-valida cobertura si cambió un campo de
 * ubicación; si solo cambiaron `alias`/`referencia` (o nada), actualiza sin
 * llamar a proveedores. Si la re-validación falla, no actualiza nada.
 * @param {object} datos - { direccion, datos }.
 * @returns {Promise<object>} Instancia de `Direccion` actualizada.
 * @throws Ídem `prepararDireccion` con `exigirCobertura: true`.
 */
export async function actualizarDireccionDeUsuario({ direccion, datos } = {}) {
  const { valores, coordenadas } = await prepararDireccion({
    datos,
    existente: direccion,
    exigirCobertura: true,
  });
  return direccion.update({ ...valores, ...(coordenadas || {}) });
}

/**
 * Persiste la dirección de una sucursal (update o create según haya dirección
 * existente) con las coordenadas ya geocodificadas por `prepararDireccion`.
 * Debe llamarse DENTRO de la transacción del controller: si falla, la
 * transacción hace rollback y no queda una Sucursal/Dirección parcial.
 * @param {object} datos - { sucursalId, existente = null, valores, coordenadas = null, transaction = null }.
 * @returns {Promise<object>} Instancia de `Direccion` persistida.
 */
export async function persistirDireccionSucursal({
  sucursalId,
  existente = null,
  valores,
  coordenadas = null,
  transaction = null,
} = {}) {
  if (existente) {
    return existente.update(
      { ...valores, ...(coordenadas || {}) },
      { transaction }
    );
  }
  return Direccion.create(
    { ...valores, ...(coordenadas || {}), sucursalId, activa: true },
    { transaction }
  );
}
