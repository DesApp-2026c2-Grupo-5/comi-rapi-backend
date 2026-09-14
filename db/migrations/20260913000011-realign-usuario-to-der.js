'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Usuarios', 'email', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    });
    await queryInterface.addColumn('Usuarios', 'password', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.addColumn('Usuarios', 'telefono', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('Usuarios', 'rol', {
      type: Sequelize.ENUM('CLIENTE', 'ADMINISTRADOR'),
      allowNull: false,
      defaultValue: 'CLIENTE',
    });
    await queryInterface.addColumn('Usuarios', 'activo', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.removeColumn('Usuarios', 'avatarUrl');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Usuarios', 'avatarUrl', {
      type: Sequelize.STRING,
    });
    await queryInterface.removeColumn('Usuarios', 'activo');
    await queryInterface.removeColumn('Usuarios', 'rol');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS public."enum_Usuarios_rol";'
    );
    await queryInterface.removeColumn('Usuarios', 'telefono');
    await queryInterface.removeColumn('Usuarios', 'password');
    await queryInterface.removeColumn('Usuarios', 'email');
  },
};
