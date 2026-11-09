import {
  NotificacionError,
  contarNoLeidas,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
} from '../services/notificaciones';

/**
 * Traduce los errores de negocio del centro de notificaciones a HTTP. Cualquier
 * otro error sigue el camino normal (500 con el middleware de errores).
 */
const responderError = (res, error, next) => {
  if (error instanceof NotificacionError) {
    return res
      .status(error.codigo)
      .json({ success: false, error: error.message });
  }
  return next(error);
};

/** GET /api/notificaciones — CLIENTE. */
export const index = async (req, res, next) => {
  try {
    const data = await listarNotificaciones(req.usuario.id, {
      tipo: req.query.tipo,
      soloNoLeidas: req.query.noLeidas,
      pagina: req.query.pagina,
      limite: req.query.limite,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/notificaciones/no-leidas — CLIENTE. */
export const noLeidas = async (req, res, next) => {
  try {
    const total = await contarNoLeidas(req.usuario.id);
    return res.json({ success: true, data: { noLeidas: total } });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** PUT /api/notificaciones/leidas — CLIENTE. */
export const leidas = async (req, res, next) => {
  try {
    const data = await marcarTodasLeidas(req.usuario.id);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** PUT /api/notificaciones/:id/leida — CLIENTE. */
export const leida = async (req, res, next) => {
  try {
    const data = await marcarLeida(req.params.id, req.usuario.id);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};
