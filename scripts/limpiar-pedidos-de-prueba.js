'use strict';

/**
 * Borra los pedidos que dejaron las verificaciones end-to-end.
 *
 * Los tests de `test/tiempo-real/` (backend) y `scripts/verificar-tiempo-real.js`
 * (frontend) hablan con la API como lo haría un navegador, así que no pueden
 * borrar lo que crean: no existe `DELETE /api/pedidos`. Como el listado del admin
 * devuelve TODOS los pedidos, esas corridas dejaban el panel lleno de ruido.
 *
 * Por eso los tests invocan este script al terminar.
 *
 * Alcance, a propósito:
 *   - Borra SOLO pedidos de los usuarios de prueba (emails de test, salvo los de
 *     la seeder).
 *   - NO toca los usuarios, sus direcciones ni sus sesiones: los tests las
 *     reutilizan para no chocar con el rate limiter de auth (20 req / 15 min).
 *   - NO toca los pedidos de ejemplo de `cliente@test.com`.
 *
 * Uso: `npm run limpiar:pruebas`
 *      `node scripts/limpiar-pedidos-de-prueba.js --dry-run`
 *
 * Respeta `NODE_ENV`: con `NODE_ENV=test` limpia `SQL_TEST_DATABASE`, nunca la
 * base de desarrollo. La config se toma de `lib/config/config.js` para no
 * duplicarla.
 */

const config = require('../lib/config/config');
const { Sequelize } = require('sequelize');

/**
 * Alcance: usuarios de prueba = cualquier email de test MENOS los de la seeder.
 *
 * Se podría usar un comodín `@test.com` a secas, pero los usuarios de la seeder
 * (`cliente@test.com`, `admin@test.com`) también terminan en `@test.com` y un
 * comodín sin más borra también los 4 pedidos de ejemplo. Por eso se excluyen
 * explícitamente: son un entregable del TP.
 */
const SUFIJO_PRUEBA = '%@test.com';

/** Emails que el script no debe tocar jamás. Aborta si el patrón los matchea. */
const USUARIOS_PROTEGIDOS = ['cliente@test.com', 'admin@test.com'];

/** Hijas de Pedidos: hay que borrarlas antes por las FK. */
const DEPENDIENTES = [
  'PedidoEstadoHistorials',
  'PedidoItems',
  'PedidoPromociones',
];

/**
 * OJO con los paréntesis: en SQL `AND` liga más fuerte que `OR`. Sin ellos, esta
 * condición se leería como `a OR b OR c OR (d AND protegido)` y matchearía
 * cualquier usuario de `a`, `b` o `c`.
 *
 * La lista de protegidos se arma desde `USUARIOS_PROTEGIDOS` a propósito: si
 * alguien agrega un tercer email protegido y no actualiza el SQL, quedaría
 * desprotegido en silencio.
 */
const condicionEmail = `(
  u.email LIKE :cualquiera
  AND lower(u.email) NOT IN (${USUARIOS_PROTEGIDOS.map(
    (_, i) => `:protegido${i}`
  ).join(', ')})
)`;

const replacements = {
  cualquiera: SUFIJO_PRUEBA,
  ...Object.fromEntries(
    USUARIOS_PROTEGIDOS.map((email, i) => [`protegido${i}`, email])
  ),
};

const sequelize = new Sequelize(config.db);

const consultar = (sql, opciones = {}) =>
  sequelize.query(sql, { replacements, ...opciones });

const contarPedidosPrueba = async (opciones) => {
  const [filas] = await consultar(
    `SELECT count(*)::int AS n
       FROM "Pedidos" p JOIN "Usuarios" u ON u.id = p."usuarioId"
      WHERE ${condicionEmail}`,
    opciones
  );
  return filas[0].n;
};

const contarDemo = async (opciones) => {
  const [filas] = await consultar(
    `SELECT count(*)::int AS n FROM "Pedidos" WHERE observacion = 'SEED-EJEMPLO'`,
    opciones
  );
  return filas[0].n;
};

async function main({ dryRun = false } = {}) {
  // Red de seguridad: si el patrón llegara a matchear un usuario protegido, no
  // se toca nada. La condición excluye a los protegidos explícitamente, pero un
  // error acá borraría los pedidos de ejemplo y nadie lo notaría hasta la demo.
  for (const email of USUARIOS_PROTEGIDOS) {
    const [filas] = await consultar(
      `SELECT count(*)::int AS n FROM "Usuarios" u WHERE ${condicionEmail}
        AND lower(u.email) = lower(:email)`,
      { replacements: { ...replacements, email } }
    );
    if (filas[0].n > 0) {
      throw new Error(
        `El patrón de limpieza matchea con el usuario protegido ${email}. Abortando.`
      );
    }
  }

  const total = await contarPedidosPrueba();
  const demoAntes = await contarDemo();
  console.log(
    `Pedidos de prueba (emails ${SUFIJO_PRUEBA} menos los protegidos): ${total}`
  );
  console.log(`Pedidos de ejemplo: ${demoAntes}`);

  if (total === 0) {
    console.log('No hay nada que limpiar.');
    return;
  }

  if (dryRun) {
    console.log('\n(dry-run) No se borra nada. Se borrarían:');
    const [detalle] = await consultar(
      `SELECT u.email, count(*)::int AS n
         FROM "Pedidos" p JOIN "Usuarios" u ON u.id = p."usuarioId"
        WHERE ${condicionEmail}
        GROUP BY u.email ORDER BY n DESC`
    );
    for (const fila of detalle) {
      console.log(`  ${fila.email}: ${fila.n}`);
    }
    return;
  }

  // Una sola transacción: o se borran todos los pedidos de prueba o ninguno.
  await sequelize.transaction(async (t) => {
    for (const tabla of DEPENDIENTES) {
      await consultar(
        `DELETE FROM "${tabla}" WHERE "pedidoId" IN (
           SELECT p.id FROM "Pedidos" p JOIN "Usuarios" u ON u.id = p."usuarioId"
            WHERE ${condicionEmail}
         )`,
        { transaction: t }
      );
    }
    await consultar(
      `DELETE FROM "Pedidos" p USING "Usuarios" u
        WHERE u.id = p."usuarioId" AND (${condicionEmail})`,
      { transaction: t }
    );
  });

  const restantes = await contarPedidosPrueba();
  const demoDespues = await contarDemo();
  console.log(`\nBorrados. Quedan ${restantes} pedidos de prueba.`);

  if (demoDespues !== demoAntes) {
    console.error(
      `FALLO: los pedidos de ejemplo cambiaron (${demoAntes} -> ${demoDespues}).`
    );
    process.exitCode = 1;
  } else {
    console.log(`Pedidos de ejemplo intactos: ${demoDespues}`);
  }
}

module.exports = { main, sequelize, USUARIOS_PROTEGIDOS, SUFIJO_PRUEBA };

/* Solo se autoejecuta cuando se lo invoca como script: los tests lo importan. */
if (require.main === module) {
  main({ dryRun: process.argv.includes('--dry-run') })
    .then(() => sequelize.close())
    .catch(async (error) => {
      console.error(`No se pudo limpiar: ${error.message}`);
      await sequelize.close();
      process.exit(1);
    });
}
