import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Queja (DER §2.23).
 *
 * Reclamo de un CLIENTE sobre un pedido propio que ya fue entregado.
 *
 * - `motivo`: categoría fija del reclamo (ENUM).
 * - `detalle`: texto obligatorio, entre 10 y 1000 caracteres (se valida en el
 *   service).
 * - `estado`: `PENDIENTE` → `EN_REVISION` → `RESUELTA` / `RECHAZADA`.
 *   `CERRADA` es el cierre del cliente. Todos los finales lo son.
 * - `respuesta`, `respondidoPorId` y `respondidaEn`: última respuesta del
 *   negocio (se replica en el hilo `QuejaMensajes`).
 *
 * Un pedido admite como máximo UNA queja (UNIQUE `pedidoId`).
 */
export default class Queja extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        motivo: {
          type: DataTypes.ENUM(
            'PEDIDO_INCOMPLETO',
            'PRODUCTO_EN_MAL_ESTADO',
            'DEMORA_EN_LA_ENTREGA',
            'ERROR_DE_COBRO',
            'OTRO'
          ),
          allowNull: false,
        },
        detalle: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        estado: {
          type: DataTypes.ENUM(
            'PENDIENTE',
            'EN_REVISION',
            'RESUELTA',
            'RECHAZADA',
            'CERRADA'
          ),
          allowNull: false,
          defaultValue: 'PENDIENTE',
        },
        respuesta: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        respondidoPorId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        respondidaEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        cerradaEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'Queja',
        tableName: 'Quejas',
      }
    );
  }

  static associate(db) {
    db.Queja.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'autor',
    });
    db.Queja.belongsTo(db.Usuario, {
      foreignKey: 'respondidoPorId',
      as: 'respondidoPor',
    });
    db.Queja.belongsTo(db.Pedido, {
      foreignKey: 'pedidoId',
      as: 'pedido',
    });
    db.Queja.hasMany(db.QuejaMensaje, {
      foreignKey: 'quejaId',
      as: 'mensajes',
    });
  }
}
