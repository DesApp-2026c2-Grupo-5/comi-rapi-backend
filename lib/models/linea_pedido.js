import { Model, DataTypes } from 'sequelize';

// Archivo legacy `linea_pedido.js` → entidad DER `PedidoItem`.
// Se mantiene el nombre de archivo por pedido del equipo; el modelo es PedidoItem.
export default class PedidoItem extends Model {
  static init(sequelize) {
    return super.init(
      {
        pedidoId: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        productoId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        nombreProducto: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        precioUnitario: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        cantidad: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        subtotal: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        // Snapshot de la personalización elegida (JSON): extras, acompañamientos,
        // sin y condimentos. `lib/services/stock.js` lo lee para descontar insumos.
        observacion: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        // Nota libre del cliente para cocina ("sin sal", "bien cocida").
        // Separada de `observacion` para no pisar el snapshot de personalización.
        nota: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        modelName: 'PedidoItem',
        tableName: 'PedidoItems',
      }
    );
  }

  static associate(db) {
    db.PedidoItem.belongsTo(db.Pedido, { foreignKey: 'pedidoId' });
    db.PedidoItem.belongsTo(db.Producto, { foreignKey: 'productoId' });
  }
}
