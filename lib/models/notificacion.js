import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Notificacion (DER §2.24).
 *
 * Aviso dirigido a un usuario (en la práctica, el CLIENTE dueño del pedido o
 * del reclamo). El centro de notificaciones del frontend lista estas filas y
 * el badge del header cuenta las que tienen `leida = false`.
 *
 * - `tipo`: PEDIDO (cambio de estado), QUEJA (respuesta o cambio de estado del
 *   reclamo) o SISTEMA (avisos internos).
 * - `pedidoId` / `quejaId`: destino del clic. Son opcionales para que un aviso
 *   de sistema no dependa de una entidad de negocio.
 * - `leida` / `leidaEn`: estado de lectura persistido por usuario, no por
 *   dispositivo.
 *
 * La creación de avisos vive en `lib/services/notificaciones.js`; este modelo
 * no decide cuándo notificar.
 */
export default class Notificacion extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        tipo: {
          type: DataTypes.ENUM('PEDIDO', 'QUEJA', 'SISTEMA'),
          allowNull: false,
          defaultValue: 'SISTEMA',
        },
        titulo: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        mensaje: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        quejaId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        leida: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        leidaEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'Notificacion',
        tableName: 'Notificaciones',
      }
    );
  }

  static associate(db) {
    db.Notificacion.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
    db.Notificacion.belongsTo(db.Pedido, {
      foreignKey: 'pedidoId',
      as: 'pedido',
    });
    db.Notificacion.belongsTo(db.Queja, {
      foreignKey: 'quejaId',
      as: 'queja',
    });
  }
}
