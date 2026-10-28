/**
 * Pruebas del catálogo de insumos y de su stock por sucursal.
 *
 * Cubren las reglas que sostienen los extras y condimentos: alta con filas en 0,
 * validaciones, baja lógica, edición de cantidades y cálculo de "agotado".
 */
import { cleanDb } from '../../test/db_utils';
import db from '../models';
import {
  InsumoInvalidoError,
  actualizarInsumo,
  actualizarStockDeInsumo,
  crearInsumo,
  darDeBajaInsumo,
  listarStockDeSucursal,
  normalizarDatosInsumo,
} from './insumos';
import {
  marcarDisponibilidad,
  totalesDisponiblesPorInsumo,
} from './disponibilidad_insumos';

const {
  Categoria,
  Insumo,
  InsumoStock,
  PersonalizacionElemento,
  Producto,
  Sucursal,
} = db;

describe('normalizarDatosInsumo', () => {
  test('un extra exige precio numérico y mayor o igual a 0', () => {
    expect(
      normalizarDatosInsumo({ nombre: ' Bacon ', tipo: 'EXTRA', precio: '500' })
    ).toEqual({
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });
    expect(() =>
      normalizarDatosInsumo({ nombre: 'Bacon', tipo: 'extra' })
    ).toThrow(InsumoInvalidoError);
    expect(() =>
      normalizarDatosInsumo({ nombre: 'Bacon', tipo: 'extra', precio: -1 })
    ).toThrow(InsumoInvalidoError);
  });

  test('un condimento es gratis: ignora el precio recibido', () => {
    expect(
      normalizarDatosInsumo({
        nombre: 'Ketchup',
        tipo: 'condimento',
        precio: 999,
      })
    ).toEqual({ nombre: 'Ketchup', tipo: 'condimento', precio: null });
  });

  test('rechaza nombre vacío y tipo desconocido', () => {
    expect(() =>
      normalizarDatosInsumo({ nombre: '   ', tipo: 'extra', precio: 10 })
    ).toThrow('El nombre es obligatorio');
    expect(() =>
      normalizarDatosInsumo({ nombre: 'X', tipo: 'bebida', precio: 10 })
    ).toThrow('El tipo debe ser extra o condimento');
  });
});

describe('insumos (catálogo y stock contra la base)', () => {
  let sucursalA;
  let sucursalB;
  let sucursalInactiva;
  let categoria;
  let producto;

  beforeAll(async () => {
    await cleanDb();
    [sucursalA, sucursalB, sucursalInactiva] = await Sucursal.bulkCreate([
      { nombre: 'Sucursal A', activa: true },
      { nombre: 'Sucursal B', activa: true },
      { nombre: 'Sucursal Cerrada', activa: false },
    ]);
    categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Test',
    });
    producto = await Producto.create({
      nombre: 'Hamburguesa',
      precio: 1000,
      categoriaId: categoria.id,
      activo: true,
      tipo: 'PRODUCTO',
    });
  });

  afterEach(async () => {
    await PersonalizacionElemento.destroy({ where: {} });
    await InsumoStock.destroy({ where: {} });
    await Insumo.destroy({ where: {} });
  });

  test('el alta crea filas en 0 sólo en sucursales activas', async () => {
    const insumo = await crearInsumo({
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });

    const filas = await InsumoStock.findAll({
      where: { insumoId: insumo.id },
      order: [['sucursalId', 'ASC']],
    });
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.sucursalId).sort()).toEqual(
      [sucursalA.id, sucursalB.id].sort()
    );
    expect(filas.every((f) => f.cantidad === 0 && f.disponible)).toBe(true);
    expect(
      filas.some((f) => Number(f.sucursalId) === Number(sucursalInactiva.id))
    ).toBe(false);
  });

  test('no permite duplicados por nombre y tipo, sin distinguir mayúsculas', async () => {
    await crearInsumo({ nombre: 'Bacon', tipo: 'extra', precio: 500 });
    await expect(
      crearInsumo({ nombre: 'bacon', tipo: 'extra', precio: 700 })
    ).rejects.toThrow('Ya existe un insumo con ese nombre y tipo');
    // Mismo nombre con otro tipo sí se permite.
    await expect(
      crearInsumo({ nombre: 'Bacon', tipo: 'condimento' })
    ).resolves.toBeTruthy();
  });

  test('la baja es lógica y conserva las filas de stock', async () => {
    const insumo = await crearInsumo({ nombre: 'Ketchup', tipo: 'condimento' });
    await darDeBajaInsumo(insumo);

    expect(insumo.activo).toBe(false);
    expect(await InsumoStock.count({ where: { insumoId: insumo.id } })).toBe(2);
  });

  test('no deja cambiar el tipo de un insumo ya vinculado', async () => {
    const insumo = await crearInsumo({
      nombre: 'Cheddar',
      tipo: 'extra',
      precio: 300,
    });
    await PersonalizacionElemento.create({
      productoId: producto.id,
      tipo: 'extra',
      nombre: 'Cheddar',
      precio: 300,
      insumoId: insumo.id,
      minimo: 0,
      maximo: 1,
      activo: true,
    });

    await expect(
      actualizarInsumo(insumo, { tipo: 'condimento' })
    ).rejects.toThrow(
      'No se puede cambiar el tipo de un insumo que ya está en uso'
    );
  });

  test('lista y filtra el stock de la sucursal por tipo de insumo', async () => {
    const extra = await crearInsumo({
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });
    await crearInsumo({ nombre: 'Ketchup', tipo: 'condimento' });
    await actualizarStockDeInsumo(sucursalA.id, extra.id, { cantidad: 7 });

    const todos = await listarStockDeSucursal(sucursalA.id);
    expect(todos).toHaveLength(2);
    expect(todos.map((f) => f.insumo).sort()).toEqual(['Bacon', 'Ketchup']);

    const soloExtras = await listarStockDeSucursal(sucursalA.id, {
      tipo: 'extra',
    });
    expect(soloExtras).toHaveLength(1);
    expect(soloExtras[0]).toMatchObject({
      insumoId: extra.id,
      insumo: 'Bacon',
      tipo: 'extra',
      cantidad: 7,
    });
  });

  test('crea la fila que falta y valida cantidad/disponibilidad', async () => {
    const insumo = await crearInsumo({
      nombre: 'Mayonesa',
      tipo: 'condimento',
    });
    // Sucursal nueva: no tiene fila.
    const sucursalNueva = await Sucursal.create({
      nombre: 'Sucursal Nueva',
      activa: true,
    });

    const creada = await actualizarStockDeInsumo(sucursalNueva.id, insumo.id, {
      cantidad: 4,
    });
    expect(creada).toMatchObject({
      sucursalId: sucursalNueva.id,
      insumoId: insumo.id,
      cantidad: 4,
      disponible: true,
    });

    const apagada = await actualizarStockDeInsumo(sucursalNueva.id, insumo.id, {
      disponible: false,
    });
    expect(apagada.disponible).toBe(false);

    await expect(
      actualizarStockDeInsumo(sucursalNueva.id, insumo.id, { cantidad: -1 })
    ).rejects.toThrow('La cantidad debe ser un entero mayor o igual a 0');
    await expect(
      actualizarStockDeInsumo(sucursalNueva.id, insumo.id, {})
    ).rejects.toThrow('No hay cambios para aplicar');
  });

  test('un insumo dado de baja no se puede actualizar', async () => {
    const insumo = await crearInsumo({ nombre: 'Mostaza', tipo: 'condimento' });
    await darDeBajaInsumo(insumo);

    await expect(
      actualizarStockDeInsumo(sucursalA.id, insumo.id, { cantidad: 1 })
    ).rejects.toThrow('Insumo no encontrado');
  });
});

describe('disponibilidad de insumos', () => {
  let sucursalActiva;
  let sucursalInactiva;
  let extra;
  let sinStock;
  let inactivo;

  beforeAll(async () => {
    await cleanDb();
    sucursalActiva = await Sucursal.create({ nombre: 'Activa', activa: true });
    sucursalInactiva = await Sucursal.create({
      nombre: 'Inactiva',
      activa: false,
    });
    extra = await Insumo.create({
      nombre: 'Bacon',
      tipo: 'extra',
      precio: 500,
    });
    sinStock = await Insumo.create({
      nombre: 'Cheddar',
      tipo: 'extra',
      precio: 300,
    });
    inactivo = await Insumo.create({
      nombre: 'Ketchup',
      tipo: 'condimento',
      activo: false,
    });
    await InsumoStock.bulkCreate([
      {
        sucursalId: sucursalActiva.id,
        insumoId: extra.id,
        cantidad: 3,
        disponible: true,
      },
      {
        sucursalId: sucursalInactiva.id,
        insumoId: extra.id,
        cantidad: 10,
        disponible: true,
      },
      {
        sucursalId: sucursalActiva.id,
        insumoId: sinStock.id,
        cantidad: 0,
        disponible: true,
      },
      {
        sucursalId: sucursalActiva.id,
        insumoId: inactivo.id,
        cantidad: 5,
        disponible: true,
      },
    ]);
  });

  test('suma sólo sucursales activas y filas disponibles', async () => {
    const totales = await totalesDisponiblesPorInsumo([extra.id, sinStock.id]);
    expect(totales.get(extra.id)).toEqual({ total: 3, activo: true });
    expect(totales.get(sinStock.id)).toEqual({ total: 0, activo: true });
  });

  test('marca agotado cuando no hay stock en ninguna sucursal activa', async () => {
    const elementos = await marcarDisponibilidad([
      { id: 1, tipo: 'extra', nombre: 'Bacon', insumoId: extra.id },
      { id: 2, tipo: 'extra', nombre: 'Cheddar', insumoId: sinStock.id },
      { id: 3, tipo: 'condimento', nombre: 'Ketchup', insumoId: inactivo.id },
      { id: 4, tipo: 'personalizar', nombre: 'Sin cebolla' },
    ]);

    expect(elementos[0]).toMatchObject({ stockTotal: 3, agotado: false });
    expect(elementos[1]).toMatchObject({ stockTotal: 0, agotado: true });
    expect(elementos[2]).toMatchObject({ stockTotal: 5, agotado: true });
    expect(elementos[3]).toMatchObject({ stockTotal: null, agotado: false });
  });
});
