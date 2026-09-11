/**
 * Middleware: auth
 *
 * Objetivo: proveer autenticación y autorización por rol a las rutas protegidas.
 *
 * Funciones esperadas:
 *   - verificarToken(req, res, next):
 *       - Lee el header 'Authorization: Bearer <token>'.
 *       - Valida el JWT y carga req.usuario con { id, nombre, email, rol }.
 *       - Si el token es inválido o falta → 401 { success: false, error: 'No autorizado' }.
 *   - permitirRoles(...roles):
 *       - Devuelve un middleware que verifica que req.usuario.rol esté en la lista.
 *       - Si no → 403 { success: false, error: 'Acceso denegado' }.
 *
 * Dependencias:
 *   - jsonwebtoken (proveer constantes de JWT en config: JWT_SECRET, expiresIn).
 *
 * Uso típico en rutas:
 *   router.post('/', verificarToken, permitirRoles(ROLES.ADMIN), ...)
 *
 * Rol del usuario: 'CLIENTE' | 'ADMIN' (frontend src/utils/constants.js → ROLES)
 */
