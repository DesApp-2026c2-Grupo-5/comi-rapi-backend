import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: IngredienteStock
 *
 * Existencias de un ingrediente en una sucursal (DER §2.10.4). Misma idea que
 * `Stock` e `InsumoStock`: PK compuesta `(sucursalId, ingredienteId)` y una
 * cantidad por sucursal.
 *
 * - `cantidad`: decimal con 3 posiciones; nunca negativa (CHECK en migración).
 * - `disponible`: si la sucursal ofrece el ingrediente. Apagarlo lo vuelve 0
 *   para el cálculo y la venta, aunque queden unidades.
 *
 * Un ingrediente sin fila en la sucursal o dado de baja también cuenta como 0.
 */
export default class IngredienteStock extends Model {
  static init(sequelize) {
    return super.init(
      {
        sucursalId: {
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
          defaultValue: 0,
          validate: {
            min: 0,
          },
        },
        disponible: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'IngredienteStock',
        tableName: 'IngredienteStocks',
      }
    );
  }

  static associate(db) {
    db.IngredienteStock.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'sucursal',
    });
    db.IngredienteStock.belongsTo(db.Ingrediente, {
      foreignKey: 'ingredienteId',
      as: 'ingrediente',
    });
  }
}
