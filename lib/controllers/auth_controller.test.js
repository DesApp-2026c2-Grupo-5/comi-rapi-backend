import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';

const agente = request.agent(app);

async function obtenerCsrf() {
  const res = await agente.get('/api/auth/csrf-token');
  expect(res.statusCode).toBe(200);
  return res.body.data.csrfToken;
}

async function registro({
  nombre,
  apellido,
  email,
  password,
  telefono,
  fechaNacimiento,
  rol,
}) {
  const csrf = await obtenerCsrf();
  return agente.post('/api/auth/registro').set('x-csrf-token', csrf).send({
    nombre,
    apellido,
    email,
    password,
    telefono,
    fechaNacimiento,
    rol,
  });
}

async function login(email, password) {
  const csrf = await obtenerCsrf();
  return agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
}

describe('Auth controller', () => {
  beforeAll(async () => {
    await cleanDb();
  });

  describe('POST /api/auth/registro', () => {
    it('registra un cliente con todos sus datos y devuelve sus datos públicos', async () => {
      const res = await registro({
        nombre: 'Cliente',
        apellido: 'Nuevo',
        email: 'nuevo@test.com',
        password: '123456',
        telefono: '11 5555-1234',
        fechaNacimiento: '1995-06-15',
        rol: 'CLIENTE',
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toMatchObject({
        email: 'nuevo@test.com',
        rol: 'CLIENTE',
        nombre: 'Cliente',
        apellido: 'Nuevo',
        telefono: '11 5555-1234',
        fechaNacimiento: '1995-06-15',
      });
      expect(res.body.data.password).toBeUndefined();
    });

    it('no permite registrarse con email en mayúsculas duplicado', async () => {
      const res = await registro({
        nombre: 'Cliente',
        email: 'NUEVO@test.com',
        password: '123456',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('No se pudo completar la operación');
    });

    it('rechaza datos incompletos con error genérico', async () => {
      const res = await registro({ nombre: '', email: 'x', password: '123' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('No se pudo completar la operación');
    });

    it('nunca expone el hash de la contraseña', async () => {
      const res = await registro({
        nombre: 'Sin hash',
        email: 'sinhash@test.com',
        password: '123456',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/\$argon2/);
    });
  });

  describe('POST /api/auth/login', () => {
    it('inicia sesión con credenciales correctas', async () => {
      const res = await login('nuevo@test.com', '123456');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({
        email: 'nuevo@test.com',
        rol: 'CLIENTE',
      });
      expect(res.body.data.password).toBeUndefined();
    });

    it('responde 401 genérico si la contraseña es incorrecta', async () => {
      const res = await login('nuevo@test.com', 'incorrecta');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Credenciales inválidas');
    });

    it('responde 401 genérico si el email no existe', async () => {
      const res = await login('no-existe@test.com', '123456');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Credenciales inválidas');
    });
  });

  describe('GET /api/auth/me', () => {
    it('responde 401 sin sesión', async () => {
      const agenteSuelto = request.agent(app);
      const res = await agenteSuelto.get('/api/auth/me');
      expect(res.statusCode).toBe(401);
    });

    it('responde con los datos del usuario autenticado', async () => {
      const res = await agente.get('/api/auth/me');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ email: 'nuevo@test.com' });
      expect(res.body.data.password).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('invalida la sesión', async () => {
      const csrf = await obtenerCsrf();
      const res = await agente
        .post('/api/auth/logout')
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(200);

      const me = await agente.get('/api/auth/me');
      expect(me.statusCode).toBe(401);
    });
  });

  describe('Protección CSRF', () => {
    it('rechaza POST sin header x-csrf-token', async () => {
      const agenteLimpio = request.agent(app);
      const res = await agenteLimpio
        .post('/api/auth/login')
        .send({ email: 'nuevo@test.com', password: '123456' });
      expect(res.statusCode).toBe(403);
    });

    it('rechaza POST con header CSRF incorrecto', async () => {
      const agenteLimpio = request.agent(app);
      await agenteLimpio.get('/api/auth/csrf-token');
      const res = await agenteLimpio
        .post('/api/auth/login')
        .set('x-csrf-token', 'token-invalido')
        .send({ email: 'nuevo@test.com', password: '123456' });
      expect(res.statusCode).toBe(403);
    });
  });
});
