'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Productos', 'tipo', {
      type: Sequelize.ENUM('PRODUCTO', 'COMBO'),
      allowNull: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('Productos', 'tipo');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS public."enum_Productos_tipo";'
    );
  },
};
