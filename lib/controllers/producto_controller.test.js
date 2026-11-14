import request from 'supertest';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import app from '../app';
import db from '../models';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoItem,
  PersonalizacionElemento,
  Producto,
  Sucursal,
} = db;

describe('Producto show (detalle)', () => {
  let producto;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Prueba',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      descripcion: 'Medallón de carne, cheddar, lechuga y tomate.',
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    await PersonalizacionElemento.bulkCreate([
      {
        productoId: producto.id,
        tipo: 'personalizar',
        nombre: 'Lechuga',
        precio: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'extra',
        nombre: 'Cheddar',
        precio: 200,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'acompanar',
        nombre: 'Papas',
        precio: 350,
        productoReferenciaId: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'condimento',
        nombre: 'Ketchup',
        precio: null,
        activo: true,
      },
      {
        productoId: producto.id,
        tipo: 'extra',
        nombre: 'Dado de baja',
        precio: 999,
        activo: false,
      },
    ]);
  });

  test('show incluye personalización activa con sus campos', async () => {
    const res = await request(app).get(`/api/productos/${producto.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nombre).toBe('Hamburguesa Clásica');
    expect(res.body.data.categoria).toBe('Hamburguesas');
    const nombres = res.body.data.personalizacion.map((e) => e.nombre);
    expect(nombres).toEqual(
      expect.arrayContaining(['Lechuga', 'Cheddar', 'Papas', 'Ketchup'])
    );
    expect(nombres).not.toContain('Dado de baja');
    const cheddar = res.body.data.personalizacion.find(
      (e) => e.nombre === 'Cheddar'
    );
    expect(cheddar).toMatchObject({ tipo: 'extra', precio: 200 });
  });

  test('show de producto inexistente responde 404', async () => {
    const res = await request(app).get('/api/productos/999999');
    expect(res.statusCode).toBe(404);
  });
});

describe('Producto index (orden del catálogo)', () => {
  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({ nombre: 'Orden' });
    const crearProducto = (nombre, precio) =>
      Producto.create({
        nombre,
        precio,
        categoriaId: categoria.id,
        tipo: 'PRODUCTO',
        activo: true,
      });
    const alfa = await crearProducto('Alfa', 100);
    const beta = await crearProducto('Beta', 200);
    const gamma = await crearProducto('Gamma', 300);
    await crearProducto('Delta', 50); // Sin ventas.

    const sucursal = await Sucursal.create({ nombre: 'Orden Centro' });
    const confirmado = await EstadoPedido.create({
      nombre: 'confirmado',
      orden: 1,
    });
    const entregado = await EstadoPedido.create({
      nombre: 'entregado',
      orden: 2,
      esFinal: true,
    });
    const cancelado = await EstadoPedido.create({
      nombre: 'cancelado',
      orden: 3,
      esFinal: true,
    });

    const cliente = await crearUsuario({
      email: 'orden-catalogo@test.com',
      rol: 'CLIENTE',
    });

    const crearPedido = (estadoId, total) =>
      Pedido.create({
        usuarioId: cliente.id,
        sucursalId: sucursal.id,
        estadoId,
        total,
        // "Hoy" según el reloj del servidor: entra en la ventana del ranking.
        fechaHora: new Date(),
      });

    const pedidoConfirmado = await crearPedido(confirmado.id, 700);
    const pedidoEntregado = await crearPedido(entregado.id, 200);
    const pedidoCancelado = await crearPedido(cancelado.id, 3000);

    await PedidoItem.bulkCreate([
      {
        pedidoId: pedidoConfirmado.id,
        productoId: alfa.id,
        nombreProducto: alfa.nombre,
        precioUnitario: 100,
        cantidad: 1,
        subtotal: 100,
      },
      {
        pedidoId: pedidoConfirmado.id,
        productoId: beta.id,
        nombreProducto: beta.nombre,
        precioUnitario: 200,
        cantidad: 3,
        subtotal: 600,
      },
      {
        pedidoId: pedidoEntregado.id,
        productoId: alfa.id,
        nombreProducto: alfa.nombre,
        precioUnitario: 100,
        cantidad: 2,
        subtotal: 200,
      },
      // Pedido cancelado: no debe contar como venta.
      {
        pedidoId: pedidoCancelado.id,
        productoId: gamma.id,
        nombreProducto: gamma.nombre,
        precioUnitario: 300,
        cantidad: 10,
        subtotal: 3000,
      },
    ]);
  });

  test('sin orden devuelve los productos por nombre', async () => {
    const res = await request(app).get('/api/productos');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((p) => p.nombre)).toEqual([
      'Alfa',
      'Beta',
      'Delta',
      'Gamma',
    ]);
  });

  test('orden=mas-vendidos prioriza unidades del día y desempata por precio', async () => {
    const res = await request(app).get('/api/productos?orden=mas-vendidos');
    expect(res.statusCode).toBe(200);
    // Beta y Alfa empatan en 3 unidades: gana el más caro (Beta). Gamma y Delta
    // no vendieron: quedan al final, otra vez por precio (Gamma 300 > Delta 50).
    expect(res.body.data.map((p) => p.nombre)).toEqual([
      'Beta',
      'Alfa',
      'Gamma',
      'Delta',
    ]);
  });

  test('un pedido cancelado no cuenta como venta', async () => {
    const res = await request(app).get('/api/productos?orden=mas-vendidos');
    // Sin el filtro de cancelados, Gamma (10 unidades) encabezaría la lista.
    expect(res.body.data[0].nombre).not.toBe('Gamma');
  });
});
