'use strict';

// Fecha de cierre por el cliente y CHECK que acepta CERRADA.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Quejas', 'cerradaEn', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "Quejas" DROP CONSTRAINT IF EXISTS "quejas_estado_valido";`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Quejas" ADD CONSTRAINT "quejas_estado_valido" CHECK ("estado" IN ('PENDIENTE', 'EN_REVISION', 'RESUELTA', 'RECHAZADA', 'CERRADA'));`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "Quejas" DROP CONSTRAINT IF EXISTS "quejas_estado_valido";`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Quejas" ADD CONSTRAINT "quejas_estado_valido" CHECK ("estado" IN ('PENDIENTE', 'EN_REVISION', 'RESUELTA', 'RECHAZADA'));`
    );
    await queryInterface.removeColumn('Quejas', 'cerradaEn');
  },
};
