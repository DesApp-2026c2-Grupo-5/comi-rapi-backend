import { cleanDb } from '../../test/db_utils';
import db from './index';

const {
  Categoria,
  Ingrediente,
  IngredienteStock,
  Producto,
  ProductoIngrediente,
  Sucursal,
} = db;

describe('Ingrediente, IngredienteStock y ProductoIngrediente', () => {
  let categoria;
  let sucursal;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Prueba',
    });
    sucursal = await Sucursal.create({ nombre: 'Centro' });
    producto = await Producto.create({
      nombre: 'Hamburguesa Clásica',
      precio: 1500,
      categoriaId: categoria.id,
      tipo: 'PRODUCTO',
    });
  });

  test('crea un ingrediente con unidad de medida', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Tomate',
      unidadMedida: 'g',
    });
    expect(ingrediente.unidadMedida).toEqual('g');
    expect(ingrediente.activo).toBe(true);
  });

  test('el nombre es único sin distinguir mayúsculas', async () => {
    await Ingrediente.create({ nombre: 'Lechuga', unidadMedida: 'g' });
    await expect(
      Ingrediente.create({ nombre: 'lechuga', unidadMedida: 'g' })
    ).rejects.toThrow();
  });

  test('rechaza una unidad de medida inválida', async () => {
    await expect(
      Ingrediente.create({ nombre: 'Azúcar', unidadMedida: 'taza' })
    ).rejects.toThrow();
  });

  test('guarda stock decimal por sucursal', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Carne',
      unidadMedida: 'g',
    });
    const stock = await IngredienteStock.create({
      sucursalId: sucursal.id,
      ingredienteId: ingrediente.id,
      cantidad: 1250.5,
    });
    expect(Number(stock.cantidad)).toBe(1250.5);
  });

  test('no permite stock negativo', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Queso',
      unidadMedida: 'g',
    });
    await expect(
      IngredienteStock.create({
        sucursalId: sucursal.id,
        ingredienteId: ingrediente.id,
        cantidad: -1,
      })
    ).rejects.toThrow();
  });

  test('la PK compuesta evita repetir sucursal e ingrediente', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Pan',
      unidadMedida: 'unidad',
    });
    await IngredienteStock.create({
      sucursalId: sucursal.id,
      ingredienteId: ingrediente.id,
      cantidad: 10,
    });
    await expect(
      IngredienteStock.create({
        sucursalId: sucursal.id,
        ingredienteId: ingrediente.id,
        cantidad: 5,
      })
    ).rejects.toThrow();
  });

  test('crea la receta con cantidad y permiteQuitar', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Cheddar',
      unidadMedida: 'g',
    });
    const receta = await ProductoIngrediente.create({
      productoId: producto.id,
      ingredienteId: ingrediente.id,
      cantidad: 20,
      permiteQuitar: false,
    });
    expect(Number(receta.cantidad)).toBe(20);
    expect(receta.permiteQuitar).toBe(false);
  });

  test('la receta exige cantidad mayor a cero', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Bacon',
      unidadMedida: 'g',
    });
    await expect(
      ProductoIngrediente.create({
        productoId: producto.id,
        ingredienteId: ingrediente.id,
        cantidad: 0,
      })
    ).rejects.toThrow();
  });

  test('no repite un ingrediente en la misma receta', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Pepinillo',
      unidadMedida: 'g',
    });
    await ProductoIngrediente.create({
      productoId: producto.id,
      ingredienteId: ingrediente.id,
      cantidad: 10,
    });
    await expect(
      ProductoIngrediente.create({
        productoId: producto.id,
        ingredienteId: ingrediente.id,
        cantidad: 5,
      })
    ).rejects.toThrow();
  });

  test('expone las asociaciones de la receta y el stock', async () => {
    const ingrediente = await Ingrediente.create({
      nombre: 'Cebolla',
      unidadMedida: 'g',
    });
    await ProductoIngrediente.create({
      productoId: producto.id,
      ingredienteId: ingrediente.id,
      cantidad: 15,
    });
    await IngredienteStock.create({
      sucursalId: sucursal.id,
      ingredienteId: ingrediente.id,
      cantidad: 300,
    });

    const receta = await ProductoIngrediente.findOne({
      where: { productoId: producto.id, ingredienteId: ingrediente.id },
      include: ['ingrediente'],
    });
    expect(receta.ingrediente.nombre).toBe('Cebolla');

    const stock = await IngredienteStock.findOne({
      where: { sucursalId: sucursal.id, ingredienteId: ingrediente.id },
      include: ['sucursal'],
    });
    expect(stock.sucursal.nombre).toBe('Centro');
  });
});
