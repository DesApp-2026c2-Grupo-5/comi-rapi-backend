import {
  ResenaError,
  actualizarResena,
  crearResena,
  eliminarResena,
  listarResenasDeProducto,
  misResenas,
  productosElegibles,
} from '../services/resenas';

/**
 * Traduce los errores de negocio de reseñas a HTTP. Cualquier otro error sigue
 * el camino normal (500 con el middleware de errores).
 */
const responderError = (res, error, next) => {
  if (error instanceof ResenaError) {
    return res
      .status(error.codigo)
      .json({ success: false, error: error.message });
  }
  return next(error);
};

/** GET /api/productos/:id/resenas — público y paginado. */
export const listarPorProducto = async (req, res, next) => {
  try {
    const data = await listarResenasDeProducto(req.params.id, {
      pagina: req.query.pagina,
      limite: req.query.limite,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/resenas/elegibles — CLIENTE. */
export const elegibles = async (req, res, next) => {
  try {
    const data = await productosElegibles(req.usuario.id, {
      pedidoId: req.query.pedidoId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/resenas/mias — CLIENTE. */
export const mias = async (req, res, next) => {
  try {
    const data = await misResenas(req.usuario.id);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** POST /api/resenas — CLIENTE. */
export const create = async (req, res, next) => {
  try {
    const data = await crearResena({
      usuarioId: req.usuario.id,
      productoId: req.body.productoId,
      puntuacion: req.body.puntuacion,
      comentario: req.body.comentario,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** PUT /api/resenas/:id — CLIENTE, sólo la propia. */
export const update = async (req, res, next) => {
  try {
    const data = await actualizarResena(req.params.id, req.usuario.id, {
      puntuacion: req.body.puntuacion,
      comentario: req.body.comentario,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** DELETE /api/resenas/:id — CLIENTE, sólo la propia. */
export const destroy = async (req, res, next) => {
  try {
    await eliminarResena(req.params.id, req.usuario.id);
    return res.json({ success: true, data: null });
  } catch (error) {
    return responderError(res, error, next);
  }
};
