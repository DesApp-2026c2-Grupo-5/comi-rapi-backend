'use strict';

// Caché de distancias por ruta entre sucursales y direcciones de entrega (A1-3).
//
// Dato DERIVADO y recomputable, no una entidad de negocio: cada fila es el
// resultado de una llamada real al proveedor de routing para un par fijo de
// coordenadas. Clave única: (coords origen, coords destino, proveedor).
//   - origen* = coordenadas de la SUCURSAL (semántica de routing_service).
//   - destino* = coordenadas de ENTREGA (dirección del cliente o snapshot).
// `sucursalId` es metadato de trazabilidad (ON DELETE SET NULL): la clave son
// las coordenadas, no el id; la baja de la sucursal es lógica y no toca la fila.
//
// Sin TTL y SIN DELETE de invalidación: las coordenadas no cambian con el
// tiempo; si una dirección o sucursal se mueve, sus coordenadas nuevas forman
// claves nuevas y las filas viejas quedan simplemente inalcanzables.
//
// La lectura filtra SIEMPRE por el proveedor activo (config.routing.proveedor):
// las distancias de un proveedor nunca se reutilizan para otro (decisión A1).
//
// down(): borra la tabla completa (es caché: se recalcula sola en el próximo uso).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('DistanciasRutas', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      origenLatitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: false,
      },
      origenLongitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: false,
      },
      destinoLatitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: false,
      },
      destinoLongitud: {
        type: Sequelize.DECIMAL(10, 7),
        allowNull: false,
      },
      sucursalId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Sucursales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      distanciaMetros: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      duracionSegundos: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      proveedor: {
        type: Sequelize.STRING(16),
        allowNull: false,
      },
      calculadoEn: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
    await queryInterface.addConstraint('DistanciasRutas', {
      fields: [
        'origenLatitud',
        'origenLongitud',
        'destinoLatitud',
        'destinoLongitud',
        'proveedor',
      ],
      type: 'unique',
      name: 'uq_distancias_rutas_par_proveedor',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('DistanciasRutas');
  },
};
