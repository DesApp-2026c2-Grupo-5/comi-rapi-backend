/**
 * Controller: sucursal_controller
 *
 * Lectura de sucursales (público + vista admin de inactivas).
 *
 * Funciones implementadas:
 *   - index(req, res):   GET /api/sucursales
 *       - Lista solo las sucursales activas (listado público).
 *       - Un ADMIN puede pasar ?activa=false para ver todas (incluye inactivas).
 *       - Respuesta: { success: true, data: [{ id, nombre, direccion, latitud, longitud, telefono, horarios, activa }] }
 *
 *   - show(req, res):    GET /api/sucursales/:id
 *       - Devuelve una sucursal por id, 404 si no existe.
 *       - Las inactivas solo son visibles para un ADMIN (404 para el resto).
 *
 * Pendiente de implementar (sprint futuro, no forma parte de esta etapa):
 *   - create(req, res):  POST /api/sucursales   (ADMIN)
 *   - update(req, res):  PUT /api/sucursales/:id   (ADMIN)
 *   - destroy(req, res): DELETE /api/sucursales/:id   (ADMIN, baja lógica: activa = false)
 *
 * Modelo: Sucursal (lib/models/sucursal.js). Sin lógica de negocio en este controller.
 */

import db from '../models';

const { Sucursal } = db;

const esAdministrador = (req) =>
  req.usuario && req.usuario.rol === 'ADMINISTRADOR';

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const soloActivas = req.query.activa !== 'false' || !esAdmin;
  const where = soloActivas ? { activa: true } : {};
  const sucursales = await Sucursal.findAll({
    where,
    order: [['nombre', 'ASC']],
  });
  res.json({
    success: true,
    data: sucursales.map((sucursal) => sucursal.toJSON()),
  });
};

export const show = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  if (!sucursal.activa && !esAdministrador(req)) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  return res.json({ success: true, data: sucursal.toJSON() });
};
