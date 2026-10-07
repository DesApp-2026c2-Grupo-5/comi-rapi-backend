/**
 * Regresión del script de alta del primer SUPERADMINISTRADOR.
 *
 * El script escribe contra la base de test (respeta `NODE_ENV` a través de
 * `lib/config/config.js`, igual que la limpieza). Lo que se prueba acá es que
 * sea idempotente, que no pise usuarios de otro rol y que el hash quede
 * compatible con los hooks del modelo (o sea, que ese usuario pueda loguearse).
 */

import { cleanDb } from '../test/db_utils';
import db from '../lib/models';
import { sequelize, crearSuperadmin } from './crear-superadmin';

async function superadmins(email) {
  return db.Usuario.count({
    where: { email, rol: 'SUPERADMINISTRADOR' },
  });
}

beforeAll(async () => {
  await cleanDb();
});

afterAll(async () => {
  await sequelize.close();
});

it('crea el superadmin y es idempotente', async () => {
  const primero = await crearSuperadmin({
    email: 'jefe@test.com',
    password: 'clave-secreta',
    nombre: 'Jefa',
  });

  expect(primero.creado).toBe(true);
  expect(await superadmins('jefe@test.com')).toBe(1);

  const segundo = await crearSuperadmin({
    email: 'JEFE@test.com',
    password: 'otra-clave',
  });

  expect(segundo.creado).toBe(false);
  expect(await superadmins('jefe@test.com')).toBe(1);
});

it('el superadmin creado puede loguearse (hash compatible)', async () => {
  const usuario = await db.Usuario.findOne({
    where: { email: 'jefe@test.com' },
  });
  expect(usuario).not.toBeNull();
  expect(await usuario.verificarPassword('clave-secreta')).toBe(true);
});

it('no reemplaza un usuario con otro rol', async () => {
  await db.Usuario.create({
    nombre: 'Admin',
    email: 'superexistente@test.com',
    password: '123456',
    rol: 'ADMINISTRADOR',
  });

  const resultado = await crearSuperadmin({
    email: 'superexistente@test.com',
    password: 'clave-nueva',
  });

  expect(resultado.creado).toBe(false);
  expect(resultado.motivo).toMatch(/rol ADMINISTRADOR/);
  const admin = await db.Usuario.findOne({
    where: { email: 'superexistente@test.com' },
  });
  expect(admin.rol).toBe('ADMINISTRADOR');
  expect(await admin.verificarPassword('123456')).toBe(true);
});

it('valida email y contraseña', async () => {
  await expect(
    crearSuperadmin({ email: 'no-es-email', password: '123456' })
  ).rejects.toThrow(/email/);
  await expect(
    crearSuperadmin({ email: 'otro@test.com', password: '123' })
  ).rejects.toThrow(/contraseña/);
});
