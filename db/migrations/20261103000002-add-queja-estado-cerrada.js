'use strict';

// Nuevo estado final: el cliente cierra el reclamo.
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_Quejas_estado" ADD VALUE IF NOT EXISTS 'CERRADA';`
    );
  },

  down: async () => {},
};
