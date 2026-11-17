'use strict';

/**
 * Horarios de atención dentro del mismo día.
 *
 * El alta de sucursales ya no acepta franjas que pasen al día siguiente
 * (`cierre <= apertura`): un lunes no puede cerrar a la 01:00 del martes. Las
 * filas que quedaron de la regla vieja (ej. 19:00–02:00 o 11:00–00:00) se
 * normalizan cerrando a las 23:59 del mismo día.
 *
 * Es una normalización de datos y no se revierte: el cierre original (00:00 o
 * 02:00 del día siguiente) no se puede reconstruir de forma unívoca.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "HorarioSucursales" SET "cierre" = '23:59:00', "updatedAt" = NOW() WHERE "cierre" <= "apertura"`
    );
  },

  down: async () => {
    // Sin vuelta atrás: la información del horario que cruzaba se descarta.
  },
};
