import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: HorarioSucursal
 *
 * Franja de atención de una sucursal (DER, relación `Sucursal 1:N
 * HorarioSucursal`). Reemplaza al viejo `Sucursales.horarios` de texto libre.
 *
 * - `diaSemana`: 1 = lunes … 7 = domingo (ISO-8601).
 * - `apertura` / `cierre`: TIME del horario REAL del local. El corte de pedidos
 *   se deriva restando el parámetro global `margenCierreMinutos`
 *   (ver `lib/services/horarios_service.js`).
 * - `cierre` tiene que ser posterior a `apertura`: la franja empieza y termina
 *   el mismo día. Un lunes no puede cerrar a la 01:00 del martes.
 *
 * Una sucursal sin franjas está cerrada.
 */
export default class HorarioSucursal extends Model {
  static init(sequelize) {
    return super.init(
      {
        sucursalId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        diaSemana: {
          type: DataTypes.INTEGER,
          allowNull: false,
          validate: {
            min: 1,
            max: 7,
          },
        },
        apertura: {
          type: DataTypes.TIME,
          allowNull: false,
        },
        cierre: {
          type: DataTypes.TIME,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'HorarioSucursal',
        tableName: 'HorarioSucursales',
      }
    );
  }

  static associate(db) {
    db.HorarioSucursal.belongsTo(db.Sucursal, {
      foreignKey: 'sucursalId',
      as: 'sucursal',
    });
  }
}
