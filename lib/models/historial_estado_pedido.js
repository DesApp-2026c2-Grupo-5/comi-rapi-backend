import { Model, DataTypes } from 'sequelize';

// Archivo legacy `historial_estado_pedido.js` → entidad DER `PedidoEstadoHistorial`.
export default class PedidoEstadoHistorial extends Model {
  static init(sequelize) {
    return super.init(
      {
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        estadoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        fechaHora: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        observacion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'PedidoEstadoHistorial',
        tableName: 'PedidoEstadoHistorials',
      }
    );
  }

  static associate(db) {
    db.PedidoEstadoHistorial.belongsTo(db.Pedido, { foreignKey: 'pedidoId' });
    db.PedidoEstadoHistorial.belongsTo(db.EstadoPedido, {
      foreignKey: 'estadoId',
    });
    db.PedidoEstadoHistorial.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
    });
  }
}
