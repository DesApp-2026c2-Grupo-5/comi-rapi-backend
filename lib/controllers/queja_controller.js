import {
  QuejaError,
  actualizarQueja,
  cerrarQueja,
  crearQueja,
  listarQuejas,
  misQuejas,
  responderQueja,
} from '../services/quejas';

/**
 * Traduce los errores de negocio de quejas a HTTP. Cualquier otro error sigue
 * el camino normal (500 con el middleware de errores).
 */
const responderError = (res, error, next) => {
  if (error instanceof QuejaError) {
    return res
      .status(error.codigo)
      .json({ success: false, error: error.message });
  }
  return next(error);
};

/** POST /api/quejas — CLIENTE. */
export const create = async (req, res, next) => {
  try {
    const data = await crearQueja({
      usuarioId: req.usuario.id,
      pedidoId: req.body.pedidoId,
      motivo: req.body.motivo,
      detalle: req.body.detalle,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/quejas/mias — CLIENTE. */
export const mias = async (req, res, next) => {
  try {
    const data = await misQuejas(req.usuario.id, {
      pedidoId: req.query.pedidoId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/quejas — ADMINISTRADOR (su sucursal) o SUPERADMINISTRADOR. */
export const index = async (req, res, next) => {
  try {
    const data = await listarQuejas({
      rol: req.usuario.rol,
      sucursalId: req.usuario.sucursalId,
      estado: req.query.estado,
      q: req.query.q,
      sucursalIdFiltro: req.query.sucursalId,
      pagina: req.query.pagina,
      limite: req.query.limite,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** POST /api/quejas/:id/mensajes — CLIENTE dueño. */
export const responder = async (req, res, next) => {
  try {
    const data = await responderQueja(req.params.id, {
      usuarioId: req.usuario.id,
      contenido: req.body.contenido,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** POST /api/quejas/:id/cerrar — CLIENTE dueño. */
export const cerrar = async (req, res, next) => {
  try {
    const data = await cerrarQueja(req.params.id, {
      usuarioId: req.usuario.id,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** PUT /api/quejas/:id — ADMINISTRADOR (su sucursal) o SUPERADMINISTRADOR. */
export const update = async (req, res, next) => {
  try {
    const data = await actualizarQueja(req.params.id, {
      rol: req.usuario.rol,
      sucursalId: req.usuario.sucursalId,
      respondidoPorId: req.usuario.id,
      estado: req.body.estado,
      respuesta: req.body.respuesta,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};
