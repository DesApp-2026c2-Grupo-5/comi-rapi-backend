import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const { EstadoPedido, Pedido, Queja, QuejaMensaje, Sucursal } = db;

const agenteCliente = request.agent(app);
const agenteOtro = request.agent(app);
const agenteAdmin = request.agent(app);
const agenteSuperadmin = request.agent(app);

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

const QUEJA_VALIDA = {
  motivo: 'PEDIDO_INCOMPLETO',
  detalle: 'Faltó la bebida y las papas del combo.',
};

describe('Quejas controller', () => {
  let cliente;
  let otroCliente;
  let admin;
  let sucursalA;
  let sucursalB;
  let pedidoEntregado;
  let pedidoEntregadoOtraSucursal;
  let pedidoPendiente;

  beforeAll(async () => {
    await cleanDb();

    sucursalA = await Sucursal.create({ nombre: 'Sucursal Centro' });
    sucursalB = await Sucursal.create({ nombre: 'Sucursal Norte' });

    const estadoEntregado = await EstadoPedido.create({
      nombre: 'entregado',
      orden: 6,
      esInicial: false,
      esFinal: true,
    });
    const estadoPendiente = await EstadoPedido.create({
      nombre: 'pendiente',
      orden: 1,
      esInicial: true,
      esFinal: false,
    });

    cliente = await crearUsuario({
      nombre: 'Ana',
      apellido: 'López',
      email: 'ana-quejas@test.com',
    });
    otroCliente = await crearUsuario({
      nombre: 'Beto',
      apellido: 'Ruiz',
      email: 'beto-quejas@test.com',
    });
    admin = await crearUsuario({
      nombre: 'Admin',
      apellido: 'Quejas',
      email: 'admin-quejas@test.com',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursalA.id,
    });
    await crearUsuario({
      nombre: 'Super',
      apellido: 'Quejas',
      email: 'super-quejas@test.com',
      rol: 'SUPERADMINISTRADOR',
    });

    pedidoEntregado = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursalA.id,
      estadoId: estadoEntregado.id,
      fechaHora: new Date(),
      total: 3300,
    });
    pedidoEntregadoOtraSucursal = await Pedido.create({
      usuarioId: otroCliente.id,
      sucursalId: sucursalB.id,
      estadoId: estadoEntregado.id,
      fechaHora: new Date(),
      total: 2500,
    });
    pedidoPendiente = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursalA.id,
      estadoId: estadoPendiente.id,
      fechaHora: new Date(),
      total: 1200,
    });

    await loguear(agenteCliente, 'ana-quejas@test.com');
    await loguear(agenteOtro, 'beto-quejas@test.com');
    await loguear(agenteAdmin, 'admin-quejas@test.com');
    await loguear(agenteSuperadmin, 'super-quejas@test.com');
  });

  beforeEach(async () => {
    await QuejaMensaje.destroy({ where: {} });
    await Queja.destroy({ where: {} });
  });

  it('POST /api/quejas responde 401 sin sesión', async () => {
    const res = await request(app)
      .post('/api/quejas')
      .send({ pedidoId: pedidoEntregado.id, ...QUEJA_VALIDA });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('POST /api/quejas responde 403 a un administrador', async () => {
    const res = await enviar(agenteAdmin, 'post', '/api/quejas', {
      pedidoId: pedidoEntregado.id,
      ...QUEJA_VALIDA,
    });
    expect(res.statusCode).toBe(403);
  });

  it('crea una queja sobre un pedido propio entregado', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoEntregado.id,
      ...QUEJA_VALIDA,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({
      pedidoId: pedidoEntregado.id,
      motivo: 'PEDIDO_INCOMPLETO',
      estado: 'PENDIENTE',
      respuesta: null,
    });
  });

  it('valida el largo del detalle', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'corto',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/al menos/);
  });

  it('rechaza un motivo fuera del enum', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoEntregado.id,
      motivo: 'INVENTADO',
      detalle: QUEJA_VALIDA.detalle,
    });
    expect(res.statusCode).toBe(400);
  });

  it('responde 404 si el pedido es de otro cliente', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoEntregadoOtraSucursal.id,
      ...QUEJA_VALIDA,
    });
    expect(res.statusCode).toBe(404);
  });

  it('responde 403 si el pedido propio no está entregado', async () => {
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoPendiente.id,
      ...QUEJA_VALIDA,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/entregados/);
  });

  it('responde 409 si el pedido ya tiene una queja', async () => {
    await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo previo sobre el mismo pedido.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteCliente, 'post', '/api/quejas', {
      pedidoId: pedidoEntregado.id,
      ...QUEJA_VALIDA,
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /api/quejas/mias devuelve solo las del cliente', async () => {
    await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de otro cliente.',
      estado: 'PENDIENTE',
    });

    const res = await agenteCliente.get('/api/quejas/mias');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].pedidoId).toBe(pedidoEntregado.id);
  });

  it('GET /api/quejas/mias filtra por pedidoId', async () => {
    await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await agenteCliente.get(
      `/api/quejas/mias?pedidoId=${pedidoPendiente.id}`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /api/quejas acota al administrador a su sucursal', async () => {
    await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la sucursal centro.',
      estado: 'PENDIENTE',
    });
    await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la sucursal norte.',
      estado: 'PENDIENTE',
    });

    const res = await agenteAdmin.get('/api/quejas');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].pedido.sucursal.id).toBe(sucursalA.id);
  });

  it('GET /api/quejas le muestra todo al superadministrador', async () => {
    await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la sucursal centro.',
      estado: 'PENDIENTE',
    });
    await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la sucursal norte.',
      estado: 'PENDIENTE',
    });

    const res = await agenteSuperadmin.get('/api/quejas');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  it('GET /api/quejas responde 403 al cliente', async () => {
    const res = await agenteCliente.get('/api/quejas');
    expect(res.statusCode).toBe(403);
  });

  it('el administrador no puede responder quejas de otra sucursal', async () => {
    const queja = await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la sucursal norte.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'EN_REVISION',
    });
    expect(res.statusCode).toBe(404);
  });

  it('el cliente no puede responder su propia queja', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteCliente, 'put', `/api/quejas/${queja.id}`, {
      estado: 'EN_REVISION',
    });
    expect(res.statusCode).toBe(403);
  });

  it('pasa a EN_REVISION sin exigir respuesta', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'EN_REVISION',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.estado).toBe('EN_REVISION');
    expect(res.body.data.respuesta).toBeNull();
  });

  it('responde sin cambiar de estado en PENDIENTE', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      respuesta: 'Estamos revisando el pedido con la sucursal.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      estado: 'PENDIENTE',
      respuesta: 'Estamos revisando el pedido con la sucursal.',
      respondidoPor: { id: admin.id },
    });
    expect(res.body.data.respondidaEn).toBeTruthy();
    expect(res.body.data.mensajes).toHaveLength(1);
    expect(res.body.data.mensajes[0]).toMatchObject({
      contenido: 'Estamos revisando el pedido con la sucursal.',
      delCliente: false,
    });
  });

  it('responde sin cambiar de estado en EN_REVISION', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'EN_REVISION',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      respuesta: 'Necesitamos el número de ticket del pago.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.estado).toBe('EN_REVISION');
    expect(res.body.data.mensajes).toHaveLength(1);
  });

  it('exige mensaje cuando no se indica estado', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      respuesta: '   ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/mensaje/i);
  });

  it('no permite mensajes del negocio en una queja resuelta', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'RESUELTA',
      respuesta: 'Resuelto.',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      respuesta: 'Un mensaje más.',
    });
    expect(res.statusCode).toBe(400);
  });

  it('ordena la bandeja por última actividad', async () => {
    const vieja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo con actividad reciente.',
      estado: 'PENDIENTE',
    });
    await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo más nuevo por creación.',
      estado: 'PENDIENTE',
    });

    // La más nueva por creación no es la de actividad más reciente: cuando el
    // cliente responde, el reclamo sube al tope de la bandeja.
    const mensaje = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${vieja.id}/mensajes`,
      { contenido: 'Sigo esperando una respuesta.' }
    );
    expect(mensaje.statusCode).toBe(201);

    const res = await agenteSuperadmin.get('/api/quejas');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0].id).toBe(vieja.id);
  });

  it('exige respuesta para resolver', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'EN_REVISION',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'RESUELTA',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/respuesta/);
  });

  it('resuelve con respuesta y guarda el respondedor', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'EN_REVISION',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'RESUELTA',
      respuesta: 'Se reintegró el valor por el mismo medio de pago.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      estado: 'RESUELTA',
      respuesta: 'Se reintegró el valor por el mismo medio de pago.',
      respondidoPor: { id: admin.id },
    });
    expect(res.body.data.respondidaEn).toBeTruthy();
    expect(res.body.data.mensajes).toHaveLength(1);
    expect(res.body.data.mensajes[0]).toMatchObject({
      contenido: 'Se reintegró el valor por el mismo medio de pago.',
      delCliente: false,
    });
  });

  it('el cliente responde y suma un mensaje al hilo', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'EN_REVISION',
    });
    const res = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/mensajes`,
      { contenido: 'Sigue sin llegarme la bebida.' }
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.data.mensajes).toHaveLength(1);
    expect(res.body.data.mensajes[0]).toMatchObject({
      contenido: 'Sigue sin llegarme la bebida.',
      delCliente: true,
    });
    expect(res.body.data.respuestasCliente).toBe(1);
    expect(res.body.data.estado).toBe('EN_REVISION');
  });

  it('la respuesta del cliente reabre una queja resuelta', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'RESUELTA',
      respuesta: 'Resuelto.',
    });
    const res = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/mensajes`,
      { contenido: 'No me llegó el reintegro.' }
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.data.estado).toBe('PENDIENTE');
  });

  it('el cliente no puede responder la queja de otro', async () => {
    const queja = await Queja.create({
      usuarioId: otroCliente.id,
      pedidoId: pedidoEntregadoOtraSucursal.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de otro cliente.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/mensajes`,
      { contenido: 'No es mía.' }
    );
    expect(res.statusCode).toBe(404);
  });

  it('el cliente tiene como máximo 5 respuestas', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    for (let i = 0; i < 5; i += 1) {
      const res = await enviar(
        agenteCliente,
        'post',
        `/api/quejas/${queja.id}/mensajes`,
        { contenido: `Mensaje ${i}` }
      );
      expect(res.statusCode).toBe(201);
    }
    const res = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/mensajes`,
      { contenido: 'Mensaje de más.' }
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/máximo/);
  });

  it('el cliente cierra el reclamo y no admite más respuestas', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'EN_REVISION',
    });
    const cierre = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/cerrar`
    );
    expect(cierre.statusCode).toBe(200);
    expect(cierre.body.data).toMatchObject({ estado: 'CERRADA' });
    expect(cierre.body.data.cerradaEn).toBeTruthy();

    const respuesta = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/mensajes`,
      { contenido: 'Quiero responder igual.' }
    );
    expect(respuesta.statusCode).toBe(409);

    const otroCierre = await enviar(
      agenteCliente,
      'post',
      `/api/quejas/${queja.id}/cerrar`
    );
    expect(otroCierre.statusCode).toBe(409);
  });

  it('el administrador no puede reabrir una queja cerrada por el cliente', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'CERRADA',
      cerradaEn: new Date(),
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'EN_REVISION',
    });
    expect(res.statusCode).toBe(400);
  });

  it('no permite reabrir una queja cerrada', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'RESUELTA',
      respuesta: 'Resuelto.',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'EN_REVISION',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza una transición inválida', async () => {
    const queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedidoEntregado.id,
      motivo: 'OTRO',
      detalle: 'Reclamo de la clienta.',
      estado: 'PENDIENTE',
    });
    const res = await enviar(agenteAdmin, 'put', `/api/quejas/${queja.id}`, {
      estado: 'PENDIENTE',
    });
    expect(res.statusCode).toBe(400);
  });
});
