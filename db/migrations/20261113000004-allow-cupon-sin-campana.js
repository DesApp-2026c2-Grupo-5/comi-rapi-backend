'use strict';

// Migracion 4 de 4: el cupon nuevo ya no pertenece a una campana.
//
// El rediseno reemplazo Campanas/CampanaEjecuciones por CuponEmisiones. La
// migracion 2 hizo el backfill de `Cupones.emisionId`, pero las columnas
// legacy `campanaId` y `ejecucionId` quedaron NOT NULL: cualquier cupon nuevo
// (que solo informa `emisionId`) fallaba al insertarse.
//
// Se conservan las columnas para no perder la trazabilidad historica de los
// cupones que no pudieron vincularse a una unica ejecucion, pero pasan a ser
// opcionales. Los cupones nuevos escriben solo `emisionId`.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('Cupones', 'campanaId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Campanas', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    await queryInterface.changeColumn('Cupones', 'ejecucionId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'CampanaEjecuciones', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Solo se puede revertir si no quedaron cupones nuevos sin campana.
    await queryInterface.changeColumn('Cupones', 'ejecucionId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'CampanaEjecuciones', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    await queryInterface.changeColumn('Cupones', 'campanaId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'Campanas', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
  },
};
