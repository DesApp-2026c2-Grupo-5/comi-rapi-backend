import { ValidationError, UniqueConstraintError } from 'sequelize';
import {
  GeorefError,
  DireccionNoEncontradaError,
  DireccionAmbiguaError,
} from '../services/geolocation_service';
import { OrsError } from '../services/routing_service';
import {
  DireccionFueraDeZonaError,
  DireccionSinCoberturaError,
} from '../services/cobertura_service';
import { ErrorValidacionDireccion } from '../services/direccion_service';
import {
  ParametroDesconocidoError,
  ParametroInvalidoError,
} from '../services/parametros_service';

// Errores semánticos (entrada válida pero no procesable): 422. Los detalles
// técnicos (causa, status del proveedor, resultados crudos) NO se exponen en
// la respuesta pública.
const MENSAJE_DIRECCION_NO_ENCONTRADA =
  'La dirección no pudo ser ubicada: revisá los datos ingresados';
// Iteración 1-geo: la ambigüedad ya no es un rechazo seco: el backend
// devuelve las identidades territoriales encontradas para que el usuario
// elija una y reintente (409 en lugar de 422).
const MENSAJE_DIRECCION_AMBIGUA =
  'La dirección coincide con varias ubicaciones: seleccioná la correcta';
const MENSAJE_GEOREF_INDISPONIBLE =
  'Servicio de geolocalización no disponible temporalmente, intentá de nuevo en unos minutos';
const MENSAJE_ORS_INDISPONIBLE =
  'Servicio de rutas no disponible temporalmente, intentá de nuevo en unos minutos';

/* eslint-disable no-unused-vars */
const errorHandler = (err, req, res, next) => {
  if (err instanceof ErrorValidacionDireccion) {
    return res.status(400).json({ success: false, error: err.message });
  }

  // Parámetros de negocio: clave desconocida o valor fuera de tipo/rango es un
  // error de entrada, no una falla del servidor.
  if (
    err instanceof ParametroDesconocidoError ||
    err instanceof ParametroInvalidoError
  ) {
    return res.status(400).json({ success: false, error: err.message });
  }

  if (err instanceof UniqueConstraintError || err instanceof ValidationError) {
    // Se acumulan TODOS los mensajes de validación de Sequelize en un único
    // mensaje (antes se descartaban los siguientes al primero).
    const mensajes =
      err.errors && err.errors.length
        ? err.errors.map((e) => e.message).join('; ')
        : 'Datos inválidos';
    return res.status(400).json({ success: false, error: mensajes });
  }

  // Georef: dirección no encontrada → 422 con mensaje amigable (sin
  // detalles del proveedor); ambigua → 409 con opciones (ver arriba);
  // indisponibilidad/timeout → 503. Nunca se convierte una caída del
  // proveedor en un 422.
  if (err instanceof DireccionNoEncontradaError) {
    return res
      .status(422)
      .json({ success: false, error: MENSAJE_DIRECCION_NO_ENCONTRADA });
  }
  // Iteración 1-geo: ambigua → 409 (conflicto con el estado actual de la
  // dirección: hay más de una identidad territorial) con las `opciones`
  // normalizadas de Georef para que el usuario elija y reintente. No se
  // exponen coordenadas ni detalles del proveedor.
  if (err instanceof DireccionAmbiguaError) {
    return res.status(409).json({
      success: false,
      error: MENSAJE_DIRECCION_AMBIGUA,
      opciones: err.opciones || [],
    });
  }
  if (
    err instanceof DireccionFueraDeZonaError ||
    err instanceof DireccionSinCoberturaError
  ) {
    const cuerpo = { success: false, error: err.message };
    // Iteración 5: detalle funcional de la cobertura (hasta ahora se perdía):
    // la distancia de la sucursal activa más cercana permite explicar el
    // rechazo sin rediseñar los mensajes (diseño final: iteración 6).
    if (
      err instanceof DireccionSinCoberturaError &&
      err.distanciaMasCercanaMetros !== undefined &&
      err.distanciaMasCercanaMetros !== null
    ) {
      cuerpo.detalle = {
        distanciaMasCercanaMetros: err.distanciaMasCercanaMetros,
      };
    }
    return res.status(422).json(cuerpo);
  }

  if (err instanceof GeorefError) {
    console.error(err);
    return res
      .status(503)
      .json({ success: false, error: MENSAJE_GEOREF_INDISPONIBLE });
  }

  // OpenRouteService: indisponibilidad, timeout, credenciales inválidas o
  // fallas de infraestructura → 503 (nunca 422).
  if (err instanceof OrsError) {
    console.error(err);
    return res
      .status(503)
      .json({ success: false, error: MENSAJE_ORS_INDISPONIBLE });
  }

  console.error(err);
  return res
    .status(500)
    .json({ success: false, error: 'Error interno del servidor' });
};

export default errorHandler;
