import db from '../models';
import {
  cantidadSeleccionada,
  PersonalizacionInvalidaError,
  validarPersonalizacionDeItems,
} from './validacion_personalizacion';

jest.mock('../models', () => ({
  __esModule: true,
  default: {
    PersonalizacionElemento: { findAll: jest.fn() },
  },
}));

const { PersonalizacionElemento } = db;

const elemento = (extra = {}) => ({
  id: 1,
  tipo: 'extra',
  nombre: 'Bacon',
  minimo: 0,
  maximo: 1,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('cantidadSeleccionada', () => {
  test('suma por id y por nombre (sin distinguir mayúsculas)', () => {
    expect(cantidadSeleccionada([{ id: 1, cantidad: 2 }], elemento())).toBe(2);
    expect(
      cantidadSeleccionada([{ nombre: 'bacon', cantidad: 3 }], elemento())
    ).toBe(3);
    expect(
      cantidadSeleccionada(
        [
          { id: 1, cantidad: 1 },
          { nombre: 'BACON', cantidad: 1 },
        ],
        elemento()
      )
    ).toBe(2);
  });

  test('ignora lo que no coincide y cantidades no positivas', () => {
    expect(
      cantidadSeleccionada(
        [
          { id: 2, cantidad: 5 },
          { id: 1, cantidad: 0 },
        ],
        elemento()
      )
    ).toBe(0);
  });
});

describe('validarPersonalizacionDeItems', () => {
  test('no valida nada si el producto no tiene elementos configurados', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 1, cantidad: 9 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });

  test('acepta cantidades dentro del rango [minimo, maximo]', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ minimo: 1, maximo: 3 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 1, cantidad: 3 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });

  test('rechaza superar el maximo por elemento', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ maximo: 1 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          nombreProducto: 'Hamburguesa',
          personalizacion: { extras: [{ id: 1, cantidad: 2 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);
  });

  test('rechaza no alcanzar el minimo requerido', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ minimo: 2, maximo: 5 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 1, cantidad: 1 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);
  });

  test('no valida cantidades en elementos de tipo personalizar', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ tipo: 'personalizar', minimo: 5, maximo: 5 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        { productoId: 10, personalizacion: { sin: ['Cebolla'] } },
      ])
    ).resolves.toBeUndefined();
  });
});
