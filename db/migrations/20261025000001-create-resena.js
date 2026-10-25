'use strict';

// Reseñas de productos y combos (DER §2.22).
//
// Una reseña la escribe un CLIENTE sobre un producto que YA compró y recibió.
// La regla de elegibilidad (pedido `entregado`) vive en
// `lib/services/resenas.js`: la base sólo garantiza la integridad estructural:
//
// - `usuarioId` + `productoId` es UNIQUE: un cliente deja una sola reseña por
//   producto (puede editarla o borrarla, no duplicarla).
// - `puntuacion` tiene un CHECK de 1 a 5: el frontend usa estrellas, pero la
//   base no confía en el cliente.
// - `pedidoId` conserva el pedido entregado que habilitó la reseña. Es una FK
//   real (no un snapshot) porque la reseña es una opinión actual, no un dato
//   histórico del pedido.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Resenas', {
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
      productoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Productos', key: 'id' },
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
      puntuacion: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      comentario: {
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

    await queryInterface.addConstraint('Resenas', {
      fields: ['usuarioId', 'productoId'],
      type: 'unique',
      name: 'resenas_usuario_producto_unique',
    });

    // CHECK explícito por SQL: `addConstraint` con `where` cambia entre
    // versiones de Sequelize y acá no queremos depender de esa traducción.
    await queryInterface.sequelize.query(
      'ALTER TABLE "Resenas" ADD CONSTRAINT "resenas_puntuacion_rango" CHECK ("puntuacion" BETWEEN 1 AND 5);'
    );

    await queryInterface.addIndex('Resenas', ['productoId'], {
      name: 'resenas_producto_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Resenas');
  },
};
