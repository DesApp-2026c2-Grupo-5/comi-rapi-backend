import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoItem,
  Producto,
  Resena,
  Sucursal,
} = db;

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);

async function obtenerCsrf(agente) {
  const res = await agente.get('/api/auth/csrf-token');
  return res.body.data.csrfToken;
}

async function loguear(agente, email) {
  const csrf = await obtenerCsrf(agente);
  const res = await agente
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: '123456' });
  expect(res.statusCode).toBe(200);
}

async function enviar(agente, metodo, url, body) {
  const csrf = await obtenerCsrf(agente);
  const pedido = agente[metodo](url).set('x-csrf-token', csrf);
  return body === undefined ? pedido : pedido.send(body);
}

describe('Reseñas controller', () => {
  let cliente;
  let productoA;
  let productoB;
  let productoC;
  let pedidoEntregado;

  beforeAll(async () => {
    await cleanDb();
    await Categoria.create({ nombre: 'Comidas' });
    productoA = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: 1,
      activo: true,
      tipo: 'PRODUCTO',
    });
    productoB = await Producto.create({
      nombre: 'Pizza Muzzarella',
      precio: 1800,
      categoriaId: 1,
      activo: true,
      tipo: 'PRODUCTO',
    });
    productoC = await Producto.create({
      nombre: 'Empanada de carne',
      precio: 800,
      categoriaId: 1,
      activo: true,
      tipo: 'PRODUCTO',
    });
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
    const estadoEntregado = await EstadoPedido.create({
      nombre: 'entregado',
      orden: 1,
      esInicial: false,
      esFinal: true,
    });
    cliente = await crearUsuario({
      nombre: 'Ana',
      apellido: 'López',
      email: 'ana-resenas@test.com',
    });
    await crearUsuario({
      nombre: 'Beto',
      apellido: 'Ruiz',
      email: 'beto-resenas@test.com',
    });
    await crearUsuario({
      nombre: 'Admin',
      apellido: 'Resenas',
      email: 'admin-resenas@test.com',
      rol: 'ADMINISTRADOR',
    });

    pedidoEntregado = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursal.id,
      estadoId: estadoEntregado.id,
      fechaHora: new Date(),
      total: 3300,
    });
    await PedidoItem.bulkCreate([
      {
        pedidoId: pedidoEntregado.id,
        productoId: productoA.id,
        nombreProducto: productoA.nombre,
        precioUnitario: 1500,
        cantidad: 1,
        subtotal: 1500,
      },
      {
        pedidoId: pedidoEntregado.id,
        productoId: productoB.id,
        nombreProducto: productoB.nombre,
        precioUnitario: 1800,
        cantidad: 1,
        subtotal: 1800,
      },
    ]);

    await loguear(agenteCliente, 'ana-resenas@test.com');
    await loguear(agenteOtro, 'beto-resenas@test.com');
    await loguear(agenteAdmin, 'admin-resenas@test.com');
  });

  beforeEach(async () => {
    await Resena.destroy({ where: {} });
  });

  it('GET /api/productos/:id/resenas es público', async () => {
    const res = await request(app).get(
      `/api/productos/${productoA.id}/resenas`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      promedio: 0,
      cantidad: 0,
      total: 0,
    });
    expect(res.body.data.items).toEqual([]);
  });

  it('POST /api/resenas responde 401 sin sesión', async () => {
    const res = await request(app).post('/api/resenas').send({
      productoId: productoA.id,
      puntuacion: 5,
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('POST /api/resenas responde 403 a un administrador', async () => {
    const res = await enviar(agenteAdmin, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 5,
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/resenas responde 403 sin compra entregada', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoC.id,
      puntuacion: 5,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/entregados/);
  });

  it('POST /api/resenas valida la puntuación', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 0,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/resenas crea la reseña y la publica', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 5,
      comentario: 'Excelente',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({
      productoId: productoA.id,
      puntuacion: 5,
      comentario: 'Excelente',
      autor: { nombre: 'Ana L.' },
    });

    const publico = await request(app).get(
      `/api/productos/${productoA.id}/resenas`
    );
    expect(publico.body.data).toMatchObject({
      promedio: 5,
      cantidad: 1,
      total: 1,
    });
    expect(publico.body.data.items[0].autor.nombre).toBe('Ana L.');
  });

  it('POST /api/resenas responde 409 si ya existe', async () => {
    await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 5,
    });
    const res = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 3,
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /api/resenas/elegibles excluye lo ya reseñado', async () => {
    await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 5,
    });

    const res = await agenteCliente.get('/api/resenas/elegibles');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((p) => p.productoId)).toEqual([productoB.id]);
    expect(res.body.data[0].pedidoId).toBe(pedidoEntregado.id);
  });

  it('GET /api/resenas/elegibles acota a un pedido', async () => {
    const res = await agenteCliente.get(
      `/api/resenas/elegibles?pedidoId=${pedidoEntregado.id}`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((p) => p.productoId).sort()).toEqual(
      [productoA.id, productoB.id].sort()
    );
  });

  it('GET /api/resenas/mias devuelve las propias con su producto', async () => {
    await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 4,
      comentario: 'Muy buena',
    });

    const res = await agenteCliente.get('/api/resenas/mias');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].producto).toMatchObject({
      id: productoA.id,
      nombre: 'Hamburguesa Clásica',
    });
  });

  it('PUT /api/resenas/:id edita la propia y oculta la ajena', async () => {
    const creada = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 4,
    });

    const propia = await enviar(
      agenteCliente,
      'put',
      `/api/resenas/${creada.body.data.id}`,
      { puntuacion: 5, comentario: 'Mejoró' }
    );
    expect(propia.statusCode).toBe(200);
    expect(propia.body.data).toMatchObject({
      puntuacion: 5,
      comentario: 'Mejoró',
    });

    const ajena = await enviar(
      agenteOtro,
      'put',
      `/api/resenas/${creada.body.data.id}`,
      { puntuacion: 1 }
    );
    expect(ajena.statusCode).toBe(404);
  });

  it('DELETE /api/resenas/:id borra la propia y oculta la ajena', async () => {
    const creada = await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 4,
    });

    const ajena = await enviar(
      agenteOtro,
      'delete',
      `/api/resenas/${creada.body.data.id}`
    );
    expect(ajena.statusCode).toBe(404);

    const propia = await enviar(
      agenteCliente,
      'delete',
      `/api/resenas/${creada.body.data.id}`
    );
    expect(propia.statusCode).toBe(200);
    expect(await Resena.count()).toBe(0);
  });

  it('GET /api/productos/:id incluye el resumen de reseñas', async () => {
    await enviar(agenteCliente, 'post', '/api/resenas', {
      productoId: productoA.id,
      puntuacion: 5,
    });

    const res = await request(app).get(`/api/productos/${productoA.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.resenas).toEqual({ promedio: 5, cantidad: 1 });
  });
});
