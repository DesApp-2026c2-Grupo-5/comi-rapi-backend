import { Model, DataTypes } from 'sequelize';

/** Mensaje del hilo de una queja. */
export default class QuejaMensaje extends Model {
  static init(sequelize) {
    return super.init(
      {
        quejaId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        autorId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        contenido: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'QuejaMensaje',
        tableName: 'QuejaMensajes',
      }
    );
  }

  static associate(db) {
    db.QuejaMensaje.belongsTo(db.Queja, {
      foreignKey: 'quejaId',
      as: 'queja',
    });
    db.QuejaMensaje.belongsTo(db.Usuario, {
      foreignKey: 'autorId',
      as: 'autor',
    });
  }
}
