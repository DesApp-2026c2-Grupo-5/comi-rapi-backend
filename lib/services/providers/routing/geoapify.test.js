/**
 * Tests del proveedor Geoapify (A1-2).
 *
 * Espejo de la suite de ORS (routing_service.test.js): misma API mockeada vía
 * `node-fetch`, mismo contrato de errores. Los fixtures corresponden al
 * formato GeoJSON real de Geoapify v1/routing (features[0].properties con
 * distance en metros y time en segundos).
 */

import config from '../../../config/config';

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
import {
  RoutingError,
  CredencialesInvalidasError,
  LimiteSolicitudesError,
  RutaInexistenteError,
} from './errors';
import { calcularRuta } from './geoapify';

const RUTA_VALIDA = {
  origen: { latitud: -34.6037, longitud: -58.3816 },
  destino: { latitud: -34.6038, longitud: -58.3842 },
};

const RESPUESTA_GEOAPIFY = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { distance: 443.5, time: 85.2, waypoints: [] },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-58.3816, -34.6037],
          [-58.3842, -34.6038],
        ],
      },
    },
  ],
};

function respuestaOk(datos) {
  return {
    ok: true,
    status: 200,
    json: async () => datos,
    text: async () => JSON.stringify(datos),
  };
}

function respuestaError(status, cuerpo) {
  return {
    ok: false,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}

function errorGeoapify(status, mensaje) {
  return respuestaError(status, {
    statusCode: status,
    error: 'Error',
    message: mensaje,
  });
}

describe('providers/routing/geoapify (API mockeada)', () => {
  const keyOriginal = config.geoapify.apiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clave fija de prueba: la suite es hermética y no depende de la clave
    // real que pueda haber en .env.local (que config carga también en test).
    config.geoapify.apiKey = 'clave-de-prueba';
  });

  afterEach(() => {
    config.geoapify.apiKey = keyOriginal;
  });

  test('ruta válida → { distanciaMetros, duracionSegundos, geometria }', async () => {
    fetch.mockResolvedValue(respuestaOk(RESPUESTA_GEOAPIFY));
    const resultado = await calcularRuta(RUTA_VALIDA);
    expect(resultado.distanciaMetros).toBe(443.5);
    expect(resultado.duracionSegundos).toBe(85.2);
    expect(resultado.geometria).toEqual(
      RESPUESTA_GEOAPIFY.features[0].geometry
    );
  });

  test('waypoints en orden lat,lon (distinto de ORS) + mode + apiKey en query', async () => {
    fetch.mockResolvedValue(respuestaOk(RESPUESTA_GEOAPIFY));
    await calcularRuta(RUTA_VALIDA);
    const url = decodeURIComponent(String(fetch.mock.calls[0][0]));
    expect(url).toContain('waypoints=-34.6037,-58.3816|-34.6038,-58.3842');
    expect(url).toContain('mode=drive');
    expect(url).toContain('apiKey=clave-de-prueba');
    expect(url).toContain('https://api.geoapify.com');
  });

  test('sin API key configurada → CredencialesInvalidasError sin llamar a la API', async () => {
    config.geoapify.apiKey = '';
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
      CredencialesInvalidasError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('401 → CredencialesInvalidasError', async () => {
    fetch.mockResolvedValue(
      errorGeoapify(401, 'API key is invalid or missing')
    );
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
      CredencialesInvalidasError
    );
  });

  test('429 → LimiteSolicitudesError', async () => {
    fetch.mockResolvedValue(errorGeoapify(429, 'Exceeded the requests limit'));
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
      LimiteSolicitudesError
    );
  });

  test('respuesta sin features → RutaInexistenteError', async () => {
    fetch.mockResolvedValue(
      respuestaOk({ type: 'FeatureCollection', features: [] })
    );
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
      RutaInexistenteError
    );
  });

  test('properties sin distance/time → RoutingError de respuesta inválida', async () => {
    fetch.mockResolvedValue(
      respuestaOk({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: null }],
      })
    );
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
      /no incluye distancia\/duración/
    );
  });

  test('HTTP 500 → RoutingError (base, no OrsError)', async () => {
    fetch.mockResolvedValue(errorGeoapify(500, 'boom'));
    const error = await calcularRuta(RUTA_VALIDA).catch((e) => e);
    expect(error).toBeInstanceOf(RoutingError);
    expect(error.name).toBe('RoutingError');
  });

  test('JSON inválido → RoutingError', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
      text: async () => 'not json',
    });
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(/JSON inválido/);
  });

  test('timeout → RoutingError de timeout', async () => {
    fetch.mockRejectedValue({ type: 'request-timeout', message: 'timed out' });
    await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(/Timeout/);
  });

  test('coordenadas inválidas → Error de validación compartida, sin llamar a la API', async () => {
    await expect(
      calcularRuta({
        origen: { latitud: null, longitud: -58.38 },
        destino: RUTA_VALIDA.destino,
      })
    ).rejects.toThrow(/La latitud del punto origen es obligatoria/);
    await expect(
      calcularRuta({
        origen: { latitud: 95, longitud: -58.38 },
        destino: RUTA_VALIDA.destino,
      })
    ).rejects.toThrow(/La latitud del punto origen debe estar entre/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
