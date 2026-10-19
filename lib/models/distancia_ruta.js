import { Model, DataTypes } from 'sequelize';

/**
 * Caché de distancias por ruta entre sucursales y direcciones de entrega (A1-3).
 *
 * Dato DERIVADO y recomputable, no una entidad de negocio. Cada fila es el
 * resultado de una llamada real al proveedor de routing para un par fijo de
 * coordenadas: origen* = SUCURSAL, destino* = ENTREGA (misma semántica que
 * `routing_service.calcularRuta`). Clave única: (4 coordenadas + proveedor);
 * la lectura filtra siempre por el proveedor activo.
 *
 * `sucursalId` es metadato de trazabilidad (ON DELETE SET NULL): la clave son
 * las coordenadas, no el id. Sin `associate`: es una caché pura, sin
 * relaciones de negocio. Sin TTL y sin DELETE de invalidación: coordenadas
 * nuevas generan claves nuevas y las filas viejas quedan inalcanzables.
 */
export default class DistanciaRuta extends Model {
  static init(sequelize) {
    return super.init(
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        origenLatitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: false,
        },
        origenLongitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: false,
        },
        destinoLatitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: false,
        },
        destinoLongitud: {
          type: DataTypes.DECIMAL(10, 7),
          allowNull: false,
        },
        sucursalId: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        distanciaMetros: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        duracionSegundos: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        proveedor: {
          type: DataTypes.STRING(16),
          allowNull: false,
        },
        calculadoEn: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'DistanciaRuta',
        tableName: 'DistanciasRutas',
      }
    );
  }

  static associate() {}
}
