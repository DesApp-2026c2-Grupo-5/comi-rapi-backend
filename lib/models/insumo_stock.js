import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: InsumoStock
 *
 * Existencias de un insumo en una sucursal. Misma idea que `Stock`: la PK es
 * compuesta `(sucursalId, insumoId)` y cada sucursal tiene su propia cantidad.
 *
 * - `cantidad`: unidades físicas. Nunca negativa (CHECK en la migración).
 * - `disponible`: si la sucursal ofrece el insumo. Apagarlo lo vuelve agotado
 *   para esa sucursal, aunque queden unidades.
 *
 * Un insumo está "agotado" para el cliente cuando la suma de sus filas
 * disponibles en sucursales activas es 0 (ver
 * `lib/services/disponibilidad_insumos.js`).
 */
export default class InsumoStock extends Model {
  static init(sequelize) {
    return super.init(
      {
        sucursalId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        insumoId: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          allowNull: false,
        },
        cantidad: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        disponible: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'InsumoStock',
        tableName: 'InsumoStocks',
      }
    );
  }

  static associate(db) {
    db.InsumoStock.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'sucursal',
    });
    db.InsumoStock.belongsTo(db.Insumo, {
      foreignKey: 'insumoId',
      as: 'insumo',
    });
  }
}
