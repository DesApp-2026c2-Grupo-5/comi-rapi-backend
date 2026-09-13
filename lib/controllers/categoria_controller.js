import { Op } from 'sequelize';
import db from '../models';

const { Categoria, Producto } = db;

export const index = async (req, res) => {
  const categorias = await Categoria.findAll({
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
  return res.json({ success: true, data: categoria.toJSON() });
};

export const create = async (req, res) => {
  const { nombre, descripcion } = req.body;
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
  const { nombre, descripcion } = req.body;
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
  const conProductos = await Producto.count({
    where: { categoriaId: categoria.id },
  });
  if (conProductos > 0) {
    return res.status(400).json({
      success: false,
      error: 'La categoría tiene productos asociados',
    });
  }
  await categoria.destroy();
  return res.json({ success: true });
};
