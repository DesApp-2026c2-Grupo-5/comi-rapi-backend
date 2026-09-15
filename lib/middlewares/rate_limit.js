/**
 * Rate limiting para endpoints de autenticación.
 * Se desactiva en el entorno de test via RATE_LIMIT_ENABLED=false.
 */
import rateLimit from 'express-rate-limit';
import config from '../config/config';

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
