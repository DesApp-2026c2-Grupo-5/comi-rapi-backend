import { DataTypes } from 'sequelize';
import { cleanDb } from '../../test/db_utils';
import Usuario from './usuario';

describe('Usuario', () => {
  beforeAll(async () => {
    await cleanDb();
  });

  test('creación válida con atributos actuales', async () => {
    const usuario = await Usuario.create({
      nombre: 'Fede',
      apellido: 'Aloi',
      email: 'fede@test.com',
      password: '123456',
      telefono: '1111111111',
      rol: 'CLIENTE',
      activo: true,
    });
    expect(usuario).toMatchObject({
      nombre: 'Fede',
      apellido: 'Aloi',
      email: 'fede@test.com',
      rol: 'CLIENTE',
      activo: true,
    });
  });

  test('rol default es CLIENTE al omitir', async () => {
    const usuario = await Usuario.create({
      nombre: 'Sin Rol',
      apellido: 'Prueba',
      email: 'sinrol@test.com',
      password: '123456',
      activo: true,
    });
    expect(usuario.rol).toEqual('CLIENTE');
  });

  test('rol ADMINISTRADOR se persiste', async () => {
    const usuario = await Usuario.create({
      nombre: 'Admin',
      apellido: 'ComiRapi',
      email: 'admin@test.com',
      password: '123456',
      rol: 'ADMINISTRADOR',
      activo: true,
    });
    expect(usuario.rol).toEqual('ADMINISTRADOR');
  });

  test('email UNIQUE: segundo usuario con mismo email falla', async () => {
    await Usuario.create({
      nombre: 'Original',
      apellido: 'Prueba',
      email: 'duplicado@test.com',
      password: '123456',
      rol: 'CLIENTE',
      activo: true,
    });
    await expect(
      Usuario.create({
        nombre: 'Duplicado',
        apellido: 'Prueba',
        email: 'duplicado@test.com',
        password: '123456',
        rol: 'CLIENTE',
        activo: true,
      })
    ).rejects.toThrow();
  });

  test('fechaNacimiento existe y se persiste', async () => {
    const usuario = await Usuario.create({
      nombre: 'Con Fecha',
      apellido: 'Prueba',
      email: 'confecha@test.com',
      password: '123456',
      fechaNacimiento: '1990-06-15',
      rol: 'CLIENTE',
      activo: true,
    });
    expect(usuario.fechaNacimiento).toEqual('1990-06-15');
  });

  test('edad es un atributo virtual (no persistido)', () => {
    const atributo = Usuario.rawAttributes.edad;
    expect(atributo).toBeDefined();
    expect(atributo.type instanceof DataTypes.VIRTUAL).toBe(true);
  });

  test('edad se calcula de forma coherente con fechaNacimiento', async () => {
    const usuario = await Usuario.create({
      nombre: 'Con Edad',
      apellido: 'Prueba',
      email: 'conedad@test.com',
      password: '123456',
      fechaNacimiento: '2000-01-01',
      rol: 'CLIENTE',
      activo: true,
    });
    const esperado = Math.floor(
      (new Date() - new Date('2000-01-01')) / (1000 * 60 * 60 * 24 * 365.25)
    );
    expect(usuario.edad).toEqual(esperado);
  });
});
