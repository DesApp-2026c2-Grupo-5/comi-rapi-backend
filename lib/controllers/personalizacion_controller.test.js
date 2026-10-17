/**
 * Pruebas del controller de personalización.
 *
 * Cubren, entre otras cosas, la edición en línea del rango de cantidad
 * (mínimo/máximo) desde el panel de superadmin: el frontend hace un PUT parcial
 * con solo `{ minimo, maximo }`, sin reenviar el resto de los campos.
 */
import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Categoria, PersonalizacionElemento, Producto } = db;

const agente = request.agent(app);

async function obtenerCsrf() {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function login(email, password = '123456') {
  const csrf = await obtenerCsrf();
  return agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
}

describe('Personalización controller · update', () => {
  let elemento;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    const producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    elemento = await PersonalizacionElemento.create({
      productoId: producto.id,
      tipo: 'extra',
      nombre: 'Bacon',
      precio: 500,
      minimo: 0,
      maximo: 1,
      activo: true,
    });
    // El registro público siempre crea CLIENTE: el superadmin se crea directo en
    // la base y luego loguea por /login (las rutas de escritura lo exigen).
    await crearUsuario({
      email: 'super-personalizacion@test.com',
      rol: 'SUPERADMINISTRADOR',
    });
    const res = await login('super-personalizacion@test.com');
    if (res.statusCode !== 200) {
      throw new Error(`El login del superadmin falló: ${res.statusCode}`);
    }
  });

  test('PUT parcial { minimo, maximo } actualiza el rango sin tocar el resto', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .put(`/api/personalizacion/${elemento.id}`)
      .set('x-csrf-token', csrf)
      .send({ minimo: 1, maximo: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ minimo: 1, maximo: 3 });

    await elemento.reload();
    expect(elemento.minimo).toBe(1);
    expect(elemento.maximo).toBe(3);
    // El resto de los campos queda intacto (no se reenviaron).
    expect(elemento.nombre).toBe('Bacon');
    expect(Number(elemento.precio)).toBe(500);
  });

  test('rechaza (400) un máximo menor que el mínimo', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .put(`/api/personalizacion/${elemento.id}`)
      .set('x-csrf-token', csrf)
      .send({ minimo: 4, maximo: 2 });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rechaza (400) un mínimo negativo', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .put(`/api/personalizacion/${elemento.id}`)
      .set('x-csrf-token', csrf)
      .send({ minimo: -1 });

    expect(res.statusCode).toBe(400);
  });

  test('rechaza (400) un máximo no entero', async () => {
    const csrf = await obtenerCsrf();
    const res = await agente
      .put(`/api/personalizacion/${elemento.id}`)
      .set('x-csrf-token', csrf)
      .send({ maximo: 1.5 });

    expect(res.statusCode).toBe(400);
  });

  test('rechaza (403) a un usuario que no es SUPERADMINISTRADOR', async () => {
    await crearUsuario({
      email: 'admin-personalizacion@test.com',
      rol: 'ADMINISTRADOR',
    });
    const agenteAdmin = request.agent(app);
    const csrfLogin = await agenteAdmin.get('/api/auth/csrf-token');
    await agenteAdmin
      .post('/api/auth/login')
      .set('x-csrf-token', csrfLogin.body.data.csrfToken)
      .send({ email: 'admin-personalizacion@test.com', password: '123456' });
    const csrf = await agenteAdmin.get('/api/auth/csrf-token');

    const res = await agenteAdmin
      .put(`/api/personalizacion/${elemento.id}`)
      .set('x-csrf-token', csrf.body.data.csrfToken)
      .send({ minimo: 0, maximo: 2 });

    expect(res.statusCode).toBe(403);
  });
});
