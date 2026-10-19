/**
 * Tests del caché de distancias `DistanciasRutas` (A1-3) contra la base de
 * test real (patrón de usuario.test.js / direccion.test.js).
 *
 * Cubre las reglas aprobadas: upsert idempotente por par+proveedor, filas
 * separadas por proveedor (nunca reutilizadas entre sí), claves estables
 * ante strings decimales y best-effort (un fallo de escritura no rompe).
 */

import { cleanDb } from '../../test/db_utils';
import db from './index';
import {
  guardarDistancias,
  redondearCoord,
} from '../services/distancias_service';

const DESTINO = { latitud: -34.5851521, longitud: -58.4159513 };
const ORIGEN = { latitud: -34.588469, longitud: -58.4109462 };

describe('DistanciaRuta (caché de distancias, A1-3)', () => {
  let sucursal;

  const parCon = (distanciaMetros, duracionSegundos) => [
    {
      sucursalId: sucursal.id,
      origen: ORIGEN,
      distanciaMetros,
      duracionSegundos,
    },
  ];

  beforeEach(async () => {
    await cleanDb();
    sucursal = await db.Sucursal.create({ nombre: 'Sucursal Centro' });
  });

  test('guarda una fila por par evaluado en vivo', async () => {
    await guardarDistancias({
      destino: DESTINO,
      pares: parCon(588, 78),
      proveedor: 'ors',
    });
    expect(await db.DistanciaRuta.count()).toBe(1);
    const fila = await db.DistanciaRuta.findOne();
    expect(fila.sucursalId).toBe(sucursal.id);
    expect(fila.distanciaMetros).toBe(588);
    expect(fila.duracionSegundos).toBe(78);
    expect(fila.proveedor).toBe('ors');
  });

  test('re-evaluar el mismo par actualiza, no duplica (ON CONFLICT DO UPDATE)', async () => {
    await guardarDistancias({
      destino: DESTINO,
      pares: parCon(588, 78),
      proveedor: 'ors',
    });
    await guardarDistancias({
      destino: DESTINO,
      pares: parCon(999, 123),
      proveedor: 'ors',
    });
    expect(await db.DistanciaRuta.count()).toBe(1);
    const fila = await db.DistanciaRuta.findOne();
    expect(fila.distanciaMetros).toBe(999);
    expect(fila.duracionSegundos).toBe(123);
  });

  test('mismo par con otro proveedor → fila separada (nunca se reutilizan)', async () => {
    await guardarDistancias({
      destino: DESTINO,
      pares: parCon(588, 78),
      proveedor: 'ors',
    });
    await guardarDistancias({
      destino: DESTINO,
      pares: parCon(590, 80),
      proveedor: 'geoapify',
    });
    expect(await db.DistanciaRuta.count()).toBe(2);
    expect(await db.DistanciaRuta.count({ where: { proveedor: 'ors' } })).toBe(
      1
    );
    expect(
      await db.DistanciaRuta.count({ where: { proveedor: 'geoapify' } })
    ).toBe(1);
  });

  test('claves estables: coordenadas como string decimal y number → misma fila', async () => {
    await guardarDistancias({
      destino: { latitud: -34.5851521, longitud: -58.4159513 },
      pares: [
        {
          sucursalId: sucursal.id,
          origen: { latitud: -34.588469, longitud: -58.4109462 },
          distanciaMetros: 588,
          duracionSegundos: 78,
        },
      ],
      proveedor: 'ors',
    });
    // La DB devuelve los DECIMAL como string: mismo par escrito a partir de
    // los valores leídos no debe duplicar.
    const fila = await db.DistanciaRuta.findOne();
    await guardarDistancias({
      destino: {
        latitud: String(fila.destinoLatitud),
        longitud: String(fila.destinoLongitud),
      },
      pares: [
        {
          sucursalId: sucursal.id,
          origen: {
            latitud: String(fila.origenLatitud),
            longitud: String(fila.origenLongitud),
          },
          distanciaMetros: 600,
          duracionSegundos: 90,
        },
      ],
      proveedor: 'ors',
    });
    expect(await db.DistanciaRuta.count()).toBe(1);
  });

  test('redondearCoord normaliza a 6 decimales y estabiliza la clave', () => {
    expect(redondearCoord('-34.58515210')).toBe(redondearCoord(-34.5851521));
    expect(redondearCoord(-34.58515214999)).toBe(-34.585152);
    expect(redondearCoord(0)).toBe(0);
  });

  test('best-effort: un fallo de escritura no lanza (la validación sigue)', async () => {
    await expect(
      guardarDistancias({
        destino: DESTINO,
        pares: [
          {
            sucursalId: sucursal.id,
            origen: ORIGEN,
            distanciaMetros: 'esto-no-es-un-numero',
            duracionSegundos: 78,
          },
        ],
        proveedor: 'ors',
      })
    ).resolves.toBeUndefined();
    expect(await db.DistanciaRuta.count()).toBe(0);
  });

  test('entrada inválida (sin destino / sin pares) no escribe nada', async () => {
    await guardarDistancias({ destino: null, pares: parCon(588, 78) });
    await guardarDistancias({ destino: DESTINO, pares: [] });
    await guardarDistancias({ destino: DESTINO });
    expect(await db.DistanciaRuta.count()).toBe(0);
  });
});
