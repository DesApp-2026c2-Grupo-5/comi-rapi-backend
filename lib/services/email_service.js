/**
 * Servicio de envío de emails.
 *
 * La lógica de recuperación NO conoce Mailpit: habla con este servicio, y este
 * servicio traduce a SMTP usando la configuración. Cambiar de Mailpit a un
 * proveedor real (SendGrid, SES, Brevo, Mailgun...) es solo cambiar las
 * variables SMTP_* en el .env, sin tocar código.
 *
 * El cuerpo del email se arma acá con plantillas simples en texto plano.
 */
import nodemailer from 'nodemailer';
import config from '../config/config';

let transporte = null;

/**
 * Construye (y memoiza) el transporte SMTP a partir de la configuración.
 * @returns {object|null} El transporte, o null si no hay transporte configurado.
 */
function obtenerTransporte() {
  if (config.mail.transport !== 'smtp') return null;
  if (transporte) return transporte;

  transporte = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    // Mailpit no requiere credenciales en desarrollo; los proveedores reales sí.
    auth:
      config.mail.user && config.mail.password
        ? { user: config.mail.user, pass: config.mail.password }
        : undefined,
    // TLS: implícito con SMTP_SECURE=true (465) u STARTTLS con
    // SMTP_REQUIRE_TLS=true (587). Ambos salen de la config, no del código,
    // para no dejar Mailpit como único escenario soportado.
    secure: config.mail.secure,
    requireTLS: config.mail.requireTLS,
    tls: { rejectUnauthorized: config.mail.rejectUnauthorized },
  });

  return transporte;
}

/**
 * Permite descartar el transporte memoizado. Solo para tests.
 * @returns {void}
 */
export function reiniciarTransporte() {
  transporte = null;
}

/**
 * Arma el enlace de recuperación que viaja en el email.
 * @param {string} token - Token en texto plano.
 * @returns {string} URL completa del frontend.
 */
export function construirEnlaceRecuperacion(token) {
  return `${config.frontend.url}/reset-password?token=${token}`;
}

/**
 * Envia un email de recuperación de contraseña.
 *
 * @param {object} params
 * @param {string} params.destinatario - Email del usuario.
 * @param {string} params.token - Token en texto plano para armar el enlace.
 * @returns {Promise<{ enviado: boolean, motivo?: string }>}
 *   motivo = 'sin-transporte' cuando MAIL_TRANSPORT no es 'smtp'.
 */
export async function enviarEmailRecuperacion({ destinatario, token }) {
  const enlace = construirEnlaceRecuperacion(token);
  const minutos = config.passwordReset.expirationMinutes;

  const asunto = 'Recuperá tu contraseña de Comi-Rapi';
  const texto = [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Comi-Rapi.',
    '',
    'Entrá a este enlace para elegir una contraseña nueva:',
    enlace,
    '',
    `El enlace expira en ${minutos} minutos y solo puede usarse una vez.`,
    '',
    'Si no solicitaste el cambio, podés ignorar este mensaje: tu contraseña actual',
    'seguirá siendo válida.',
    '',
    'Equipo Comi-Rapi',
  ].join('\n');

  const t = obtenerTransporte();

  if (!t) {
    // Sin transporte configurado no se envía nada y NO se registra el token:
    // en producción un token en logs sería una fuga.
    return { enviado: false, motivo: 'sin-transporte' };
  }

  await t.sendMail({
    from: config.mail.from,
    to: destinatario,
    subject: asunto,
    text: texto,
  });

  return { enviado: true };
}
