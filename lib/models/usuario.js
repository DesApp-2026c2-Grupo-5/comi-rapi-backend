import argon2 from 'argon2';
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
        hooks: {
          async beforeSave(usuario) {
            if (usuario.password && usuario.changed('password')) {
              usuario.password = await argon2.hash(usuario.password);
            }
          },
        },
      }
    );
  }

  /**
   * Verifica una contraseña en texto plano contra el hash Argon2id almacenado.
   * @param {string} passwordPlana - Contraseña ingresada por el usuario.
   * @returns {Promise<boolean>} true si coincide.
   */
  async verificarPassword(passwordPlana) {
    if (!this.password || typeof passwordPlana !== 'string') {
      return false;
    }
    try {
      return await argon2.verify(this.password, passwordPlana);
    } catch (error) {
      return false;
    }
  }

  /**
   * Devuelve únicamente los datos públicos del usuario (sin password/hash).
   * @returns {object} Datos públicos.
   */
  datosPublicos() {
    const {
      id,
      nombre,
      apellido,
      email,
      telefono,
      rol,
      activo,
      fechaNacimiento,
    } = this.get();
    return {
      id,
      nombre,
      apellido,
      email,
      telefono,
      rol,
      activo,
      fechaNacimiento,
    };
  }

  toJSON() {
    const values = this.get();
    delete values.password;
    return values;
  }
}
