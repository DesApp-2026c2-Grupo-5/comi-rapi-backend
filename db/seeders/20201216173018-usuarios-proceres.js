'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('Usuarios', [
      {
        nombre: 'Admin',
        apellido: 'ComiRapi',
        email: 'admin@test.com',
        password: '123456',
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
        password: '123456',
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
