import { Model, DataTypes } from 'sequelize';

export default class Producto extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        precio: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        imagen: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        descripcion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        categoriaId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        tipo: {
          type: DataTypes.ENUM('PRODUCTO', 'COMBO'),
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'Producto',
        tableName: 'Productos',
      }
    );
  }

  static associate(db) {
    db.Producto.belongsTo(db.Categoria, {
      foreignKey: 'categoriaId',
      as: 'Categoria',
    });
  }
}
