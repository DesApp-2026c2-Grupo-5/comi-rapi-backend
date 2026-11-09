'use strict';

// Reclamos del cliente sobre pedidos entregados (DER §2.23).
//
// Una queja la escribe un CLIENTE sobre un pedido propio que YA fue entregado.
// La elegibilidad (dueño + estado `entregado`), el alcance por sucursal y la
// máquina de estados viven en `lib/services/quejas.js`: la base sólo garantiza
// la integridad estructural:
//
// - `pedidoId` es UNIQUE: un pedido admite una sola queja.
// - `motivo` y `estado` son ENUM: el dominio queda cerrado aunque el cliente
//   mande cualquier texto.
// - `respondidoPorId` y `respondidaEn` quedan NULL hasta que el negocio
//   responde; la respuesta es obligatoria para cerrar (se valida en el service).
// - Las FK son RESTRICT: ni el usuario ni el pedido pueden borrarse dejando la
//   queja huérfana.

const MOTIVOS = [
  'PEDIDO_INCOMPLETO',
  'PRODUCTO_EN_MAL_ESTADO',
  'DEMORA_EN_LA_ENTREGA',
  'ERROR_DE_COBRO',
  'OTRO',
];

const ESTADOS = ['PENDIENTE', 'EN_REVISION', 'RESUELTA', 'RECHAZADA'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Quejas', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      pedidoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Pedidos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      motivo: {
        type: Sequelize.ENUM(...MOTIVOS),
        allowNull: false,
      },
      detalle: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      estado: {
        type: Sequelize.ENUM(...ESTADOS),
        allowNull: false,
        defaultValue: 'PENDIENTE',
      },
      respuesta: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      respondidoPorId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      respondidaEn: {
        type: Sequelize.DATE,
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

    await queryInterface.addConstraint('Quejas', {
      fields: ['pedidoId'],
      type: 'unique',
      name: 'quejas_pedido_unique',
    });

    // CHECK explícito además del ENUM, para que la restricción quede visible
    // en el DER y no dependa del tipo generado por Sequelize.
    await queryInterface.sequelize.query(
      `ALTER TABLE "Quejas" ADD CONSTRAINT "quejas_estado_valido" CHECK ("estado" IN ('PENDIENTE', 'EN_REVISION', 'RESUELTA', 'RECHAZADA'));`
    );

    await queryInterface.addIndex('Quejas', ['usuarioId'], {
      name: 'quejas_usuario_idx',
    });
    await queryInterface.addIndex('Quejas', ['estado'], {
      name: 'quejas_estado_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Quejas');
    // `dropTable` no elimina los tipos ENUM generados por PostgreSQL.
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Quejas_motivo";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Quejas_estado";'
    );
  },
};
