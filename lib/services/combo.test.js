import {
  MIN_COMPONENTES,
  normalizarComponentes,
  validarComponentes,
} from './combo';
import db from '../models';

jest.mock('../models', () => ({
  __esModule: true,
  default: {
    Producto: { findAll: jest.fn(), findByPk: jest.fn() },
    ComboComponente: {
      findAll: jest.fn(),
      destroy: jest.fn(),
      bulkCreate: jest.fn(),
    },
  },
}));

const { Producto } = db;

const producto = (id, tipo = 'PRODUCTO', activo = true) => ({
  id,
  tipo,
  activo,
  nombre: `Producto ${id}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  Producto.findAll.mockImplementation(({ where }) =>
    Promise.resolve(where.id.map((id) => producto(id)))
  );
});

describe('combo (forma de la receta)', () => {
  test('exige una lista no vacía', () => {
    expect(() => normalizarComponentes([])).toThrow('productos seleccionados');
    expect(() => normalizarComponentes(undefined)).toThrow(
      'productos seleccionados'
    );
  });

  test('exige al menos dos componentes', () => {
    expect(() => normalizarComponentes([{ productoId: 1 }])).toThrow(
      `${MIN_COMPONENTES} o más`
    );
  });

  test('normaliza la cantidad a 1 cuando no viene', () => {
    expect(
      normalizarComponentes([{ productoId: 1 }, { productoId: 2 }])
    ).toEqual([
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 1 },
    ]);
  });

  test('rechaza cantidad 0 o negativa', () => {
    expect(() =>
      normalizarComponentes([
        { productoId: 1, cantidad: 1 },
        { productoId: 2, cantidad: 0 },
      ])
    ).toThrow('1 o más');
  });

  test('rechaza el mismo producto repetido', () => {
    expect(() =>
      normalizarComponentes([
        { productoId: 1, cantidad: 1 },
        { productoId: 1, cantidad: 2 },
      ])
    ).toThrow('no se puede repetir');
  });

  test('un combo no puede ser componente de sí mismo', () => {
    expect(() =>
      normalizarComponentes(
        [
          { productoId: 1, cantidad: 1 },
          { productoId: 5, cantidad: 1 },
        ],
        5
      )
    ).toThrow('sí mismo');
  });
});

describe('combo (validación contra el catálogo)', () => {
  test('acepta una receta de productos activos', async () => {
    const resultado = await validarComponentes([
      { productoId: 1, cantidad: 2 },
      { productoId: 2, cantidad: 1 },
    ]);
    expect(resultado).toEqual([
      { productoId: 1, cantidad: 2 },
      { productoId: 2, cantidad: 1 },
    ]);
  });

  test('rechaza un producto inexistente', async () => {
    Producto.findAll.mockImplementation(() => Promise.resolve([producto(1)]));
    await expect(
      validarComponentes([
        { productoId: 1, cantidad: 1 },
        { productoId: 99, cantidad: 1 },
      ])
    ).rejects.toThrow('99 no existe');
  });

  test('rechaza combos anidados', async () => {
    Producto.findAll.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id.map((id) => producto(id, id === 2 ? 'COMBO' : 'PRODUCTO'))
      )
    );
    await expect(
      validarComponentes([
        { productoId: 1, cantidad: 1 },
        { productoId: 2, cantidad: 1 },
      ])
    ).rejects.toThrow('dentro de otro combo');
  });

  test('rechaza un componente dado de baja', async () => {
    Producto.findAll.mockImplementation(({ where }) =>
      Promise.resolve(where.id.map((id) => producto(id, 'PRODUCTO', id !== 2)))
    );
    await expect(
      validarComponentes([
        { productoId: 1, cantidad: 1 },
        { productoId: 2, cantidad: 1 },
      ])
    ).rejects.toThrow('dado de baja');
  });
});
