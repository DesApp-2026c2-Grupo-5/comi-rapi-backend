'use strict';

/**
 * Agrega el rango de cantidad (mínimo/máximo) por elemento de personalización.
 * Reemplaza los topes globales que vivían hardcodeados en el frontend:
 * ahora cada extra/acompañamiento/personalizado/condimento indica cuántas
 * unidades se pueden elegir de ESE elemento en el producto.
 *
 * Defaults: mínimo 0 (opcional) y máximo 1.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('PersonalizacionElementos', 'minimo', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('PersonalizacionElementos', 'maximo', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('PersonalizacionElementos', 'minimo');
    await queryInterface.removeColumn('PersonalizacionElementos', 'maximo');
  },
};
