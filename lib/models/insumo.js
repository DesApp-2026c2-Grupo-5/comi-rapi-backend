import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Insumo
 *
 * Extras y condimentos con stock propio. Es una extensión del modelo aprobado:
 * no reemplaza a `Producto` (no se vende solo) ni a `PersonalizacionElemento`
 * (que sigue definiendo cómo se ofrece en cada producto).
 *
 * - `tipo`: `extra` (cobra y descuenta stock) o `condimento` (gratis y descuenta
 *   stock). Acompañamientos e ingredientes quedan fuera del insumo.
 * - `precio`: precio de referencia que el formulario de personalización
 *   precarga en el elemento. El elemento puede pisarlo.
 * - `activo`: baja lógica. Un insumo inactivo se considera agotado en el modal.
 *
 * `(nombre, tipo)` es único: el mismo nombre puede existir como extra y como
 * condimento, pero no duplicarse dentro de un tipo.
 */
export default class Insumo extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        tipo: {
          type: DataTypes.ENUM('extra', 'condimento'),
          allowNull: false,
        },
        precio: {
          type: DataTypes.DECIMAL(10, 2),
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
        modelName: 'Insumo',
        tableName: 'Insumos',
        indexes: [
          {
            unique: true,
            fields: ['nombre', 'tipo'],
            name: 'insumos_nombre_tipo_unique',
          },
        ],
      }
    );
  }

  static associate(db) {
    db.Insumo.hasMany(db.InsumoStock, {
      foreignKey: 'insumoId',
      as: 'stocks',
    });
    db.Insumo.hasMany(db.PersonalizacionElemento, {
      foreignKey: 'insumoId',
      as: 'elementos',
    });
    db.Insumo.hasMany(db.PersonalizacionCategoria, {
      foreignKey: 'insumoId',
      as: 'plantillas',
    });
  }
}
