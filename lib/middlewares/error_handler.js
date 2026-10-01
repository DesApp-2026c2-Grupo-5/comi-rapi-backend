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

// Errores semánticos (entrada válida pero no procesable): 422. Los detalles
// técnicos (causa, status del proveedor, resultados crudos) NO se exponen en
// la respuesta pública.
const MENSAJE_DIRECCION_NO_ENCONTRADA =
  'La dirección no pudo ser ubicada: revisá los datos ingresados';
const MENSAJE_DIRECCION_AMBIGUA =
  'La dirección es ambigua: especificá mejor los datos ingresados';
const MENSAJE_GEOREF_INDISPONIBLE =
  'Servicio de geolocalización no disponible temporalmente, intentá de nuevo en unos minutos';
const MENSAJE_ORS_INDISPONIBLE =
  'Servicio de rutas no disponible temporalmente, intentá de nuevo en unos minutos';

/* eslint-disable no-unused-vars */
const errorHandler = (err, req, res, next) => {
  if (err instanceof ErrorValidacionDireccion) {
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

  // Georef: dirección no encontrada/ambigua → 422 con mensaje amigable (sin
  // detalles del proveedor); indisponibilidad/timeout → 503. Nunca se convierte
  // una caída del proveedor en un 422.
  if (err instanceof DireccionNoEncontradaError) {
    return res
      .status(422)
      .json({ success: false, error: MENSAJE_DIRECCION_NO_ENCONTRADA });
  }
  if (err instanceof DireccionAmbiguaError) {
    return res
      .status(422)
      .json({ success: false, error: MENSAJE_DIRECCION_AMBIGUA });
  }
  if (
    err instanceof DireccionFueraDeZonaError ||
    err instanceof DireccionSinCoberturaError
  ) {
    return res.status(422).json({ success: false, error: err.message });
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
