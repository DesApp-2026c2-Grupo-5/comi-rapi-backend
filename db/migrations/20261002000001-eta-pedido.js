'use strict';

// T2: tiempo estimado de entrega (ETA).
//
// Agrega a `Pedidos`:
//   - `etaMinutos` (INTEGER NULL): cocina (30 min fijos, config) + viaje
//     (duracion por ruta de ORS, en minutos redondeado hacia arriba).
//     NULL si ORS falló al confirmar (degradación: el pago nunca se bloquea)
//     o si el pedido todavía no fue confirmado.
//   - `etaCalculadoEn` (DATE NULL): timestamp del cálculo — permite al
//     frontend mostrar "llegada estimada ~HH:MM" calculando desde ese momento.
//
// Ambas columnas son nullable: los pedidos existentes quedan en null y solo
// los pedidos confirmados a partir de esta migración tendrán ETA.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Pedidos', 'etaMinutos', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('Pedidos', 'etaCalculadoEn', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('Pedidos', 'etaCalculadoEn');
    await queryInterface.removeColumn('Pedidos', 'etaMinutos');
  },
};
