import db from '../models';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import {
  NotificacionError,
  contarNoLeidas,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  notificarEstadoPedido,
  notificarQueja,
} from './notificaciones';

const { EstadoPedido, Notificacion, Pedido, Queja, Sucursal } = db;

describe('Service: notificaciones', () => {
  let cliente;
  let otroCliente;
  let pedido;
  let queja;

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
      apellido: 'Notificaciones',
      email: 'ana-notificaciones@test.com',
    });
    otroCliente = await crearUsuario({
      nombre: 'Beto',
      apellido: 'Notificaciones',
      email: 'beto-notificaciones@test.com',
    });

    pedido = await Pedido.create({
      usuarioId: cliente.id,
      sucursalId: sucursal.id,
      estadoId: estado.id,
      fechaHora: new Date(),
      total: 2000,
    });
    queja = await Queja.create({
      usuarioId: cliente.id,
      pedidoId: pedido.id,
      motivo: 'PEDIDO_INCOMPLETO',
      detalle: 'Faltó la bebida del combo.',
      estado: 'PENDIENTE',
    });
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

  it('lista solo las notificaciones del usuario, más nuevas primero', async () => {
    await crear(cliente.id, { titulo: 'Vieja' });
    await crear(cliente.id, { titulo: 'Nueva' });
    await crear(otroCliente.id, { titulo: 'Ajena' });

    const data = await listarNotificaciones(cliente.id);
    expect(data.total).toBe(2);
    expect(data.noLeidas).toBe(2);
    expect(data.items.map((n) => n.titulo)).toEqual(['Nueva', 'Vieja']);
    expect(data.items[0]).toMatchObject({
      leida: false,
      creadaEn: expect.any(Date),
    });
  });

  it('filtra por tipo y por no leídas', async () => {
    await crear(cliente.id, { tipo: 'PEDIDO', leida: true });
    await crear(cliente.id, { tipo: 'QUEJA' });

    const soloQueja = await listarNotificaciones(cliente.id, { tipo: 'queja' });
    expect(soloQueja.total).toBe(1);
    expect(soloQueja.items[0].tipo).toBe('QUEJA');

    const noLeidas = await listarNotificaciones(cliente.id, {
      soloNoLeidas: '1',
    });
    expect(noLeidas.total).toBe(1);
    expect(noLeidas.noLeidas).toBe(1);
  });

  it('rechaza un tipo desconocido', async () => {
    await expect(
      listarNotificaciones(cliente.id, { tipo: 'OTRO' })
    ).rejects.toBeInstanceOf(NotificacionError);
  });

  it('pagina el listado', async () => {
    for (let i = 0; i < 5; i += 1) await crear(cliente.id);
    const data = await listarNotificaciones(cliente.id, {
      pagina: 2,
      limite: 2,
    });
    expect(data.pagina).toBe(2);
    expect(data.items).toHaveLength(2);
    expect(data.paginas).toBe(3);
  });

  it('marca una notificación como leída y es idempotente', async () => {
    const notificacion = await crear(cliente.id);
    const primera = await marcarLeida(notificacion.id, cliente.id);
    expect(primera.leida).toBe(true);
    expect(primera.leidaEn).toBeTruthy();

    const leidaEn = primera.leidaEn;
    const segunda = await marcarLeida(notificacion.id, cliente.id);
    expect(segunda.leidaEn).toEqual(leidaEn);
  });

  it('no permite marcar notificaciones de otro usuario', async () => {
    const notificacion = await crear(otroCliente.id);
    await expect(
      marcarLeida(notificacion.id, cliente.id)
    ).rejects.toMatchObject({ codigo: 404 });
  });

  it('marca todas las pendientes del usuario', async () => {
    await crear(cliente.id);
    await crear(cliente.id);
    await crear(otroCliente.id);

    const data = await marcarTodasLeidas(cliente.id);
    expect(data.actualizadas).toBe(2);
    expect(await contarNoLeidas(cliente.id)).toBe(0);
    expect(await contarNoLeidas(otroCliente.id)).toBe(1);
  });

  it('crea el aviso de un pedido con el texto del estado', async () => {
    const notificacion = await notificarEstadoPedido(pedido, 'en_camino');
    expect(notificacion).toBeTruthy();
    expect(notificacion).toMatchObject({
      usuarioId: cliente.id,
      tipo: 'PEDIDO',
      pedidoId: pedido.id,
      titulo: 'Tu pedido está en camino',
      leida: false,
    });
  });

  it('permite personalizar el texto y omitir estados sin mensaje', async () => {
    const notificacion = await notificarEstadoPedido(pedido, 'cancelado', {
      titulo: 'Cancelado por cierre',
      mensaje: 'No había otra sucursal abierta.',
    });
    expect(notificacion.titulo).toBe('Cancelado por cierre');
    expect(notificacion.mensaje).toBe('No había otra sucursal abierta.');

    await expect(
      notificarEstadoPedido(pedido, 'estado-inexistente')
    ).resolves.toBeNull();
  });

  it('crea el aviso de un reclamo con su pedido asociado', async () => {
    const notificacion = await notificarQueja(queja, {
      titulo: 'Tu reclamo fue resuelto',
      mensaje: 'Gracias por avisar.',
    });
    expect(notificacion).toMatchObject({
      usuarioId: cliente.id,
      tipo: 'QUEJA',
      quejaId: queja.id,
      pedidoId: pedido.id,
    });
  });
});
