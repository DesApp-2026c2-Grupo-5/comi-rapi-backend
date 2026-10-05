/**
 * Tests de geolocation_service (Georef Argentina).
 *
 * La comunicación HTTP se mockea vía `node-fetch` (jest.mock): los tests NO
 * dependen de una conexión real a Georef. El fixture corresponde a una respuesta
 * real capturada de la API pública (Av. Corrientes 1234, CABA).
 */

import config from '../config/config';

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
import {
  GeorefError,
  DireccionNoEncontradaError,
  DireccionAmbiguaError,
  geocodificarDireccion,
  buscarDirecciones,
} from './geolocation_service';

const DIRECCION_VALIDA = {
  calle: 'Av. Corrientes',
  altura: 1234,
  provincia: 'Ciudad Autónoma de Buenos Aires',
  localidad: 'CABA',
  codigoPostal: '1043',
};

const RESULTADO_GEOREF = {
  altura: { unidad: null, valor: 1234 },
  calle: { categoria: 'AV', id: '0200701001185', nombre: 'AV CORRIENTES' },
  calle_cruce_1: { categoria: null, id: null, nombre: null },
  calle_cruce_2: { categoria: null, id: null, nombre: null },
  departamento: { id: '02007', nombre: 'Comuna 1' },
  localidad_censal: {
    id: '02000010',
    nombre: 'Ciudad Autónoma de Buenos Aires',
  },
  nomenclatura: 'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires',
  piso: null,
  provincia: { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' },
  ubicacion: {
    lat: -34.60385632930893,
    lon: -58.38419018127011,
  },
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
    json: async () => {
      throw new Error('no json');
    },
    text: async () => cuerpo || '',
  };
}

describe('geolocation_service (Georef Argentina, API mockeada)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('geocodificarDireccion', () => {
    test('resultado exitoso: latitud, longitud, nomenclatura y normalizada', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          cantidad: 1,
          direcciones: [RESULTADO_GEOREF],
          total: 1,
        })
      );
      const resultado = await geocodificarDireccion(DIRECCION_VALIDA);
      expect(resultado.latitud).toBeCloseTo(-34.6038563);
      expect(resultado.longitud).toBeCloseTo(-58.3841902);
      expect(resultado.nomenclatura).toBe(
        'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires'
      );
      expect(resultado.normalizada).toEqual({
        calle: 'AV CORRIENTES',
        provincia: 'Ciudad Autónoma de Buenos Aires',
        departamento: 'Comuna 1',
        localidad: 'Ciudad Autónoma de Buenos Aires',
      });
    });

    test('query correcta: baseUrl, dirección calle+altura, provincia, localidad, max y campos', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 1, direcciones: [RESULTADO_GEOREF], total: 1 })
      );
      await geocodificarDireccion(DIRECCION_VALIDA);

      expect(fetch).toHaveBeenCalledTimes(1);
      const urlLlamada = fetch.mock.calls[0][0];
      expect(
        urlLlamada.startsWith(`${config.georef.baseUrl}/api/direcciones?`)
      ).toBe(true);
      const params = new URLSearchParams(urlLlamada.split('?')[1]);
      expect(params.get('direccion')).toBe('Av. Corrientes 1234');
      expect(params.get('provincia')).toBe('Ciudad Autónoma de Buenos Aires');
      expect(params.get('localidad')).toBe('CABA');
      expect(params.get('max')).toBe(String(config.georef.maxResultados));
      expect(params.get('campos')).toContain('ubicacion');
      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['User-Agent']).toBe('comi-rapi-backend');
    });

    test('dirección no encontrada (total: 0) → DireccionNoEncontradaError', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 0, direcciones: [], total: 0 })
      );
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        DireccionNoEncontradaError
      );
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /no fue encontrada/
      );
    });

    // Iteración 1-geo: la ambigüedad se define por identidad territorial;
    // dos resultados con el mismo territorio + calle NO son ambiguos.
    test('varias identidades territoriales → DireccionAmbiguaError con opciones agrupadas', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          cantidad: 2,
          direcciones: [
            RESULTADO_GEOREF,
            {
              ...RESULTADO_GEOREF,
              departamento: { id: '02091', nombre: 'Comuna 13' },
              nomenclatura:
                'AV CORRIENTES 1234, Comuna 13, Ciudad Autónoma de Buenos Aires',
            },
            // Tercer resultado: mismo territorio que el segundo → mismo grupo.
            {
              ...RESULTADO_GEOREF,
              departamento: { id: '02091', nombre: 'Comuna 13' },
              nomenclatura:
                'AV CORRIENTES 1234, Comuna 13, Ciudad Autónoma de Buenos Aires',
            },
          ],
          total: 3,
        })
      );
      let error;
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        DireccionAmbiguaError
      );
      try {
        await geocodificarDireccion(DIRECCION_VALIDA);
      } catch (e) {
        error = e;
      }
      // Opciones agrupadas por identidad (2), sin coordenadas.
      expect(error.opciones).toHaveLength(2);
      expect(error.opciones[0].departamento).toBe('Comuna 1');
      expect(error.opciones[1].departamento).toBe('Comuna 13');
      expect(error.opciones[0].nomenclatura).toBe(
        'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires'
      );
      expect(error.opciones[0].ubicacion).toBeUndefined();
      // Resultados crudos conservados para compatibilidad.
      expect(error.resultados).toHaveLength(3);
    });

    // Caso verificado en vivo contra Georef: "General Villegas 5329" en
    // Tres de Febrero devuelve 2 segmentos con nomenclatura idéntica y
    // coordenadas a ~240 m: misma identidad → NO ambigua.
    test('varios segmentos de la misma identidad territorial → NO ambigua: toma el primero', async () => {
      const resultado = {
        ...RESULTADO_GEOREF,
        departamento: { id: '62141', nombre: 'Tres de Febrero' },
        localidad_censal: { id: '06214040', nombre: 'Tres de Febrero' },
        provincia: { id: '06', nombre: 'Buenos Aires' },
        calle: {
          categoria: 'CALLE',
          id: '06214010100250',
          nombre: 'GRL VILLEGAS',
        },
        nomenclatura: 'GRL VILLEGAS 5329, Tres de Febrero, Buenos Aires',
        ubicacion: { lat: -34.62096384777289, lon: -58.575137331406935 },
      };
      fetch.mockResolvedValue(
        respuestaOk({
          cantidad: 2,
          direcciones: [
            resultado,
            {
              ...resultado,
              ubicacion: { lat: -34.620870769318245, lon: -58.577461964786195 },
            },
          ],
          total: 2,
        })
      );
      const res = await geocodificarDireccion({
        calle: 'General Villegas',
        altura: 5329,
        provincia: 'Buenos Aires',
        departamento: 'Tres de Febrero',
      });
      expect(res.latitud).toBeCloseTo(-34.62096384777289);
      expect(res.normalizada.departamento).toBe('Tres de Febrero');
    });

    test('error HTTP 500 → GeorefError con status', async () => {
      fetch.mockResolvedValue(respuestaError(500, 'boom'));
      let error;
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        GeorefError
      );
      try {
        await geocodificarDireccion(DIRECCION_VALIDA);
      } catch (e) {
        error = e;
      }
      expect(error.status).toBe(500);
    });

    test('timeout → GeorefError con mensaje de timeout', async () => {
      fetch.mockRejectedValue({
        type: 'request-timeout',
        message: 'network timeout at https://apis.datos.gob.ar/georef',
      });
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /Timeout al consultar Georef/
      );
    });

    test('error de conexión → GeorefError', async () => {
      fetch.mockRejectedValue({
        type: 'system',
        message: 'request to https://apis.datos.gob.ar/georef failed',
      });
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /Error de conexión con Georef/
      );
    });

    test('respuesta con JSON inválido → GeorefError', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
        text: async () => '<html>error</html>',
      });
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /JSON inválido/
      );
    });

    test('respuesta sin direcciones (incompleta) → GeorefError', async () => {
      fetch.mockResolvedValue(respuestaOk({ cantidad: 0 }));
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /incompleta o inválida/
      );
    });

    test('resultado único sin ubicación → GeorefError', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          cantidad: 1,
          direcciones: [{ ...RESULTADO_GEOREF, ubicacion: undefined }],
          total: 1,
        })
      );
      await expect(geocodificarDireccion(DIRECCION_VALIDA)).rejects.toThrow(
        /no incluye ubicación/
      );
    });

    test('validación de entrada: sin datos obligatorios falla sin llamar a Georef', async () => {
      await expect(geocodificarDireccion({ altura: 1234 })).rejects.toThrow(
        /insuficientes/
      );
      await expect(
        geocodificarDireccion({ ...DIRECCION_VALIDA, altura: '' })
      ).rejects.toThrow(/altura/);
      await expect(
        geocodificarDireccion({ ...DIRECCION_VALIDA, provincia: null })
      ).rejects.toThrow(/provincia/);
      expect(fetch).not.toHaveBeenCalled();
    });

    // Iteración 1-geo: `localidad` y `departamento` son opcionales en la
    // query (con provincia+calle+altura Georef resuelve; el partido/comuna
    // desambigua cuando viene).
    test('localidad vacía ya no es un error de validación (opcional)', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 1, direcciones: [RESULTADO_GEOREF], total: 1 })
      );
      await expect(
        geocodificarDireccion({ ...DIRECCION_VALIDA, localidad: '' })
      ).resolves.toBeTruthy();
    });

    test('sin departamento/localidad: no se envían esos filtros en la query', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 1, direcciones: [RESULTADO_GEOREF], total: 1 })
      );
      await geocodificarDireccion({
        calle: 'Av. Corrientes',
        altura: 1234,
        provincia: 'Ciudad Autónoma de Buenos Aires',
      });
      const params = new URLSearchParams(fetch.mock.calls[0][0].split('?')[1]);
      expect(params.has('departamento')).toBe(false);
      expect(params.has('localidad')).toBe(false);
    });

    test('con departamento: se envía como filtro de desambiguación', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 1, direcciones: [RESULTADO_GEOREF], total: 1 })
      );
      await geocodificarDireccion({
        ...DIRECCION_VALIDA,
        departamento: 'Tres de Febrero',
      });
      const params = new URLSearchParams(fetch.mock.calls[0][0].split('?')[1]);
      expect(params.get('departamento')).toBe('Tres de Febrero');
    });
  });

  describe('buscarDirecciones', () => {
    test('devuelve la lista cruda de resultados de Georef', async () => {
      const direcciones = [
        RESULTADO_GEOREF,
        { ...RESULTADO_GEOREF, nomenclatura: 'AV CORRIENTES 1234, Comuna 2' },
      ];
      fetch.mockResolvedValue(
        respuestaOk({ cantidad: 2, direcciones, total: 2 })
      );
      const lista = await buscarDirecciones(DIRECCION_VALIDA);
      expect(lista).toHaveLength(2);
      expect(lista[0].nomenclatura).toBe(
        'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires'
      );
      expect(lista[1].ubicacion.lat).toBeCloseTo(-34.6038563);
    });

    test('valida los datos de entrada antes de llamar a Georef', async () => {
      await expect(buscarDirecciones(null)).rejects.toThrow(/insuficientes/);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
