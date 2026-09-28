'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PedidoPromociones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      pedidoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Pedidos',
          key: 'id',
        },
        onDelete: 'RESTRICT',
      },
      promocionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Promociones',
          key: 'id',
        },
        onDelete: 'RESTRICT',
      },
      descuentoAplicado: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
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
    await queryInterface.addConstraint('PedidoPromociones', {
      fields: ['pedidoId', 'promocionId'],
      type: 'unique',
      name: 'pedido_promocion_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('PedidoPromociones');
  },
};
