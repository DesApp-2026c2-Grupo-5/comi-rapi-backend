import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import Usuario from '../models/usuario';

const agenteAdmin = request.agent(app);

async function obtenerCsrf() {
  const res = await agenteAdmin.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function crearAdmin() {
  const csrf = await obtenerCsrf();
  await agenteAdmin.post('/api/auth/registro').set('x-csrf-token', csrf).send({
    nombre: 'Administradora',
    apellido: 'Del Sistema',
    email: 'adminsistema@test.com',
    password: '123456',
    rol: 'ADMINISTRADOR',
  });
  const csrfLogin = await obtenerCsrf();
  await agenteAdmin
    .post('/api/auth/login')
    .set('x-csrf-token', csrfLogin)
    .send({ email: 'adminsistema@test.com', password: '123456' });
}

describe('Usuario controller', () => {
  beforeAll(async () => {
    await cleanDb();
    await crearAdmin();

    await Usuario.bulkCreate(
      [
        {
          nombre: 'Pepita',
          apellido: 'La pistolera',
          email: 'pepita@test.com',
          password: '123456',
          rol: 'CLIENTE',
          activo: true,
        },
        {
          nombre: 'Juana',
          apellido: 'Azurduy',
          email: 'juana@test.com',
          password: '123456',
          rol: 'CLIENTE',
          activo: true,
        },
      ],
      { individualHooks: true }
    );
  });

  describe('GET /api/usuarios', () => {
    it('responde 401 sin sesión', async () => {
      const agenteSuelto = request.agent(app);
      const response = await agenteSuelto.get('/api/usuarios');
      expect(response.statusCode).toBe(401);
    });

    it('responde 403 para un cliente autenticado', async () => {
      const agenteCliente = request.agent(app);
      const csrf1 = (await agenteCliente.get('/api/auth/csrf-token')).body.data
        .csrfToken;
      await agenteCliente
        .post('/api/auth/registro')
        .set('x-csrf-token', csrf1)
        .send({
          nombre: 'Cliente',
          email: 'clientetest@test.com',
          password: '123456',
        });
      const csrf2 = (await agenteCliente.get('/api/auth/csrf-token')).body.data
        .csrfToken;
      await agenteCliente
        .post('/api/auth/login')
        .set('x-csrf-token', csrf2)
        .send({ email: 'clientetest@test.com', password: '123456' });

      const response = await agenteCliente.get('/api/usuarios');
      expect(response.statusCode).toBe(403);
    });

    it('devuelve código 200 para un administrador', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      expect(response.statusCode).toBe(200);
    });

    it('devuelve la lista de usuarios sin contraseñas', async () => {
      const response = await agenteAdmin.get('/api/usuarios');
      expect(response.statusCode).toBe(200);

      const pepita = response.body.data.find(
        (u) => u.email === 'pepita@test.com'
      );
      const juana = response.body.data.find(
        (u) => u.email === 'juana@test.com'
      );
      expect(pepita).toMatchObject({
        nombre: 'Pepita',
        apellido: 'La pistolera',
      });
      expect(juana).toMatchObject({ nombre: 'Juana', apellido: 'Azurduy' });
      expect(response.body.data).toHaveLength(4);
      expect(response.body.data.every((u) => u.rol)).toBe(true);

      const serializado = JSON.stringify(response.body);
      expect(serializado).not.toContain('password');
      expect(serializado).not.toMatch(/\$argon2/);
    });
  });
});
