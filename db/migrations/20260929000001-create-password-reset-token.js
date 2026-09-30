'use strict';

/**
 * Tokens de recuperación de contraseña.
 *
 * Nunca se guarda el token en texto plano: solo su hash SHA-256. Los tokens
 * usados, expirados o invalidados se conservan para auditoría (ver
 * docs/recuperacion-contrasena.md) y los elimina la tarea de mantenimiento.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PasswordResetTokens', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Usuarios',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      tokenHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      // NULL mientras el token no se haya utilizado.
      usedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      // Se setea cuando una solicitud posterior invalida este token, para poder
      // distinguirlo en la auditoría de uno que simplemente expiró sin usarse.
      invalidatedAt: {
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

    await queryInterface.addIndex('PasswordResetTokens', ['usuarioId'], {
      name: 'password_reset_tokens_usuario',
    });
    await queryInterface.addIndex('PasswordResetTokens', ['expiresAt'], {
      name: 'password_reset_tokens_expires_at',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('PasswordResetTokens');
  },
};
