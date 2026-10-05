import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

/**
 * Tests de las rutas del catálogo territorial (Iteración 3): proxy con cache
 * de Georef + preview de direcciones. Públicas (sin sesión); el POST de
 * preview exige el doble envío de CSRF como el resto de la API. La
 * comunicación HTTP se mockea vía `node-fetch`.
 *
 * Iteración 5: el preview con flag `cobertura` evalúa la cobertura real
 * (zona + sucursal activa ≤5 km por ruta) contra la BD de test: por eso este
 * archivo ahora usa `cleanDb` y crea una sucursal activa geolocalizada.
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

const { Sucursal, Direccion } = db;

const agente = request.agent(app);

async function obtenerCsrf() {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

function respuestaOk(cuerpo) {
  return {
    ok: true,
    status: 200,
    json: async () => cuerpo,
    text: async () => '',
  };
}

function respuestaError(status) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error('no json');
    },
    text: async () => 'boom',
  };
}

const DIRECCION_RESULTADO = {
  altura: { unidad: null, valor: 4200 },
  calle: { categoria: 'AV', id: '020700101', nombre: 'AV JUAN B JUSTO' },
  departamento: { id: '02091', nombre: 'Comuna 11' },
  localidad_censal: {
    id: '02000010',
    nombre: 'Ciudad Autónoma de Buenos Aires',
  },
  nomenclatura:
    'AV JUAN B JUSTO 4200, Comuna 11, Ciudad Autónoma de Buenos Aires',
  provincia: { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' },
  ubicacion: { lat: -34.6058859146942, lon: -58.4605130392351 },
};

describe('Rutas /api/geo (catálogo territorial)', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('GET /api/geo/departamentos', () => {
    it('público: devuelve partidos/comunas de la provincia', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          total: 1,
          departamentos: [{ id: '02007', nombre: 'Comuna 1' }],
        })
      );
      const res = await agente.get(
        '/api/geo/departamentos?provincia=Ciudad%20Aut%C3%B3noma%20de%20Buenos%20Aires'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([{ id: '02007', nombre: 'Comuna 1' }]);
    });

    it('sin provincia → 400', async () => {
      const res = await agente.get('/api/geo/departamentos');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/geo/localidades', () => {
    it('devuelve localidades filtradas por provincia y departamento', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          total: 1,
          localidades: [{ id: '06411010010', nombre: 'Caseros' }],
        })
      );
      const res = await agente.get(
        '/api/geo/localidades?provincia=Buenos%20Aires&departamento=Tres%20de%20Febrero'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].nombre).toBe('Caseros');
    });

    it('sin provincia → 400', async () => {
      const res = await agente.get('/api/geo/localidades');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/geo/calles', () => {
    // Contrato del fix bug 3: los ítems incluyen departamento y
    // nomenclatura, necesarios para DISTINGUIR calles repetidas entre
    // comunas/partidos (caso real: "AV JUAN B JUSTO" existe en 6 comunas,
    // cada una con id distinto — verificado contra Georef).
    it('autocompletado por nombre parcial, con datos que distinguen comunas/partidos', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          total: 2,
          calles: [
            {
              id: '0206301001475',
              nombre: 'AV JUAN B JUSTO',
              categoria: 'AV',
              departamento: { id: '02063', nombre: 'Comuna 9' },
              provincia: {
                id: '02',
                nombre: 'Ciudad Autónoma de Buenos Aires',
              },
              nomenclatura:
                'AV JUAN B JUSTO, Comuna 9, Ciudad Autónoma de Buenos Aires',
            },
            {
              id: '0204201001475',
              nombre: 'AV JUAN B JUSTO',
              categoria: 'AV',
              departamento: { id: '02042', nombre: 'Comuna 6' },
              provincia: {
                id: '02',
                nombre: 'Ciudad Autónoma de Buenos Aires',
              },
              nomenclatura:
                'AV JUAN B JUSTO, Comuna 6, Ciudad Autónoma de Buenos Aires',
            },
          ],
        })
      );
      const res = await agente.get(
        '/api/geo/calles?provincia=02&nombre=juan%20b'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].nombre).toBe('AV JUAN B JUSTO');
      expect(res.body.data[0].departamento.nombre).toBe('Comuna 9');
      expect(res.body.data[0].nomenclatura).toBe(
        'AV JUAN B JUSTO, Comuna 9, Ciudad Autónoma de Buenos Aires'
      );
      // Ambas opciones son legítimas y distintas (no se deduplican).
      expect(res.body.data[1].departamento.nombre).toBe('Comuna 6');
    });

    it('menos de 3 letras → lista vacía sin consultar Georef', async () => {
      const res = await agente.get('/api/geo/calles?provincia=02&nombre=ju');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    // Regresión del 503 (post-iteración 5): con localidad seleccionada en la
    // cascada, el autocomplete debe seguir funcionando — el filtro
    // `localidad` se acepta en la ruta pero NO se reenvía a /api/calles.
    it('con localidad en la query → 200 y el filtro NO se reenvía a Georef (regresión 503)', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          total: 1,
          calles: [
            { id: '0653901005150', nombre: 'MATACO', categoria: 'CALLE' },
          ],
        })
      );
      const res = await agente.get(
        '/api/geo/calles?provincia=Buenos%20Aires&departamento=Merlo&localidad=Libertad&nombre=mataco'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].nombre).toBe('MATACO');
      const url = String(fetch.mock.calls[0][0]);
      expect(url).toContain('nombre=mataco');
      expect(url).not.toContain('localidad=');
    });

    it('sin provincia → 400', async () => {
      const res = await agente.get('/api/geo/calles?nombre=algo');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/geo/zonas', () => {
    it('devuelve las zonas de la configuración sin llamar a Georef', async () => {
      const res = await agente.get('/api/geo/zonas');
      expect(res.statusCode).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
      const nombres = res.body.data.map((z) => z.nombre);
      expect(nombres).toContain('CABA');
      expect(nombres).toContain('AMBA');
    });
  });

  describe('POST /api/geo/preview', () => {
    it('dirección única → estado "unica" con resultado normalizado', async () => {
      fetch.mockResolvedValue(
        respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] })
      );
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'juan b justo',
          altura: 4200,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          departamento: 'Comuna 11',
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.estado).toBe('unica');
      expect(res.body.data.resultado.nomenclatura).toBe(
        'AV JUAN B JUSTO 4200, Comuna 11, Ciudad Autónoma de Buenos Aires'
      );
      expect(res.body.data.resultado.normalizada.calle).toBe('AV JUAN B JUSTO');
      expect(res.body.data.opciones).toEqual([]);
    });

    it('varias identidades territoriales → estado "ambigua" con opciones (incluye calle oficial)', async () => {
      fetch.mockResolvedValue(
        respuestaOk({
          total: 2,
          direcciones: [
            DIRECCION_RESULTADO,
            {
              ...DIRECCION_RESULTADO,
              departamento: { id: '02056', nombre: 'Comuna 6' },
              nomenclatura:
                'AV JUAN B JUSTO 4200, Comuna 6, Ciudad Autónoma de Buenos Aires',
            },
          ],
        })
      );
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'juan b justo',
          altura: 4200,
          provincia: 'Ciudad Autónoma de Buenos Aires',
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('ambigua');
      expect(res.body.data.resultado).toBeNull();
      expect(res.body.data.opciones).toHaveLength(2);
      expect(res.body.data.opciones.map((o) => o.departamento)).toEqual([
        'Comuna 11',
        'Comuna 6',
      ]);
      // La calle oficial permite un reintento determinista desde el frontend.
      expect(res.body.data.opciones[0].calle).toBe('AV JUAN B JUSTO');
    });

    it('dirección inexistente → estado "no_encontrada" (no 422: el preview informa)', async () => {
      fetch.mockResolvedValue(respuestaOk({ total: 0, direcciones: [] }));
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Inexistente',
          altura: 99999,
          provincia: 'Buenos Aires',
          departamento: 'Quilmes',
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('no_encontrada');
    });

    it('sin calle/altura/provincia → 400', async () => {
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send({ provincia: 'Buenos Aires' });
      expect(res.statusCode).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('Georef caído → 503 (error handler centralizado)', async () => {
      fetch.mockResolvedValue(respuestaError(500));
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 1,
          provincia: 'Buenos Aires',
          departamento: 'Quilmes',
        });
      expect(res.statusCode).toBe(503);
    });
  });
});

// Iteración 5: preview con flag `cobertura` (validación real de cobertura en
// el paso de verificación del formulario del cliente). Usa la BD de test:
// se crea una sucursal activa geolocalizada para las reglas de distancia.
describe('POST /api/geo/preview con cobertura (iteración 5)', () => {
  // Resultado Georef real de "juan b justo 4200, CABA" (fixture del propio
  // archivo superior, replicado acá por alcance de bloque).
  const DIRECCION_RESULTADO = {
    altura: { unidad: null, valor: 4200 },
    calle: { categoria: 'AV', id: '020700101', nombre: 'AV JUAN B JUSTO' },
    departamento: { id: '02091', nombre: 'Comuna 11' },
    localidad_censal: {
      id: '02000010',
      nombre: 'Ciudad Autónoma de Buenos Aires',
    },
    nomenclatura:
      'AV JUAN B JUSTO 4200, Comuna 11, Ciudad Autónoma de Buenos Aires',
    provincia: { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' },
    ubicacion: { lat: -34.6058859146942, lon: -58.4605130392351 },
  };

  beforeAll(async () => {
    await cleanDb();
    const sucursal = await Sucursal.create({
      nombre: 'Sucursal Preview Geo',
      activa: true,
    });
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Av. Sucursal',
      altura: 1,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      latitud: -34.6037,
      longitud: -58.3816,
      activa: true,
    });
  });

  beforeEach(() => {
    fetch.mockClear();
  });

  function respuestaOrs(distanciaMetros) {
    return respuestaOk({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { summary: { distance: distanciaMetros, duration: 600 } },
          geometry: { type: 'LineString', coordinates: [[-58.38, -34.6]] },
        },
      ],
      metadata: { query: {}, engine: {} },
    });
  }

  function configurarMock({ georef, ors }) {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('georef')) {
        return georef;
      }
      return ors;
    });
  }

  const PREVIEW_CABA = {
    calle: 'juan b justo',
    altura: 4200,
    provincia: 'Ciudad Autónoma de Buenos Aires',
    cobertura: true,
  };

  it('zona OK + sucursal activa a ≤5 km → coberturaDisponible true con la sucursal más cercana', async () => {
    configurarMock({
      georef: respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] }),
      ors: respuestaOrs(2000),
    });
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/geo/preview')
      .set('x-csrf-token', csrf)
      .send(PREVIEW_CABA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.estado).toBe('unica');
    expect(res.body.data.cobertura.dentroZona).toBe(true);
    expect(res.body.data.cobertura.zona).toBe('CABA');
    expect(res.body.data.cobertura.coberturaDisponible).toBe(true);
    expect(res.body.data.cobertura.sucursal.nombre).toBe(
      'Sucursal Preview Geo'
    );
    expect(res.body.data.cobertura.sucursal.distanciaMetros).toBe(2000);
  });

  it('fuera de la zona (Córdoba) → dentroZona false SIN llamar a ORS', async () => {
    configurarMock({
      georef: respuestaOk({
        total: 1,
        direcciones: [
          {
            ...DIRECCION_RESULTADO,
            nomenclatura: 'AV COLON 100, Capital, Córdoba',
            provincia: { id: '14', nombre: 'Córdoba' },
            departamento: { id: '14014', nombre: 'Capital' },
            localidad_censal: { id: '14014010', nombre: 'Córdoba' },
          },
        ],
      }),
      ors: respuestaOrs(1000),
    });
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/geo/preview')
      .set('x-csrf-token', csrf)
      .send({
        calle: 'Av. Colón',
        altura: 100,
        provincia: 'Córdoba',
        cobertura: true,
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.cobertura.dentroZona).toBe(false);
    expect(res.body.data.cobertura.coberturaDisponible).toBe(false);
    expect(res.body.data.cobertura.sucursal).toBe(null);
    // Zona primero: 1 sola llamada (Georef), sin rutas.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('zona OK + sucursal más cercana a 9 km → coberturaDisponible false con distancia de referencia', async () => {
    configurarMock({
      georef: respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] }),
      ors: respuestaOrs(9000),
    });
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/geo/preview')
      .set('x-csrf-token', csrf)
      .send(PREVIEW_CABA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.cobertura.dentroZona).toBe(true);
    expect(res.body.data.cobertura.coberturaDisponible).toBe(false);
    expect(res.body.data.cobertura.sucursal.distanciaMetros).toBe(9000);
    expect(res.body.data.cobertura.mensaje).toMatch(/No hay sucursales/);
  });

  it('zona OK pero ORS caído → 503 (error técnico, no funcional)', async () => {
    configurarMock({
      georef: respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] }),
      ors: respuestaError(500),
    });
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/geo/preview')
      .set('x-csrf-token', csrf)
      .send(PREVIEW_CABA);
    expect(res.statusCode).toBe(503);
  });

  it('sin el flag cobertura → comportamiento previo: no evalúa cobertura ni llama a ORS', async () => {
    const { calle, altura, provincia } = PREVIEW_CABA;
    configurarMock({
      georef: respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] }),
      ors: respuestaOrs(1000),
    });
    const csrf = await obtenerCsrf();
    const res = await agente
      .post('/api/geo/preview')
      .set('x-csrf-token', csrf)
      .send({ calle, altura, provincia });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.cobertura).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // Tarea 7: caso "ausencia de sucursales activas" de la taxonomía — dentro
  // de zona pero sin ninguna sucursal activa geolocalizada. Resultado
  // funcional: cobertura no disponible, sucursal null y CERO llamadas a ORS.
  it('zona OK + ninguna sucursal activa → coberturaDisponible false con sucursal null y sin llamar a ORS', async () => {
    await Sucursal.update({ activa: false }, { where: {} });
    try {
      configurarMock({
        georef: respuestaOk({ total: 1, direcciones: [DIRECCION_RESULTADO] }),
        ors: respuestaOrs(1000),
      });
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/geo/preview')
        .set('x-csrf-token', csrf)
        .send(PREVIEW_CABA);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.cobertura.dentroZona).toBe(true);
      expect(res.body.data.cobertura.coberturaDisponible).toBe(false);
      expect(res.body.data.cobertura.sucursal).toBe(null);
      // Sin sucursales activas no se consultan rutas: 1 sola llamada (Georef).
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await Sucursal.update({ activa: true }, { where: {} });
    }
  });
});
