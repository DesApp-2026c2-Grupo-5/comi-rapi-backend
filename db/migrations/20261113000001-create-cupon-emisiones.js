'use strict';

// Nuevo esquema de cupones (reemplaza a Campanas + CampanaEjecuciones).
//
// Migracion 1 de 3: crea las tablas nuevas y agrega columnas a Cupones
// SIN imponer restricciones NOT NULL ni eliminar columnas antiguas.
// El backfill de datos vive en la migracion 2 (20261113000002).
//
// Tablas nuevas:
// - CuponEmisiones: cabecera de una operacion de distribucion de cupones.
// - CuponEmisionCategorias: categorias alcanzadas por emision.
// - CuponEmisionProductos: productos alcanzados por emision.
//
// Columnas agregadas a Cupones (existente):
// - emisionId: FK nullable a CuponEmisiones (se pobla en el backfill).
// - alcanceSnapshot: JSONB con el alcance resuelto congelado.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('CuponEmisiones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      creadaPorUsuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      nombre: { type: Sequelize.STRING(160), allowNull: false },
      descripcion: { type: Sequelize.TEXT, allowNull: true },
      tipoDescuento: {
        type: Sequelize.ENUM('PORCENTAJE', 'MONTO_FIJO'),
        allowNull: false,
      },
      valorDescuento: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      compraMinima: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      descuentoMaximo: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      fechaInicio: { type: Sequelize.DATE, allowNull: false },
      fechaFin: { type: Sequelize.DATE, allowNull: false },
      maxDestinatarios: { type: Sequelize.INTEGER, allowNull: true },
      periodoAnalisisDias: { type: Sequelize.INTEGER, allowNull: true },
      cantidadElegibles: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cantidadCupones: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cantidadEnviados: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cantidadFallidos: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      estado: {
        type: Sequelize.ENUM('EN_PROCESO', 'COMPLETADA', 'CON_ERRORES'),
        allowNull: false,
        defaultValue: 'EN_PROCESO',
      },
      configuracionSnapshot: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      bloqueoToken: { type: Sequelize.STRING(64), allowNull: true },
      bloqueoExpiraEn: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('CuponEmisionCategorias', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      emisionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CuponEmisiones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      categoriaId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Categorias', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('CuponEmisionProductos', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      emisionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CuponEmisiones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      productoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Productos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // Agregar columnas a Cupones (tabla existente). emisionId es nullable
    // para permitir el backfill antes de imponer NOT NULL.
    await queryInterface.addColumn('Cupones', 'emisionId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'CuponEmisiones', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    await queryInterface.addColumn('Cupones', 'alcanceSnapshot', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: { global: true },
    });

    // Indices de apoyo para el backfill y consultas posteriores.
    await queryInterface.addIndex('Cupones', ['emisionId'], {
      name: 'cupones_emision_idx',
    });
    await queryInterface.addIndex('Cupones', ['emisionId', 'estadoEnvio'], {
      name: 'cupones_emision_envio_idx',
    });
    await queryInterface.addIndex('CuponEmisiones', ['estado'], {
      name: 'cupon_emisiones_estado_idx',
    });
    await queryInterface.addIndex('CuponEmisiones', ['creadaPorUsuarioId'], {
      name: 'cupon_emisiones_creada_por_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('Cupones', 'cupones_emision_envio_idx');
    await queryInterface.removeIndex('Cupones', 'cupones_emision_idx');
    await queryInterface.removeIndex(
      'CuponEmisiones',
      'cupon_emisiones_creada_por_idx'
    );
    await queryInterface.removeIndex(
      'CuponEmisiones',
      'cupon_emisiones_estado_idx'
    );
    await queryInterface.removeColumn('Cupones', 'alcanceSnapshot');
    await queryInterface.removeColumn('Cupones', 'emisionId');
    await queryInterface.dropTable('CuponEmisionProductos');
    await queryInterface.dropTable('CuponEmisionCategorias');
    await queryInterface.dropTable('CuponEmisiones');
  },
};
