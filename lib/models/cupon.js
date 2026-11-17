import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: Cupon (rediseño).
 *
 * Código personal emitido por una emisión de cupones y enviado por email a un
 * cliente. Guarda snapshot de descuento, vigencia y alcance: editar la emisión
 * después no cambia lo ya entregado.
 *
 * - `emisionId`: FK a `CuponEmisiones` (operación de distribución).
 * - `codigo`: identificador que el cliente ingresa en el carrito (UNIQUE).
 * - `activo`: baja individual del cupón.
 * - `estadoEnvio`: PENDIENTE / ENVIADO / FALLIDO. Es independiente del uso.
 * - `usosPermitidos`: cantidad de pedidos distintos en los que puede usarse.
 *   Los usos efectivos se cuentan desde `PedidoCupon`. Las emisiones nuevas
 *   siempre escriben 1; los históricos conservan su valor original.
 * - `alcanceSnapshot`: JSON con el alcance resuelto congelado al emitir.
 *   `{ global: true }` para cupones heredados (sin alcance de producto/categoría);
 *   `{ global: false, productoIdsResueltos: [...], categoriaIds: [...] }`
 *   para los nuevos.
 *
 * El estado visible (ANULADO / VENCIDO / USADO / EN_USO / DISPONIBLE / PROGRAMADO)
 * se deriva en el service con esa prioridad exacta; no se persiste.
 */
export default class Cupon extends Model {
  static init(sequelize) {
    return super.init(
      {
        emisionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        codigo: {
          type: DataTypes.STRING(64),
          allowNull: false,
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
        usosPermitidos: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        activo: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        estadoEnvio: {
          type: DataTypes.ENUM('PENDIENTE', 'ENVIADO', 'FALLIDO'),
          allowNull: false,
          defaultValue: 'PENDIENTE',
        },
        enviadoEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        errorEnvio: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        alcanceSnapshot: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: { global: true },
        },
      },
      {
        sequelize,
        modelName: 'Cupon',
        tableName: 'Cupones',
      }
    );
  }

  static associate(db) {
    db.Cupon.belongsTo(db.CuponEmision, {
      foreignKey: 'emisionId',
      as: 'emision',
    });
    db.Cupon.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
    db.Cupon.hasMany(db.PedidoCupon, {
      foreignKey: 'cuponId',
      as: 'usos',
    });
  }
}
