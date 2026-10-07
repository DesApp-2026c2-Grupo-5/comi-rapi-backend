import { Op } from 'sequelize';
import db from '../models';

const { Categoria } = db;

// Ambos roles de gestión ven las categorías inactivas: el ADMINISTRADOR para
// operar la disponibilidad de su sucursal (stock) y el SUPERADMINISTRADOR para
// el CRUD del catálogo.
const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

export const index = async (req, res) => {
  const esGestionActiva = esGestion(req);
  const soloActivas = req.query.activa !== 'false' || !esGestionActiva;
  const where = soloActivas ? { activa: true } : {};
  const categorias = await Categoria.findAll({
    where,
    order: [['nombre', 'ASC']],
  });
  res.json({
    success: true,
    data: categorias.map((categoria) => categoria.toJSON()),
  });
};

export const show = async (req, res) => {
  const categoria = await Categoria.findByPk(req.params.id);
  if (!categoria) {
    return res
      .status(404)
      .json({ success: false, error: 'Categoría no encontrada' });
  }
  if (!categoria.activa && !esGestion(req)) {
    return res
      .status(404)
      .json({ success: false, error: 'Categoría no encontrada' });
  }
  return res.json({ success: true, data: categoria.toJSON() });
};

export const create = async (req, res) => {
  const { nombre, descripcion, imagen } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  const nombreLimpio = String(nombre).trim();
  const yaExiste = await Categoria.findOne({ where: { nombre: nombreLimpio } });
  if (yaExiste) {
    return res
      .status(400)
      .json({ success: false, error: 'Ya existe esa categoría' });
  }
  const categoria = await Categoria.create({
    nombre: nombreLimpio,
    descripcion,
    imagen,
  });
  return res.status(201).json({ success: true, data: categoria.toJSON() });
};

export const update = async (req, res) => {
  const categoria = await Categoria.findByPk(req.params.id);
  if (!categoria) {
    return res
      .status(404)
      .json({ success: false, error: 'Categoría no encontrada' });
  }
  const { nombre, descripcion, activa, imagen } = req.body;
  const cambios = {};
  if (nombre !== undefined) {
    const nombreLimpio = String(nombre).trim();
    if (!nombreLimpio) {
      return res
        .status(400)
        .json({ success: false, error: 'El nombre no puede quedar vacío' });
    }
    const duplicado = await Categoria.findOne({
      where: { nombre: nombreLimpio, id: { [Op.ne]: categoria.id } },
    });
    if (duplicado) {
      return res
        .status(400)
        .json({ success: false, error: 'Ya existe esa categoría' });
    }
    cambios.nombre = nombreLimpio;
  }
  if (descripcion !== undefined) {
    cambios.descripcion = descripcion;
  }
  if (imagen !== undefined) {
    cambios.imagen = imagen;
  }
  if (activa !== undefined) {
    cambios.activa = Boolean(activa);
  }
  await categoria.update(cambios);
  return res.json({ success: true, data: categoria.toJSON() });
};

export const destroy = async (req, res) => {
  const categoria = await Categoria.findByPk(req.params.id);
  if (!categoria) {
    return res
      .status(404)
      .json({ success: false, error: 'Categoría no encontrada' });
  }
  await categoria.update({ activa: false });
  return res.json({ success: true });
};
