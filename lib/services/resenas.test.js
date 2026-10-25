import db from '../models';
import { cleanDb, crearUsuario } from '../../test/db_utils';
import {
  actualizarResena,
  crearResena,
  eliminarResena,
  listarResenasDeProducto,
  misResenas,
  productosElegibles,
  resumenDeProducto,
} from './resenas';

const {
  Categoria,
  EstadoPedido,
  Pedido,
  PedidoItem,
  Producto,
  Resena,
  Sucursal,
} = db;

describe('Service: resenas', () => {
  let cliente;
  let otroCliente;
  let productoA;
  let productoB;
  let productoC;
  let estadoEntregado;
  let estadoCancelado;
  let sucursal;

  const crearProducto = (nombre, activo = true) =>
    Producto.create({
      nombre,
      precio: 1500,
      categoriaId: 1,
      activo,
      tipo: 'PRODUCTO',
    });

  const crearPedido = async ({
    usuarioId,
    estadoId,
    productos = [productoA.id],
    fechaHora = new Date(),
  }) => {
    const pedido = await Pedido.create({
      usuarioId,
      sucursalId: sucursal.id,
      estadoId,
      fechaHora,
      total: 1500 * productos.length,
    });
    await Promise.all(
      productos.map((productoId) =>
        PedidoItem.create({
          pedidoId: pedido.id,
          productoId,
          nombreProducto: `Producto ${productoId}`,
          precioUnitario: 1500,
          cantidad: 1,
          subtotal: 1500,
        })
      )
    );
    return pedido;
  };

  beforeEach(async () => {
    await cleanDb();
    await Categoria.create({ nombre: 'Hamburguesas' });
    productoA = await crearProducto('Hamburguesa Clásica');
    productoB = await crearProducto('Pizza Muzzarella');
    productoC = await crearProducto('Empanada de carne');
    sucursal = await Sucursal.create({ nombre: 'Sucursal Centro' });
    estadoEntregado = await EstadoPedido.create({
      nombre: 'entregado',
      orden: 1,
      esInicial: false,
      esFinal: true,
    });
    estadoCancelado = await EstadoPedido.create({
      nombre: 'cancelado',
      orden: 2,
      esInicial: false,
      esFinal: true,
    });
    cliente = await crearUsuario({
      nombre: 'María',
      apellido: 'Gómez',
      email: 'maria@test.com',
    });
    otroCliente = await crearUsuario({
      nombre: 'Juan',
      apellido: 'Pérez',
      email: 'juan@test.com',
    });
  });

  describe('crearResena', () => {
    it('crea la reseña de un producto comprado y entregado', async () => {
      const pedido = await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });

      const resena = await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 5,
        comentario: '  Muy rica  ',
      });

      expect(resena).toMatchObject({
        productoId: productoA.id,
        puntuacion: 5,
        comentario: 'Muy rica',
        autor: { nombre: 'María G.' },
      });
      expect(resena).not.toHaveProperty('usuarioId');
      expect(await Resena.count({ where: { pedidoId: pedido.id } })).toBe(1);
    });

    it('acepta comentario vacío y lo guarda como null', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });
      const resena = await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 4,
        comentario: '   ',
      });
      expect(resena.comentario).toBeNull();
    });

    it('rechaza 403 si el producto sólo aparece en pedidos no entregados', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoCancelado.id,
      });

      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: productoA.id,
          puntuacion: 5,
        })
      ).rejects.toMatchObject({ codigo: 403 });
    });

    it('rechaza 403 si el producto no está en ningún pedido del cliente', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });

      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: productoC.id,
          puntuacion: 5,
        })
      ).rejects.toMatchObject({ codigo: 403 });
    });

    it('rechaza 409 si el cliente ya reseñó el producto', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });
      await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 5,
      });

      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: productoA.id,
          puntuacion: 3,
        })
      ).rejects.toMatchObject({ codigo: 409 });
    });

    it('valida puntuación entera de 1 a 5', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });

      for (const puntuacion of [0, 6, 4.5, 'cinco', null]) {
        await expect(
          crearResena({
            usuarioId: cliente.id,
            productoId: productoA.id,
            puntuacion,
          })
        ).rejects.toMatchObject({ codigo: 400 });
      }
    });

    it('valida el largo máximo del comentario', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });

      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: productoA.id,
          puntuacion: 5,
          comentario: 'x'.repeat(501),
        })
      ).rejects.toMatchObject({ codigo: 400 });
    });

    it('responde 404 si el producto no existe', async () => {
      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: 999999,
          puntuacion: 5,
        })
      ).rejects.toMatchObject({ codigo: 404 });
    });

    it('rechaza productos inactivos', async () => {
      const inactivo = await crearProducto('Producto viejo', false);
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [inactivo.id],
      });

      await expect(
        crearResena({
          usuarioId: cliente.id,
          productoId: inactivo.id,
          puntuacion: 5,
        })
      ).rejects.toMatchObject({ codigo: 400 });
    });
  });

  describe('listarResenasDeProducto', () => {
    it('devuelve promedio 0 cuando no hay reseñas', async () => {
      const data = await listarResenasDeProducto(productoA.id);
      expect(data).toMatchObject({ promedio: 0, cantidad: 0, total: 0 });
      expect(data.items).toEqual([]);
    });

    it('calcula promedio y pagina los resultados', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });
      await crearPedido({
        usuarioId: otroCliente.id,
        estadoId: estadoEntregado.id,
      });
      await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 5,
      });
      await crearResena({
        usuarioId: otroCliente.id,
        productoId: productoA.id,
        puntuacion: 4,
      });

      const pagina1 = await listarResenasDeProducto(productoA.id, {
        pagina: 1,
        limite: 1,
      });
      expect(pagina1).toMatchObject({
        promedio: 4.5,
        cantidad: 2,
        total: 2,
        paginas: 2,
      });
      expect(pagina1.items).toHaveLength(1);

      const pagina2 = await listarResenasDeProducto(productoA.id, {
        pagina: 2,
        limite: 1,
      });
      expect(pagina2.items).toHaveLength(1);
      expect(pagina2.items[0].id).not.toBe(pagina1.items[0].id);
    });

    it('responde 404 si el producto no existe', async () => {
      await expect(listarResenasDeProducto(999999)).rejects.toMatchObject({
        codigo: 404,
      });
    });
  });

  describe('productosElegibles', () => {
    it('devuelve sólo productos de pedidos entregados', async () => {
      const entregado = await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [productoA.id, productoB.id],
      });
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoCancelado.id,
        productos: [productoC.id],
      });

      const elegibles = await productosElegibles(cliente.id);
      expect(elegibles).toHaveLength(2);
      expect(elegibles.map((p) => p.productoId).sort()).toEqual(
        [productoA.id, productoB.id].sort()
      );
      expect(elegibles.every((p) => p.pedidoId === entregado.id)).toBe(true);
    });

    it('excluye los productos que el cliente ya reseñó', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [productoA.id, productoB.id],
      });
      await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 5,
      });

      const elegibles = await productosElegibles(cliente.id);
      expect(elegibles.map((p) => p.productoId)).toEqual([productoB.id]);
    });

    it('acota al pedido indicado', async () => {
      const pedido1 = await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [productoA.id],
      });
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [productoB.id],
      });

      const elegibles = await productosElegibles(cliente.id, {
        pedidoId: pedido1.id,
      });
      expect(elegibles.map((p) => p.productoId)).toEqual([productoA.id]);
    });
  });

  describe('actualizarResena / eliminarResena', () => {
    const crearResenaDeCliente = async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });
      return crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 4,
        comentario: 'Buena',
      });
    };

    it('permite editar la reseña propia', async () => {
      const resena = await crearResenaDeCliente();
      const actualizada = await actualizarResena(resena.id, cliente.id, {
        puntuacion: 5,
        comentario: 'Excelente',
      });
      expect(actualizada).toMatchObject({
        puntuacion: 5,
        comentario: 'Excelente',
      });
    });

    it('permite borrar el comentario dejando la puntuación', async () => {
      const resena = await crearResenaDeCliente();
      const actualizada = await actualizarResena(resena.id, cliente.id, {
        puntuacion: 4,
        comentario: '',
      });
      expect(actualizada.comentario).toBeNull();
    });

    it('no deja editar ni borrar la reseña de otro (404)', async () => {
      const resena = await crearResenaDeCliente();

      await expect(
        actualizarResena(resena.id, otroCliente.id, { puntuacion: 1 })
      ).rejects.toMatchObject({ codigo: 404 });
      await expect(
        eliminarResena(resena.id, otroCliente.id)
      ).rejects.toMatchObject({ codigo: 404 });
    });

    it('elimina la reseña propia', async () => {
      const resena = await crearResenaDeCliente();
      await eliminarResena(resena.id, cliente.id);
      expect(await Resena.count()).toBe(0);
    });
  });

  describe('misResenas y resumenDeProducto', () => {
    it('devuelve las reseñas propias con su producto', async () => {
      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
        productos: [productoA.id],
      });
      await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 5,
      });

      const mias = await misResenas(cliente.id);
      expect(mias).toHaveLength(1);
      expect(mias[0].producto).toMatchObject({
        id: productoA.id,
        nombre: 'Hamburguesa Clásica',
      });
    });

    it('resume promedio y cantidad', async () => {
      expect(await resumenDeProducto(productoA.id)).toEqual({
        promedio: 0,
        cantidad: 0,
      });

      await crearPedido({
        usuarioId: cliente.id,
        estadoId: estadoEntregado.id,
      });
      await crearResena({
        usuarioId: cliente.id,
        productoId: productoA.id,
        puntuacion: 4,
      });

      expect(await resumenDeProducto(productoA.id)).toEqual({
        promedio: 4,
        cantidad: 1,
      });
    });
  });
});
