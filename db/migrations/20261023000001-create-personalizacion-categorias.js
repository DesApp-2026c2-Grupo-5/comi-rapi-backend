'use strict';

/**
 * Plantillas de personalización por categoría.
 *
 * Extiende el modelo implementado de personalización (PersonalizacionElementos,
 * que es por producto): cada fila acá define un elemento que se copia a los
 * productos nuevos de la categoría al darlos de alta.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PersonalizacionCategorias', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      categoriaId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Categorias', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      tipo: {
        type: Sequelize.ENUM(
          'extra',
          'personalizar',
          'acompanar',
          'condimento'
        ),
        allowNull: false,
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      precio: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      productoReferenciaId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Productos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      minimo: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      maximo: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      activo: {
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
    await queryInterface.dropTable('PersonalizacionCategorias');
  },
};
