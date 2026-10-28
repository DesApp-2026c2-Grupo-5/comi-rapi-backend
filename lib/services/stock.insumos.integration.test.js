/**
 * Pruebas del stock de extras y condimentos.
 *
 * El stock de un insumo vive en su propia tabla (`InsumoStocks`), pero comparte
 * el ciclo de vida del pedido con los productos: se controla antes de asignar
 * sucursal, se descuenta al crear y se repone al cancelar. Estas pruebas cubren
 * ese recorrido y los textos que ve el cliente.
 */
import { cleanDb } from '../../test/db_utils';
import db from '../models';
import {
  StockInsuficienteError,
  descontarStock,
  faltantesDeInsumos,
  faltantesDePedido,
  insumosDeLineas,
  mensajeDeFaltantes,
  reponerStock,
  reservasDeStockVencidas,
} from './stock';

const { Categoria, Insumo, InsumoStock, Producto, Stock, Sucursal } = db;

const lineaCon = (opciones, cantidad = 1) => ({
  productoId: 1,
  cantidad,
  personalizacion: opciones,
});

describe('insumosDeLineas', () => {
  test('suma extras y condimentos multiplicando por las unidades de la línea', () => {
    const requeridos = insumosDeLineas([
      lineaCon(
        {
          extras: [{ insumoId: 10, cantidad: 2 }],
          condimentos: [{ insumoId: 20, cantidad: 1 }],
        },
        3
      ),
      lineaCon({ extras: [{ insumoId: 10, cantidad: 1 }] }, 1),
    ]);

    expect(requeridos.get(10)).toBe(7);
    expect(requeridos.get(20)).toBe(3);
  });

  test('lee la personalización guardada como JSON en observacion', () => {
    const requeridos = insumosDeLineas([
      {
        productoId: 1,
        cantidad: 2,
        observacion: JSON.stringify({
          extras: [{ insumoId: 5, cantidad: 1 }],
        }),
      },
    ]);
    expect(requeridos.get(5)).toBe(2);
  });

  test('ignora acompañamientos, ingredientes y líneas viejas sin insumoId', () => {
    const requeridos = insumosDeLineas([
      lineaCon({
        acompanar: [{ insumoId: 1, cantidad: 1 }],
        personalizar: [{ insumoId: 2, cantidad: 1 }],
        extras: [{ nombre: 'Bacon', cantidad: 1 }],
      }),
    ]);
    expect(requeridos.size).toBe(0);
  });
});

describe('stock de insumos contra la base', () => {
  let sucursal;
  let producto;
  let extra;
  let condimento;
  let linea;

  beforeEach(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Test', activa: true });
    producto = await Producto.create({
      nombre: 'Hamburguesa',
      precio: 1000,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    extra = await Insumo.create({
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
      activo: true,
    });
    condimento = await Insumo.create({
      nombre: 'Ketchup',
      tipo: 'condimento',
      precio: null,
      activo: true,
    });
    await Stock.create({
      sucursalId: sucursal.id,
      productoId: producto.id,
      cantidad: 10,
      disponible: true,
    });
    await InsumoStock.bulkCreate([
      {
        sucursalId: sucursal.id,
        insumoId: extra.id,
        cantidad: 5,
        disponible: true,
      },
      {
        sucursalId: sucursal.id,
        insumoId: condimento.id,
        cantidad: 3,
        disponible: true,
      },
    ]);
    linea = {
      productoId: producto.id,
      cantidad: 2,
      personalizacion: {
        extras: [{ insumoId: extra.id, cantidad: 2 }],
        condimentos: [{ insumoId: condimento.id, cantidad: 1 }],
      },
    };
  });

  test('faltantesDeInsumos cuenta filas ausentes, apagadas y dadas de baja como 0', async () => {
    expect(await faltantesDeInsumos([linea], sucursal.id)).toEqual([]);

    await InsumoStock.update(
      { cantidad: 1 },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    const faltantes = await faltantesDeInsumos([linea], sucursal.id);
    expect(faltantes).toEqual([
      {
        tipo: 'insumo',
        insumoId: extra.id,
        nombre: 'Bacon',
        hay: 1,
        necesario: 4,
      },
    ]);

    await InsumoStock.update(
      { cantidad: 5, disponible: false },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    expect((await faltantesDeInsumos([linea], sucursal.id))[0]).toMatchObject({
      hay: 0,
    });

    await InsumoStock.update(
      { disponible: true },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    await extra.update({ activo: false });
    expect((await faltantesDeInsumos([linea], sucursal.id))[0]).toMatchObject({
      nombre: 'Bacon',
      hay: 0,
    });
  });

  test('descuenta y repone productos e insumos juntos', async () => {
    const filas = await descontarStock([linea], sucursal.id);
    expect(filas).toEqual(
      expect.arrayContaining([
        { sucursalId: sucursal.id, productoId: producto.id },
        { sucursalId: sucursal.id, insumoId: extra.id },
        { sucursalId: sucursal.id, insumoId: condimento.id },
      ])
    );

    const stockProducto = await Stock.findOne({
      where: { sucursalId: sucursal.id, productoId: producto.id },
    });
    expect(stockProducto.cantidad).toBe(8);
    const stockExtra = await InsumoStock.findOne({
      where: { sucursalId: sucursal.id, insumoId: extra.id },
    });
    expect(stockExtra.cantidad).toBe(1);
    const stockCondimento = await InsumoStock.findOne({
      where: { sucursalId: sucursal.id, insumoId: condimento.id },
    });
    expect(stockCondimento.cantidad).toBe(1);

    await reponerStock([linea], sucursal.id);
    expect(
      (
        await Stock.findOne({
          where: { sucursalId: sucursal.id, productoId: producto.id },
        })
      ).cantidad
    ).toBe(10);
    expect(
      (
        await InsumoStock.findOne({
          where: { sucursalId: sucursal.id, insumoId: extra.id },
        })
      ).cantidad
    ).toBe(5);
    expect(
      (
        await InsumoStock.findOne({
          where: { sucursalId: sucursal.id, insumoId: condimento.id },
        })
      ).cantidad
    ).toBe(3);
  });

  test('no sobrevende el insumo y responde con su nombre', async () => {
    await InsumoStock.update(
      { cantidad: 2 },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );

    await expect(descontarStock([linea], sucursal.id)).rejects.toMatchObject({
      name: 'StockInsuficienteError',
      faltantes: [
        expect.objectContaining({
          tipo: 'insumo',
          nombre: 'Bacon',
          hay: 2,
          necesario: 4,
        }),
      ],
    });
    // El producto no se descontó: la operación entera falla antes de tocar filas
    // de insumos y el llamador maneja la transacción.
    expect(
      (
        await Stock.findOne({
          where: { sucursalId: sucursal.id, productoId: producto.id },
        })
      ).cantidad
    ).toBe(10);
  });

  test('reponer un insumo sin fila la crea para no perder la devolución', async () => {
    await InsumoStock.destroy({
      where: { sucursalId: sucursal.id, insumoId: condimento.id },
    });

    await reponerStock([linea], sucursal.id);
    const creada = await InsumoStock.findOne({
      where: { sucursalId: sucursal.id, insumoId: condimento.id },
    });
    expect(creada).toBeTruthy();
    expect(creada.cantidad).toBe(2);
    expect(creada.disponible).toBe(true);
  });

  test('faltantesDePedido suma los insumos a los productos', async () => {
    await InsumoStock.update(
      { cantidad: 1 },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );

    const faltantes = await faltantesDePedido([linea], sucursal.id);
    expect(faltantes).toHaveLength(1);
    expect(faltantes[0]).toMatchObject({
      tipo: 'insumo',
      nombre: 'Bacon',
      hay: 1,
      necesario: 4,
    });
  });

  test('una reserva de insumo vence si la fila se apaga o el insumo se da de baja', async () => {
    expect(await reservasDeStockVencidas([linea], sucursal.id)).toEqual([]);

    await InsumoStock.update(
      { disponible: false },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    expect(await reservasDeStockVencidas([linea], sucursal.id)).toEqual([
      { tipo: 'insumo', insumoId: extra.id, nombre: 'Bacon' },
    ]);

    await InsumoStock.update(
      { disponible: true },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    await condimento.update({ activo: false });
    expect(await reservasDeStockVencidas([linea], sucursal.id)).toEqual([
      { tipo: 'insumo', insumoId: condimento.id, nombre: 'Ketchup' },
    ]);
  });

  test('la reserva no compara cantidad: el pedido ya la consumió', async () => {
    await InsumoStock.update(
      { cantidad: 0 },
      { where: { sucursalId: sucursal.id, insumoId: extra.id } }
    );
    expect(await reservasDeStockVencidas([linea], sucursal.id)).toEqual([]);
  });
});

describe('mensajeDeFaltantes con insumos', () => {
  test('nombra el insumo sin stock', () => {
    expect(
      mensajeDeFaltantes([
        { tipo: 'insumo', nombre: 'Bacon', hay: 0, necesario: 2 },
      ])
    ).toBe(
      'Lo sentimos, no hay stock suficiente para completar tu pedido. No queda stock de Bacon.'
    );
  });

  test('distingue stock parcial y agrega el alcance de cobertura', () => {
    expect(
      mensajeDeFaltantes(
        [
          { tipo: 'insumo', nombre: 'Bacon', hay: 1, necesario: 2 },
          { tipo: 'insumo', nombre: 'Cheddar', hay: 0, necesario: 1 },
        ],
        { cobertura: true }
      )
    ).toBe(
      'Lo sentimos, no hay stock suficiente para completar tu pedido. No queda stock de Cheddar en las sucursales que llegan a tu dirección. De Bacon queda 1 unidad disponible en las sucursales que llegan a tu dirección.'
    );
  });

  test('separa productos de insumos en el mismo mensaje', () => {
    const mensaje = mensajeDeFaltantes([
      { nombre: 'Hamburguesa', hay: 0, necesario: 1 },
      { tipo: 'insumo', nombre: 'Bacon', hay: 1, necesario: 2 },
    ]);
    expect(mensaje).toBe(
      'Lo sentimos, no hay stock suficiente para completar tu pedido. No queda stock de Hamburguesa. De Bacon queda 1 unidad disponible.'
    );
  });
});

describe('StockInsuficienteError', () => {
  test('conserva los faltantes y el flag de cobertura', () => {
    const error = new StockInsuficienteError(
      [{ tipo: 'insumo', nombre: 'Bacon', hay: 0, necesario: 1 }],
      { cobertura: true }
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.cobertura).toBe(true);
    expect(error.faltantes[0].nombre).toBe('Bacon');
  });
});
