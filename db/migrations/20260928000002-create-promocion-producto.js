'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PromocionProductos', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      productoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Productos',
          key: 'id',
        },
        onDelete: 'RESTRICT',
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
    await queryInterface.addConstraint('PromocionProductos', {
      fields: ['promocionId', 'productoId'],
      type: 'unique',
      name: 'promocion_producto_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('PromocionProductos');
  },
};
