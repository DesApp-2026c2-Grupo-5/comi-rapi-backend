import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Sucursal } = db;

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
    await Sucursal.destroy({ where: {}, force: true });
    await Sucursal.create({
      nombre: 'Sucursal Centro',
      direccion: 'Av. Principal 123',
      latitud: -34.6037,
      longitud: -58.3816,
      telefono: '011-1234-5678',
      horarios: 'Lun-Dom 10:00-22:00',
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
      expect(res.body.data[0].latitud).toBe(-34.6037);
      expect(res.body.data[0].longitud).toBe(-58.3816);
    });

    it('ADMIN ve todas con ?activa=false', async () => {
      await Sucursal.create({
        nombre: 'Sucursal Norte',
        direccion: 'Calle Norte 456',
        activa: false,
      });
      const res = await agenteAdmin.get('/api/sucursales?activa=false');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe('POST /api/sucursales', () => {
    it('responde 401/403 sin sesión', async () => {
      const res = await request(app)
        .post('/api/sucursales')
        .send({ nombre: 'X', direccion: 'Y' });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('rechaza a un CLIENTE (403)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'X', direccion: 'Y' });
      expect(res.statusCode).toBe(403);
    });

    it('ADMIN crea una sucursal (201)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Sucursal Sur',
          direccion: 'Av. Sur 789',
          latitud: -34.6123,
          longitud: -58.3718,
          telefono: '011-0000-0000',
          horarios: 'Lun-Vie 09:00-21:00',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nombre).toBe('Sucursal Sur');
      expect(res.body.data.activa).toBe(true);
    });

    it('rechaza latitud fuera de rango (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/sucursales')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'X', direccion: 'Y', latitud: 95, longitud: 0 });
      expect(res.statusCode).toBe(400);
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
