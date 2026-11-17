import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: CuponEmision (reemplaza a CampanaEjecucion y absorbe Campana).
 *
 * Cabecera de una operación de distribución de cupones. Cada fila representa
 * un cupón que el SUPERADMIN configuró y emitió directamente (sin concepto de
 * campaña reutilizable). Es autocontenida: guarda la configuración, el alcance
 * resuelto y los destinatarios aprobados en `configuracionSnapshot`.
 *
 * - `configuracionSnapshot.destinatariosIds`: lista de IDs de clientes
 *   aprobados en la preview y confirmados al emitir. No se vuelve a consultar
 *   el ranking al confirmar.
 * - `configuracionSnapshot.alcance`: { categoriaIds, productoIds,
 *   productoIdsResueltos } congelado para la emisión.
 * - `estado`: EN_PROCESO mientras se envía; COMPLETADA si no quedan pendientes
 *   ni fallidos; CON_ERRORES en caso contrario.
 * - `bloqueoToken` / `bloqueoExpiraEn`: lease atómico para reintentos.
 */
export default class CuponEmision extends Model {
  static init(sequelize) {
    return super.init(
      {
        creadaPorUsuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        nombre: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        descripcion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        tipoDescuento: {
          type: DataTypes.ENUM('PORCENTAJE', 'MONTO_FIJO'),
          allowNull: false,
        },
        valorDescuento: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        compraMinima: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        descuentoMaximo: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        fechaInicio: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        fechaFin: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        maxDestinatarios: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        periodoAnalisisDias: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        cantidadElegibles: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        cantidadCupones: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        cantidadEnviados: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        cantidadFallidos: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        estado: {
          type: DataTypes.ENUM('EN_PROCESO', 'COMPLETADA', 'CON_ERRORES'),
          allowNull: false,
          defaultValue: 'EN_PROCESO',
        },
        configuracionSnapshot: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        bloqueoToken: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        bloqueoExpiraEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'CuponEmision',
        tableName: 'CuponEmisiones',
      }
    );
  }

  static associate(db) {
    db.CuponEmision.belongsTo(db.Usuario, {
      foreignKey: 'creadaPorUsuarioId',
      as: 'creadaPor',
    });
    db.CuponEmision.hasMany(db.Cupon, {
      foreignKey: 'emisionId',
      as: 'cupones',
    });
  }
}
