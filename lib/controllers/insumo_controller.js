/**
 * Controller: insumos
 *
 * Catálogo corporativo de extras y condimentos con stock propio.
 *
 * - Lectura: pública (el formulario de personalización del superadmin y el
 *   catálogo la necesitan). El público sólo ve los activos; un usuario de
 *   gestión puede pedir `?activo=false` para ver la baja lógica.
 * - Escritura: sólo SUPERADMINISTRADOR, igual que el resto del catálogo.
 *
 * Las cantidades por sucursal NO se tocan acá: viven en `/api/stock/insumos` y
 * las opera el ADMINISTRADOR de cada sucursal.
 */
import { Op } from 'sequelize';
import db from '../models';
import {
  InsumoInvalidoError,
  actualizarInsumo,
  crearInsumo,
  darDeBajaInsumo,
  normalizarTipo,
  TIPOS_VALIDOS,
} from '../services/insumos';

const { Insumo } = db;

const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

const responderError = (res, error) => {
  if (error instanceof InsumoInvalidoError) {
    return res
      .status(error.status || 400)
      .json({ success: false, error: error.message });
  }
  throw error;
};

/** GET /api/insumos?tipo=extra|condimento&activo=true|false&q=texto */
export const index = async (req, res) => {
  const where = {};

  if (req.query.tipo) {
    const tipo = normalizarTipo(req.query.tipo);
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ success: false, error: 'Tipo inválido' });
    }
    where.tipo = tipo;
  }

  if (req.query.activo !== undefined) {
    where.activo = String(req.query.activo) !== 'false';
  } else if (!esGestion(req)) {
    // El listado público sólo ve lo que se puede ofrecer.
    where.activo = true;
  }

  if (req.query.q) {
    where.nombre = { [Op.iLike]: `%${String(req.query.q).trim()}%` };
  }

  const insumos = await Insumo.findAll({
    where,
    order: [
      ['tipo', 'ASC'],
      ['nombre', 'ASC'],
    ],
  });

  return res.json({
    success: true,
    data: insumos.map((insumo) => insumo.toJSON()),
  });
};

/** GET /api/insumos/:id */
export const show = async (req, res) => {
  const insumo = await Insumo.findByPk(req.params.id);
  if (!insumo || (!insumo.activo && !esGestion(req))) {
    return res
      .status(404)
      .json({ success: false, error: 'Insumo no encontrado' });
  }
  return res.json({ success: true, data: insumo.toJSON() });
};

/** POST /api/insumos */
export const create = async (req, res) => {
  try {
    const insumo = await crearInsumo(req.body || {});
    return res.status(201).json({
      success: true,
      data: { ...insumo.toJSON(), stockTotal: 0 },
    });
  } catch (error) {
    return responderError(res, error);
  }
};

/** PUT /api/insumos/:id */
export const update = async (req, res) => {
  const insumo = await Insumo.findByPk(req.params.id);
  if (!insumo) {
    return res
      .status(404)
      .json({ success: false, error: 'Insumo no encontrado' });
  }
  try {
    const actualizado = await actualizarInsumo(insumo, req.body || {});
    return res.json({ success: true, data: actualizado.toJSON() });
  } catch (error) {
    return responderError(res, error);
  }
};

/** DELETE /api/insumos/:id — baja lógica. */
export const destroy = async (req, res) => {
  const insumo = await Insumo.findByPk(req.params.id);
  if (!insumo) {
    return res
      .status(404)
      .json({ success: false, error: 'Insumo no encontrado' });
  }
  await darDeBajaInsumo(insumo);
  return res.json({ success: true });
};
