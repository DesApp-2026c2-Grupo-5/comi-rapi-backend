import { Model, DataTypes } from 'sequelize';

export default class Promocion extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        descripcion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        tipo: {
          type: DataTypes.ENUM('DESCUENTO_PORCENTUAL', 'DOS_POR_UNO'),
          allowNull: false,
        },
        valor: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        fechaInicio: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        fechaFin: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        activa: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'Promocion',
        tableName: 'Promociones',
      }
    );
  }

  static associate(db) {
    db.Promocion.hasMany(db.PromocionProducto, {
      foreignKey: 'promocionId',
      as: 'productos',
    });
    db.Promocion.hasMany(db.PedidoPromocion, {
      foreignKey: 'promocionId',
      as: 'pedidos',
    });
    db.Promocion.belongsToMany(db.Producto, {
      through: db.PromocionProducto,
      foreignKey: 'promocionId',
      otherKey: 'productoId',
      as: 'Productos',
    });
  }
}
