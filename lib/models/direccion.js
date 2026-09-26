import { Model, DataTypes } from 'sequelize';

export default class Direccion extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        sucursalId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        calle: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        altura: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        provincia: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        localidad: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        codigoPostal: {
          type: DataTypes.STRING,
          allowNull: false,
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
        validate: {
          unSoloPropietario() {
            const conUsuario =
              this.usuarioId !== null && this.usuarioId !== undefined;
            const conSucursal =
              this.sucursalId !== null && this.sucursalId !== undefined;
            if (conUsuario === conSucursal) {
              throw new Error(
                'La dirección debe pertenecer a un usuario o a una sucursal, no a ambos ni a ninguno'
              );
            }
          },
        },
      }
    );
  }

  static associate(db) {
    db.Direccion.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
    db.Direccion.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'sucursal',
    });
  }
}
