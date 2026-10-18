'use strict';

const argon2 = require('argon2');

// Usuario CLIENTE demo. El admin genérico `admin@test.com` fue reemplazado por
// un ADMINISTRADOR por sucursal con email descriptivo de la calle de cada
// local: ver `20260915000003-usuarios-admins-por-sucursal.js`.
//
// Idempotente por diseño (bulkInsert); el `down` borra SOLO este usuario por
// email: antes borraía TODOS los Usuarios y arrasaría los creados por otros
// seeders en un `seed:undo:all`.

const CLIENTE = {
  nombre: 'Cliente',
  apellido: 'Prueba',
  email: 'cliente@test.com',
  password: '123456',
  telefono: '2222222222',
  fechaNacimiento: '1992-11-03',
};

module.exports = {
  up: async (queryInterface) => {
    const password = await argon2.hash(CLIENTE.password, { timeCost: 2 });
    await queryInterface.bulkInsert('Usuarios', [
      {
        nombre: CLIENTE.nombre,
        apellido: CLIENTE.apellido,
        email: CLIENTE.email,
        password,
        telefono: CLIENTE.telefono,
        fechaNacimiento: CLIENTE.fechaNacimiento,
        rol: 'CLIENTE',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Usuarios', {
      email: CLIENTE.email,
    });
  },
};
