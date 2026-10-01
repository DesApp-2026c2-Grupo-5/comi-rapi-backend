import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Stock
 *
 * Existencias de un producto en una sucursal (DER §2.10).
 *
 * La clave es compuesta `(sucursalId, productoId)`: una sucursal tiene su
 * propia cantidad de cada producto y el mismo producto puede tener números
 * distintos en cada una.
 *
 * - `cantidad`: cuántas unidades hay físicamente.
 * - `disponible`: si la sucursal ofrece el producto. `disponible = false` lo
 *   saca del catálogo de esa sucursal, aunque `cantidad` valga.
 *
 * Un combo también tiene fila de stock, pero su `cantidad` es un tope: lo que
 * la sucursal puede armar sale del stock de los componentes. Ver
 * `lib/services/stock.js`.
 */
export default class Stock extends Model {
  static init(sequelize) {
    return super.init(
      {
        sucursalId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        productoId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        cantidad: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          validate: { min: 0 },
        },
        disponible: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'Stock',
        tableName: 'Stocks',
      }
    );
  }

  /**
   * Unidades que la sucursal realmente ofrece: si el producto está dado de
   * baja para esa sucursal, no hay existencias aunque `cantidad` valga.
   */
  get cantidadOfrecida() {
    return this.disponible ? this.cantidad : 0;
  }

  static associate(db) {
    this.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'Sucursal',
    });
    this.belongsTo(db.Producto, {
      foreignKey: 'productoId',
      as: 'Producto',
    });
  }
}
