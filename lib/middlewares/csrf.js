/**
 * Protección CSRF por doble envío (double-submit cookie).
 *
 * Cómo funciona:
 * - GET /api/auth/csrf-token genera un token aleatorio, lo guarda en una cookie
 *   `csrf-token` (NO HttpOnly para que el frontend lo pueda leer) y lo devuelve.
 * - En cualquier método que cambie estado (POST/PUT/PATCH/DELETE) se exige que el
 *   header `x-csrf-token` coincida exactamente con la cookie `csrf-token`.
 * - Un sitio tercero no puede escribir la cookie en el origen de la API ni leerla
 *   (SameSite + CORS), por lo que no puede fabricar el par válido cookie+header.
 *
 * No se depende de paquetes externos: el token se genera con crypto.randomBytes.
 */
import crypto from 'crypto';
import config from '../config/config';

export const CSRF_COOKIE_NAME = 'csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const METODOS_PROTEGIDOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Emite (o rota) la cookie CSRF en la respuesta y devuelve el token generado.
 * @param {object} res - Respuesta de Express.
 */
export function setCsrfCookie(res) {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: config.session.sameSite,
    secure: config.session.secure,
    path: '/',
    maxAge: config.session.ttl,
  });
  return token;
}

/**
 * Middleware principal: valida cookie == header en métodos que cambian estado.
 * En métodos seguros (GET/HEAD/OPTIONS) no hace nada.
 */
export const csrfProtection = (req, res, next) => {
  if (!METODOS_PROTEGIDOS.has(req.method)) {
    return next();
  }
  const cookieToken = req.cookies && req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res
      .status(403)
      .json({ success: false, error: 'Solicitud no válida' });
  }
  return next();
};
