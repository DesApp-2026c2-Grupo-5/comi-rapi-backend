import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

/**
 * La comunicación HTTP (Georef y ORS) se mockea: los tests NO dependen de APIs
 * externas. Solo los tests de create/update la necesitan (validación → 400 y
 * GET/DELETE no llaman a proveedores).
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

const { Direccion, Sucursal } = db;

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);

let clienteId;
let otroClienteId;

function respuestaGeorefOk(provincia, departamento) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 1,
      direcciones: [
        {
          nomenclatura: `DIRECCION 1, ${departamento}, ${provincia}`,
          ubicacion: { lat: -34.60385632930893, lon: -58.38419018127011 },
          calle: { nombre: 'DIRECCION' },
          provincia: { nombre: provincia },
          departamento: { nombre: departamento },
          localidad_censal: { nombre: departamento },
        },
      ],
    }),
    text: async () => '',
  };
}

function respuestaGeorefVacia() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ total: 0, direcciones: [] }),
    text: async () => '',
  };
}

function respuestaGeorefAmbigua(provincia, departamento) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 2,
      direcciones: [
        {
          nomenclatura: `DIRECCION 1, ${departamento}, ${provincia}`,
          ubicacion: { lat: -34.6, lon: -58.38 },
        },
        {
          nomenclatura: `DIRECCION 2, ${departamento}, ${provincia}`,
          ubicacion: { lat: -34.61, lon: -58.39 },
        },
      ],
    }),
    text: async () => '',
  };
}

function respuestaOrs(distanciaMetros) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { summary: { distance: distanciaMetros, duration: 600 } },
          geometry: { type: 'LineString', coordinates: [[-58.38, -34.6]] },
        },
      ],
      metadata: { query: {}, engine: {} },
    }),
    text: async () => '',
  };
}

/**
 * Configura el mock de fetch: llamadas a Georef devuelven `georef`; llamadas a
 * ORS devuelven las distancias de `rutas` en orden (una por sucursal activa
 * geolocalizada).
 */
function configurarMock({ georef, rutas = [] }) {
  let indice = 0;
  fetch.mockImplementation(async (url) => {
    if (String(url).includes('georef')) {
      return georef;
    }
    const distancia = rutas[indice];
    indice += 1;
    return respuestaOrs(distancia);
  });
}

async function crearSucursalGeolocalizada({ latitud, longitud }) {
  const sucursal = await Sucursal.create({
    nombre: `Sucursal ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    activa: true,
  });
  await Direccion.create({
    sucursalId: sucursal.id,
    calle: 'Av. Sucursal',
    altura: 1,
    provincia: 'Ciudad Autónoma de Buenos Aires',
    localidad: 'CABA',
    codigoPostal: '1000',
    latitud,
    longitud,
    activa: true,
  });
  return sucursal;
}

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function registrarYLoguear(agente, email, rol) {
  const csrf1 = await obtenerCsrf(agente);
  await agente.post('/api/auth/registro').set('x-csrf-token', csrf1).send({
    nombre: 'Test',
    email,
    password: '123456',
    rol,
  });
  const csrf2 = await obtenerCsrf(agente);
  await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf2)
    .send({ email, password: '123456' });
  const me = await agente.get('/api/auth/me');
  return me.body.data.id;
}

describe('Direcciones controller', () => {
  beforeAll(async () => {
    await cleanDb();
    clienteId = await registrarYLoguear(
      agenteCliente,
      'cliente-direcciones@test.com',
      'CLIENTE'
    );
    otroClienteId = await registrarYLoguear(
      agenteOtro,
      'otro-direcciones@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-direcciones@test.com',
      'ADMINISTRADOR'
    );
  });

  beforeEach(async () => {
    fetch.mockClear();
    await Direccion.destroy({ where: {}, force: true });
    await Direccion.create({
      usuarioId: clienteId,
      calle: 'Av. Siempreviva',
      altura: 1234,
      provincia: 'Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1406',
      referencia: 'Casa verde',
      alias: 'Casa',
      activa: true,
    });
    // Sucursal activa geolocalizada para la validación de cobertura (create).
    await crearSucursalGeolocalizada({
      latitud: -34.6037,
      longitud: -58.3816,
    });
  });

  describe('GET /api/direcciones', () => {
    it('devuelve solo las direcciones activas del cliente autenticado', async () => {
      const res = await agenteCliente.get('/api/direcciones');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].calle).toBe('Av. Siempreviva');
      expect(res.body.data[0].latitud).toBeNull();
    });

    it('no filtra direcciones de otros clientes (aislamiento por usuario)', async () => {
      await Direccion.create({
        usuarioId: otroClienteId,
        calle: 'Calle Ajena',
        altura: 1,
        provincia: 'Buenos Aires',
        localidad: 'CABA',
        codigoPostal: '1406',
        activa: true,
      });
      const res = await agenteCliente.get('/api/direcciones');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data.every((d) => d.usuarioId === clienteId)).toBe(true);
    });

    it('responde 401 sin sesión', async () => {
      const res = await request(app).get('/api/direcciones');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/direcciones', () => {
    it('crea una dirección geocodificada: persiste latitud/longitud del backend', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [2000],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Corrientes',
          altura: 1234,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1043',
          alias: 'Trabajo',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.calle).toBe('Av. Corrientes');
      expect(res.body.data.altura).toBe(1234);
      expect(res.body.data.provincia).toBe('Ciudad Autónoma de Buenos Aires');
      expect(res.body.data.localidad).toBe('CABA');
      expect(res.body.data.codigoPostal).toBe('1043');
      expect(res.body.data.latitud).toBeCloseTo(-34.60385632930893);
      expect(res.body.data.longitud).toBeCloseTo(-58.38419018127011);
      expect(res.body.data.usuarioId).toBe(clienteId);
      // 1 llamada a Georef + 1 a ORS (sucursal activa geolocalizada).
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('dirección no encontrada en Georef → 422 sin persistir', async () => {
      configurarMock({ georef: respuestaGeorefVacia(), rutas: [] });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Inexistente',
          altura: 99999,
          provincia: 'Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1406',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/no pudo ser ubicada/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('dirección ambigua → 422 sin persistir', async () => {
      configurarMock({
        georef: respuestaGeorefAmbigua('Buenos Aires', 'CABA'),
        rutas: [],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Ambigua',
          altura: 1,
          provincia: 'Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1406',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/ambigua/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('dirección fuera de la zona de operación → 422 sin persistir', async () => {
      configurarMock({
        georef: respuestaGeorefOk('Córdoba', 'Capital'),
        rutas: [],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Colón',
          altura: 100,
          provincia: 'Córdoba',
          localidad: 'Córdoba',
          codigoPostal: '5000',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/fuera de la zona/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('sin sucursales dentro de la cobertura → 422 sin persistir', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [9000],
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Av. Lejana',
          altura: 2000,
          provincia: 'Ciudad Autónoma de Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1406',
        });
      expect(res.statusCode).toBe(422);
      expect(res.body.error).toMatch(/cobertura/i);
      expect(await Direccion.count({ where: { usuarioId: clienteId } })).toBe(
        1
      );
    });

    it('rechaza sin calle (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          altura: 100,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin altura (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin provincia (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin localidad (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          provincia: 'P',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin codigoPostal (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({ calle: 'Calle', altura: 100, provincia: 'P', localidad: 'L' });
      expect(res.statusCode).toBe(400);
    });

    it('acumula todos los errores de validación en un único mensaje (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          altura: -5,
          provincia: '',
          localidad: '',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('La calle es obligatoria');
      expect(res.body.error).toContain('La altura debe ser');
      expect(res.body.error).toContain('La provincia');
      expect(res.body.error).toContain('La localidad');
      expect(res.body.error).toContain('El código postal');
    });

    it('rechaza latitud/longitud ingresadas manualmente (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle',
          altura: 100,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
          latitud: -34.6,
          longitud: -58.38,
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no se ingresan manualmente/);
    });

    it('rechaza a un ADMINISTRADOR (403)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'X',
          altura: 1,
          provincia: 'P',
          localidad: 'L',
          codigoPostal: '1',
        });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PUT /api/direcciones/:id', () => {
    it('actualiza campos parciales de una dirección propia', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ alias: 'Nuevo alias', referencia: 'Nueva referencia' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.alias).toBe('Nuevo alias');
      expect(res.body.data.referencia).toBe('Nueva referencia');
      // Cambios sin campos de ubicación: sin llamadas a proveedores.
      expect(fetch).not.toHaveBeenCalled();
    });

    it('cambio de ubicación: re-geocodifica y actualiza coordenadas', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [3000],
      });
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Av. Nueva', altura: 999 });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.calle).toBe('Av. Nueva');
      expect(res.body.data.altura).toBe(999);
      expect(res.body.data.latitud).toBeCloseTo(-34.60385632930893);
      expect(res.body.data.longitud).toBeCloseTo(-58.38419018127011);
      // 1 Georef + 1 ORS.
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('cambio solo de codigoPostal: NO re-geocodifica (Georef no lo usa)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ codigoPostal: '9999' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.codigoPostal).toBe('9999');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('cambio de ubicación con cobertura fallando → 422 sin actualizar nada', async () => {
      configurarMock({
        georef: respuestaGeorefOk(
          'Ciudad Autónoma de Buenos Aires',
          'Comuna 1'
        ),
        rutas: [9000],
      });
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Av. Lejana' });
      expect(res.statusCode).toBe(422);
      const persistida = await Direccion.findByPk(direccion.id);
      expect(persistida.calle).toBe('Av. Siempreviva');
    });

    it('no permite editar la dirección de otro cliente (403)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .put(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf)
        .send({ calle: 'Hack' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/direcciones/:id', () => {
    it('baja lógica: activa pasa a false', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .delete(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(200);
      const persistida = await Direccion.findByPk(direccion.id);
      expect(persistida.activa).toBe(false);
    });

    it('no permite eliminar la dirección de otro cliente (403)', async () => {
      const direccion = await Direccion.findOne({
        where: { usuarioId: clienteId },
      });
      const csrf = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .delete(`/api/direcciones/${direccion.id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(403);
    });
  });
});
