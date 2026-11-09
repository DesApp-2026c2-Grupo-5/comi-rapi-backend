'use strict';

// Centro de notificaciones del CLIENTE (DER §2.24).
//
// Cada fila es un aviso dirigido a UN usuario. El cliente es el único rol que
// recibe notificaciones: cambios de estado de sus pedidos y novedades de sus
// reclamos. El negocio sigue usando los contadores de Pedidos y Reclamos.
//
// - `tipo` es ENUM para que el destino del clic se pueda resolver sin mirar el
//   texto: PEDIDO, QUEJA o SISTEMA.
// - `pedidoId` y `quejaId` son opcionales y usan SET NULL: si algún día se
//   elimina el origen, el aviso histórico no deja la fila huérfana. Los pedidos
//   y las quejas del sistema no se borran, pero la FK no debe impedirlo.
// - `leida` + `leidaEn` guardan el estado de lectura. El listado y el badge se
//   calculan siempre en el backend para que el contador no dependa del
//   dispositivo desde el que se abrió la app.

const TIPOS = ['PEDIDO', 'QUEJA', 'SISTEMA'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Notificaciones', {
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
        onDelete: 'CASCADE',
      },
      tipo: {
        type: Sequelize.ENUM(...TIPOS),
        allowNull: false,
        defaultValue: 'SISTEMA',
      },
      titulo: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      mensaje: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      pedidoId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Pedidos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      quejaId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Quejas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      leida: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      leidaEn: {
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

    await queryInterface.sequelize.query(
      `ALTER TABLE "Notificaciones" ADD CONSTRAINT "notificaciones_tipo_valido" CHECK ("tipo" IN ('PEDIDO', 'QUEJA', 'SISTEMA'));`
    );

    // El listado siempre filtra por destinatario y ordena por fecha. El índice
    // compuesto cubre además el conteo de no leídas (`usuarioId + leida`).
    await queryInterface.addIndex('Notificaciones', ['usuarioId', 'leida'], {
      name: 'notificaciones_usuario_leida_idx',
    });
    await queryInterface.addIndex(
      'Notificaciones',
      ['usuarioId', 'createdAt'],
      {
        name: 'notificaciones_usuario_fecha_idx',
      }
    );
    await queryInterface.addIndex('Notificaciones', ['pedidoId'], {
      name: 'notificaciones_pedido_idx',
    });
    await queryInterface.addIndex('Notificaciones', ['quejaId'], {
      name: 'notificaciones_queja_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Notificaciones');
    // `dropTable` no elimina el tipo ENUM generado por PostgreSQL.
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Notificaciones_tipo";'
    );
  },
};
