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
 * Devuelve el id de la sucursal asignada a la sesión (o null).
 *
 * Solo el ADMINISTRADOR puede tener sucursal: CLIENTE y SUPERADMINISTRADOR no
 * están acotados a ninguna. Es la fuente para el scoping por sucursal, de modo
 * que nunca se confía en un `sucursalId` que venga en el request.
 *
 * @param {object} req - Request de Express con `req.usuario` cargado.
 * @returns {number|null} Id de sucursal asignada, o null.
 */
export const sucursalDeSesion = (req) =>
  (req.usuario && req.usuario.sucursalId) || null;

/**
 * Exige que un ADMINISTRADOR tenga una sucursal asignada para operar.
 *
 * Un ADMINISTRADOR sin sucursal no puede leer ni escribir recursos acotados
 * (stock, pedidos, estadísticas de su local). El SUPERADMINISTRADOR no se acota
 * y el CLIENTE no llega a estas rutas.
 */
export const requiereSucursal = (req, res, next) => {
  if (
    req.usuario &&
    req.usuario.rol === 'ADMINISTRADOR' &&
    !req.usuario.sucursalId
  ) {
    return res.status(403).json({
      success: false,
      error: 'El administrador no tiene una sucursal asignada',
    });
  }
  return next();
};

/**
 * Impide operar sobre `:sucursalId` de otra sucursal.
 *
 * El `sucursalId` de la URL es sólo un identificador a comparar: la sucursal
 * efectiva siempre sale de la sesión — la asignada del ADMINISTRADOR o el
 * contexto elegido del SUPERADMINISTRADOR. Si no hay sucursal operativa no
 * se acota acá (de eso se encarga `requiereSucursalOperativa` en la ruta);
 * el CLIENTE no llega a estas rutas.
 */
export const acotarASucursalPropia = (req, res, next) => {
  const propia = sucursalOperativaDeSesion(req);
  const pedida = Number(req.params.sucursalId);
  if (propia && Number.isInteger(pedida) && pedida !== Number(propia)) {
    return res.status(403).json({
      success: false,
      error: 'Solo podés operar sobre tu sucursal asignada',
    });
  }
  return next();
};

/**
 * Devuelve la sucursal OPERATIVA de la sesión (o null).
 *
 * Es la sucursal "en la que está parado" quien hace la operación:
 * - ADMINISTRADOR: su sucursal asignada (no cambia).
 * - SUPERADMINISTRADOR: el contexto elegido explícitamente en la sesión
 *   (`sucursalOperativaId`, seteado por /api/auth/sucursal-contexto y
 *   validado contra la BD al elegirlo). Nunca sale del request.
 * - CLIENTE: null (no opera sucursales).
 *
 * Es la fuente para todo scoping OPERATIVO (reasignación, estados, stock):
 * las lecturas globales del SUPERADMINISTRADOR no se acotan por esto.
 */
export const sucursalOperativaDeSesion = (req) => {
  if (!req.usuario) return null;
  if (req.usuario.rol === 'ADMINISTRADOR') {
    return req.usuario.sucursalId || null;
  }
  if (req.usuario.rol === 'SUPERADMINISTRADOR') {
    const contexto = req.session && req.session.sucursalOperativaId;
    const id = Number(contexto);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return null;
};

/**
 * Exige una sucursal OPERATIVA para operar recursos acotados.
 *
 * Difiere de `requiereSucursal`: ese protege también las lecturas del
 * SUPERADMINISTRADOR (que son globales y no deben cortarse). Este es para
 * operaciones: un ADMINISTRADOR sin sucursal y un SUPERADMINISTRADOR sin
 * contexto elegido reciben 403 con un mensaje que indica qué falta. El
 * CLIENTE pasa: su autorización es por propiedad del pedido (dueño), no
 * por sucursal.
 */
export const requiereSucursalOperativa = (req, res, next) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol === 'CLIENTE') {
    return next();
  }
  if (sucursalOperativaDeSesion(req)) {
    return next();
  }
  const esSuperadmin = rol === 'SUPERADMINISTRADOR';
  return res.status(403).json({
    success: false,
    error: esSuperadmin
      ? 'Elegí una sucursal para operar'
      : 'El administrador no tiene una sucursal asignada',
  });
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
