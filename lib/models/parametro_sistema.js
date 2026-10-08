import { Model, DataTypes } from 'sequelize';

/**
 * Parámetros de negocio configurables por el SUPERADMINISTRADOR.
 *
 * Una sola tabla clave-valor (no una tabla por parámetro), según el DER §2.20 y
 * modelo-dominio §5.17: `id` (PK), `clave` (única), `valor` y `descripcion`.
 * `clave` es el nombre estable que usa el código para leer el valor. El `valor`
 * se guarda siempre como texto y se interpreta según el catálogo de
 * `lib/services/parametros_service.js` (que define tipo, descripción, unidad y
 * valor por defecto de cada clave). Así la metadata no se duplica y no puede
 * quedar desincronizada con la base.
 */
export default class ParametroSistema extends Model {
  static init(sequelize) {
    return super.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        clave: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        valor: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        descripcion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'ParametroSistema',
        tableName: 'ParametrosSistema',
      }
    );
  }

  static associate() {}
}
