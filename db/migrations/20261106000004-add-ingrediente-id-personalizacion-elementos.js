'use strict';

/**
 * Trazabilidad entre la receta y las opciones "Sin X" (DER §2.10.5).
 *
 * `PersonalizacionElementos` ya guarda el nombre visible de la opción; esta FK
 * nullable permite saber de qué ingrediente salió cada fila generada con
 * `tipo = 'personalizar'`. Es opcional para no romper los elementos viejos ni
 * los tipos `extra`, `acompanar` y `condimento`.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const columnas = await queryInterface.describeTable(
      'PersonalizacionElementos'
    );
    if (!columnas.ingredienteId) {
      await queryInterface.addColumn(
        'PersonalizacionElementos',
        'ingredienteId',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: 'Ingredientes',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        }
      );
    }

    const indices = await queryInterface.showIndex('PersonalizacionElementos');
    if (
      !indices.some(
        (indice) => indice.name === 'personalizacion_elementos_ingrediente_id'
      )
    ) {
      await queryInterface.addIndex(
        'PersonalizacionElementos',
        ['ingredienteId'],
        { name: 'personalizacion_elementos_ingrediente_id' }
      );
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      'PersonalizacionElementos',
      'personalizacion_elementos_ingrediente_id'
    );
    await queryInterface.removeColumn(
      'PersonalizacionElementos',
      'ingredienteId'
    );
  },
};
