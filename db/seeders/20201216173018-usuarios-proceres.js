'use strict';

const argon2 = require('argon2');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const password = await argon2.hash('123456', { timeCost: 2 });
    await queryInterface.bulkInsert('Usuarios', [
      {
        nombre: 'Admin',
        apellido: 'ComiRapi',
        email: 'admin@test.com',
        password,
        telefono: '1111111111',
        fechaNacimiento: '1985-05-20',
        rol: 'ADMINISTRADOR',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        nombre: 'Cliente',
        apellido: 'Prueba',
        email: 'cliente@test.com',
        password,
        telefono: '2222222222',
        fechaNacimiento: '1992-11-03',
        rol: 'CLIENTE',
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Usuarios', null, {});
  },
};
