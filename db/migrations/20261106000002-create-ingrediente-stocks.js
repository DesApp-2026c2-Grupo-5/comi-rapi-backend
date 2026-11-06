'use strict';

/**
 * Existencias de ingredientes por sucursal (DER §2.10.4).
 *
 * Misma idea que `Stocks` e `InsumoStocks`: PK compuesta
 * `(sucursalId, ingredienteId)` y una cantidad por sucursal. La diferencia es
 * que la cantidad es decimal (`DECIMAL(12,3)`), porque la receta puede pedir
 * 150 g o 20,5 ml de un ingrediente.
 *
 * `disponible = false` equivale a 0 para el cálculo y la venta. La ausencia de
 * fila también equivale a 0.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('IngredienteStocks', {
      sucursalId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Sucursales',
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
        defaultValue: 0,
      },
      disponible: {
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

    await queryInterface.addIndex('IngredienteStocks', ['ingredienteId'], {
      name: 'ingrediente_stocks_ingrediente_id',
    });

    // El descuento se hace con `UPDATE ... WHERE cantidad >= n`; el CHECK evita
    // que un error futuro deje una existencia negativa.
    await queryInterface.sequelize.query(
      `ALTER TABLE "IngredienteStocks" ADD CONSTRAINT "CK_IngredienteStocks_cantidad" CHECK ("cantidad" >= 0)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('IngredienteStocks');
  },
};
