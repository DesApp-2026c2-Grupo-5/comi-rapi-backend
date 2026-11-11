import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Ingrediente
 *
 * Materia prima del catálogo (modelo-dominio §5.8.2). No es un `Producto` ni un
 * `Insumo`: no se vende solo y no tiene precio.
 *
 * - `nombre`: único sin distinguir mayúsculas (índice funcional en la
 *   migración). Se normaliza en el service antes de guardar.
 * - `unidadMedida`: `unidad`, `g`, `kg`, `ml` o `l`. No hay conversión entre
 *   unidades; la receta usa siempre la unidad del ingrediente.
 * - `activo`: baja lógica. Un ingrediente inactivo cuenta como stock 0.
 */
export const UNIDADES_MEDIDA = ['unidad', 'g', 'kg', 'ml', 'l'];

export default class Ingrediente extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
          validate: {
            notEmpty: true,
          },
        },
        unidadMedida: {
          type: DataTypes.ENUM(...UNIDADES_MEDIDA),
          allowNull: false,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'Ingrediente',
        tableName: 'Ingredientes',
      }
    );
  }

  static associate(db) {
    db.Ingrediente.hasMany(db.IngredienteStock, {
      foreignKey: 'ingredienteId',
      as: 'stocks',
    });
    db.Ingrediente.hasMany(db.ProductoIngrediente, {
      foreignKey: 'ingredienteId',
      as: 'recetas',
    });
    db.Ingrediente.belongsToMany(db.Producto, {
      through: db.ProductoIngrediente,
      foreignKey: 'ingredienteId',
      otherKey: 'productoId',
      as: 'productos',
    });
    db.Ingrediente.hasMany(db.PersonalizacionElemento, {
      foreignKey: 'ingredienteId',
      as: 'elementos',
    });
  }
}
