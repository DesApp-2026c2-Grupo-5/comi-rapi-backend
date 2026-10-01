import { Model, DataTypes } from 'sequelize';

export default class Direccion extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        sucursalId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        calle: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        altura: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        provincia: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        // Iteración 1-geo: unidad territorial intermedia según Georef (el
        // `departamento` que devuelve/acepta /api/direcciones): partido en
        // Buenos Aires, comuna en CABA, departamento en el resto. Se persiste
        // el nombre normalizado por el backend al geocodificar; nullable para
        // no romper filas existentes (se completa al editar o por backfill).
        departamento: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        // Iteración 1-geo: la localidad pasa a ser determinada por el backend
        // (Georef la devuelve como `localidad_censal` normalizada); deja de
        // ser obligatoria en el ingreso.
        localidad: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        // Iteración 1-geo: Georef no provee el código postal (verificado en
        // su API); deja de exigirse al usuario y pasa a ser opcional.
        codigoPostal: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        // Iteración 1-geo: dirección completa normalizada por Georef, para
        // confirmación del usuario y auditoría.
        nomenclatura: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        referencia: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        latitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
        },
        longitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: true,
        },
        alias: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        activa: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
      },
      {
        sequelize,
        modelName: 'Direccion',
        tableName: 'Direcciones',
        validate: {
          unSoloPropietario() {
            const conUsuario =
              this.usuarioId !== null && this.usuarioId !== undefined;
            const conSucursal =
              this.sucursalId !== null && this.sucursalId !== undefined;
            if (conUsuario === conSucursal) {
              throw new Error(
                'La dirección debe pertenecer a un usuario o a una sucursal, no a ambos ni a ninguno'
              );
            }
          },
        },
      }
    );
  }

  static associate(db) {
    db.Direccion.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
    db.Direccion.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'sucursal',
    });
  }
}
