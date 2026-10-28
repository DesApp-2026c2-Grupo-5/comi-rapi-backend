import { Model, DataTypes } from 'sequelize';

/**
 * Plantilla de personalización por categoría.
 *
 * Define los elementos (extra, personalizar, acompañar, condimento) que se
 * copian a PersonalizacionElementos cuando se crea un producto de la categoría.
 */
export default class PersonalizacionCategoria extends Model {
  static init(sequelize) {
    return super.init(
      {
        categoriaId: {
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
        // Insumo con stock propio. Sólo aplica a `extra` y `condimento`; el
        // resto de los tipos lo deja en null.
        insumoId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        minimo: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        maximo: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'PersonalizacionCategoria',
        tableName: 'PersonalizacionCategorias',
      }
    );
  }

  static associate(db) {
    db.PersonalizacionCategoria.belongsTo(db.Categoria, {
      foreignKey: 'categoriaId',
      as: 'categoria',
    });
    db.PersonalizacionCategoria.belongsTo(db.Producto, {
      foreignKey: 'productoReferenciaId',
      as: 'productoReferencia',
    });
    db.PersonalizacionCategoria.belongsTo(db.Insumo, {
      foreignKey: 'insumoId',
      as: 'insumo',
    });
  }
}
