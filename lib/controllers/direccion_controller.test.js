import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Direccion } = db;

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);

let clienteId;
let otroClienteId;

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
    it('crea una dirección sin latitud/longitud (opcionales)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/direcciones')
        .set('x-csrf-token', csrf)
        .send({
          calle: 'Calle Falsa',
          altura: 456,
          provincia: 'Buenos Aires',
          localidad: 'CABA',
          codigoPostal: '1406',
          alias: 'Trabajo',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.calle).toBe('Calle Falsa');
      expect(res.body.data.altura).toBe(456);
      expect(res.body.data.provincia).toBe('Buenos Aires');
      expect(res.body.data.localidad).toBe('CABA');
      expect(res.body.data.codigoPostal).toBe('1406');
      expect(res.body.data.latitud).toBeNull();
      expect(res.body.data.usuarioId).toBe(clienteId);
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
        .send({ calle: 'Av. Nueva', altura: 999 });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.calle).toBe('Av. Nueva');
      expect(res.body.data.altura).toBe(999);
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
