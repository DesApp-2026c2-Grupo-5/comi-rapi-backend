'use strict';

/**
 * Limpieza periódica de los tokens de recuperación de contraseña.
 *
 * `PasswordResetTokens` es una tabla de auditoría: los tokens no se borran al
 * consumirse ni al invalidarse, para poder reconstruir el historial de
 * solicitudes. Eso hace que crezca sin límite, así que hace falta un script de
 * mantenimiento.
 *
 * Alcance, a propósito:
 *   - Borra tokens YA consumidos (`usedAt`) o YA invalidados (`invalidatedAt`).
 *   - Borra tokens expirados hace más de RETENCION_DIAS, que ya no pueden
 *     activarse aunque se intente reutilizarlos.
 *   - NO borra tokens vigentes: uno que acaba de emitirse se respeta siempre,
 *     aunque por un reloj desfasado pareciera expirado.
 *   - Es idempotente: correrlo dos veces no rompe nada ni borra de más.
 *
 * Uso: `npm run limpiar:tokens`
 *      `node scripts/limpiar-tokens-expirados.js --dry-run`
 *
 * Respeta `NODE_ENV`: con `NODE_ENV=test` limpia `SQL_TEST_DATABASE`, nunca la
 * base de desarrollo. La config se toma de `lib/config/config.js` para no
 * duplicarla.
 */

const config = require('../lib/config/config');
const { Sequelize } = require('sequelize');

/**
 * Días que se conserva un token ya consumido/invalidado, y días extra para uno
 * expirado. Es un piso de retención, no un plazo legal: sirve para que un
 * incidente se pueda auditar durante unos días y nada más.
 */
const DIAS_RETENCION = 30;
const DIAS_EXPIRADO = 7;

const sequelize = new Sequelize(config.db);

const contar = async (where) => {
  const [filas] = await sequelize.query(
    `SELECT count(*)::int AS n FROM "PasswordResetTokens" WHERE ${where}`
  );
  return filas[0].n;
};

async function main({ dryRun = false } = {}) {
  // OJO con las comillas: sin ellas Postgres pliega `usedAt` a `usedat` y la
  // consulta falla con "column does not exist".
  //
  // Se usa NOW() y no un parámetro de fecha porque Sequelize entrecomilla los
  // replacements: `:fecha - INTERVAL '30 days'` se vuelve
  // `'2026-09-29 ...' - INTERVAL '30 days'`, y Postgres intenta castear el
  // string a interval. Además, para una limpieza el reloj de la base es el
  // que corresponde.
  const vigente = '"usedAt" IS NULL AND "invalidatedAt" IS NULL';

  const usados = `"usedAt" IS NOT NULL AND "usedAt" < NOW() - INTERVAL '${DIAS_RETENCION} days'`;
  const invalidados = `"invalidatedAt" IS NOT NULL AND "invalidatedAt" < NOW() - INTERVAL '${DIAS_RETENCION} days'`;
  const expiradosAntiguos = `${vigente} AND "expiresAt" < NOW() - INTERVAL '${DIAS_EXPIRADO} days'`;

  const total = await contar('TRUE');
  const aBorrar = {
    usados: await contar(usados),
    invalidados: await contar(invalidados),
    expirados: await contar(expiradosAntiguos),
  };
  // Se cuenta una sola vez la union, porque un token no puede estar usado e
  // invalidado a la vez, pero expiradosAntiguos excluye ambos por construcción.
  const totalABorrar = aBorrar.usados + aBorrar.invalidados + aBorrar.expirados;
  const vigentes = await contar(vigente);

  console.log(`Tokens de recuperación: ${total} en total.`);
  console.log(`  vigentes (se conservan): ${vigentes}`);
  console.log(`  usados hace >${DIAS_RETENCION} días:      ${aBorrar.usados}`);
  console.log(
    `  invalidados hace >${DIAS_RETENCION} días: ${aBorrar.invalidados}`
  );
  console.log(
    `  expirados hace >${DIAS_EXPIRADO} días:     ${aBorrar.expirados}`
  );

  if (dryRun) {
    console.log(
      `\n--dry-run: no se borra nada (se borrarían ${totalABorrar}).`
    );
    return;
  }

  if (totalABorrar === 0) {
    console.log('\nNo hay nada que limpiar.');
    return;
  }

  const [, resultado] = await sequelize.query(
    `DELETE FROM "PasswordResetTokens"
      WHERE ${usados}
         OR ${invalidados}
         OR ${expiradosAntiguos}`
  );

  console.log(`\nBorrados ${resultado.rowCount} tokens.`);
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  main({ dryRun })
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Error al limpiar tokens de recuperación:', error.message);
      await sequelize.close();
      process.exit(1);
    });
}

module.exports = { main };
