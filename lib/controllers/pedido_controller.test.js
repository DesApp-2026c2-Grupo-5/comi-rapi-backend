import request from 'supertest';
import { cleanDb } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { Categoria, EstadoPedido, Producto, Sucursal, Direccion } = db;

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

describe('Pedidos controller', () => {
  let sucursal;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Av. Principal',
      altura: 123,
      provincia: 'Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1406',
    });
    await EstadoPedido.bulkCreate([
      { nombre: 'pendiente', orden: 1, esInicial: true },
      { nombre: 'confirmado', orden: 2 },
      { nombre: 'en_preparacion', orden: 3 },
      { nombre: 'listo_para_entregar', orden: 4 },
      { nombre: 'en_camino', orden: 5 },
      { nombre: 'entregado', orden: 6, esFinal: true },
      { nombre: 'cancelado', orden: 7, esFinal: true },
    ]);

    await registrarYLoguear(
      agenteCliente,
      'cliente-pedidos@test.com',
      'CLIENTE'
    );
    await registrarYLoguear(
      agenteAdmin,
      'admin-pedidos@test.com',
      'ADMINISTRADOR'
    );
  });

  describe('POST /api/pedidos', () => {
    it('responde 401 sin sesión', async () => {
      const res = await request(app)
        .post('/api/pedidos')
        .send({
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      // 401 por falta de sesión o 403 por falta de CSRF: ambos indican protección
      expect([401, 403]).toContain(res.statusCode);
    });

    it('crea un pedido con snapshot y total recalculado (201)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 2 }],
          direccionEntrega: { calle: 'Av. Siempreviva 123', ciudad: 'CABA' },
          // total enviado a propósito incorrecto: el backend lo recalcula
          total: 1,
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(3000);
      expect(res.body.data.estado).toBe('pendiente');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].nombreProducto).toBe('Hamburguesa Clásica');
    });

    it('rechaza pedido sin productos (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({ sucursalId: sucursal.id, productos: [] });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/pedidos', () => {
    it('CLIENTE solo ve sus propios pedidos', async () => {
      const res = await agenteCliente.get('/api/pedidos');
      expect(res.statusCode).toBe(200);
      expect(
        res.body.data.every(
          (p) => p.cliente?.email === 'cliente-pedidos@test.com'
        )
      ).toBe(true);
    });

    it('ADMIN ve todos (?sucursalId= filtra)', async () => {
      const res = await agenteAdmin.get(
        `/api/pedidos?sucursalId=${sucursal.id}`
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/pedidos/:id/estado', () => {
    it('rechaza transición inválida pendiente → entregado (400)', async () => {
      const lista = await agenteCliente.get('/api/pedidos');
      const id = lista.body.data[0].id;
      const csrf = await obtenerCsrf(agenteCliente);
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'entregado' });
      expect(res.statusCode).toBe(400);
    });

    it('permite confirmar pendiente → confirmado con medioPago', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Confirmar 1', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('confirmado');
      expect(res.body.data.medioPago).toBe('TARJETA');
    });

    it('rechaza confirmar sin medioPago (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Medio de pago obligatorio para confirmar');
    });

    it('admin no puede confirmar pendiente ajeno (403, solo CLIENTE dueño)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfAdmin)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      expect(res.statusCode).toBe(403);
    });

    it('cliente no puede avanzar confirmado → en_preparacion (403)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'en_preparacion' });
      expect(res.statusCode).toBe(403);
    });

    it('admin avanza confirmado → en_preparacion (200 + historial)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'MERCADO_PAGO' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      const res = await agenteAdmin
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrfAdmin)
        .send({ estado: 'en_preparacion' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('en_preparacion');
      expect(
        res.body.data.historial.some(
          (h) => h.EstadoPedido.nombre === 'en_preparacion'
        )
      ).toBe(true);
    });

    it('admin completa flujo hasta entregado (fallback repartidor)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      const id = creado.body.data.id;
      await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      for (const estado of [
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
        'entregado',
      ]) {
        const res = await agenteAdmin
          .patch(`/api/pedidos/${id}/estado`)
          .set('x-csrf-token', csrfAdmin)
          .send({ estado });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.estado).toBe(estado);
      }
      const detalle = await agenteAdmin.get(`/api/pedidos/${id}`);
      expect(
        detalle.body.data.historial.map((h) => h.EstadoPedido.nombre)
      ).toEqual([
        'pendiente',
        'confirmado',
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
        'entregado',
      ]);
    });

    it('cliente no puede marcar en_camino → entregado (403)', async () => {
      const csrfCliente = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrfCliente)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      const id = creado.body.data.id;
      await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'confirmado', medioPago: 'TARJETA' });
      const csrfAdmin = await obtenerCsrf(agenteAdmin);
      for (const estado of [
        'en_preparacion',
        'listo_para_entregar',
        'en_camino',
      ]) {
        await agenteAdmin
          .patch(`/api/pedidos/${id}/estado`)
          .set('x-csrf-token', csrfAdmin)
          .send({ estado });
      }
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfCliente)
        .send({ estado: 'entregado' });
      expect(res.statusCode).toBe(403);
    });

    it('cliente cancela su propio pedido pendiente (200)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Siempreviva 456', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;

      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'cancelado', observacion: 'Cancelado por el cliente' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.estado).toBe('cancelado');
      expect(
        res.body.data.historial.some(
          (h) => h.EstadoPedido.nombre === 'cancelado'
        )
      ).toBe(true);
    });

    it('cliente no puede cancelarlo pedido ajeno (404/403)', async () => {
      const agenteOtro = request.agent(app);
      await registrarYLoguear(agenteOtro, 'cliente-otro@test.com', 'CLIENTE');

      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;

      const csrfOtro = await obtenerCsrf(agenteOtro);
      const res = await agenteOtro
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrfOtro)
        .send({ estado: 'cancelado' });
      expect(res.statusCode).toBe(403);
    });

    it('rechaza medioPago inválido (400)', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(creado.statusCode).toBe(201);
      const res = await agenteCliente
        .patch(`/api/pedidos/${creado.body.data.id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'efectivo' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Medio de pago inválido');
    });

    it('persiste medioPago al confirmar', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const creado = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
          direccionEntrega: { calle: 'Av. Siempreviva 456', ciudad: 'CABA' },
        });
      expect(creado.statusCode).toBe(201);
      const id = creado.body.data.id;
      const res = await agenteCliente
        .patch(`/api/pedidos/${id}/estado`)
        .set('x-csrf-token', csrf)
        .send({ estado: 'confirmado', medioPago: 'MERCADO_PAGO' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.medioPago).toBe('MERCADO_PAGO');

      const detalle = await agenteCliente.get(`/api/pedidos/${id}`);
      expect(detalle.statusCode).toBe(200);
      expect(detalle.body.data.medioPago).toBe('MERCADO_PAGO');
    });
  });

  describe('orden del historial', () => {
    it('lista recientes primero y con historial cronológico', async () => {
      const csrf = await obtenerCsrf(agenteCliente);
      const viejo = await agenteCliente
        .post('/api/pedidos')
        .set('x-csrf-token', csrf)
        .send({
          sucursalId: sucursal.id,
          productos: [{ productoId: producto.id, cantidad: 1 }],
        });
      expect(viejo.statusCode).toBe(201);
      await db.Pedido.update(
        { fechaHora: new Date('2020-01-01T00:00:00Z') },
        { where: { id: viejo.body.data.id } }
      );

      const res = await agenteCliente.get('/api/pedidos');
      expect(res.statusCode).toBe(200);
      const fechas = res.body.data.map((p) => p.fechaHora);
      expect([...fechas].sort().reverse()).toEqual(fechas);

      const confirmado = res.body.data.find((p) => p.estado === 'confirmado');
      expect(confirmado.historial.map((h) => h.EstadoPedido.nombre)).toEqual([
        'pendiente',
        'confirmado',
      ]);
    });
  });
});
