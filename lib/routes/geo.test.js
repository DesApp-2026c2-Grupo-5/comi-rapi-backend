import request from 'supertest';
import app from '../app';

/**
 * Tests de las rutas del catálogo territorial (Iteración 3): proxy con cache
 * de Georef + preview de direcciones. Públicas (sin sesión); el POST de
 * preview exige el doble envío de CSRF como el resto de la API. La
 * comunicación HTTP se mockea vía `node-fetch`.
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

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
