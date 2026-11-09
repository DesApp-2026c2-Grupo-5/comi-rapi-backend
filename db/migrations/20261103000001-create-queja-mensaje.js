'use strict';

// Hilo de respuestas de una queja (cliente y negocio).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('QuejaMensajes', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      quejaId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Quejas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      autorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      contenido: {
        type: Sequelize.TEXT,
        allowNull: false,
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

    await queryInterface.addIndex('QuejaMensajes', ['quejaId'], {
      name: 'queja_mensajes_queja_idx',
    });

    const [filas] = await queryInterface.sequelize.query(
      `SELECT "id", "respondidoPorId", "respuesta", COALESCE("respondidaEn", "updatedAt") AS "creadaEn"
         FROM "Quejas"
        WHERE "respuesta" IS NOT NULL AND "respondidoPorId" IS NOT NULL`
    );
    if (filas.length) {
      await queryInterface.bulkInsert(
        'QuejaMensajes',
        filas.map((fila) => ({
          quejaId: fila.id,
          autorId: fila.respondidoPorId,
          contenido: fila.respuesta,
          createdAt: fila.creadaEn,
          updatedAt: fila.creadaEn,
        }))
      );
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('QuejaMensajes');
  },
};
