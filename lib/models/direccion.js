import { Model, DataTypes } from 'sequelize';

export default class Direccion extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        calle: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        altura: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        ciudad: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        codigoPostal: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        referencia: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        latitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
        },
        longitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
        },
        alias: {
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
        modelName: 'Direccion',
        tableName: 'Direcciones',
      }
    );
  }

  static associate(db) {
    db.Direccion.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
    db.Usuario.hasMany(db.Direccion, {
      foreignKey: 'usuarioId',
      as: 'direcciones',
    });
  }
}
