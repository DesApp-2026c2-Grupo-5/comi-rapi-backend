import { Model, DataTypes } from 'sequelize';

export default class PromocionProducto extends Model {
  static init(sequelize) {
    return super.init(
      {
        promocionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        productoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'PromocionProducto',
        tableName: 'PromocionProductos',
      }
    );
  }

  static associate(db) {
    db.PromocionProducto.belongsTo(db.Promocion, {
      foreignKey: 'promocionId',
    });
    db.PromocionProducto.belongsTo(db.Producto, {
      foreignKey: 'productoId',
    });
  }
}
