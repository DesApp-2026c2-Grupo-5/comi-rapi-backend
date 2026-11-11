'use strict';

/**
 * Catálogo de ingredientes (modelo-dominio §5.8.2 / DER §2.10.3).
 *
 * El stock real del catálogo pasa a estar en las materias primas: cada
 * ingrediente tiene una unidad de medida fija y una receta lo vincula con los
 * productos. `Insumo`/`InsumoStock` siguen siendo independientes.
 *
 * - `nombre` es único sin distinguir mayúsculas: el índice funcional sobre
 *   `LOWER("nombre")` evita duplicados como "Tomate" y "tomate".
 * - `unidadMedida` no admite conversión: la cantidad de la receta se expresa
 *   siempre en esta unidad.
 * - `activo` es baja lógica; un ingrediente inactivo cuenta como stock 0.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Ingredientes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      unidadMedida: {
        type: Sequelize.ENUM('unidad', 'g', 'kg', 'ml', 'l'),
        allowNull: false,
      },
      activo: {
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

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX "ingredientes_nombre_unique" ON "Ingredientes" (LOWER("nombre"));'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Ingredientes');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Ingredientes_unidadMedida";'
    );
  },
};
