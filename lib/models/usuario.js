import argon2 from 'argon2';
import { Model, DataTypes } from 'sequelize';
import config from '../config/config';

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
        fotoPerfilUrl: {
          type: DataTypes.STRING,
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
              usuario.password = await argon2.hash(
                usuario.password,
                config.argon2
              );
            }
          },
        },
      }
    );
  }

  static associate(db) {
    db.Usuario.hasMany(db.Direccion, {
      foreignKey: 'usuarioId',
      as: 'direcciones',
    });
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
   *
   * Cuenta con esto: `activo` no se incluye a propósito, porque una sesión
   * autenticada ya implica que el usuario está activo (el middleware lo exige),
   * y `fechaNacimiento` es información privada que el frontend no consume.
   *
   * `fotoPerfilUrl` sí viaja acá: la sesión alimenta el avatar del navbar, que la
   * necesita en cada página sin tener que pedir el perfil aparte. Es la misma URL
   * relativa que ya devuelve datosDePerfil(), no un dato sensible.
   *
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
      fotoPerfilUrl,
    } = this.get();
    return {
      id,
      nombre,
      apellido,
      email,
      telefono,
      rol,
      fotoPerfilUrl,
    };
  }

  /**
   * Devuelve los datos visibles para un administrador (lista de clientes).
   * Excluye sensibles: `password` y `fechaNacimiento` (privada, ver
   * `datosPublicos`). Incluye `activo` para el filtro/badge de estado.
   *
   * @param {number} cantidadPedidos - Total de pedidos del usuario.
   * @returns {object} Datos administrativos.
   */
  datosAdministracion(cantidadPedidos = 0) {
    const {
      id,
      nombre,
      apellido,
      email,
      telefono,
      rol,
      activo,
      fotoPerfilUrl,
      createdAt,
    } = this.get();
    return {
      id,
      nombre,
      apellido,
      email,
      telefono,
      rol,
      activo,
      fotoPerfilUrl,
      creadoEn: createdAt,
      cantidadPedidos,
    };
  }

  toJSON() {
    const values = this.get();
    delete values.password;
    return values;
  }

  /**
   * Devuelve únicamente los datos del perfil (sección "Mi perfil").
   * Incluye fechaNacimiento y fotoPerfilUrl porque son editables por el propio
   * usuario; no incluye `rol` ni `password`. `nombre` y `apellido` aparecen pero
   * solo para lectura: el endpoint de edición los rechaza.
   *
   * @returns {object} Datos del perfil.
   */
  datosDePerfil() {
    const {
      id,
      nombre,
      apellido,
      email,
      telefono,
      fechaNacimiento,
      fotoPerfilUrl,
    } = this.get();
    return {
      id,
      nombre,
      apellido,
      email,
      telefono,
      fechaNacimiento,
      fotoPerfilUrl,
    };
  }
}
