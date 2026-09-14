import { Model, DataTypes } from 'sequelize';

export default class Usuario extends Model {
  static init(sequelize) {
    return super.init(
      {
        nombre: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        apellido: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        password: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        telefono: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        rol: {
          type: DataTypes.ENUM('CLIENTE', 'ADMINISTRADOR'),
          allowNull: false,
          defaultValue: 'CLIENTE',
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        fechaNacimiento: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        edad: {
          type: new DataTypes.VIRTUAL(DataTypes.INTEGER, ['fechaNacimiento']),
          get() {
            const fecha = this.get('fechaNacimiento');
            if (!fecha) return null;
            return Math.floor(
              (new Date() - new Date(fecha)) / (1000 * 60 * 60 * 24 * 365.25)
            );
          },
        },
      },
      {
        sequelize,
        modelName: 'Usuario',
      }
    );
  }
}
