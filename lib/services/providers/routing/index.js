/**
 * Fábrica del proveedor de routing activo (A1-1).
 *
 * Selecciona la implementación según `config.routing.proveedor`
 * (`ROUTING_PROVIDER`, default 'ors') y expone el contrato único que consumen
 * `cobertura_service` y `eta_service` (a través del facade
 * `lib/services/routing_service.js`):
 *
 *   calcularRuta({ origen, destino })
 *     → Promise<{ distanciaMetros, duracionSegundos, geometria }>
 *
 * Errores: los del contrato (`RoutingError` y subclases, ver errors.js) —
 * cualquier proveedor debe lanzarlos para que `error_handler` los traduzca
 * a 503 sin importar cuál esté activo.
 *
 * Proveedores: uno por archivo en este directorio.
 *   - ors.js: OpenRouteService (implementación histórica, default)
 *   - geoapify.js: Geoapify (A1-2)
 */

import config from '../../../config/config';
import * as ors from './ors';
import * as geoapify from './geoapify';

export * from './errors';

const PROVEEDORES = { ors, geoapify };

/**
 * Resuelve el módulo del proveedor activo.
 * @returns {object} Módulo del proveedor (expone calcularRuta).
 * @throws {Error} Proveedor desconocido o aún no implementado (fail-fast).
 */
export function obtenerProveedor() {
  const nombre = (config.routing && config.routing.proveedor) || 'ors';
  const proveedor = PROVEEDORES[nombre];
  if (!proveedor) {
    throw new Error(
      `Proveedor de routing desconocido o no implementado: "${nombre}" (ROUTING_PROVIDER)`
    );
  }
  return proveedor;
}

/**
 * Calcula la ruta delegando en el proveedor activo.
 * @param {object} datos - { origen, destino } con { latitud, longitud }.
 * @returns {Promise<object>} { distanciaMetros, duracionSegundos, geometria }.
 */
export async function calcularRuta(datos) {
  const proveedor = obtenerProveedor();
  return proveedor.calcularRuta(datos);
}
