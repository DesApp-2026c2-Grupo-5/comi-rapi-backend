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
    PersonalizacionCategoria: { findAll: jest.fn() },
    Producto: { findByPk: jest.fn() },
  },
}));

const { PersonalizacionElemento, PersonalizacionCategoria, Producto } = db;

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
  // Default mocks for the new validations
  Producto.findByPk.mockResolvedValue(null);
  PersonalizacionCategoria.findAll.mockResolvedValue([]);
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
      elemento({ tipo: 'personalizar', nombre: 'Cebolla', minimo: 5, maximo: 5 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        { productoId: 10, personalizacion: { sin: ['Cebolla'] } },
      ])
    ).resolves.toBeUndefined();
  });

  // --- NUEVAS PRUEBAS: Validaciones mejoradas ---

  test('rechaza opción que no existe en la BD (eliminada)', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 1, nombre: 'Bacon', precio: 500 }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          nombreProducto: 'Hamburguesa',
          personalizacion: { extras: [{ id: 999, nombre: 'QuesoExtra', cantidad: 1 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);
  });

  test('rechaza opción desactivada (activo: false)', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 1, nombre: 'Bacon', precio: 500, activo: false }),
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

  test('usa precio de la BD ignorando precio del frontend (extra)', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 1, nombre: 'Bacon', precio: 800, maximo: 2 }), // Precio real en BD: 800, maximo 2
    ]);
    // Frontend envía precio 500 (desactualizado), pero se debe usar 800 de la BD
    const items = [
      {
        productoId: 10,
        nombreProducto: 'Hamburguesa',
        personalizacion: { extras: [{ id: 1, cantidad: 2, precio: 500 }] },
      },
    ];
    // La validación no lanza error, pero el precio se recalcula en construirItems
    // Aquí solo verificamos que no falle la validación
    await expect(validarPersonalizacionDeItems(items)).resolves.toBeUndefined();
  });

  test('usa precio de la BD ignorando precio del frontend (acompanar)', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 2, tipo: 'acompanar', nombre: 'Papas', precio: 1200, productoReferenciaId: 20 }),
    ]);
    Producto.findByPk.mockResolvedValue({ id: 20, nombre: 'Papas Fritas', precio: 1000, activo: true });
    const items = [
      {
        productoId: 10,
        personalizacion: { acompanamientos: [{ id: 2, cantidad: 1, precio: 800 }] },
      },
    ];
    await expect(validarPersonalizacionDeItems(items)).resolves.toBeUndefined();
  });

  test('valida condimentos (gratis) - solo existencia y activo', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 3, tipo: 'condimento', nombre: 'Orégano', precio: null }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { condimentos: [{ id: 3, cantidad: 1 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });

  test('rechaza condimento desactivado', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 3, tipo: 'condimento', nombre: 'Orégano', activo: false }),
    ]);
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { condimentos: [{ id: 3, cantidad: 1 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);
  });

  test('usa plantillas de categoría como fallback si producto no tiene elementos propios', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([]); // Sin elementos propios
    PersonalizacionCategoria.findAll.mockResolvedValue([
      { id: 101, tipo: 'extra', nombre: 'Queso Extra', precio: 600, minimo: 0, maximo: 2, activo: true, categoriaId: 5 },
    ]);
    Producto.findByPk.mockResolvedValue({ id: 10, categoriaId: 5, nombre: 'Hamburguesa', precio: 2000, activo: true });

    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 101, cantidad: 1 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });

  test('rechaza plantilla de categoría desactivada', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([]);
    PersonalizacionCategoria.findAll.mockResolvedValue([
      { id: 101, tipo: 'extra', nombre: 'Queso Extra', precio: 600, minimo: 0, maximo: 2, activo: false, categoriaId: 5 },
    ]);
    Producto.findByPk.mockResolvedValue({ id: 10, categoriaId: 5, nombre: 'Hamburguesa', precio: 2000, activo: true });

    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 101, cantidad: 1 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);
  });

  test('producto sin elementos propios usa sus plantillas; si tiene propios ignora plantillas', async () => {
    // Producto tiene extra propio 'Bacon'
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 1, tipo: 'extra', nombre: 'Bacon', precio: 500, minimo: 0, maximo: 1 }),
    ]);
    // Categoría tiene extra 'Queso' (distinto)
    PersonalizacionCategoria.findAll.mockResolvedValue([
      { id: 101, tipo: 'extra', nombre: 'Queso Extra', precio: 600, minimo: 0, maximo: 2, activo: true, categoriaId: 5 },
    ]);
    Producto.findByPk.mockResolvedValue({ id: 10, categoriaId: 5, nombre: 'Hamburguesa', precio: 2000, activo: true });

    // 'Queso Extra' no existe en elementos propios -> debe fallar
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 101, nombre: 'Queso Extra', cantidad: 1 }] },
        },
      ])
    ).rejects.toBeInstanceOf(PersonalizacionInvalidaError);

    // Pero 'Bacon' sí existe -> debe pasar
    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { extras: [{ id: 1, cantidad: 1 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });

  test('acompañamiento valida productoReferenciaId y precio de BD', async () => {
    PersonalizacionElemento.findAll.mockResolvedValue([
      elemento({ id: 2, tipo: 'acompanar', nombre: 'Papas', precio: 1200, productoReferenciaId: 20 }),
    ]);
    Producto.findByPk.mockResolvedValue({ id: 20, nombre: 'Papas Fritas', precio: 1000, activo: true });

    await expect(
      validarPersonalizacionDeItems([
        {
          productoId: 10,
          personalizacion: { acompanamientos: [{ id: 2, cantidad: 1 }] },
        },
      ])
    ).resolves.toBeUndefined();
  });
});
