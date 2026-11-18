import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: CuponPreviewToken
 *
 * Registro de un previewToken generado por previewDestinatarios. Se consume
 * una sola vez al confirmar la emisión (emitir), impidiendo que una misma
 * previsualización genere dos emisiones distintas.
 *
 * - `tokenHash`: hash SHA-256 del previewToken (se almacena solo el hash, no
 *   el token plano).
 * - `usado`: indica si el token ya fue consumido en una emisión exitosa.
 * - `expiraEn`: vencimiento del preview (30 minutos desde su creacion).
 */
export default class CuponPreviewToken extends Model {
  static init(sequelize) {
    return super.init(
      {
        tokenHash: {
          type: DataTypes.STRING(128),
          allowNull: false,
        },
        usado: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        expiraEn: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        creadoEn: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        usadoEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'CuponPreviewToken',
        tableName: 'CuponPreviewTokens',
        timestamps: false,
      }
    );
  }
}
