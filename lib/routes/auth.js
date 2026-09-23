/**
 * Rutas de autenticación y registro (sesiones con cookie HttpOnly).
 *
 * Endpoints:
 *   GET  /api/auth/csrf-token  → emite cookie CSRF + token (antiforgery)
 *   POST /api/auth/registro    → registra y crea sesión
 *   POST /api/auth/login       → inicia sesión
 *   POST /api/auth/logout      → cierra sesión (invalida en BD)
 *   GET  /api/auth/me          → datos públicos del usuario autenticado
 */
import express from 'express';
import { login, logout, me, registro } from '../controllers/auth_controller';
import { verificarSesion } from '../middlewares/auth';
import { authLimiter } from '../middlewares/rate_limit';
import { setCsrfCookie } from '../middlewares/csrf';
import { withErrorHandling } from './utils';

const router = express.Router();

router.get('/csrf-token', (req, res) => {
  const token = setCsrfCookie(res);
  res.json({ success: true, data: { csrfToken: token } });
});

router.post('/registro', authLimiter, withErrorHandling(registro));
router.post('/login', authLimiter, withErrorHandling(login));
router.post('/logout', withErrorHandling(logout));
router.get('/me', verificarSesion, withErrorHandling(me));

export default router;
