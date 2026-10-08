'use strict';

// Parámetros de negocio configurables por el SUPERADMINISTRADOR.
//
// Una sola tabla clave-valor (no una tabla por parámetro), según el DER §2.20 y
// modelo-dominio §5.17: `id` (PK), `clave` (única), `valor` y `descripcion`.
// `clave` es el nombre estable que usa el código para leer el valor (UNIQUE, no
// PK). `valor` se guarda como texto y se interpreta según el catálogo de
// `parametros_service` (tipo/unidad/rango viven en el código).
//
// El catálogo de claves es cerrado: la tabla no admite claves arbitrarias, solo
// las que el servicio conoce (ver `actualizarParametros`). El seeder carga los
// valores por defecto para que queden explícitos y editables desde el panel.
//
// down(): borra la tabla completa.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ParametrosSistema', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      clave: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      valor: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      descripcion: {
        type: Sequelize.TEXT,
        allowNull: true,
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
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ParametrosSistema');
  },
};
