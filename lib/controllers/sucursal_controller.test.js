import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

/**
 * La comunicación HTTP (Georef) se mockea: los tests NO dependen de APIs
 * externas. La dirección de sucursal exige geocodificación (sin validación de
 * zona/cobertura: no hay llamadas a ORS). Solo create/update la necesitan.
 */

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

const { Sucursal, Direccion } = db;

function respuestaGeorefOk(provincia, departamento) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      total: 1,
      direcciones: [
        {
          nomenclatura: `DIRECCION 1, ${departamento}, ${provincia}`,
          ubicacion: { lat: -34.6123, lon: -58.3718 },
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

const agenteCliente = request.agent(app);
const agenteAdmin = request.agent(app);

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
}

describe('Sucursales controller', () => {
  beforeAll(async () => {
    await cleanDb();
    await registrarYLoguear(
      agenteCliente,
      'cliente-sucursales@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-sucursales@test.com',
      'ADMINISTRADOR'
    );
  });

  beforeEach(async () => {
    fetch.mockClear();
    await Direccion.destroy({ where: {}, force: true });
    await Sucursal.destroy({ where: {}, force: true });
    const sucursal = await Sucursal.create({
      nombre: 'Sucursal Centro',
      telefono: '011-1234-5678',
      horarios: 'Lun-Dom 10:00-22:00',
      activa: true,
    });
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Av. Principal',
      altura: 123,
      provincia: 'Ciudad Autónoma de Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1000',
      latitud: -34.6037,
      longitud: -58.3816,
      activa: true,
    });
  });

  describe('GET /api/sucursales', () => {
    it('lista solo sucursales activas para el público', async () => {
      const res = await request(app).get('/api/sucursales');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].nombre).toBe('Sucursal Centro');
      expect(res.body.data[0].direccion.calle).toBe('Av. Principal');
      expect(res.body.data[0].latitud).toBe(-34.6037);
      expect(res.body.data[0].longitud).toBe(-58.3816);
    });

    it('ADMIN ve todas con ?activa=false', async () => {
      await Sucursal.create({ nombre: 'Sucursal Norte', activa: false });
      const res = await agenteAdmin.get('/api/sucursales?activa=false');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe('POST /api/sucursales', () => {
    it('responde 401/403 sin sesión', async () => {
      const res = await request(app)
        .post('/api/sucursales')
        .send({ nombre: 'X', direccion: { calle: 'Y' } });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('rechaza a un CLIENTE (403)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'X', direccion: { calle: 'Y' } });
      expect(res.statusCode).toBe(403);
    });

    it('ADMIN crea una sucursal (201): dirección geocodificada', async () => {
      fetch.mockResolvedValue(
        respuestaGeorefOk('Ciudad Autónoma de Buenos Aires', 'Comuna 3')
      );
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Sucursal Sur',
          direccion: {
            calle: 'Av. Sur',
            altura: 789,
            provincia: 'Ciudad Autónoma de Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1064',
          },
          telefono: '011-0000-0000',
          horarios: 'Lun-Vie 09:00-21:00',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nombre).toBe('Sucursal Sur');
      expect(res.body.data.activa).toBe(true);
      expect(res.body.data.direccion.calle).toBe('Av. Sur');
      expect(res.body.data.direccion.altura).toBe(789);
      const direccion = await Direccion.findOne({
        where: { sucursalId: res.body.data.id },
      });
      expect(direccion).not.toBeNull();
      expect(direccion.calle).toBe('Av. Sur');
      expect(direccion.latitud).not.toBeNull();
      expect(direccion.longitud).not.toBeNull();
      expect(Number(direccion.latitud)).toBeCloseTo(-34.6123);
      // Solo Georef: sin validación de cobertura (no hay llamadas a ORS).
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('geocodificación fallando → 422 sin persistir nada', async () => {
      fetch.mockResolvedValue(respuestaGeorefVacia());
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Sucursal Inubicable',
          direccion: {
            calle: 'Calle Inexistente',
            altura: 99999,
            provincia: 'Buenos Aires',
            departamento: 'Quilmes',
            localidad: 'CABA',
            codigoPostal: '1406',
          },
        });
      expect(res.statusCode).toBe(422);
      expect(await Sucursal.count()).toBe(1);
      expect(await Direccion.count()).toBe(1);
    });

    it('rechaza latitud/longitud ingresadas manualmente (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'X',
          direccion: {
            calle: 'Y',
            altura: 1,
            provincia: 'Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1406',
            latitud: -34.6,
            longitud: -58.38,
          },
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no se ingresan manualmente/);
    });

    it('solo con latitud también se rechaza (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'X',
          direccion: {
            calle: 'Y',
            altura: 1,
            provincia: 'Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1406',
            latitud: -34.6,
          },
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin calle en la dirección (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'X',
          direccion: {
            altura: 1,
            provincia: 'Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1406',
          },
        });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin provincia en la dirección (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'X',
          direccion: {
            calle: 'Y',
            altura: 1,
            localidad: 'CABA',
            codigoPostal: '1406',
          },
        });
      expect(res.statusCode).toBe(400);
    });

    // Iteración 1-geo: la localidad es opcional en el ingreso; la regla
    // territorial nueva es el partido obligatorio en Buenos Aires.
    it('dirección de Buenos Aires sin partido → 400 (regla territorial)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'X',
          direccion: {
            calle: 'Y',
            altura: 1,
            provincia: 'Buenos Aires',
            codigoPostal: '1406',
          },
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/partido es obligatorio/i);
    });

    // Iteración 1-geo: localidad y código postal opcionales (el backend
    // determina la localidad y Georef no provee el CP).
    it('dirección sin localidad ni codigoPostal (CABA): 201 con null', async () => {
      fetch.mockResolvedValue(
        respuestaGeorefOk('Ciudad Autónoma de Buenos Aires', 'Comuna 5')
      );
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Sucursal Minimal',
          direccion: {
            calle: 'Av. Sur',
            altura: 100,
            provincia: 'Ciudad Autónoma de Buenos Aires',
          },
        });
      expect(res.statusCode).toBe(201);
      const direccion = await Direccion.findOne({
        where: { sucursalId: res.body.data.id },
      });
      expect(direccion.codigoPostal).toBeNull();
      // La localidad se persiste normalizada por Georef, no la ingresada.
      expect(direccion.localidad).toBe('Comuna 5');
      expect(direccion.departamento).toBe('Comuna 5');
      expect(direccion.nomenclatura).toBe(
        'DIRECCION 1, Comuna 5, Ciudad Autónoma de Buenos Aires'
      );
    });
  });

  describe('PUT /api/sucursales/:id', () => {
    it('ADMIN actualiza campos parciales', async () => {
      const sucursal = await Sucursal.findOne({
        where: { nombre: 'Sucursal Centro' },
      });
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .put(`/api/sucursales/${sucursal.id}`)
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Sucursal Centro Renovada', activa: false });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.nombre).toBe('Sucursal Centro Renovada');
      expect(res.body.data.activa).toBe(false);
    });

    it('ADMIN actualiza la dirección anidada de la sucursal (re-geocodifica)', async () => {
      fetch.mockResolvedValue(
        respuestaGeorefOk('Ciudad Autónoma de Buenos Aires', 'Comuna 1')
      );
      const sucursal = await Sucursal.findOne({
        where: { nombre: 'Sucursal Centro' },
      });
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .put(`/api/sucursales/${sucursal.id}`)
        .set('x-csrf-token', csrf)
        .send({
          direccion: {
            calle: 'Av. Nueva',
            altura: 999,
            provincia: 'Ciudad Autónoma de Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1406',
          },
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.direccion.calle).toBe('Av. Nueva');
      expect(res.body.data.direccion.altura).toBe(999);
      expect(res.body.data.direccion.latitud).toBeCloseTo(-34.6123);
      const direcciones = await Direccion.findAll({
        where: { sucursalId: sucursal.id },
      });
      expect(direcciones).toHaveLength(1);
      expect(direcciones[0].calle).toBe('Av. Nueva');
      expect(Number(direcciones[0].latitud)).toBeCloseTo(-34.6123);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('ADMIN actualiza solo el teléfono: NO geocodifica (sin llamadas a proveedores)', async () => {
      const sucursal = await Sucursal.findOne({
        where: { nombre: 'Sucursal Centro' },
      });
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .put(`/api/sucursales/${sucursal.id}`)
        .set('x-csrf-token', csrf)
        .send({ telefono: '011-9999-9999' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.telefono).toBe('011-9999-9999');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('ADMIN reenvía la dirección idéntica: NO re-geocodifica', async () => {
      const sucursal = await Sucursal.findOne({
        where: { nombre: 'Sucursal Centro' },
      });
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .put(`/api/sucursales/${sucursal.id}`)
        .set('x-csrf-token', csrf)
        .send({
          direccion: {
            calle: 'Av. Principal',
            altura: 123,
            provincia: 'Ciudad Autónoma de Buenos Aires',
            localidad: 'CABA',
            codigoPostal: '1000',
          },
        });
      expect(res.statusCode).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
      // Coordenadas persistidas se conservan.
      const persistida = await Direccion.findOne({
        where: { sucursalId: sucursal.id },
      });
      expect(Number(persistida.latitud)).toBeCloseTo(-34.6037);
    });
  });

  describe('DELETE /api/sucursales/:id', () => {
    it('baja lógica: activa pasa a false', async () => {
      const sucursal = await Sucursal.findOne({
        where: { nombre: 'Sucursal Centro' },
      });
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .delete(`/api/sucursales/${sucursal.id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(200);
      const persistida = await Sucursal.findByPk(sucursal.id);
      expect(persistida.activa).toBe(false);
    });
  });
});
