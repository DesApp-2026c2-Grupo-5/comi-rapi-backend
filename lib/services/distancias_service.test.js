/**
 * Tests unitarios de la LECTURA del caché de distancias (A1-4).
 *
 * Se mockea `../models` (DistanciaRuta.findOne, sequelize.query) y
 * `./routing_service` (calcularRuta): el test es hermético y rápido. La
 * persistencia real (upsert ON CONFLICT) tiene su suite contra la base de
 * test en lib/models/distancia_ruta.test.js; el ranking cache-first con
 * fetch real-mockeado, en cobertura_service.cache.test.js.
 */

jest.mock('../models', () => ({
  DistanciaRuta: { findOne: jest.fn() },
  sequelize: { query: jest.fn() },
}));
jest.mock('./routing_service', () => ({
  calcularRuta: jest.fn(),
}));
import db from '../models';
import config from '../config/config';
import { calcularRuta } from './routing_service';
import {
  claveDeCoordenadas,
  obtenerDistanciasCacheadas,
  obtenerOCalcularDistancia,
} from './distancias_service';

const ORIGEN = { latitud: -34.588469, longitud: -58.4109462 };
const DESTINO = { latitud: -34.5851521, longitud: -58.4159513 };

function filaCacheada(distanciaMetros, duracionSegundos) {
  return {
    distanciaMetros: String(distanciaMetros),
    duracionSegundos: String(duracionSegundos),
    proveedor: 'ors',
  };
}

describe('distancias_service (lectura del caché, A1-4)', () => {
  const proveedorOriginal = config.routing.proveedor;

  beforeEach(() => {
    jest.clearAllMocks();
    config.routing.proveedor = 'ors';
  });

  afterEach(() => {
    config.routing.proveedor = proveedorOriginal;
  });

  describe('claveDeCoordenadas', () => {
    test('clave estable ante strings decimales y numbers', () => {
      expect(
        claveDeCoordenadas({ latitud: '-34.588469', longitud: -58.4109462 })
      ).toBe(claveDeCoordenadas(ORIGEN));
    });
  });

  describe('obtenerDistanciasCacheadas', () => {
    test('busca cada origen con las coordenadas redondeadas y el proveedor activo', async () => {
      db.DistanciaRuta.findOne.mockResolvedValue(filaCacheada(588, 78));
      const mapa = await obtenerDistanciasCacheadas({
        destino: DESTINO,
        origenes: [ORIGEN],
      });
      expect(mapa.get(claveDeCoordenadas(ORIGEN))).toEqual({
        distanciaMetros: 588,
        duracionSegundos: 78,
      });
      const where = db.DistanciaRuta.findOne.mock.calls[0][0].where;
      expect(where.proveedor).toBe('ors');
      expect(where.origenLatitud).toBe(-34.588469);
      expect(where.destinoLongitud).toBe(-58.415951);
    });

    test('filas de OTRO proveedor no se devuelven (nunca se reutilizan)', async () => {
      // Simula que solo existe fila del proveedor inactivo: findOne con el
      // filtro del activo no la encuentra.
      db.DistanciaRuta.findOne.mockResolvedValue(null);
      const mapa = await obtenerDistanciasCacheadas({
        destino: DESTINO,
        origenes: [ORIGEN],
      });
      expect(mapa.size).toBe(0);
    });

    test('entradas inválidas (sin destino / sin orígenes) → mapa vacío sin consultar', async () => {
      expect(
        await obtenerDistanciasCacheadas({ destino: null, origenes: [ORIGEN] })
      ).toEqual(new Map());
      expect(
        await obtenerDistanciasCacheadas({ destino: DESTINO, origenes: [] })
      ).toEqual(new Map());
      expect(
        await obtenerDistanciasCacheadas({ destino: DESTINO, origenes: [null] })
      ).toEqual(new Map());
      expect(db.DistanciaRuta.findOne).not.toHaveBeenCalled();
    });
  });

  describe('obtenerOCalcularDistancia', () => {
    test('caché caliente → devuelve la duración SIN llamar al proveedor', async () => {
      db.DistanciaRuta.findOne.mockResolvedValue(filaCacheada(588, 78));
      const resultado = await obtenerOCalcularDistancia({
        origen: ORIGEN,
        destino: DESTINO,
        sucursalId: 2,
      });
      expect(resultado).toEqual({
        distanciaMetros: 588,
        duracionSegundos: 78,
        deCache: true,
      });
      expect(calcularRuta).not.toHaveBeenCalled();
      expect(db.sequelize.query).not.toHaveBeenCalled();
    });

    test('caché frío → calcula en vivo y puebla el caché (self-healing)', async () => {
      db.DistanciaRuta.findOne.mockResolvedValue(null);
      calcularRuta.mockResolvedValue({
        distanciaMetros: 999,
        duracionSegundos: 123,
        geometria: null,
      });
      const resultado = await obtenerOCalcularDistancia({
        origen: ORIGEN,
        destino: DESTINO,
        sucursalId: 2,
      });
      expect(resultado).toEqual({
        distanciaMetros: 999,
        duracionSegundos: 123,
        deCache: false,
      });
      expect(calcularRuta).toHaveBeenCalledTimes(1);
      // El upsert (INSERT ... ON CONFLICT) se disparó para el par calculado.
      expect(db.sequelize.query).toHaveBeenCalledTimes(1);
      expect(String(db.sequelize.query.mock.calls[0][0])).toContain(
        'ON CONFLICT'
      );
    });

    test('fail-closed: el error del proveedor se PROPAGA (nunca inventa distancia)', async () => {
      db.DistanciaRuta.findOne.mockResolvedValue(null);
      calcularRuta.mockRejectedValue(
        new Error('Se superó el límite de solicitudes')
      );
      await expect(
        obtenerOCalcularDistancia({ origen: ORIGEN, destino: DESTINO })
      ).rejects.toThrow(/límite de solicitudes/);
      expect(db.sequelize.query).not.toHaveBeenCalled();
    });
  });
});
