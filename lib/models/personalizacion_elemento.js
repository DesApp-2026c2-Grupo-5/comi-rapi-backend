import { Model, DataTypes } from 'sequelize';

export default class PersonalizacionElemento extends Model {
  static init(sequelize) {
    return super.init(
      {
        productoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        tipo: {
          type: DataTypes.ENUM(
            'extra',
            'personalizar',
            'acompanar',
            'condimento'
          ),
          allowNull: false,
        },
        nombre: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        precio: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        productoReferenciaId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'PersonalizacionElemento',
        tableName: 'PersonalizacionElementos',
      }
    );
  }

  static associate(db) {
    db.PersonalizacionElemento.belongsTo(db.Producto, {
      foreignKey: 'productoId',
      as: 'producto',
    });
    db.PersonalizacionElemento.belongsTo(db.Producto, {
      foreignKey: 'productoReferenciaId',
      as: 'productoReferencia',
    });
  }
}
