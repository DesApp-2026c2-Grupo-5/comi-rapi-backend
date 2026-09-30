'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Promociones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      descripcion: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      tipo: {
        type: Sequelize.ENUM('DESCUENTO_PORCENTUAL', 'DOS_POR_UNO'),
        allowNull: false,
      },
      valor: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      fechaInicio: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      fechaFin: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      activa: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Promociones');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Promociones_tipo";'
    );
  },
};
