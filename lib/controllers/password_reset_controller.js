/**
 * Controller de recuperación de contraseña.
 *
 * Solo traduce HTTP ↔ dominio; las reglas viven en password_reset_service y
 * email_service (ver AGENTS.md: Routes → Middlewares → Controllers → Services).
 *
 * Política de errores (requisito §16 del plan): el backend distingue internamente
 * token inexistente / expirado / usado / invalidado, pero la respuesta pública es
 * siempre la misma. El estado real solo se registra en el log del servidor.
 */
import db from '../models';
import {
  emitirTokenRecuperacion,
  clasificarToken,
  aplicarCambioDePassword,
  normalizarEmail,
  TokenNoUtilizableError,
} from '../services/password_reset_service';
import { enviarEmailRecuperacion } from '../services/email_service';

const MENSAJE_SOLICITUD =
  'Si existe una cuenta asociada al email, recibirás un enlace para recuperar tu contraseña.';
const MENSAJE_TOKEN_GENERICO =
  'El enlace de recuperación no es válido o ya expiró.';
const MENSAJE_CAMBIADO = 'Contraseña actualizada correctamente.';
const MENSAJE_NO_COINCIDE = 'Las contraseñas no coinciden.';
const ERROR_OPERACION = 'No se pudo completar la operación';

const formatoEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esEmailValido = (email) => formatoEmail.test(email);
const esPasswordValido = (password) =>
  typeof password === 'string' && password.length >= 6;

/**
 * POST /auth/forgot-password
 *
 * Siempre responde 200 con el mismo mensaje, exista o no la cuenta, para no
 * permitir enumerar emails registrados. La respuesta se emite después de hacer
 * el trabajo: recién entonces es verdad que el email salió.
 */
export const forgotPassword = async (req, res) => {
  const email = normalizarEmail((req.body || {}).email);
  const responderGenerico = () =>
    res.json({ success: true, data: { message: MENSAJE_SOLICITUD } });

  if (!esEmailValido(email)) return responderGenerico();

  try {
    const usuario = await db.Usuario.findOne({
      where: { email, activo: true },
    });

    if (usuario) {
      const { token } = await emitirTokenRecuperacion(usuario.id);
      const resultado = await enviarEmailRecuperacion({
        destinatario: usuario.email,
        token,
      });

      if (!resultado.enviado) {
        // Sin SMTP no se filtra nada al usuario, pero sí queda registrado que
        // el enlace no salió (el token nunca se escribe en el log).
        console.warn(
          `[recuperacion] email no enviado a ${email} (${resultado.motivo})`
        );
      }
    }
  } catch (error) {
    // Se registra el motivo y se responde igual: un 5xx delataría que hubo un
    // error real, que es justo lo que este endpoint no debe filtrar.
    console.error('[recuperacion] error en forgot-password:', error.message);
  }

  return responderGenerico();
};

/**
 * POST /auth/reset-password
 *
 * Valida token y contraseña, y solo después aplica el cambio dentro de una
 * única transacción (password + usedAt + borrado de sesiones).
 */
export const resetPassword = async (req, res) => {
  const { token, password, confirmPassword } = req.body || {};
  const nuevaPassword = String(password || '');

  // El orden importa: primero se valida la contraseña, sin tocar la base, para
  // no gastar el token si el usuario se equivocó al escribirla.
  if (nuevaPassword !== String(confirmPassword || '')) {
    return res.status(400).json({ success: false, error: MENSAJE_NO_COINCIDE });
  }
  if (!esPasswordValido(nuevaPassword)) {
    return res.status(400).json({ success: false, error: ERROR_OPERACION });
  }

  const { estado } = await clasificarToken(token);

  if (estado !== 'vigente') {
    // Único punto donde se distingue el motivo, y solo hacia el log del servidor.
    console.warn(`[recuperacion] token rechazado (${estado})`);
    return res
      .status(400)
      .json({ success: false, error: MENSAJE_TOKEN_GENERICO });
  }

  try {
    // El servicio vuelve a validar el token DENTRO de la transacción: la
    // clasificación de arriba es solo una comprobación temprana para no abrir
    // una transacción si el token ya se sabe descartado. Entre ambas puede
    // aparecer una petición concurrente que lo consuma, y en ese caso el error
    // de dominio se traduce al mismo mensaje genérico.
    await aplicarCambioDePassword({ token, nuevaPassword });
  } catch (error) {
    if (error instanceof TokenNoUtilizableError) {
      console.warn(
        `[recuperacion] cambio rechazado (${error.estado}) tras la comprobación inicial`
      );
      return res
        .status(400)
        .json({ success: false, error: MENSAJE_TOKEN_GENERICO });
    }

    // La transacción hizo ROLLBACK: no queda password cambiada, ni token usado,
    // ni sesiones borradas.
    console.error('[recuperacion] error al aplicar el cambio:', error.message);
    return res.status(500).json({ success: false, error: ERROR_OPERACION });
  }

  return res.json({ success: true, data: { message: MENSAJE_CAMBIADO } });
};
