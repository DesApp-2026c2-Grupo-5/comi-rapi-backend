import { cleanDb } from '../../test/db_utils';
import db from './index';

const {
  Categoria,
  Direccion,
  EstadoPedido,
  Pedido,
  PedidoEstadoHistorial,
  PedidoItem,
  Producto,
  Sucursal,
  Usuario,
} = db;

describe('Pedido (DER simplificado)', () => {
  let usuario;
  let sucursal;
  let estadoPendiente;
  let estadoConfirmado;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas Test',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa Test',
      precio: 1500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    usuario = await Usuario.create({
      nombre: 'Cliente',
      email: 'cliente-pedido@test.com',
      password: '123456',
      rol: 'CLIENTE',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Test' });
    await Direccion.create({
      sucursalId: sucursal.id,
      calle: 'Calle Test',
      altura: 123,
      provincia: 'Buenos Aires',
      localidad: 'CABA',
      codigoPostal: '1406',
    });
    estadoPendiente = await EstadoPedido.create({
      nombre: 'pendiente',
      orden: 1,
      esInicial: true,
    });
    estadoConfirmado = await EstadoPedido.create({
      nombre: 'confirmado',
      orden: 2,
    });
  });

  test('snapshot: el item conserva nombre y precio aunque cambie el producto', async () => {
    const pedido = await Pedido.create({
      usuarioId: usuario.id,
      sucursalId: sucursal.id,
      estadoId: estadoPendiente.id,
      total: 3000,
    });
    await PedidoItem.create({
      pedidoId: pedido.id,
      productoId: producto.id,
      nombreProducto: 'Hamburguesa Test',
      precioUnitario: 1500,
      cantidad: 2,
      subtotal: 3000,
    });
    await producto.update({ nombre: 'Hamburguesa Renombrada', precio: 9999 });

    const item = await PedidoItem.findOne({ where: { pedidoId: pedido.id } });
    expect(item.nombreProducto).toBe('Hamburguesa Test');
    expect(Number(item.precioUnitario)).toBe(1500);
  });

  test('historial registra el estado inicial', async () => {
    const pedido = await Pedido.create({
      usuarioId: usuario.id,
      sucursalId: sucursal.id,
      estadoId: estadoConfirmado.id,
      total: 1500,
    });
    await PedidoEstadoHistorial.create({
      pedidoId: pedido.id,
      estadoId: estadoConfirmado.id,
      usuarioId: usuario.id,
    });
    const historial = await PedidoEstadoHistorial.findAll({
      where: { pedidoId: pedido.id },
    });
    expect(historial).toHaveLength(1);
  });

  test('FK usuarioId/sucursalId/estadoId son NOT NULL', async () => {
    await expect(Pedido.create({ total: 100 })).rejects.toThrow();
  });
});
