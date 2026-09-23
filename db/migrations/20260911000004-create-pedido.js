'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Pedidos', {
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
      sucursalId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Sucursales', key: 'id' },
        onDelete: 'RESTRICT',
      },
      fechaHora: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      estadoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'EstadoPedidos', key: 'id' },
        onDelete: 'RESTRICT',
      },
      costoEnvio: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      medioPago: {
        type: Sequelize.ENUM('MERCADO_PAGO', 'TARJETA'),
        allowNull: true,
      },
      observacion: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      calle: {
        type: Sequelize.STRING,
        allowNull: true,
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
    await queryInterface.dropTable('Pedidos');
  },
};
