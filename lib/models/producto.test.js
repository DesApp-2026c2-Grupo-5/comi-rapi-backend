import { cleanDb } from '../../test/db_utils';
import db from './index';

const { Producto, Categoria } = db;

describe('Producto', () => {
  let categoria;

  beforeAll(async () => {
    await cleanDb();
    categoria = await Categoria.create({
      nombre: 'Hamburguesas',
      descripcion: 'Prueba',
    });
  });

  const datosBase = () => ({
    nombre: 'Hamburguesa Clásica',
    precio: 1500,
    categoriaId: categoria.id,
    activo: true,
  });

  test('tipo PRODUCTO crea correctamente', async () => {
    const producto = await Producto.create({
      ...datosBase(),
      tipo: 'PRODUCTO',
    });
    expect(producto.tipo).toEqual('PRODUCTO');
  });

  test('tipo COMBO crea correctamente', async () => {
    const producto = await Producto.create({
      ...datosBase(),
      tipo: 'COMBO',
    });
    expect(producto.tipo).toEqual('COMBO');
  });

  test('omitir tipo falla por NOT NULL / ausencia de default', async () => {
    await expect(Producto.create(datosBase())).rejects.toThrow();
  });

  test('tipo inválido es rechazado por el ENUM', async () => {
    await expect(
      Producto.create({ ...datosBase(), tipo: 'INVALIDO' })
    ).rejects.toThrow();
  });
});
