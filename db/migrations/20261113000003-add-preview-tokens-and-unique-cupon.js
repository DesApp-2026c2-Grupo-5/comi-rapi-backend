'use strict';

// Migracion 3 de 3: tokens de preview de un solo uso y restriccion de unicidad.
//
// - Crea CuponPreviewTokens: registra el hash de cada previewToken consumido
//   para impedir doble confirmacion (una misma previsualizacion no puede
//   generar dos emisiones distintas).
// - Agrega UNIQUE(emisionId, usuarioId) a Cupones: defensa en profundidad para
//   evitar que un cliente reciba dos cupones de la misma emisión.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('CuponPreviewTokens', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      tokenHash: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      usado: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      expiraEn: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      creadoEn: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      usadoEn: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addConstraint('CuponPreviewTokens', {
      fields: ['tokenHash'],
      type: 'unique',
      name: 'cupon_preview_tokens_token_hash_unique',
    });

    await queryInterface.addIndex('CuponPreviewTokens', ['tokenHash'], {
      name: 'cupon_preview_tokens_token_hash_idx',
    });
    await queryInterface.addIndex('CuponPreviewTokens', ['usado'], {
      name: 'cupon_preview_tokens_usado_idx',
    });

    // Defensa en profundidad: un cliente no puede recibir dos cupones de la
    // misma emisión.
    await queryInterface.addConstraint('Cupones', {
      fields: ['emisionId', 'usuarioId'],
      type: 'unique',
      name: 'cupones_emision_usuario_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeConstraint(
      'Cupones',
      'cupones_emision_usuario_unique'
    );
    await queryInterface.removeIndex(
      'CuponPreviewTokens',
      'cupon_preview_tokens_usado_idx'
    );
    await queryInterface.removeIndex(
      'CuponPreviewTokens',
      'cupon_preview_tokens_token_hash_idx'
    );
    await queryInterface.removeConstraint(
      'CuponPreviewTokens',
      'cupon_preview_tokens_token_hash_unique'
    );
    await queryInterface.dropTable('CuponPreviewTokens');
  },
};
