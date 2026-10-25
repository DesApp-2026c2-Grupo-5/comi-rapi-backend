import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Resena (DER §2.22).
 *
 * Opinión de un CLIENTE sobre un producto o combo que ya compró y recibió.
 *
 * - `puntuacion`: entero de 1 a 5 (la migración lo refuerza con un CHECK).
 * - `comentario`: opcional, hasta 500 caracteres (se valida en el service).
 * - `pedidoId`: pedido entregado que habilitó la reseña. No es un snapshot:
 *   la reseña se apoya en una compra concreta y se borra si esa compra se
 *   borra (RESTRICT), pero muestra el texto actual del producto.
 *
 * Un cliente tiene como máximo UNA reseña por producto (UNIQUE
 * `usuarioId` + `productoId`); puede editarla o eliminarla.
 */
export default class Resena extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        productoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        puntuacion: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        comentario: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'Resena',
        tableName: 'Resenas',
      }
    );
  }

  static associate(db) {
    db.Resena.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'autor',
    });
    db.Resena.belongsTo(db.Producto, {
      foreignKey: 'productoId',
      as: 'producto',
    });
    db.Resena.belongsTo(db.Pedido, {
      foreignKey: 'pedidoId',
      as: 'pedido',
    });
  }
}
