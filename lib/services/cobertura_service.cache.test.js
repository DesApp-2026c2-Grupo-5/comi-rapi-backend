/**
 * Tests de integración del ranking cache-first (A1-4).
 *
 * `sucursalesEnCobertura` contra la base de test REAL (patrón de
 * stock.integration.test.js) con el proveedor HTTP mockeado (node-fetch):
 * la_suite prueba el circuito completo caché → lazy → upsert → re-lectura,
 * incluido el criterio estrella: con caché caliente CERO llamadas al
 * proveedor.
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
import { cleanDb } from '../../test/db_utils';
import db from '../models';
import config from '../config/config';
import { sucursalesEnCobertura } from './cobertura_service';
import { guardarDistancias } from './distancias_service';

const DESTINO = { latitud: -34.5851521, longitud: -58.4159513 };

function respuestaOrs(distanciaMetros, duracionSegundos) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          summary: { distance: distanciaMetros, duration: duracionSegundos },
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

async function crearSucursalConCoords(nombre, latitud, longitud) {
  const sucursal = await db.Sucursal.create({ nombre, activa: true });
  await db.Direccion.create({
    sucursalId: sucursal.id,
    calle: 'Calle Test',
    altura: 100,
    provincia: 'Ciudad Autónoma de Buenos Aires',
    latitud,
    longitud,
    activa: true,
  });
  return sucursal;
}

describe('sucursalesEnCobertura con caché (A1-4, integración)', () => {
  const proveedorOriginal = config.routing.proveedor;

  beforeEach(async () => {
    fetch.mockReset();
    config.routing.proveedor = 'ors';
    await cleanDb();
  });

  afterEach(() => {
    config.routing.proveedor = proveedorOriginal;
  });

  test('caché caliente → ranking ordenado con CERO llamadas al proveedor', async () => {
    const cercana = await crearSucursalConCoords('Cercana', -34.5851, -58.4159);
    const lejana = await crearSucursalConCoords(
      'Lejana',
      -34.588469,
      -58.4109462
    );
    await guardarDistancias({
      destino: DESTINO,
      pares: [
        {
          sucursalId: lejana.id,
          origen: { latitud: -34.588469, longitud: -58.4109462 },
          distanciaMetros: 3000,
          duracionSegundos: 400,
        },
        {
          sucursalId: cercana.id,
          origen: { latitud: -34.5851, longitud: -58.4159 },
          distanciaMetros: 1200,
          duracionSegundos: 150,
        },
      ],
      proveedor: 'ors',
    });

    const dentro = await sucursalesEnCobertura(DESTINO);

    expect(fetch).not.toHaveBeenCalled();
    expect(dentro.map((e) => e.sucursal.nombre)).toEqual(['Cercana', 'Lejana']);
    expect(dentro[0].distanciaMetros).toBe(1200);
    expect(dentro[0].duracionSegundos).toBe(150);
  });

  test('el radio aplicado es el parámetro VIGENTE, no el de cuando se cacheó', async () => {
    const cercana = await crearSucursalConCoords('Cercana', -34.5851, -58.4159);
    const lejana = await crearSucursalConCoords(
      'Lejana',
      -34.588469,
      -58.4109462
    );
    await guardarDistancias({
      destino: DESTINO,
      pares: [
        {
          sucursalId: cercana.id,
          origen: { latitud: -34.5851, longitud: -58.4159 },
          distanciaMetros: 1200,
          duracionSegundos: 150,
        },
        {
          sucursalId: lejana.id,
          origen: { latitud: -34.588469, longitud: -58.4109462 },
          distanciaMetros: 3000,
          duracionSegundos: 400,
        },
      ],
      proveedor: 'ors',
    });
    await db.ParametroSistema.create({
      clave: 'radioCoberturaKm',
      valor: '2',
      descripcion: 'Radio reducido para el test',
    });

    const dentro = await sucursalesEnCobertura(DESTINO);

    expect(fetch).not.toHaveBeenCalled();
    expect(dentro.map((e) => e.sucursal.nombre)).toEqual(['Cercana']);
  });

  test('par faltante → exactamente UNA llamada en vivo, se cachea y a la segunda ya no se llama', async () => {
    const cercana = await crearSucursalConCoords('Cercana', -34.5851, -58.4159);
    await crearSucursalConCoords('Nueva', -34.588469, -58.4109462);
    await guardarDistancias({
      destino: DESTINO,
      pares: [
        {
          sucursalId: cercana.id,
          origen: { latitud: -34.5851, longitud: -58.4159 },
          distanciaMetros: 1200,
          duracionSegundos: 150,
        },
      ],
      proveedor: 'ors',
    });
    fetch.mockResolvedValue(respuestaOk(respuestaOrs(2500, 300)));

    const primera = await sucursalesEnCobertura(DESTINO);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(primera.map((e) => e.sucursal.nombre)).toEqual(['Cercana', 'Nueva']);
    expect(primera[1].distanciaMetros).toBe(2500);
    // El par faltante quedó cacheado (self-healing).
    expect(await db.DistanciaRuta.count()).toBe(2);

    fetch.mockClear();
    const segunda = await sucursalesEnCobertura(DESTINO);

    expect(fetch).not.toHaveBeenCalled();
    expect(segunda.map((e) => e.sucursal.nombre)).toEqual(['Cercana', 'Nueva']);
  });

  test('filas de otro proveedor se ignoran: miss → cálculo en vivo para todos', async () => {
    const cercana = await crearSucursalConCoords('Cercana', -34.5851, -58.4159);
    const lejana = await crearSucursalConCoords(
      'Lejana',
      -34.588469,
      -58.4109462
    );
    // El caché tiene los pares, pero del proveedor INACTIVO: nunca se reutilizan.
    await guardarDistancias({
      destino: DESTINO,
      pares: [
        {
          sucursalId: cercana.id,
          origen: { latitud: -34.5851, longitud: -58.4159 },
          distanciaMetros: 1200,
          duracionSegundos: 150,
        },
        {
          sucursalId: lejana.id,
          origen: { latitud: -34.588469, longitud: -58.4109462 },
          distanciaMetros: 3000,
          duracionSegundos: 400,
        },
      ],
      proveedor: 'geoapify',
    });
    fetch.mockImplementation(async () => respuestaOk(respuestaOrs(2600, 300)));

    const dentro = await sucursalesEnCobertura(DESTINO);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(dentro).toHaveLength(2);
    // Quedaron cacheadas bajo el proveedor activo.
    expect(await db.DistanciaRuta.count({ where: { proveedor: 'ors' } })).toBe(
      2
    );
  });

  test('fail-closed: proveedor caído con par faltante → el error se propaga', async () => {
    await crearSucursalConCoords('Cercana', -34.5851, -58.4159);
    fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'ORS offline' } }),
      text: async () => '{}',
    });

    await expect(sucursalesEnCobertura(DESTINO)).rejects.toThrow(
      /OpenRouteService/
    );
  });
});
