/**
 * Controller: ingredientes
 *
 * Catálogo corporativo de materias primas para las recetas.
 *
 * - Lectura: pública (el formulario de producto y el detalle del cliente la
 *   necesitan). El público sólo ve los activos; un usuario de gestión puede
 *   pedir `?activo=false` para ver la baja lógica.
 * - Escritura: sólo SUPERADMINISTRADOR, igual que el resto del catálogo.
 *
 * Las cantidades por sucursal viven en `/api/stock/ingredientes` y las opera el
 * ADMINISTRADOR de cada sucursal.
 */
import db from '../models';
import {
  IngredienteInvalidoError,
  actualizarIngrediente,
  crearIngrediente,
  darDeBajaIngrediente,
  listarIngredientes,
  obtenerIngrediente,
} from '../services/ingredientes_catalogo';

const { Ingrediente } = db;

const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

const responderError = (res, error) => {
  if (error instanceof IngredienteInvalidoError) {
    return res
      .status(error.status || 400)
      .json({ success: false, error: error.message });
  }
  throw error;
};

/** GET /api/ingredientes?activo=true|false */
export const index = async (req, res) => {
  const activo =
    req.query.activo !== undefined
      ? String(req.query.activo) !== 'false'
      : esGestion(req)
      ? undefined
      : true;

  const ingredientes = await listarIngredientes({ activo });
  return res.json({ success: true, data: ingredientes });
};

/** GET /api/ingredientes/:id */
export const show = async (req, res) => {
  try {
    const ingrediente = await obtenerIngrediente(req.params.id);
    if (!ingrediente.activo && !esGestion(req)) {
      return res
        .status(404)
        .json({ success: false, error: 'Ingrediente no encontrado' });
    }
    return res.json({ success: true, data: ingrediente });
  } catch (error) {
    return responderError(res, error);
  }
};

/** POST /api/ingredientes */
export const create = async (req, res) => {
  try {
    const ingrediente = await crearIngrediente(req.body || {});
    return res.status(201).json({
      success: true,
      data: {
        id: Number(ingrediente.id),
        nombre: ingrediente.nombre,
        unidadMedida: ingrediente.unidadMedida,
        activo: Boolean(ingrediente.activo),
        enUso: false,
        recetas: 0,
        stockTotal: 0,
      },
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/** PUT /api/ingredientes/:id */
export const update = async (req, res) => {
  const ingrediente = await Ingrediente.findByPk(req.params.id);
  if (!ingrediente) {
    return res
      .status(404)
      .json({ success: false, error: 'Ingrediente no encontrado' });
  }
  try {
    await actualizarIngrediente(ingrediente, req.body || {});
    const actualizado = await obtenerIngrediente(ingrediente.id);
    return res.json({ success: true, data: actualizado });
  } catch (error) {
    return responderError(res, error);
  }
};

/** DELETE /api/ingredientes/:id — baja lógica. */
export const destroy = async (req, res) => {
  const ingrediente = await Ingrediente.findByPk(req.params.id);
  if (!ingrediente) {
    return res
      .status(404)
      .json({ success: false, error: 'Ingrediente no encontrado' });
  }
  await darDeBajaIngrediente(ingrediente);
  return res.json({ success: true });
};
