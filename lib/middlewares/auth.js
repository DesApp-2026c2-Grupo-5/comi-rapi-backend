/**
 * Middlewares de autenticación y autorización por rol.
 *
 * - verificarSesion: valida que exista una sesión activa (req.session.usuarioId)
 *   y carga el usuario correspondiente en req.usuario (datos públicos).
 * - permitirRoles(...roles): restringe la ruta a los roles indicados.
 *
 * A diferencia del stub JSDoc original (pensado para JWT), acá la autenticación
 * se basa en sesiones server-side con cookie HttpOnly (sin token en el cliente).
 */
import db from '../models';

export const verificarSesion = async (req, res, next) => {
  const usuarioId = req.session && req.session.usuarioId;
  if (!usuarioId) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  try {
    const usuario = await db.Usuario.findByPk(usuarioId);
    if (!usuario || !usuario.activo) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ success: false, error: 'No autorizado' });
    }
    req.usuario = usuario.datosPublicos();
    return next();
  } catch (error) {
    return next(error);
  }
};

export const permitirRoles = (...roles) => (req, res, next) => {
  if (!req.usuario || !roles.includes(req.usuario.rol)) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  return next();
};
