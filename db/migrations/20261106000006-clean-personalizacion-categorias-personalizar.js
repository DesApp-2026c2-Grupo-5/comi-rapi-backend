'use strict';

/**
 * Limpieza de `personalizar` administrable a mano (BE-8).
 *
 * A partir de la receta, las opciones "Sin X" se generan automáticamente y ya
 * no se administran desde el ABM. Las plantillas `personalizar` de categoría
 * dejan de heredarse y se eliminan; los `personalizar` de producto que no
 * provengan de una receta (sin `ingredienteId`) también se eliminan.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "PersonalizacionCategorias" WHERE "tipo" = 'personalizar'`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "PersonalizacionElementos" WHERE "tipo" = 'personalizar' AND "ingredienteId" IS NULL`
    );
  },

  down: async () => {
    // No se restauran los datos eliminados.
  },
};
