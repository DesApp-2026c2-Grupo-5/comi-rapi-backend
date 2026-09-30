/**
 * Helpers para probar que una transacción PostgreSQL hace ROLLBACK de verdad.
 *
 * La estrategia es provocar un error REAL de base en el ÚLTIMO paso de la
 * transacción (el DELETE de sesiones). Así se verifica que todo lo escrito
 * antes — password y usedAt — se revierte, y que la fila de `session` sobrevive.
 *
 * No se usan bloqueos de tabla (LOCK TABLE) a propósito: un ACCESS EXCLUSIVE
 * sobre `session` mientras la transacción interna intenta borrarla produce un
 * deadlock con el pool de conexiones y la suite se cuelga.
 */
import db from '../lib/models';

const NOMBRE_TRIGGER = 'trigger_fallo_simulado_password_reset';

/**
 * Ejecuta `fn` con un trigger que hace fallar cualquier DELETE sobre `session`.
 *
 * @param {Function} fn - Código bajo prueba; se espera que rechace.
 * @returns {Promise<Error>} El error que produjo `fn`.
 */
export async function conDeleteDeSesionesFallando(fn) {
  await db.sequelize.query(`
    CREATE OR REPLACE FUNCTION fn_password_reset_fallo() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'fallo simulado al borrar sesiones';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.sequelize.query(`
    CREATE TRIGGER ${NOMBRE_TRIGGER}
    BEFORE DELETE ON "session"
    FOR EACH ROW EXECUTE FUNCTION fn_password_reset_fallo();
  `);

  try {
    await fn();
  } catch (error) {
    return error;
  } finally {
    await db.sequelize.query(
      `DROP TRIGGER IF EXISTS ${NOMBRE_TRIGGER} ON "session";`
    );
    await db.sequelize.query(
      `DROP FUNCTION IF EXISTS fn_password_reset_fallo();`
    );
  }

  throw new Error('Se esperaba que la operación fallara y no falló');
}
