'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Direcciones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onDelete: 'RESTRICT',
      },
      calle: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      altura: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ciudad: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      codigoPostal: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      referencia: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      latitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: true,
      },
      longitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: true,
      },
      alias: {
        type: Sequelize.STRING,
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

  down: async (queryInterface) => {
    await queryInterface.dropTable('Direcciones');
  },
};
