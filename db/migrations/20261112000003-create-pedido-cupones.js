'use strict';

// Migracion faltante: crea `PedidoCupones`, el ciclo de uso de un cupon dentro
// de un pedido (ver lib/models/pedido_cupon.js).
//
// Sin esta tabla, cualquier Pedido.findAll que incluya la asociacion `cupon`
// falla con `relation "PedidoCupones" does not exist`.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PedidoCupones', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      pedidoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Pedidos', key: 'id' },
        onDelete: 'RESTRICT',
      },
      cuponId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Cupones', key: 'id' },
        onDelete: 'RESTRICT',
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
      },
      descuentoMaximo: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      baseCalculo: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      descuentoAplicado: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      estado: {
        type: Sequelize.ENUM('RESERVADO', 'CONFIRMADO', 'LIBERADO'),
        allowNull: false,
        defaultValue: 'RESERVADO',
      },
      reservadoEn: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      confirmadoEn: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      liberadoEn: {
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

    // Un pedido puede usar, como maximo, un cupon.
    await queryInterface.addConstraint('PedidoCupones', {
      fields: ['pedidoId'],
      type: 'unique',
      name: 'pedido_cupones_pedido_unique',
    });
    await queryInterface.addIndex('PedidoCupones', ['cuponId'], {
      name: 'pedido_cupones_cupon_idx',
    });
    await queryInterface.addIndex('PedidoCupones', ['usuarioId'], {
      name: 'pedido_cupones_usuario_idx',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('PedidoCupones');
    await queryInterface.dropEnum('enum_PedidoCupones_tipoDescuento');
    await queryInterface.dropEnum('enum_PedidoCupones_estado');
  },
};
