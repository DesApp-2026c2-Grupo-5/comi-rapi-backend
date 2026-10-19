'use strict';

// A6: hora estimada de llegada del pedido (timestamp absoluto).
//
// Se persiste al pasar a `en_camino`: es el ancla del "quedan X min" que ve el
// cliente — la duración del viaje sale del caché de distancias (A1-4), sin
// llamar al proveedor en el paso crítico.
//
// Nullable y sin default: los pedidos existentes quedan en NULL (sin impacto)
// y solo los que pasan por en_camino la cargan. `etaMinutos`/`etaCalculadoEn`
// (T2) no cambian: siguen siendo el estimado de cocina+viaje del momento del
// pago; `horaEstimadaLlegada` es la proyección absoluta al salir el repartidor.
//
// down(): quita la columna.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Pedidos', 'horaEstimadaLlegada', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('Pedidos', 'horaEstimadaLlegada');
  },
};
