/**
 * Facade del proveedor de routing activo (A1-1: contrato de proveedor).
 *
 * El contrato público de este módulo NO cambia: `cobertura_service`,
 * `eta_service`, `error_handler` y los tests siguen importando desde acá.
 * La implementación concreta vive en `providers/routing/` y se selecciona con
 * `ROUTING_PROVIDER` (default 'ors'):
 *   - providers/routing/ors.js → OpenRouteService (implementación histórica)
 *   - providers/routing/geoapify.js → Geoapify (se agrega en A1-2)
 *
 * Errores: `RoutingError` es la clase base del contrato (independiente del
 * proveedor); `OrsError` y sus subclases se mantienen por compatibilidad.
 */

export {
  RoutingError,
  OrsError,
  CredencialesInvalidasError,
  LimiteSolicitudesError,
  RutaInexistenteError,
  calcularRuta,
} from './providers/routing';
