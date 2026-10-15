/**
 * Tests de la fábrica del proveedor de routing (A1-1).
 *
 * Verifica que la selección por `config.routing.proveedor` resuelva el módulo
 * correcto y que un proveedor desconocido o aún no implementado falle rápido
 * con un mensaje claro (fail-fast, sin asignar nada por defecto silencioso).
 * No mockea node-fetch: el proveedor ORS ya tiene su propia suite contra el
 * facade; acá solo se prueba la resolución del módulo.
 */

import config from '../../../config/config';
import { obtenerProveedor } from './index';
import * as ors from './ors';

describe('providers/routing (fábrica de proveedor)', () => {
  const proveedorOriginal = config.routing && config.routing.proveedor;

  afterEach(() => {
    config.routing.proveedor = proveedorOriginal;
  });

  test('"ors" resuelve el módulo de OpenRouteService', () => {
    config.routing.proveedor = 'ors';
    expect(obtenerProveedor()).toBe(ors);
  });

  test('proveedor vacío usa ORS por defecto', () => {
    config.routing.proveedor = '';
    expect(obtenerProveedor()).toBe(ors);
  });

  test('proveedor no definido en config usa ORS por defecto', () => {
    const original = config.routing;
    config.routing = undefined;
    try {
      expect(obtenerProveedor()).toBe(ors);
    } finally {
      config.routing = original;
    }
  });

  test('"geoapify" aún no implementado → error claro (A1-2 lo agrega)', () => {
    config.routing.proveedor = 'geoapify';
    expect(() => obtenerProveedor()).toThrow(/geoapify/);
  });

  test('proveedor desconocido → error claro', () => {
    config.routing.proveedor = 'osrm';
    expect(() => obtenerProveedor()).toThrow(/osrm/);
  });
});
