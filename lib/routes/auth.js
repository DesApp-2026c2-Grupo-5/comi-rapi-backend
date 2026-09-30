/**
 * Rutas de autenticación y registro (sesiones con cookie HttpOnly).
 *
 * Endpoints:
 *   GET  /api/auth/csrf-token  → emite cookie CSRF + token (antiforgery)
 *   POST /api/auth/registro    → registra y crea sesión
 *   POST /api/auth/login       → inicia sesión
 *   POST /api/auth/logout      → cierra sesión (invalida en BD)
 *   GET  /api/auth/me          → datos públicos del usuario autenticado
 *   POST /api/auth/forgot-password  → solicita el enlace de recuperación
 *   POST /api/auth/reset-password   → establece la contraseña con el token
 */
import express from 'express';
import { login, logout, me, registro } from '../controllers/auth_controller';
import { verificarSesion } from '../middlewares/auth';
import {
  authLimiter,
  passwordResetIpLimiter,
  passwordResetEmailLimiter,
} from '../middlewares/rate_limit';
import { setCsrfCookie } from '../middlewares/csrf';
import { withErrorHandling } from './utils';
import {
  forgotPassword,
  resetPassword,
} from '../controllers/password_reset_controller';

const router = express.Router();

router.get('/csrf-token', (req, res) => {
  const token = setCsrfCookie(res);
  res.json({ success: true, data: { csrfToken: token } });
});

router.post('/registro', authLimiter, withErrorHandling(registro));
router.post('/login', authLimiter, withErrorHandling(login));
router.post('/logout', withErrorHandling(logout));
router.get('/me', verificarSesion, withErrorHandling(me));

// Recuperación de contraseña: dos límites (por IP y por email normalizado).
// Ambos se aplican también cuando el email no existe, para que el endpoint se
// comporte igual en los dos casos y no permita enumerar cuentas.
router.post(
  '/forgot-password',
  passwordResetIpLimiter,
  passwordResetEmailLimiter,
  withErrorHandling(forgotPassword)
);
router.post('/reset-password', withErrorHandling(resetPassword));

export default router;
