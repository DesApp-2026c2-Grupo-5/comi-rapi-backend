/**
 * Tests de cobertura_service (reglas de cobertura geográfica).
 *
 * Las comunicaciones HTTP (Georef y OpenRouteService) se mockean vía
 * `node-fetch` (jest.mock): los tests NO dependen de APIs externas. Los
 * fixtures corresponden a los formatos reales de Georef (api/direcciones) y
 * ORS v2 (GeoJSON). La lista de sucursales se inyecta (sin BD); la consulta a
 * la BD de `obtenerSucursalesActivas` se testea con el módulo `../models`
 * mockeado.
 */

import config from '../config/config';

jest.mock('node-fetch', () => jest.fn());
jest.mock('../models', () => ({
  Sucursal: { findAll: jest.fn() },
  Direccion: {},
  sequelize: {},
  Sequelize: {},
}));
import fetch from 'node-fetch';
import db from '../models';
import {
  evaluarZona,
  validarCoberturaDireccion,
  validarCoberturaParaDelivery,
  DireccionFueraDeZonaError,
  DireccionSinCoberturaError,
} from './cobertura_service';
import { DireccionNoEncontradaError } from './geolocation_service';
import { OrsError } from './routing_service';
import { ZONAS_COBERTURA } from '../config/cobertura-zonas';

const DIRECCION_CABA = {
  calle: 'Av. Corrientes',
  altura: 1234,
  provincia: 'Ciudad Autónoma de Buenos Aires',
  localidad: 'CABA',
};

const RESPUESTA_GEOREF_CABA = {
  total: 1,
  direcciones: [
    {
      nomenclatura:
        'AV CORRIENTES 1234, Comuna 1, Ciudad Autónoma de Buenos Aires',
      ubicacion: { lat: -34.60385632930893, lon: -58.38419018127011 },
      calle: { nombre: 'AV. CORRIENTES' },
      provincia: { nombre: 'Ciudad Autónoma de Buenos Aires' },
      departamento: { nombre: 'Comuna 1' },
      localidad_censal: { nombre: 'Comuna 1' },
    },
  ],
};

function respuestaGeoref(provincia, departamento) {
  return {
    total: 1,
    direcciones: [
      {
        nomenclatura: `DIRECCION 1, ${departamento}, ${provincia}`,
        ubicacion: { lat: -34.6, lon: -58.38 },
        calle: { nombre: 'DIRECCION' },
        provincia: { nombre: provincia },
        departamento: { nombre: departamento },
        localidad_censal: { nombre: departamento },
      },
    ],
  };
}

const RESPUESTA_GEOREF_VACIA = { total: 0, direcciones: [] };

function respuestaOrs(distanciaMetros) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          summary: { distance: distanciaMetros, duration: 600 },
        },
        geometry: { type: 'LineString', coordinates: [[-58.38, -34.6]] },
      },
    ],
    metadata: { query: {}, engine: {} },
  };
}

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

/**
 * Configura el mock de fetch: llamadas a Georef devuelven `georef`; llamadas a
 * ORS devuelven las distancias de `rutas` en orden (una por sucursal activa
 * con coordenadas).
 */
function configurarMock({ georef, rutas = [] }) {
  let indice = 0;
  fetch.mockImplementation(async (url) => {
    if (String(url).includes('georef')) {
      return respuestaOk(georef);
    }
    const distancia = rutas[indice];
    indice += 1;
    return respuestaOk(respuestaOrs(distancia));
  });
}

const SUCURSALES = [
  {
    id: 1,
    nombre: 'Sucursal Centro',
    activa: true,
    direccion: { latitud: -34.6037, longitud: -58.3816 },
  },
  {
    id: 2,
    nombre: 'Sucursal Norte',
    activa: true,
    direccion: { latitud: -34.5926, longitud: -58.3912 },
  },
  {
    id: 3,
    nombre: 'Sucursal Sur',
    activa: false,
    direccion: { latitud: -34.6123, longitud: -58.3718 },
  },
];

describe('cobertura_service (APIs mockeadas)', () => {
  const radioOriginal = config.cobertura.radioMaxKm;

  afterEach(() => {
    jest.clearAllMocks();
    config.cobertura.radioMaxKm = radioOriginal;
  });

  describe('validarCoberturaDireccion', () => {
    test('dirección CABA con sucursal activa dentro del radio → cobertura disponible', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [2000, 3500] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales: SUCURSALES,
      });

      expect(resultado.dentroZona).toBe(true);
      expect(resultado.zona).toBe('CABA');
      expect(resultado.coberturaDisponible).toBe(true);
      expect(resultado.sucursal.id).toBe(1);
      expect(resultado.sucursal.nombre).toBe('Sucursal Centro');
      expect(resultado.sucursal.distanciaMetros).toBeCloseTo(2000);
      expect(resultado.coordenadas.latitud).toBeCloseTo(-34.60385632930893);
      expect(resultado.coordenadas.longitud).toBeCloseTo(-58.38419018127011);
      // 1 llamada a Georef + 2 a ORS (solo sucursales activas; la inactiva se ignora).
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('partido del AMBA (San Isidro) → zona AMBA', async () => {
      configurarMock({
        georef: respuestaGeoref('Buenos Aires', 'San Isidro'),
        rutas: [4000, 4200],
      });
      const resultado = await validarCoberturaDireccion({
        direccion: {
          calle: 'Av. del Libertador',
          altura: 500,
          provincia: 'Buenos Aires',
          localidad: 'San Isidro',
        },
        sucursales: SUCURSALES,
      });

      expect(resultado.dentroZona).toBe(true);
      expect(resultado.zona).toBe('AMBA');
      expect(resultado.coberturaDisponible).toBe(true);
    });

    test('provincia fuera de la zona (Córdoba) → dentroZona false sin llamar a ORS', async () => {
      configurarMock({
        georef: respuestaGeoref('Córdoba', 'Capital'),
        rutas: [],
      });
      const resultado = await validarCoberturaDireccion({
        direccion: {
          calle: 'Av. Colón',
          altura: 100,
          provincia: 'Córdoba',
          localidad: 'Córdoba',
        },
        sucursales: SUCURSALES,
      });

      expect(resultado.dentroZona).toBe(false);
      expect(resultado.zona).toBe(null);
      expect(resultado.coberturaDisponible).toBe(false);
      expect(resultado.sucursal).toBe(null);
      // Solo la llamada a Georef: no se consultan sucursales ni rutas.
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0][0])).toContain('georef');
    });

    test('partido de provincia habilitada pero fuera de la lista AMBA (La Plata) → dentroZona false', async () => {
      configurarMock({
        georef: respuestaGeoref('Buenos Aires', 'La Plata'),
        rutas: [],
      });
      const resultado = await validarCoberturaDireccion({
        direccion: {
          calle: 'Calle 7',
          altura: 900,
          provincia: 'Buenos Aires',
          localidad: 'La Plata',
        },
        sucursales: SUCURSALES,
      });

      expect(resultado.dentroZona).toBe(false);
      expect(resultado.coberturaDisponible).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('devuelve la sucursal más cercana por distancia real por ruta', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [3000, 1200] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales: SUCURSALES,
      });

      expect(resultado.sucursal.id).toBe(2);
      expect(resultado.sucursal.distanciaMetros).toBeCloseTo(1200);
      expect(resultado.coberturaDisponible).toBe(true);
    });

    test('todas las sucursales activas fuera del radio → cobertura no disponible', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [7000, 8200] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales: SUCURSALES,
      });

      expect(resultado.dentroZona).toBe(true);
      expect(resultado.coberturaDisponible).toBe(false);
      expect(resultado.sucursal.id).toBe(1);
      expect(resultado.sucursal.distanciaMetros).toBeCloseTo(7000);
    });

    test('radio máximo configurable (config.cobertura.radioMaxKm)', async () => {
      config.cobertura.radioMaxKm = 1;
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [3000, 1200] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales: SUCURSALES,
      });

      expect(resultado.radioMaxKm).toBe(1);
      expect(resultado.coberturaDisponible).toBe(false);
    });

    test('ignora sucursales activas sin coordenadas geolocalizadas', async () => {
      const sucursales = [
        {
          id: 1,
          nombre: 'Sucursal Centro',
          activa: true,
          direccion: { latitud: -34.6037, longitud: -58.3816 },
        },
        { id: 4, nombre: 'Sucursal Sin GPS', activa: true, direccion: null },
      ];
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [2500] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales,
      });

      expect(resultado.coberturaDisponible).toBe(true);
      expect(resultado.sucursal.id).toBe(1);
      // 1 Georef + 1 ORS: la sucursal sin coordenadas no genera llamada.
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('dirección no encontrada en Georef → DireccionNoEncontradaError', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_VACIA, rutas: [] });
      await expect(
        validarCoberturaDireccion({
          direccion: DIRECCION_CABA,
          sucursales: SUCURSALES,
        })
      ).rejects.toThrow(DireccionNoEncontradaError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('error de ORS (HTTP 500) se propaga', async () => {
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('georef')) {
          return respuestaOk(RESPUESTA_GEOREF_CABA);
        }
        return respuestaError(500, { error: { code: 500, message: 'boom' } });
      });
      await expect(
        validarCoberturaDireccion({
          direccion: DIRECCION_CABA,
          sucursales: SUCURSALES,
        })
      ).rejects.toThrow(OrsError);
    });

    test('dirección sin datos obligatorios → error sin llamar a APIs', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [] });
      await expect(
        validarCoberturaDireccion({
          direccion: { calle: 'Av. Corrientes' },
          sucursales: SUCURSALES,
        })
      ).rejects.toThrow(/Faltan/);
      await expect(validarCoberturaDireccion()).rejects.toThrow(
        /insuficientes/
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    test('sin sucursales activas → cobertura no disponible sin llamadas a ORS', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
        sucursales: [],
      });

      expect(resultado.dentroZona).toBe(true);
      expect(resultado.coberturaDisponible).toBe(false);
      expect(resultado.sucursal).toBe(null);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('sin sucursales inyectadas obtiene las activas de la BD', async () => {
      db.Sucursal.findAll.mockResolvedValue([
        {
          id: 1,
          nombre: 'Sucursal Centro',
          activa: true,
          direccion: { latitud: '-34.6037', longitud: '-58.3816' },
        },
        {
          id: 2,
          nombre: 'Sucursal Sin GPS',
          activa: true,
          direccion: null,
        },
      ]);
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [1500] });
      const resultado = await validarCoberturaDireccion({
        direccion: DIRECCION_CABA,
      });

      expect(db.Sucursal.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { activa: true },
        })
      );
      expect(resultado.coberturaDisponible).toBe(true);
      expect(resultado.sucursal.id).toBe(1);
      // 1 Georef + 1 ORS: la sucursal sin coordenadas de la BD se ignora.
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('evaluarZona', () => {
    test('coincidencia insensible a mayúsculas y acentos', () => {
      const zona = evaluarZona({
        provincia: 'ciudad autonoma de buenos aires',
        departamento: 'comuna 3',
      });
      expect(zona.nombre).toBe('CABA');
    });

    test('provincia ausente o normalizada inválida → null', () => {
      expect(evaluarZona(null)).toBe(null);
      expect(evaluarZona({ departamento: 'Comuna 1' })).toBe(null);
      expect(evaluarZona({ provincia: '  ' })).toBe(null);
    });

    test('provincia no habilitada → null', () => {
      expect(
        evaluarZona({ provincia: 'Santa Fe', departamento: 'Rosario' })
      ).toBe(null);
    });

    test('lista de zonas vacía → null', () => {
      expect(
        evaluarZona({ provincia: 'Ciudad Autónoma de Buenos Aires' }, [])
      ).toBe(null);
    });

    test('usa la configuración por defecto (ZONAS_COBERTURA)', () => {
      expect(
        evaluarZona({
          provincia: 'Buenos Aires',
          departamento: 'Tres de Febrero',
        }).nombre
      ).toBe('AMBA');
      expect(ZONAS_COBERTURA.map((z) => z.nombre)).toEqual(['CABA', 'AMBA']);
    });
  });

  describe('validarCoberturaParaDelivery (ABM)', () => {
    test('fuera de zona → DireccionFueraDeZonaError sin llamar a ORS', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [] });
      await expect(
        validarCoberturaParaDelivery({
          coordenadas: { latitud: -31.42, longitud: -64.18 },
          normalizada: { provincia: 'Córdoba', departamento: 'Capital' },
        })
      ).rejects.toThrow(DireccionFueraDeZonaError);
      expect(fetch).not.toHaveBeenCalled();
    });

    test('dentro de zona sin sucursales dentro del radio → DireccionSinCoberturaError', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [7000, 8200] });
      let error;
      try {
        await validarCoberturaParaDelivery({
          coordenadas: { latitud: -34.6038, longitud: -58.3842 },
          normalizada: {
            provincia: 'Ciudad Autónoma de Buenos Aires',
            departamento: 'Comuna 1',
          },
          sucursales: SUCURSALES,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(DireccionSinCoberturaError);
      expect(error.distanciaMasCercanaMetros).toBeCloseTo(7000);
    });

    test('dentro de cobertura → resultado detallado', async () => {
      configurarMock({ georef: RESPUESTA_GEOREF_CABA, rutas: [2000, 3500] });
      const resultado = await validarCoberturaParaDelivery({
        coordenadas: { latitud: -34.6038, longitud: -58.3842 },
        normalizada: {
          provincia: 'Ciudad Autónoma de Buenos Aires',
          departamento: 'Comuna 1',
        },
        sucursales: SUCURSALES,
      });
      expect(resultado.coberturaDisponible).toBe(true);
      expect(resultado.sucursal.id).toBe(1);
      expect(resultado.sucursal.distanciaMetros).toBeCloseTo(2000);
    });
  });
});
