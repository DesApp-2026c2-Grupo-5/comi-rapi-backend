import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const {
  EstadoPedido,
  Notificacion,
  Pedido,
  Queja,
  QuejaMensaje,
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

describe('Notificaciones controller', () => {
  let cliente;
  let otroCliente;
  let pedido;

  beforeAll(async () => {
    await cleanDb();

    const sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
    const estado = await EstadoPedido.create({
      nombre: 'entregado',
      orden: 6,
      esInicial: false,
      esFinal: true,
    });

    cliente = await crearUsuario({
      nombre: 'Ana',
      apellido: 'Centro',
      email: 'ana-centro@test.com',
    });
    otroCliente = await crearUsuario({
      nombre: 'Beto',
      apellido: 'Centro',
      email: 'beto-centro@test.com',
    });
    await crearUsuario({
      nombre: 'Admin',
      apellido: 'Centro',
      email: 'admin-centro@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursal.id,
    });

    pedido = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursal.id,
      estadoId: estado.id,
      fechaHora: new Date(),
      total: 2000,
    });

    await loguear(agenteCliente, 'ana-centro@test.com');
    await loguear(agenteOtro, 'beto-centro@test.com');
    await loguear(agenteAdmin, 'admin-centro@test.com');
  });

  beforeEach(async () => {
    await Notificacion.destroy({ where: {} });
  });

  const crear = (usuarioId, datos = {}) =>
    Notificacion.create({
      usuarioId,
      tipo: 'SISTEMA',
      titulo: 'Aviso de prueba',
      ...datos,
    });

  it('GET /api/notificaciones responde 401 sin sesión', async () => {
    const res = await request(app).get('/api/notificaciones');
    expect([401, 403]).toContain(res.statusCode);
  });

  it('GET /api/notificaciones responde 403 a un administrador', async () => {
    const res = await agenteAdmin.get('/api/notificaciones');
    expect(res.statusCode).toBe(403);
  });

  it('lista solo las notificaciones del cliente autenticado', async () => {
    await crear(cliente.id, { titulo: 'Propia' });
    await crear(otroCliente.id, { titulo: 'Ajena' });

    const res = await agenteCliente.get('/api/notificaciones');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].titulo).toBe('Propia');
  });

  it('GET /api/notificaciones/no-leidas devuelve el contador', async () => {
    await crear(cliente.id);
    await crear(cliente.id, { leida: true });

    const res = await agenteCliente.get('/api/notificaciones/no-leidas');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.noLeidas).toBe(1);
  });

  it('PUT /api/notificaciones/:id/leida marca solo una propia', async () => {
    const propia = await crear(cliente.id);
    const ajena = await crear(otroCliente.id);

    const ok = await enviar(
      agenteCliente,
      'put',
      `/api/notificaciones/${propia.id}/leida`
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.leida).toBe(true);

    const ajeno = await enviar(
      agenteCliente,
      'put',
      `/api/notificaciones/${ajena.id}/leida`
    );
    expect(ajeno.statusCode).toBe(404);
  });

  it('PUT /api/notificaciones/leidas marca todas las pendientes', async () => {
    await crear(cliente.id);
    await crear(cliente.id);
    await crear(otroCliente.id);

    const res = await enviar(
      agenteCliente,
      'put',
      '/api/notificaciones/leidas'
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.actualizadas).toBe(2);

    const contador = await agenteCliente.get('/api/notificaciones/no-leidas');
    expect(contador.body.data.noLeidas).toBe(0);
  });

  it('una respuesta del negocio genera una notificación de reclamo', async () => {
    const creada = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedido.id,
      motivo: 'PEDIDO_INCOMPLETO',
      detalle: 'Faltó la bebida del combo.',
    });
    expect(creada.statusCode).toBe(201);

    const res = await enviar(
      agenteAdmin,
      'put',
      `/api/quejas/${creada.body.data.id}`,
      { estado: 'RESUELTA', respuesta: 'Te devolvimos el importe.' }
    );
    expect(res.statusCode).toBe(200);

    const listado = await agenteCliente.get('/api/notificaciones');
    expect(listado.body.data.items).toHaveLength(1);
    expect(listado.body.data.items[0]).toMatchObject({
      tipo: 'QUEJA',
      quejaId: creada.body.data.id,
      pedidoId: pedido.id,
      titulo: 'Tu reclamo fue resuelto',
    });
  });

  afterAll(async () => {
    await QuejaMensaje.destroy({ where: {} });
    await Queja.destroy({ where: {} });
  });
});
