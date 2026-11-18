import { Model, DataTypes } from 'sequelize';

/**
 * Modelo: PedidoCupon (Sprint 5).
 *
 * Ciclo de uso de un cupón dentro de un pedido. No existe una entidad
 * `CuponUso` separada: `PedidoCupon` guarda la reserva, la confirmación y la
 * liberación.
 *
 * - `RESERVADO`: tomado al crear el pedido pendiente. Cuenta como uso activo
 *   solo mientras el pedido siga pendiente y la reserva no haya vencido.
 * - `CONFIRMADO`: el pago se confirmó; cuenta como uso efectivo.
 * - `LIBERADO`: el pedido se canceló o el cupón dejó de ser válido; no cuenta.
 *
 * `pedidoId` es UNIQUE (un cupón por pedido). Las columnas de descuento son
 * snapshot para reconstruir el cálculo aunque el cupón o la campaña cambien.
 * `usuarioId` identifica al cliente dueño del uso y permite consultar sus
 * pedidos con cupón sin depender del join a `Pedidos`.
 */
export default class PedidoCupon extends Model {
  static init(sequelize) {
    return super.init(
      {
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        cuponId: {
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
        },
        descuentoMaximo: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        baseCalculo: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        descuentoAplicado: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        estado: {
          type: DataTypes.ENUM('RESERVADO', 'CONFIRMADO', 'LIBERADO'),
          allowNull: false,
          defaultValue: 'RESERVADO',
        },
        reservadoEn: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        confirmadoEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        liberadoEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'PedidoCupon',
        tableName: 'PedidoCupones',
      }
    );
  }

  static associate(db) {
    db.PedidoCupon.belongsTo(db.Pedido, {
      foreignKey: 'pedidoId',
      as: 'pedido',
    });
    db.PedidoCupon.belongsTo(db.Cupon, {
      foreignKey: 'cuponId',
      as: 'cupon',
    });
    db.PedidoCupon.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
  }
}
