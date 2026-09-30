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

/**
 * Resuelve el usuario asociado a una sesión server-side.
 *
 * Es la única fuente de verdad para "¿quién es esta sesión?" y la comparten
 * tanto el middleware de Express como el handshake de Socket.IO, para que el
 * canal de tiempo real no duplique la validación de sesión.
 *
 * @param {object} sesion - Sesión de express-session (puede ser undefined).
 * @returns {Promise<object|null>} Datos públicos del usuario, o null si no hay
 *   sesión activa, el usuario no existe o está inactivo.
 */
export const resolverUsuarioDeSesion = async (sesion) => {
  const usuarioId = sesion && sesion.usuarioId;
  if (!usuarioId) return null;
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario || !usuario.activo) return null;
  return usuario.datosPublicos();
};

export const verificarSesion = async (req, res, next) => {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  try {
    const usuario = await resolverUsuarioDeSesion(req.session);
    if (!usuario) {
      req.session.destroy(() => {});
      return res.status(401).json({ success: false, error: 'No autorizado' });
    }
    req.usuario = usuario;
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

/**
 * sesionOpcional: carga el usuario en req.usuario si existe una sesión activa,
 * pero no rechaza la petición cuando no la hay. Se usa en rutas públicas donde
 * conviene distinguir un ADMINISTRADOR autenticado (p. ej. para listar
 * categorías inactivas) sin exigir autenticación para el resto.
 */
export const sesionOpcional = async (req, res, next) => {
  const usuarioId = req.session && req.session.usuarioId;
  if (!usuarioId) {
    return next();
  }
  try {
    const usuario = await db.Usuario.findByPk(usuarioId);
    if (usuario && usuario.activo) {
      req.usuario = usuario.datosPublicos();
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
