'use strict';

// Limpia el rastro que quedó en la base de un trabajo que se descartó.
//
// Hace unos días se implementó una versión de `Stocks` y `ComboComponentes`
// que después se descartó y se revirtió a nivel de código. La reversión llegó
// hasta el repo, pero nunca hasta Postgres: las bases de desarrollo y test
// quedaron con objetos de aquella versión. Este trabajo volvió a crear las
// tablas con migraciones propias, así que hoy conviven dos capas.
//
// Qué dejó el trabajo descartado y sobra:
//
// 1. `Stocks.reservadoCombos`, una columna que no está en `docs/DER.md`, que el
//    modelo Sequelize no declara y que ningún service lee ni escribe. Con su
//    CHECK (`reservadoCombos <= cantidad`) hacía que bajar la cantidad de un
//    producto por debajo del valor reservado fallara con un error de Postgres
//    crudo, del tipo `violates check constraint "stocks_reservado_maximo"`, sin
//    sentido para quien está cargando stock.
//
// 2. Constraints duplicadas o redundantes: `stocks_cantidad_no_negativa`
//    (igual que `CK_Stocks_cantidad`) y `combo_componentes_cantidad_check`
//    (la versión discarded de la que `CK_ComboComponentes_cantidad` ya se
//    ocupa, y que la migración 20260930000004 deja en `>= 1`).
//
// 3. Dos registros en `SequelizeMeta` de migraciones que ya no existen en el
//    repo, así que `db:migrate:status` las daba por aplicadas sin que hubiera
//    archivo que las respaldara.
//
// Ninguna de las tres cosas es recuperable: `reservadoCombos` nunca tuvo un
// modelo ni una regla que la respaldara, y las filas de `SequelizeMeta` apuntan
// a archivos borrados. Se borran en vez de migrarse.
//
// down() no restituye nada: volver a dejar `reservadoCombos` sin el código que
// la mantendría volvería a introducir el error que esta migración elimina.

module.exports = {
  up: async (queryInterface) => {
    const query = (sql) => queryInterface.sequelize.query(sql);

    // 1. Constraints del trabajo descartado.
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

    // 2. Columna que el DER no define. Los CHECK que la vigilarían ya están
    //    caídos arriba, así que se puede quitar sin referencias colgantes.
    await query(`ALTER TABLE "Stocks" DROP COLUMN IF EXISTS "reservadoCombos"`);

    // 3. Migraciones fantasma en SequelizeMeta.
    await query(
      `DELETE FROM "SequelizeMeta" WHERE name IN ('20260929000001-create-stock.js', '20260930000001-create-combo-componente.js')`
    );
  },

  down: async () => {
    throw new Error(
      '20260930000005 no se puede revertir: restituiría reservadoCombos y las ' +
        'constraints del trabajo descartado, que es justo lo que se limpia.'
    );
  },
};
