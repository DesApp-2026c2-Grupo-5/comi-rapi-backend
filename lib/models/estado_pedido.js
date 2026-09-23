import { Model, DataTypes } from 'sequelize';

export default class EstadoPedido extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        orden: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        esInicial: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        esFinal: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'EstadoPedido',
        tableName: 'EstadoPedidos',
      }
    );
  }

  static associate(db) {
    db.EstadoPedido.hasMany(db.Pedido, { foreignKey: 'estadoId' });
    db.EstadoPedido.hasMany(db.PedidoEstadoHistorial, {
      foreignKey: 'estadoId',
    });
  }
}
