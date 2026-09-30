/**
 * Servicio de recuperación de contraseña.
 *
 * Reglas de seguridad:
 * - El token se genera con crypto.randomBytes (compatible con Node 14.15;
 *   no se usa crypto.randomUUID porque el proyecto declara engines node 14.15.x).
 * - En la base solo se guarda el SHA-256 del token. El texto plano existe
 *   únicamente en memoria durante el procesamiento de la solicitud.
 * - Un token es de un solo uso (usedAt) y expira a los 10 minutos por config.
 * - Al pedir una recuperación se invalidan los tokens pendientes del usuario
 *   (invalidatedAt), sin borrarlos, para poder auditar el historial.
 * - La validación distingue internamente token inexistente / expirado / usado /
 *   invalidado, pero la API siempre responde con un único mensaje genérico.
 */
import crypto from 'crypto';
import db from '../models';
import config from '../config/config';

const MINUTOS_POR_MS = 60 * 1000;

/**
 * Normaliza el email con la misma convención que el controller de auth
 * (trim + lowercase), para que el rate limit por email no esquive nada.
 * @param {*} valor
 * @returns {string}
 */
export function normalizarEmail(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase();
}

/**
 * Genera un token criptográficamente seguro en hexadecimal.
 * @returns {string} 64 caracteres hexadecimales.
 */
export function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calcula el hash SHA-256 que sí se persiste.
 * @param {string} token
 * @returns {string} 64 caracteres hexadecimales.
 */
export function hashearToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Indica si un token tiene la forma esperada (64 hexadecimales).
 * Evita generar un hash para cualquier basura que llegue por el body.
 * @param {*} token
 * @returns {boolean}
 */
export function esTokenBienFormado(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}

/**
 * Calcula la fecha de vencimiento: createdAt + expirationMinutes.
 * @param {Date} [ahora]
 * @returns {Date}
 */
export function calcularExpiracion(ahora = new Date()) {
  return new Date(
    ahora.getTime() + config.passwordReset.expirationMinutes * MINUTOS_POR_MS
  );
}

/**
 * Invalida los tokens pendientes del usuario y emite uno nuevo.
 *
 * Los tokens previos no se borran: se marcan con invalidatedAt para poder
 * reconstruir el historial de solicitudes (ver docs/recuperacion-contrasena.md).
 *
 * @param {number} usuarioId
 * @param {object} [opciones]
 * @param {object} [opciones.transaction]
 * @returns {Promise<{ token: string, registro: object }>} El token en texto
 *   plano (solo para enviarlo por email) y su registro persistido.
 */
export async function emitirTokenRecuperacion(usuarioId, opciones = {}) {
  const { transaction } = opciones;
  const ahora = new Date();

  await db.PasswordResetToken.update(
    { invalidatedAt: ahora },
    {
      where: {
        usuarioId,
        usedAt: null,
        invalidatedAt: null,
      },
      transaction,
    }
  );

  const token = generarToken();
  const registro = await db.PasswordResetToken.create(
    {
      usuarioId,
      tokenHash: hashearToken(token),
      expiresAt: calcularExpiracion(ahora),
      usedAt: null,
      invalidatedAt: null,
    },
    { transaction }
  );

  return { token, registro };
}

/**
 * Error de dominio: el token no está en estado 'vigente'.
 *
 * Lleva el estado real en `estado` para que el controller pueda decidir la
 * respuesta, pero nunca se expone al cliente: la API responde siempre el mismo
 * mensaje genérico.
 */
export class TokenNoUtilizableError extends Error {
  constructor(estado) {
    super(`El token no se puede utilizar (${estado})`);
    this.name = 'TokenNoUtilizableError';
    this.estado = estado;
  }
}

/**
 * Clasifica un registro ya leído, sin volver a consultar la base.
 *
 * Se separa de clasificarToken para que el estado se pueda evaluar también
 * DENTRO de la transacción de aplicación, con la fila ya bloqueada.
 *
 * @param {object|null} registro
 * @param {Date} [ahora]
 * @returns {string} estado
 */
export function clasificarRegistro(registro, ahora = new Date()) {
  if (!registro) return 'inexistente';
  if (registro.invalidatedAt) return 'invalidado';
  if (registro.usedAt) return 'usado';
  if (registro.expiresAt.getTime() <= ahora.getTime()) return 'expirado';
  return 'vigente';
}

/**
 * Busca el registro que corresponde a un token recibido y clasifica su estado.
 *
 * El `estado` es interno: la API no lo expone, solo sirve para logs y tests.
 *
 * @param {string} token - Token en texto plano.
 * @param {object} [opciones]
 * @param {Date} [opciones.ahora]
 * @param {object} [opciones.transaction]
 * @returns {Promise<{ registro: object|null, estado: string }>}
 *   estado ∈ 'vigente' | 'inexistente' | 'invalido' | 'expirado' |
 *   'usado' | 'invalidado'
 */
export async function clasificarToken(token, opciones = {}) {
  const { ahora = new Date(), transaction } = opciones;

  if (!esTokenBienFormado(token)) {
    return { registro: null, estado: 'invalido' };
  }

  const registro = await db.PasswordResetToken.findOne({
    where: { tokenHash: hashearToken(token) },
    include: [{ model: db.Usuario, as: 'Usuario' }],
    transaction,
  });

  return { registro, estado: clasificarRegistro(registro, ahora) };
}

/**
 * Elimina las sesiones activas de un usuario dentro de la transacción dada.
 *
 * connect-pg-simple guarda la sesión serializada en la columna `sess` (json) de
 * la tabla `session`, en la misma base de datos que Sequelize. Por eso el DELETE
 * se emite con sequelize.query usando la transacción activa: forma parte del
 * mismo BEGIN/COMMIT y un error posterior hace ROLLBACK de todo.
 *
 * @param {number} usuarioId
 * @param {object} [opciones]
 * @param {object} [opciones.transaction]
 * @returns {Promise<number>} Filas eliminadas.
 */
export async function eliminarSesiones(usuarioId, opciones = {}) {
  const { transaction } = opciones;
  const [
    ,
    resultado,
  ] = await db.sequelize.query(
    `DELETE FROM "session" WHERE "sess"->>'usuarioId' = :usuarioId`,
    { replacements: { usuarioId: String(usuarioId) }, transaction }
  );
  // sequelize.query devuelve un Result de Postgres: el conteo va en rowCount.
  return resultado.rowCount;
}

/**
 * Aplica el cambio de contraseña y consume el token, TODO dentro de una única
 * transacción junto con la eliminación de sesiones.
 *
 * Secuencia: BEGIN -> SELECT ... FOR UPDATE -> validar -> password -> usedAt
 *             -> DELETE sesiones -> COMMIT.
 *
 * Dos detalles de seguridad que no son opcionales:
 *
 * 1. `lock: transaction.LOCK.UPDATE` (SELECT ... FOR UPDATE) serializa las
 *    peticiones concurrentes con el mismo token: la segunda espera al COMMIT de
 *    la primera y después ve `usedAt` ya seteado, por lo que se rechaza. Sin
 *    este lock, dos requests simultáneos pasarían la validación y ambos
 *    cambiarían la contraseña.
 *
 * 2. El estado se re-evalúa AQUÍ adentro, con la fila bloqueada, y no antes de
 *    abrir la transacción: validar afuera deja una ventana en la que el token
 *    todavía se ve vigente.
 *
 * El usuario se carga como instancia (no con `Model.update`) porque los hooks
 * `beforeSave` de instancia son los que aplican Argon2id; un update masivo solo
 * dispara `beforeBulkUpdate` y guardaría la contraseña en texto plano.
 *
 * @param {object} params
 * @param {string} params.token - Token en texto plano (se hashea para buscar).
 * @param {string} params.nuevaPassword
 * @returns {Promise<void>}
 * @throws {TokenNoUtilizableError} Si el token dejó de estar vigente.
 */
export async function aplicarCambioDePassword({ token, nuevaPassword }) {
  if (!esTokenBienFormado(token)) {
    throw new TokenNoUtilizableError('invalido');
  }

  await db.sequelize.transaction(async (transaction) => {
    const registro = await db.PasswordResetToken.findOne({
      where: { tokenHash: hashearToken(token) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const estado = clasificarRegistro(registro);
    if (estado !== 'vigente') {
      throw new TokenNoUtilizableError(estado);
    }

    const usuario = await db.Usuario.findByPk(registro.usuarioId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!usuario) throw new TokenNoUtilizableError('inexistente');

    await usuario.update({ password: nuevaPassword }, { transaction });
    await registro.update({ usedAt: new Date() }, { transaction });
    await eliminarSesiones(registro.usuarioId, { transaction });
  });
}
