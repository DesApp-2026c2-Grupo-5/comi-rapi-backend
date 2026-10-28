'use strict';

/**
 * Insumos: extras y condimentos con stock propio.
 *
 * Hasta ahora los extras y condimentos vivían sólo como texto dentro de
 * `PersonalizacionElementos` y no descontaban stock. Para poder venderlos con
 * stock real se separan en una entidad propia:
 *
 *  - `Insumos`: catálogo corporativo (nombre, tipo, precio, activo). Lo
 *    administra el SUPERADMINISTRADOR desde Catálogo.
 *  - `InsumoStocks`: existencias por sucursal, con la misma PK compuesta que
 *    `Stocks` (sucursalId, insumoId). El ADMINISTRADOR sólo carga cantidades
 *    de su sucursal.
 *
 * Es una extensión del modelo aprobado: no reemplaza a `Stocks` (productos y
 * combos) ni a `PersonalizacionElementos` (configuración por producto).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Insumos', {
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
      // Sólo los dos tipos que descuentan stock. Acompañamientos e ingredientes
      // siguen siendo configuración del producto, no insumos vendibles.
      tipo: {
        type: Sequelize.ENUM('extra', 'condimento'),
        allowNull: false,
      },
      precio: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
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

    // Un mismo nombre puede existir como extra y como condimento (son listas
    // distintas en el modal), pero no duplicarse dentro del mismo tipo.
    await queryInterface.addIndex('Insumos', ['nombre', 'tipo'], {
      unique: true,
      name: 'insumos_nombre_tipo_unique',
    });

    await queryInterface.createTable('InsumoStocks', {
      sucursalId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Sucursales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      insumoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Insumos',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cantidad: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      disponible: {
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

    await queryInterface.addIndex('InsumoStocks', ['insumoId']);

    // Mismo criterio que `Stocks`: el descuento se hace con
    // `UPDATE ... WHERE cantidad >= n`, pero el CHECK impide que un error
    // future deje una existencia negativa.
    await queryInterface.sequelize.query(
      `ALTER TABLE "InsumoStocks" ADD CONSTRAINT "CK_InsumoStocks_cantidad" CHECK ("cantidad" >= 0)`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('InsumoStocks');
    await queryInterface.dropTable('Insumos');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Insumos_tipo";'
    );
  },
};
