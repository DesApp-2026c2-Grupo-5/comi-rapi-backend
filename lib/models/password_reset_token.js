import { Model, DataTypes } from 'sequelize';

/**
 * Token de recuperación de contraseña.
 *
 * Guarda únicamente el hash del token: el texto plano solo viaja por email y
 * existe en memoria durante el procesamiento de la solicitud.
 *
 * Estados auditables (derivados, ver docs/recuperacion-contrasena.md):
 *   invalidado  -> invalidatedAt IS NOT NULL
 *   utilizado   -> usedAt IS NOT NULL
 *   expirado    -> usedAt IS NULL AND invalidatedAt IS NULL AND expiresAt <= NOW()
 *   vigente     -> usedAt IS NULL AND invalidatedAt IS NULL AND expiresAt >  NOW()
 */
export default class PasswordResetToken extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        // SHA-256 en hexadecimal: 64 caracteres.
        tokenHash: {
          type: DataTypes.STRING(64),
          allowNull: false,
          unique: true,
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        usedAt: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        invalidatedAt: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'PasswordResetToken',
        tableName: 'PasswordResetTokens',
      }
    );
  }

  static associate(db) {
    db.Usuario.hasMany(db.PasswordResetToken, { foreignKey: 'usuarioId' });
    db.PasswordResetToken.belongsTo(db.Usuario, { foreignKey: 'usuarioId' });
  }

  /**
   * Indica si el token puede utilizarse en este momento.
   * Un token invalidado por una solicitud posterior nunca es utilizable.
   * @param {Date} [ahora] - Momento de referencia.
   * @returns {boolean}
   */
  esUtilizable(ahora = new Date()) {
    if (this.usedAt || this.invalidatedAt) return false;
    return this.expiresAt.getTime() > ahora.getTime();
  }

  /**
   * Estado del token para auditoría. No se expone por la API.
   * @param {Date} [ahora] - Momento de referencia.
   * @returns {'invalidado'|'utilizado'|'expirado'|'vigente'}
   */
  estado(ahora = new Date()) {
    if (this.invalidatedAt) return 'invalidado';
    if (this.usedAt) return 'utilizado';
    if (this.expiresAt.getTime() <= ahora.getTime()) return 'expirado';
    return 'vigente';
  }
}
