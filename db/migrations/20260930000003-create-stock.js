'use strict';

// Existencias por sucursal (DER §2.10 / modelo-dominio §5.8).
//
// La clave es compuesta (sucursalId, productoId): cada sucursal tiene su propia
// cantidad de cada producto, y el mismo producto puede tener números distintos
// en cada una. Es la única entidad con PK compuesta (PromocionProducto y
// PedidoPromocion usan id propio), justamente porque siempre se accede por el
// par sucursal + producto.
//
// Un combo también tiene fila de stock: `cantidad` es cuántos combos pone la
// sucursal a la venta. Lo que la sucursal puede armar de verdad sale de los
// componentes (ver `lib/services/stock.js`), así que la fila del combo es un
// tope, nunca la garantía de que se pueda armar.
//
// down(): borra la tabla completa.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Stocks', {
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
      cantidad: {
        type: Sequelize.INTEGER,
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

    // No hay existencias negativas: el descuento se hace con un
    // `UPDATE ... WHERE cantidad >= n`, pero el CHECK evita que un error future
    // deje la fila en negativo.
    await queryInterface.sequelize.query(
      `ALTER TABLE "Stocks" ADD CONSTRAINT "CK_Stocks_cantidad" CHECK ("cantidad" >= 0)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Stocks');
  },
};
