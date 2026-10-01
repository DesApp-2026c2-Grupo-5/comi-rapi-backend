import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: ComboComponente
 *
 * Composición de un combo (DER §2.6): qué productos lo arman y cuántos lleva
 * cada uno.
 *
 * `comboId` y `productoId` son dos FKs a `Productos`; la auto-referencia
 * distingue el rol de "combo" del de "componente". `cantidad` es cuántas
 * unidades del componente van en UNA unidad del combo.
 */
export default class ComboComponente extends Model {
  static init(sequelize) {
    return super.init(
      {
        comboId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        productoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        cantidad: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          validate: { min: 1 },
        },
      },
      {
        sequelize,
        modelName: 'ComboComponente',
        tableName: 'ComboComponentes',
        indexes: [{ unique: true, fields: ['comboId', 'productoId'] }],
      }
    );
  }

  static associate(db) {
    this.belongsTo(db.Producto, {
      foreignKey: 'comboId',
      as: 'Combo',
    });
    this.belongsTo(db.Producto, {
      foreignKey: 'productoId',
      as: 'Producto',
    });
  }
}
