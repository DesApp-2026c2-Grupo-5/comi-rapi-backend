import { Model, DataTypes } from 'sequelize';

export default class Sucursal extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        telefono: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        horarios: {
          type: DataTypes.STRING,
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
        modelName: 'Sucursal',
        tableName: 'Sucursales',
      }
    );
  }

  static associate(db) {
    db.Sucursal.hasMany(db.Pedido, { foreignKey: 'sucursalId' });
    db.Sucursal.hasOne(db.Direccion, {
      foreignKey: 'sucursalId',
      as: 'direccion',
    });
  }
}
