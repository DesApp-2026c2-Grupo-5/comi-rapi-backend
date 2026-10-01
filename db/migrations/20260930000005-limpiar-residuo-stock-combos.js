'use strict';

// Limpia objetos de una versión de Stocks/ComboComponentes que se descartó y
// nunca llegó a reversarse en la base: la columna `reservadoCombos`, que el DER
// no define, dos constraints redundantes y dos filas fantasma en SequelizeMeta.
// No es reversible: restituiría justo lo que esta migración elimina.

module.exports = {
  up: async (queryInterface) => {
    const query = (sql) => queryInterface.sequelize.query(sql);

    await query(
      `ALTER TABLE "Stocks" DROP CONSTRAINT IF EXISTS "stocks_reservado_maximo"`
    );
    await query(
      `ALTER TABLE "Stocks" DROP CONSTRAINT IF EXISTS "stocks_reservado_no_negativo"`
    );
    await query(
      `ALTER TABLE "Stocks" DROP CONSTRAINT IF EXISTS "stocks_cantidad_no_negativa"`
    );
    await query(
      `ALTER TABLE "ComboComponentes" DROP CONSTRAINT IF EXISTS "combo_componentes_cantidad_check"`
    );

    await query(`ALTER TABLE "Stocks" DROP COLUMN IF EXISTS "reservadoCombos"`);

    await query(
      `DELETE FROM "SequelizeMeta" WHERE name IN ('20260929000001-create-stock.js', '20260930000001-create-combo-componente.js')`
    );
  },

  down: async () => {
    throw new Error('20260930000005 no es reversible.');
  },
};
