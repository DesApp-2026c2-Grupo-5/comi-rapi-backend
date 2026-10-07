import { DataTypes } from 'sequelize';
import { cleanDb } from '../../test/db_utils';
import Usuario from './usuario';
import db from './index';

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

  test('rol SUPERADMINISTRADOR se persiste', async () => {
    const usuario = await Usuario.create({
      nombre: 'Super',
      apellido: 'Admin',
      email: 'superadmin@test.com',
      password: '123456',
      rol: 'SUPERADMINISTRADOR',
      activo: true,
    });
    expect(usuario.rol).toEqual('SUPERADMINISTRADOR');
  });

  test('sucursalId se persiste para ADMINISTRADOR', async () => {
    const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Centro' });
    const usuario = await Usuario.create({
      nombre: 'Admin Sucursal',
      apellido: 'Prueba',
      email: 'adminsucursal@test.com',
      password: '123456',
      rol: 'ADMINISTRADOR',
      sucursalId: sucursal.id,
      activo: true,
    });
    expect(usuario.sucursalId).toEqual(sucursal.id);
  });

  test('chk_usuarios_sucursal_solo_admin: un CLIENTE no puede tener sucursalId', async () => {
    const sucursal = await db.Sucursal.create({ nombre: 'Sucursal Oeste' });
    await expect(
      Usuario.create({
        nombre: 'Cliente Sucursal',
        apellido: 'Prueba',
        email: 'clientesucursal@test.com',
        password: '123456',
        rol: 'CLIENTE',
        sucursalId: sucursal.id,
        activo: true,
      })
    ).rejects.toThrow();
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
