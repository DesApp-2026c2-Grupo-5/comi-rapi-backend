/**
 * Servicio de sesiones server-side.
 *
 * Conecta con la tabla `session` (connect-pg-simple) en la misma base de datos
 * que usa Sequelize. Se comparte entre la recuperación de contraseña y el
 * perfil del usuario: ambos necesitan invalidar las sesiones de una cuenta.
 */
import db from '../models';

/**
 * Elimina las sesiones activas de un usuario.
 *
 * connect-pg-simple guarda la sesión serializada en la columna `sess` (json) de
 * la tabla `session`, en la misma base de datos que Sequelize. Por eso el DELETE
 * se emite con sequelize.query usando la transacción activa: forma parte del
 * mismo BEGIN/COMMIT y un error posterior hace ROLLBACK de todo.
 *
 * @param {number} usuarioId
 * @param {object} [opciones]
 * @param {object} [opciones.transaction] - Transacción Sequelize activa.
 * @param {string|number} [opciones.exceptoSid] - Si se indica, esa sesión se
 *   conserva (p. ej. la sesión actual al cambiar la contraseña desde el perfil).
 * @returns {Promise<number>} Filas eliminadas.
 */
export async function eliminarSesiones(usuarioId, opciones = {}) {
  const { transaction, exceptoSid } = opciones;
  let clausula = `"sess"->>'usuarioId' = :usuarioId`;
  const replacements = { usuarioId: String(usuarioId) };

  if (exceptoSid) {
    clausula += ' AND "sid" <> :exceptoSid';
    replacements.exceptoSid = String(exceptoSid);
  }

  const [, resultado] = await db.sequelize.query(
    `DELETE FROM "session" WHERE ${clausula}`,
    {
      replacements,
      transaction,
    }
  );
  // sequelize.query devuelve un Result de Postgres: el conteo va en rowCount.
  return resultado.rowCount;
}
