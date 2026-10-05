/**
 * Tests de routing_service (OpenRouteService).
 *
 * La comunicación HTTP se mockea vía `node-fetch` (jest.mock): los tests NO
 * dependen de una conexión real a OpenRouteService. El fixture corresponde al
 * formato GeoJSON real de ORS v2 (GET /v2/directions/driving-car).
 */

import config from '../config/config';

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
import {
  OrsError,
  CredencialesInvalidasError,
  LimiteSolicitudesError,
  RutaInexistenteError,
  calcularRuta,
} from './routing_service';

const RUTA_VALIDA = {
  origen: { latitud: -34.6037, longitud: -58.3816 },
  destino: { latitud: -34.6038, longitud: -58.3842 },
};

const RESPUESTA_ORS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        segments: [{ distance: 443.5, duration: 85.2 }],
        summary: { distance: 443.5, duration: 85.2 },
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-58.3816, -34.6037],
          [-58.3842, -34.6038],
        ],
      },
    },
  ],
  metadata: { query: {}, engine: {} },
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

function errorOrs(status, mensaje) {
  return respuestaError(status, { error: { code: status, message: mensaje } });
}

describe('routing_service (OpenRouteService, API mockeada)', () => {
  const keyOriginal = config.ors.apiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    config.ors.apiKey = keyOriginal || 'clave-de-prueba';
  });

  afterEach(() => {
    config.ors.apiKey = keyOriginal;
  });

  describe('calcularRuta', () => {
    test('resultado exitoso: distancia, duración y geometría', async () => {
      fetch.mockResolvedValue(respuestaOk(RESPUESTA_ORS));
      const resultado = await calcularRuta(RUTA_VALIDA);
      expect(resultado.distanciaMetros).toBeCloseTo(443.5);
      expect(resultado.duracionSegundos).toBeCloseTo(85.2);
      expect(resultado.geometria).toEqual(RESPUESTA_ORS.features[0].geometry);
    });

    test('query correcta: baseUrl, profile, orden lon,lat y key por header', async () => {
      fetch.mockResolvedValue(respuestaOk(RESPUESTA_ORS));
      await calcularRuta(RUTA_VALIDA);

      expect(fetch).toHaveBeenCalledTimes(1);
      const urlLlamada = fetch.mock.calls[0][0];
      expect(
        urlLlamada.startsWith(
          `${config.ors.baseUrl}/v2/directions/${config.ors.profile}?`
        )
      ).toBe(true);
      const params = new URLSearchParams(urlLlamada.split('?')[1]);
      expect(params.get('start')).toBe('-58.3816,-34.6037');
      expect(params.get('end')).toBe('-58.3842,-34.6038');
      const headers = fetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe(config.ors.apiKey);
      expect(urlLlamada).not.toContain(config.ors.apiKey);
    });

    test('key ausente en la configuración → CredencialesInvalidasError sin llamar a ORS', async () => {
      config.ors.apiKey = '';
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        CredencialesInvalidasError
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /ORS_API_KEY no está configurada/
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    test('HTTP 401 → CredencialesInvalidasError', async () => {
      fetch.mockResolvedValue(errorOrs(401, 'API key is missing or invalid.'));
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        CredencialesInvalidasError
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /rechazó las credenciales/
      );
    });

    test('HTTP 429 → LimiteSolicitudesError', async () => {
      fetch.mockResolvedValue(errorOrs(429, 'Rate limit exceeded.'));
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        LimiteSolicitudesError
      );
    });

    test('HTTP 404 → RutaInexistenteError', async () => {
      fetch.mockResolvedValue(
        errorOrs(404, 'Route could not be found between the given points.')
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        RutaInexistenteError
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /no encontró una ruta/
      );
    });

    test('HTTP 500 → OrsError con status', async () => {
      fetch.mockResolvedValue(errorOrs(500, 'Internal server error'));
      let error;
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(OrsError);
      try {
        await calcularRuta(RUTA_VALIDA);
      } catch (e) {
        error = e;
      }
      expect(error.status).toBe(500);
    });

    test('timeout → OrsError con mensaje de timeout', async () => {
      fetch.mockRejectedValue({
        type: 'request-timeout',
        message: 'network timeout at https://api.openrouteservice.org',
      });
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /Timeout al consultar OpenRouteService/
      );
    });

    test('error de conexión → OrsError', async () => {
      fetch.mockRejectedValue({
        type: 'system',
        message: 'request to https://api.openrouteservice.org failed',
      });
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /Error de conexión con OpenRouteService/
      );
    });

    test('respuesta con JSON inválido → OrsError', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
        text: async () => '<html>error</html>',
      });
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(/JSON inválido/);
    });

    test('respuesta sin features (incompleta) → OrsError', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ type: 'FeatureCollection', features: [] })
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /incompleta o inválida/
      );
    });

    test('respuesta sin summary (incompleta) → OrsError', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          type: 'FeatureCollection',
          features: [{ properties: {}, geometry: {} }],
        })
      );
      await expect(calcularRuta(RUTA_VALIDA)).rejects.toThrow(
        /no incluye distancia\/duración/
      );
    });

    test('validación de entrada: coordenadas inválidas fallan sin llamar a ORS', async () => {
      await expect(
        calcularRuta({ origen: RUTA_VALIDA.origen })
      ).rejects.toThrow(/obligatorio/);
      await expect(
        calcularRuta({
          origen: { latitud: 95, longitud: -58.3816 },
          destino: RUTA_VALIDA.destino,
        })
      ).rejects.toThrow(/latitud/);
      await expect(
        calcularRuta({
          origen: { latitud: -34.6037, longitud: 200 },
          destino: RUTA_VALIDA.destino,
        })
      ).rejects.toThrow(/longitud/);
      await expect(calcularRuta(null)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
