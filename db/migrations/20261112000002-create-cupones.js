'use strict';

// Migracion faltante: crea la tabla `Cupones`.
//
// El rediseno de cupones agrego los modelos y las migraciones
// 20261113000001..0004, pero nunca la creacion de `Cupones` ni de
// `PedidoCupones`. Sin esta tabla, `20261113000001` falla al ejecutar
// addColumn('Cupones', ...) y el backend falla en runtime al incluir la
// asociacion `PedidoCupon` en Pedido.findAll.
//
// Se crea con el esquema previo al rediseno: conserva las columnas legacy
// `campanaId` / `ejecucionId` (la migracion 2 las lee para el backfill y la
// migracion 4 las relaja a nullable). No se declaran sus FKs porque
// `Campanas` y `CampanaEjecuciones` nunca existieron en este repositorio.
//
// Lo que agrega despues:
// - `20261113000001`: emisionId (FK nullable) y alcanceSnapshot.
// - `20261113000003`: UNIQUE(emisionId, usuarioId) y CuponPreviewTokens.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Cupones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      // Columnas legacy: NOT NULL como en el esquema original. La migracion
      // 20261113000004 las deja opcionales para los cupones nuevos.
      campanaId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      ejecucionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onDelete: 'RESTRICT',
      },
      codigo: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      tipoDescuento: {
        type: Sequelize.ENUM('PORCENTAJE', 'MONTO_FIJO'),
        allowNull: false,
      },
      valorDescuento: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      compraMinima: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      descuentoMaximo: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      fechaInicio: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      fechaFin: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      usosPermitidos: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      activo: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      estadoEnvio: {
        type: Sequelize.ENUM('PENDIENTE', 'ENVIADO', 'FALLIDO'),
        allowNull: false,
        defaultValue: 'PENDIENTE',
      },
      enviadoEn: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      errorEnvio: {
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

    // El modelo documenta `codigo` como identificador UNIQUE.
    await queryInterface.addConstraint('Cupones', {
      fields: ['codigo'],
      type: 'unique',
      name: 'cupones_codigo_unique',
    });
    await queryInterface.addIndex('Cupones', ['usuarioId'], {
      name: 'cupones_usuario_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Cupones');
    await queryInterface.dropEnum('enum_Cupones_tipoDescuento');
    await queryInterface.dropEnum('enum_Cupones_estadoEnvio');
  },
};
