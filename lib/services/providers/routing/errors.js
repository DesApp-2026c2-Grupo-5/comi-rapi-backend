/**
 * Contrato de errores del servicio de routing (A1-1).
 *
 * `RoutingError` es la clase base del contrato de proveedores: cualquier
 * implementación (ORS, Geoapify) la lanza ante indisponibilidad, timeout,
 * respuestas inválidas o credenciales faltantes. `error_handler` traduce
 * `RoutingError` → 503 "Servicio de rutas no disponible".
 *
 * `OrsError` y sus subclases se mantienen por compatibilidad con el código y
 * los tests existentes: el proveedor ORS sigue lanzándolas.
 */

export class RoutingError extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje);
    this.name = 'RoutingError';
    if (opciones.status !== undefined) {
      this.status = opciones.status;
    }
    if (opciones.causa !== undefined) {
      this.causa = opciones.causa;
    }
  }
}

export class OrsError extends RoutingError {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'OrsError';
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
