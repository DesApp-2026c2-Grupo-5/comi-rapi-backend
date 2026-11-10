import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: ProductoIngrediente (receta)
 *
 * Ingredientes y cantidades de un producto simple (modelo-dominio §5.8.3).
 * `cantidad` es lo que lleva UNA unidad del producto, en la `unidadMedida` del
 * ingrediente. La PK compuesta `(productoId, ingredienteId)` evita repetidos.
 *
 * `permiteQuitar` define si el ingrediente aparece como "Sin X" en el detalle.
 * No cambia el descuento de stock: se descuenta la receta completa.
 *
 * Sólo aplica a `Producto.tipo = PRODUCTO`; un COMBO no tiene receta de
 * ingredientes.
 */
export default class ProductoIngrediente extends Model {
  static init(sequelize) {
    return super.init(
      {
        productoId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        ingredienteId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        cantidad: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
        },
        permiteQuitar: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'ProductoIngrediente',
        tableName: 'ProductoIngredientes',
      }
    );
  }

  static associate(db) {
    db.ProductoIngrediente.belongsTo(db.Producto, {
      foreignKey: 'productoId',
      as: 'producto',
    });
    db.ProductoIngrediente.belongsTo(db.Ingrediente, {
      foreignKey: 'ingredienteId',
      as: 'ingrediente',
    });
  }
}
