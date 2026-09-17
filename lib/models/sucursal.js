import { Model, DataTypes } from 'sequelize';

export default class Sucursal extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        direccion: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        latitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
        },
        longitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
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
  }
}
