import { Model, DataTypes } from 'sequelize';

export default class Categoria extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        descripcion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'Categoria',
        tableName: 'Categorias',
      }
    );
  }

  static associate(db) {
    db.Categoria.hasMany(db.Producto, { foreignKey: 'categoriaId' });
  }
}
