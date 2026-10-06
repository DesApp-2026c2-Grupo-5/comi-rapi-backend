import { Model, DataTypes } from 'sequelize';

export default class Pedido extends Model {
  static init(sequelize) {
    return super.init(
      {
        usuarioId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        sucursalId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        fechaHora: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        estadoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        costoEnvio: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
        },
        total: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        medioPago: {
          type: DataTypes.ENUM('MERCADO_PAGO', 'TARJETA'),
          allowNull: true,
        },
        observacion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        calle: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        altura: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        ciudad: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        codigoPostal: {
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
        // T2: tiempo estimado de entrega en minutos
        // (cocina + viaje por ruta). NULL si ORS falló o si el pedido no
        // fue confirmado aún.
        etaMinutos: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        // T2: timestamp del cálculo — base para mostrar "llegada ~HH:MM".
        etaCalculadoEn: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'Pedido',
        tableName: 'Pedidos',
      }
    );
  }

  static associate(db) {
    db.Pedido.belongsTo(db.Usuario, {
      foreignKey: 'usuarioId',
      as: 'cliente',
    });
    db.Pedido.belongsTo(db.Sucursal, { foreignKey: 'sucursalId' });
    db.Pedido.belongsTo(db.EstadoPedido, {
      foreignKey: 'estadoId',
      as: 'estadoActual',
    });
    db.Pedido.hasMany(db.PedidoItem, { foreignKey: 'pedidoId', as: 'items' });
    db.Pedido.hasMany(db.PedidoEstadoHistorial, {
      foreignKey: 'pedidoId',
      as: 'historial',
    });
    db.Pedido.hasMany(db.PedidoPromocion, {
      foreignKey: 'pedidoId',
      as: 'promociones',
    });
  }
}
