import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

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

describe('Promociones controller', () => {
  beforeAll(async () => {
    await cleanDb();
    await registrarYLoguear(
      agenteCliente,
      'cliente-promos@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-promos@test.com',
      'ADMINISTRADOR'
    );
  });

  describe('POST /api/promociones', () => {
    it('responde 401/403 sin sesión', async () => {
      const res = await request(app).post('/api/promociones').send({
        nombre: 'Promo X',
        tipo: 'DESCUENTO_PORCENTUAL',
        valor: 10,
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('rechaza CLIENTE (403, solo ADMIN)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo X', tipo: 'DESCUENTO_PORCENTUAL', valor: 10 });
      expect(res.statusCode).toBe(403);
    });

    it('crea DESCUENTO_PORCENTUAL (201)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Promo 10%',
          descripcion: 'Diez por ciento',
          tipo: 'DESCUENTO_PORCENTUAL',
          valor: 10,
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tipo).toBe('DESCUENTO_PORCENTUAL');
      expect(Number(res.body.data.valor)).toBe(10);
      expect(res.body.data.activa).toBe(true);
    });

    it('crea DOS_POR_UNO 2x1 (201)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo 2x1', tipo: 'DOS_POR_UNO', valor: 50 });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tipo).toBe('DOS_POR_UNO');
    });

    it('rechaza tipo inválido (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo X', tipo: 'TRES_POR_DOS', valor: 10 });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Tipo de promoción inválido');
    });

    it('rechaza porcentual mayor a 100 (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo X', tipo: 'DESCUENTO_PORCENTUAL', valor: 150 });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza sin nombre (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ tipo: 'DESCUENTO_PORCENTUAL', valor: 10 });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza fechaFin anterior a fechaInicio (400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Promo X',
          tipo: 'DESCUENTO_PORCENTUAL',
          valor: 10,
          fechaInicio: '2026-10-01',
          fechaFin: '2026-09-01',
        });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/promociones', () => {
    it('público no ve inactivas; admin con ?activa=false sí', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const creada = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo Oculta', tipo: 'DOS_POR_UNO', valor: 50 });
      expect(creada.statusCode).toBe(201);
      await agenteAdmin
        .delete(`/api/promociones/${creada.body.data.id}`)
        .set('x-csrf-token', csrf);

      const publico = await request(app).get('/api/promociones');
      expect(publico.statusCode).toBe(200);
      expect(publico.body.data.some((p) => p.nombre === 'Promo Oculta')).toBe(
        false
      );

      const admin = await agenteAdmin.get('/api/promociones?activa=false');
      expect(admin.statusCode).toBe(200);
      expect(admin.body.data.some((p) => p.nombre === 'Promo Oculta')).toBe(
        true
      );
    });

    it('show inexistente (404)', async () => {
      const res = await request(app).get('/api/promociones/999999');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT/DELETE /api/promociones/:id', () => {
    it('actualiza parcial y valida tipo (200/400)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const creada = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({
          nombre: 'Promo Edit',
          tipo: 'DESCUENTO_PORCENTUAL',
          valor: 20,
        });
      const id = creada.body.data.id;

      const ok = await agenteAdmin
        .put(`/api/promociones/${id}`)
        .set('x-csrf-token', csrf)
        .send({ valor: 30 });
      expect(ok.statusCode).toBe(200);
      expect(Number(ok.body.data.valor)).toBe(30);

      const mala = await agenteAdmin
        .put(`/api/promociones/${id}`)
        .set('x-csrf-token', csrf)
        .send({ tipo: 'CUPON' });
      expect(mala.statusCode).toBe(400);
    });

    it('destroy hace baja lógica (activa=false)', async () => {
      const csrf = await obtenerCsrf(agenteAdmin);
      const creada = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre: 'Promo Baja', tipo: 'DOS_POR_UNO', valor: 50 });
      const id = creada.body.data.id;
      const res = await agenteAdmin
        .delete(`/api/promociones/${id}`)
        .set('x-csrf-token', csrf);
      expect(res.statusCode).toBe(200);

      const detalle = await agenteAdmin.get(`/api/promociones/${id}`);
      expect(detalle.body.data.activa).toBe(false);
    });
  });

  describe('vínculo promoción-productos', () => {
    let producto;
    let productoInactivo;

    beforeAll(async () => {
      const categoria = await db.Categoria.create({
        nombre: 'Promos Test',
        descripcion: 'Test',
      });
      producto = await db.Producto.create({
        nombre: 'Promo Burger',
        precio: 2000,
        categoriaId: categoria.id,
        activo: true,
        tipo: 'PRODUCTO',
      });
      productoInactivo = await db.Producto.create({
        nombre: 'Promo Burger Off',
        precio: 2000,
        categoriaId: categoria.id,
        activo: false,
        tipo: 'PRODUCTO',
      });
    });

    async function crearPromo(nombre) {
      const csrf = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .post('/api/promociones')
        .set('x-csrf-token', csrf)
        .send({ nombre, tipo: 'DESCUENTO_PORCENTUAL', valor: 15 });
      expect(res.statusCode).toBe(201);
      return { id: res.body.data.id, csrf };
    }

    it('asigna producto activo y lo lista (201)', async () => {
      const { id, csrf } = await crearPromo('Promo Vinculo');
      const res = await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: producto.id });
      expect(res.statusCode).toBe(201);

      const lista = await agenteAdmin.get(`/api/promociones/${id}/productos`);
      expect(lista.statusCode).toBe(200);
      expect(lista.body.data).toHaveLength(1);
      expect(lista.body.data[0].nombre).toBe('Promo Burger');
    });

    it('rechaza duplicado (400, no 500)', async () => {
      const { id, csrf } = await crearPromo('Promo Dup');
      await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: producto.id });
      const res = await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: producto.id });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(
        'El producto ya está asignado a la promoción'
      );
    });

    it('rechaza producto inactivo o inexistente (400)', async () => {
      const { id, csrf } = await crearPromo('Promo Inact');
      const inactivo = await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: productoInactivo.id });
      expect(inactivo.statusCode).toBe(400);

      const inexistente = await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: 999999 });
      expect(inexistente.statusCode).toBe(400);
    });

    it('quita vínculo (200) y quitar inexistente (404)', async () => {
      const { id, csrf } = await crearPromo('Promo Quit');
      await agenteAdmin
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: producto.id });
      const ok = await agenteAdmin
        .delete(`/api/promociones/${id}/productos/${producto.id}`)
        .set('x-csrf-token', csrf);
      expect(ok.statusCode).toBe(200);

      const lista = await agenteAdmin.get(`/api/promociones/${id}/productos`);
      expect(lista.body.data).toHaveLength(0);

      const falta = await agenteAdmin
        .delete(`/api/promociones/${id}/productos/${producto.id}`)
        .set('x-csrf-token', csrf);
      expect(falta.statusCode).toBe(404);
    });

    it('cliente no puede asignar (403)', async () => {
      const { id } = await crearPromo('Promo Rol');
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post(`/api/promociones/${id}/productos`)
        .set('x-csrf-token', csrf)
        .send({ productoId: producto.id });
      expect(res.statusCode).toBe(403);
    });
  });
});
