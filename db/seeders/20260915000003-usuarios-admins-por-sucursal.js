'use strict';

const argon2 = require('argon2');

// Un ADMINISTRADOR por sucursal (A1-Seed), con email descriptivo de la calle
// donde está cada local. Reemplaza al genérico `admin@test.com` (eliminado de
// `usuarios-proceres.js`): tras el reset, cada sucursal tiene su admin y el
// flujo del panel queda "conectado" sin setup manual.
//
// Corre DESPUÉS de `20260915000001-estados-pedido-sucursales.js` (necesita las
// sucursales para asignar `sucursalId`). El CHECK de la migración
// `20261002000001-superadministrador-y-sucursal-admin` exige que solo un
// ADMINISTRADOR pueda tener sucursal asignada.
//
// Idempotente: si ya existe un usuario con ese email no lo toca.
// Contraseña demo '123456' (argon2 timeCost 2, igual que `usuarios-proceres`).

const ADMINS = [
  {
    // Sucursal Oeste — J. M. de Rosas 600, Morón.
    email: 'admin@jmderosas.com',
    nombre: 'Admin',
    apellido: 'Oeste',
    telefono: '1111111101',
    fechaNacimiento: '1985-05-20',
    sucursal: 'Sucursal Oeste',
  },
  {
    // Sucursal Palermo — Av. Santa Fe 3253, CABA.
    email: 'admin@santafe.com',
    nombre: 'Admin',
    apellido: 'Palermo',
    telefono: '1111111102',
    fechaNacimiento: '1986-06-15',
    sucursal: 'Sucursal Palermo',
  },
  {
    // Sucursal Vergara — AV GDOR VERGARA 3547, Hurlingham.
    email: 'admin@vergara.com',
    nombre: 'Admin',
    apellido: 'Vergara',
    telefono: '1111111103',
    fechaNacimiento: '1987-07-20',
    sucursal: 'Sucursal Vergara',
  },
];

module.exports = {
  up: async (queryInterface) => {
    const [sucursales] = await queryInterface.sequelize.query(
      `SELECT id, nombre FROM "Sucursales"`
    );
    const idPorNombre = new Map(sucursales.map((s) => [s.nombre, s.id]));

    const faltantes = ADMINS.filter((a) => !idPorNombre.has(a.sucursal)).map(
      (a) => a.sucursal
    );
    if (faltantes.length > 0) {
      throw new Error(
        `No se encontraron las sucursales: ${faltantes.join(
          ', '
        )}. Ejecutar el seeder de sucursales primero.`
      );
    }

    const [
      existentes,
    ] = await queryInterface.sequelize.query(
      `SELECT email FROM "Usuarios" WHERE email IN (:emails)`,
      { replacements: { emails: ADMINS.map((a) => a.email) } }
    );
    const yaCreados = new Set(existentes.map((u) => u.email.toLowerCase()));

    const password = await argon2.hash('123456', { timeCost: 2 });

    const inserts = ADMINS.filter(
      (a) => !yaCreados.has(a.email.toLowerCase())
    ).map((a) => ({
      nombre: a.nombre,
      apellido: a.apellido,
      email: a.email,
      password,
      telefono: a.telefono,
      fechaNacimiento: a.fechaNacimiento,
      rol: 'ADMINISTRADOR',
      sucursalId: idPorNombre.get(a.sucursal),
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    if (inserts.length > 0) {
      await queryInterface.bulkInsert('Usuarios', inserts);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "Usuarios" WHERE email IN (:emails)`,
      { replacements: { emails: ADMINS.map((a) => a.email) } }
    );
  },
};
