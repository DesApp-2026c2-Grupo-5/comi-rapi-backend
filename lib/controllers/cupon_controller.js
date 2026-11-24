import {
  CuponError,
  cambiarActivoCupon,
  detalleCuponAdmin,
  evaluarCuponesParaCarrito,
  listarCuponesAdmin,
  listarCuponesCliente,
} from '../services/cupones';
import {
  EmisionError,
  validarDatosEmision,
  previewDestinatarios,
  emitir,
  reenviarEmision,
  obtenerEmision,
  obtenerCuponesDeEmision,
  listarEmisiones,
} from '../services/cupon_emisiones';

/**
 * Traduce los errores de negocio de cupones y emisiones a HTTP.
 */
const responderError = (res, error, next) => {
  if (error instanceof CuponError || error instanceof EmisionError) {
    return res.status(error.codigo).json({
      success: false,
      error: error.message,
      motivo: error.motivo,
    });
  }
  return next(error);
};

/**
 * GET /api/cupones — listado administrativo paginado.
 * Filtros: `emisionId`, `activo`, `estado`, `pagina`, `limite`.
 */
export const index = async (req, res, next) => {
  try {
    const data = await listarCuponesAdmin({
      emisionId: req.query.emisionId,
      activo: req.query.activo,
      estado: req.query.estado,
      pagina: req.query.pagina,
      limite: req.query.limite,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/** GET /api/cupones/:id — detalle de un cupón con su estado derivado. */
export const show = async (req, res, next) => {
  try {
    const data = await detalleCuponAdmin(req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * PATCH /api/cupones/:id/activo — baja o reactivación individual.
 * Body: `{ activo: true|false }`.
 */
export const activar = async (req, res, next) => {
  try {
    const data = await cambiarActivoCupon(req.params.id, req.body.activo);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * GET /api/cupones/mios — cupones del cliente autenticado.
 */
export const mios = async (req, res, next) => {
  try {
    const data = await listarCuponesCliente(req.usuario.id);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * POST /api/cupones/evaluar-carrito — elegibilidad de los cupones del cliente
 * frente al carrito que se está armando. No persiste nada: el alta de pedidos
 * vuelve a calcular lo mismo con las líneas definitivas.
 */
export const evaluarCarrito = async (req, res, next) => {
  try {
    const {
      codigos,
      lineas,
      descuentoPromocionesPorLinea,
      subtotalItems,
      descuentoPromociones,
    } = req.body || {};
    const resultados = await evaluarCuponesParaCarrito(req.usuario.id, {
      codigos,
      lineas,
      descuentoPromocionesPorLinea,
      subtotalItems,
      descuentoPromociones,
    });
    return res.json({ success: true, data: { resultados } });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * POST /api/cupones/preview — previsualiza destinatarios elegibles sin
 * persistir nada. Devuelve un previewToken para la confirmación.
 */
export const preview = async (req, res, next) => {
  try {
    const datos = validarDatosEmision(req.body);
    const data = await previewDestinatarios(datos, {
      ahora: req.query.ahora || new Date(),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * POST /api/cupones/emisiones — confirma y emite los cupones para los
 * destinatarios aprobados en la preview.
 * Body: datos de la emision + previewToken + previewExpiraEn + destinatariosIds.
 */
export const crearEmision = async (req, res, next) => {
  try {
    // `validarDatosEmision` normaliza solo la configuración. El token y los
    // destinatarios aprobados en el preview son parte de la confirmación y
    // deben llegar intactos al service (si se pierden, la emisión siempre
    // falla con `preview_requerido`).
    const datos = {
      ...validarDatosEmision(req.body),
      destinatariosIds: req.body.destinatariosIds,
      previewToken: req.body.previewToken,
      previewExpiraEn: req.body.previewExpiraEn,
    };
    const data = await emitir(datos, {
      usuarioId: req.usuario.id,
      ahora: new Date(),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * GET /api/cupones/emisiones — listado de emisiones con filtros.
 */
export const listarEmisionesCtrl = async (req, res, next) => {
  try {
    const data = await listarEmisiones({
      estado: req.query.estado,
      desde: req.query.desde,
      hasta: req.query.hasta,
      pagina: req.query.pagina,
      limite: req.query.limite,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * GET /api/cupones/emisiones/:id — datos propios de la emisión, sin cupones.
 */
export const obtenerEmisionCtrl = async (req, res, next) => {
  try {
    const data = await obtenerEmision(req.params.id);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Emisión no encontrada',
        motivo: 'emision_no_encontrada',
      });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * GET /api/cupones/emisiones/:id/cupones — datos complementarios del detalle:
 * cupones de la emisión y nombres del alcance congelado en el snapshot.
 */
export const obtenerCuponesEmisionCtrl = async (req, res, next) => {
  try {
    const data = await obtenerCuponesDeEmision(req.params.id);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Emisión no encontrada',
        motivo: 'emision_no_encontrada',
      });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};

/**
 * POST /api/cupones/emisiones/:id/reenviar — reintenta envíos fallidos/pendientes.
 */
export const reenviarEmisionCtrl = async (req, res, next) => {
  try {
    const data = await reenviarEmision(req.params.id, {
      ahora: new Date(),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error, next);
  }
};
