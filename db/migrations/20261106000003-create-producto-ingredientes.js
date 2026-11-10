'use strict';

/**
 * Receta de un producto simple (DER §2.10.5 / modelo-dominio §5.8.3).
 *
 * `cantidad` es lo que lleva UNA unidad del producto, expresada en la unidad
 * del ingrediente. La PK compuesta `(productoId, ingredienteId)` evita repetir
 * el mismo ingrediente en una receta.
 *
 * `permiteQuitar` define si el ingrediente aparece como "Sin X" en el detalle.
 * No altera el descuento de stock: siempre se descuenta la receta completa.
 *
 * Sólo aplica a `Producto.tipo = PRODUCTO`; un COMBO sigue derivando de
 * `ComboComponentes`.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ProductoIngredientes', {
      productoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Productos',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ingredienteId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Ingredientes',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cantidad: {
        type: Sequelize.DECIMAL(12, 3),
        allowNull: false,
      },
      permiteQuitar: {
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

    await queryInterface.addIndex('ProductoIngredientes', ['ingredienteId'], {
      name: 'producto_ingredientes_ingrediente_id',
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "ProductoIngredientes" ADD CONSTRAINT "CK_ProductoIngredientes_cantidad" CHECK ("cantidad" > 0)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ProductoIngredientes');
  },
};
