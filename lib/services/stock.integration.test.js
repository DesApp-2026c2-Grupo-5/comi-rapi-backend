import { cleanDb } from '../../test/db_utils';
import db from '../models';
import {
  combosOfrecidos,
  descontarStock,
  maximoDeCombosPorSucursal,
  reponerStock,
} from './stock';

const { Categoria, ComboComponente, Producto, Stock, Sucursal } = db;

describe('stock (descuento y reposición contra la base)', () => {
  let sucursal;
  let combo;
  let componenteA;
  let componenteB;
  let simple;

  beforeAll(async () => {
    await cleanDb();
    const categoria = await Categoria.create({
      nombre: 'Combos',
      descripcion: 'Test',
    });
    sucursal = await Sucursal.create({ nombre: 'Sucursal Test' });
    simple = await Producto.create({
      nombre: 'Empanada',
      precio: 1000,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    componenteA = await Producto.create({
      nombre: 'Papas',
      precio: 800,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    componenteB = await Producto.create({
      nombre: 'Bebida',
      precio: 900,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
    combo = await Producto.create({
      nombre: 'Combo Doble',
      precio: 2500,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'COMBO',
    });
    await ComboComponente.bulkCreate([
      { comboId: combo.id, productoId: componenteA.id, cantidad: 2 },
      { comboId: combo.id, productoId: componenteB.id, cantidad: 1 },
    ]);
  });

  const cargar = (productoId, cantidad) =>
    Stock.create({
      sucursalId: sucursal.id,
      productoId,
      cantidad,
      disponible: true,
    });

  const cantidadDe = async (productoId) => {
    const stock = await Stock.findOne({
      where: { sucursalId: sucursal.id, productoId },
    });
    return stock ? stock.cantidad : null;
  };

  afterEach(async () => {
    await Stock.destroy({ where: {} });
  });

  test('descontar un combo descuenta el combo y los componentes', async () => {
    await cargar(combo.id, 10);
    await cargar(componenteA.id, 20);
    await cargar(componenteB.id, 30);

    await descontarStock([{ productoId: combo.id, cantidad: 2 }], sucursal.id);

    // El combo descuenta su propia unidad, y la receta multiplicada (2 papas).
    expect(await cantidadDe(combo.id)).toBe(8);
    expect(await cantidadDe(componenteA.id)).toBe(16);
    expect(await cantidadDe(componenteB.id)).toBe(28);
  });

  test('descontar respeta el stock real de los componentes', async () => {
    // El combo dice 10, pero con 6 papas (3 por combo) solo salen 3.
    await cargar(combo.id, 10);
    await cargar(componenteA.id, 6);
    await cargar(componenteB.id, 30);

    expect(await combosOfrecidos(combo.id, sucursal.id)).toBe(3);
    await descontarStock([{ productoId: combo.id, cantidad: 3 }], sucursal.id);
    expect(await cantidadDe(componenteA.id)).toBe(0);
  });

  test('rechaza el pedido cuando no alcanza el stock', async () => {
    await cargar(simple.id, 2);

    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 5 }], sucursal.id)
    ).rejects.toThrow(/Stock insuficiente/);
    // La transacción del caller hace rollback; acá solo se verifica el rechazo.
  });

  test('un producto sin fila de stock no se puede pedir', async () => {
    await expect(
      descontarStock([{ productoId: componenteB.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow(/Stock insuficiente/);
  });

  test('stock cargado en 0 o no disponible se trata como faltante', async () => {
    await cargar(simple.id, 0);
    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow(/Stock insuficiente/);

    await Stock.update({ cantidad: 5, disponible: false }, { where: {} });
    await expect(
      descontarStock([{ productoId: simple.id, cantidad: 1 }], sucursal.id)
    ).rejects.toThrow(/Stock insuficiente/);
  });

  test('una lista vacía de líneas controlables no toca el stock', async () => {
    // Las líneas ad-hoc (sin `productoId`) las filtra el controller con
    // `lineasControlables`; acá el service solo recibe lo que hay que controlar.
    await expect(descontarStock([], sucursal.id)).resolves.toBeUndefined();
    await expect(reponerStock([], sucursal.id)).resolves.toBeUndefined();
  });

  test('una línea sin productoId se rechaza (el filtrado es del controller)', async () => {
    await expect(
      descontarStock(
        [{ nombre: 'Extra', precioUnitario: 500, cantidad: 2 }],
        sucursal.id
      )
    ).rejects.toThrow(/producto undefined no existe/);
  });

  test('reponer suma sobre una fila existente', async () => {
    await cargar(simple.id, 3);

    await reponerStock([{ productoId: simple.id, cantidad: 2 }], sucursal.id);

    expect(await cantidadDe(simple.id)).toBe(5);
  });

  test('reponer suma aunque la fila valga justo lo que se repone', async () => {
    // Regresión: comparar contra el total hacía que la reposición se salte y
    // el stock quedara en 2 en vez de subir a 4.
    await cargar(simple.id, 2);

    await reponerStock([{ productoId: simple.id, cantidad: 2 }], sucursal.id);

    expect(await cantidadDe(simple.id)).toBe(4);
  });

  test('descontar y reponer dejan el stock donde estaba', async () => {
    await cargar(combo.id, 5);
    await cargar(componenteA.id, 10);
    await cargar(componenteB.id, 10);
    const items = [{ productoId: combo.id, cantidad: 2 }];

    await descontarStock(items, sucursal.id);
    await reponerStock(items, sucursal.id);

    expect(await cantidadDe(combo.id)).toBe(5);
    expect(await cantidadDe(componenteA.id)).toBe(10);
    expect(await cantidadDe(componenteB.id)).toBe(10);
  });

  test('reponer crea la fila si el producto ya no está en el catálogo de la sucursal', async () => {
    // Cancelar un pedido viejo tiene que poder completarse aunque después se
    // haya sacado el producto de la sucursal.
    await reponerStock(
      [{ productoId: componenteB.id, cantidad: 4 }],
      sucursal.id
    );

    expect(await cantidadDe(componenteB.id)).toBe(4);
  });

  test('el máximo de combos sale de la receta, no del stock del combo', async () => {
    await cargar(combo.id, 100);
    await cargar(componenteA.id, 8);
    await cargar(componenteB.id, 100);

    // 8 papas, 2 por combo.
    expect(await maximoDeCombosPorSucursal(combo.id, sucursal.id)).toBe(4);
  });

  test('un combo sin receta no se puede armar', async () => {
    const comboSinReceta = await Producto.create({
      nombre: 'Combo vacío',
      precio: 1000,
      categoriaId: (await Categoria.findOne()).id,
      activo: true,
      tipo: 'COMBO',
    });
    await cargar(comboSinReceta.id, 10);

    expect(
      await maximoDeCombosPorSucursal(comboSinReceta.id, sucursal.id)
    ).toBe(0);
  });
});
