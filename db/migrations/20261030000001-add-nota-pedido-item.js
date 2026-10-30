'use strict';

// Observaciones por ítem del carrito.
//
// Agrega a `PedidoItems`:
//   - `nota` (TEXT NULL): texto libre que el cliente escribe en el carrito
//     ("sin sal", "bien cocida") y que se muestra en cocina.
//
// Por qué una columna nueva y no `observacion`:
//   `PedidoItems.observacion` ya guarda el snapshot de la personalización como
//   JSON (`extras`, `acompanamientos`, `sin`, `condimentos`) y de ahí lo lee
//   `lib/services/stock.js` para descontar insumos. Escribir texto libre en esa
//   columna perdería la personalización y rompería el descuento de stock.
//
// Columna nullable: los pedidos existentes quedan en NULL y no se migran datos.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('PedidoItems', 'nota', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('PedidoItems', 'nota');
  },
};
