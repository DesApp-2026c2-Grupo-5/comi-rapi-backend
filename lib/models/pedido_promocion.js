import { Model, DataTypes } from 'sequelize';

export default class PedidoPromocion extends Model {
  static init(sequelize) {
    return super.init(
      {
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        promocionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        descuentoAplicado: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'PedidoPromocion',
        tableName: 'PedidoPromociones',
      }
    );
  }

  static associate(db) {
    db.PedidoPromocion.belongsTo(db.Pedido, {
      foreignKey: 'pedidoId',
    });
    db.PedidoPromocion.belongsTo(db.Promocion, {
      foreignKey: 'promocionId',
    });
  }
}
