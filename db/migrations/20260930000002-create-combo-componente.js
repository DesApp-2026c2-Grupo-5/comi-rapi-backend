'use strict';

// Composición de un combo (DER §2.6 / modelo-dominio §5.6).
//
// Un combo es un `Producto` con `tipo = COMBO`; `ComboComponente` dice qué
// productos lo arman y en qué cantidad. Son dos FKs a la misma tabla
// `Productos`: la auto-referencia distingue el rol de "combo" del de
// "componente".
//
// `cantidad` es cuántas unidades del componente lleva UNA unidad del combo
// (un combo con papas y bebida lleva `cantidad = 1` de cada una). Es lo que
// permite calcular cuántos combos sale del stock de la sucursal.
//
// Id propio + UNIQUE sobre el par de FKs (igual que PromocionProducto y
// PedidoPromocion); a diferencia de `Stocks`, que sí usa clave compuesta.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ComboComponentes', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      comboId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Productos',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      productoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Productos',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cantidad: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
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

    await queryInterface.addConstraint('ComboComponentes', {
      fields: ['comboId', 'productoId'],
      type: 'unique',
      name: 'combo_componente_unique',
    });

    // `cantidad` es un entero positivo o cero: "cuántas unidades lleva" nunca
    // puede ser negativo ni fraccionario.
    await queryInterface.sequelize.query(
      `ALTER TABLE "ComboComponentes" ADD CONSTRAINT "CK_ComboComponentes_cantidad" CHECK ("cantidad" >= 0)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ComboComponentes');
  },
};
