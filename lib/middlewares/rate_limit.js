/**
 * Rate limiting para endpoints de autenticación.
 * Se desactiva en el entorno de test via RATE_LIMIT_ENABLED=false.
 */
import rateLimit from 'express-rate-limit';
import config from '../config/config';
import { normalizarEmail } from '../services/password_reset_service';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: false,
  legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: 'Demasiados intentos. Intente nuevamente más tarde.',
    }),
});

/**
 * Manejador común de los limitadores de recuperación. Mantiene el mismo formato
 * de error que authLimiter para no delatar por qué se bloqueó la solicitud.
 */
const respuestaDemasiados = (req, res) =>
  res.status(429).json({
    success: false,
    error:
      'Demasiadas solicitudes de recuperación. Intente nuevamente más tarde.',
  });

/**
 * Límite de cambios de contraseña del perfil (5 por 15 minutos por usuario).
 *
 * El endpoint exige la contraseña actual, así que sin este límite quien se
 * aproveche de una sesión ajena podría probarla indefinidamente. La clave es el
 * usuario de la sesión (req.usuario.id, que deja verificarSesion), no la IP: así
 * un atacante no puede saltarse el límite cambiando de dirección, y un cliente
 * legítimo no se ve afectado por el tráfico de otros.
 *
 * Se desactiva con RATE_LIMIT_ENABLED=false (por eso los tests pueden repetir
 * el endpoint sin quedar bloqueados).
 */
export const perfilPasswordLimiter = rateLimit({
  windowMs: config.perfil.rateLimitPassword.windowMinutes * 60 * 1000,
  max: config.perfil.rateLimitPassword.max,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    String((req.usuario && req.usuario.id) || 'sin-sesion'),
  skip: () => !config.rateLimit.enabled,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error:
        'Demasiados intentos de cambio de contraseña. Intente nuevamente más tarde.',
    }),
});

/**
 * Límite por IP para requesting una recuperación de contraseña.
 * Valores configurables en .env (3 por 60 minutos por defecto).
 */
export const passwordResetIpLimiter = rateLimit({
  windowMs: config.passwordReset.rateLimitIp.windowMinutes * 60 * 1000,
  max: config.passwordReset.rateLimitIp.max,
  standardHeaders: false,
  legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  handler: respuestaDemasiados,
});

/**
 * Límite por email normalizado (trim + lowercase), para que un mismo usuario
 * no agote el límite desde IPs distintas. Se aplica también a emails que no
 * existen, para que el endpoint se comporte igual en ambos casos.
 */
export const passwordResetEmailLimiter = rateLimit({
  windowMs: config.passwordReset.rateLimitEmail.windowMinutes * 60 * 1000,
  max: config.passwordReset.rateLimitEmail.max,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    normalizarEmail(req.body && req.body.email) || 'sin-email',
  skip: () => !config.rateLimit.enabled,
  handler: respuestaDemasiados,
});
