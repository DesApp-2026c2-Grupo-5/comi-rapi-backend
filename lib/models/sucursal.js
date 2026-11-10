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
    // Franjas de atención (DER: Sucursal 1:N HorarioSucursal). Sin filas la
    // sucursal está cerrada; el corte de pedidos se deriva del margen global.
    db.Sucursal.hasMany(db.HorarioSucursal, {
      foreignKey: 'sucursalId',
      as: 'horarios',
    });
    db.Sucursal.hasMany(db.Stock, {
      foreignKey: 'sucursalId',
      as: 'stock',
    });
    db.Sucursal.hasMany(db.InsumoStock, {
      foreignKey: 'sucursalId',
      as: 'stockInsumos',
    });
    db.Sucursal.hasMany(db.IngredienteStock, {
      foreignKey: 'sucursalId',
      as: 'stockIngredientes',
    });
    db.Sucursal.hasMany(db.Usuario, {
      foreignKey: 'sucursalId',
      as: 'administradores',
    });
  }
}
