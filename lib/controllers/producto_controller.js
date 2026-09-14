import db from '../models';

const { Categoria, Producto } = db;

const TIPOS_VALIDOS = ['PRODUCTO', 'COMBO'];

const serializar = (producto) => ({
  id: producto.id,
  nombre: producto.nombre,
  precio: Number(producto.precio),
  categoria: producto.Categoria ? producto.Categoria.nombre : null,
  categoriaId: producto.categoriaId,
  imagen: producto.imagen,
  descripcion: producto.descripcion,
  activo: producto.activo,
  tipo: producto.tipo,
});

const withCategoria = {
  model: Categoria,
  as: 'Categoria',
};

async function resolverCategoria(categoriaId, categoriaNombre) {
  if (categoriaId) {
    const categoria = await Categoria.findByPk(categoriaId);
    if (!categoria) {
      throw new Error('Categoría no encontrada');
    }
    return { id: categoria.id, nombre: categoria.nombre };
  }
  if (categoriaNombre) {
    const categoria = await Categoria.findOne({
      where: { nombre: String(categoriaNombre) },
    });
    if (!categoria) {
      throw new Error(`Categoría "${categoriaNombre}" no encontrada`);
    }
    return { id: categoria.id, nombre: categoria.nombre };
  }
  throw new Error('La categoría es obligatoria');
}

export const index = async (req, res) => {
  const productos = await Producto.findAll({
    where: { activo: true },
    include: [withCategoria],
    order: [['nombre', 'ASC']],
  });
  res.json({ success: true, data: productos.map(serializar) });
};

export const show = async (req, res) => {
  const producto = await Producto.findByPk(req.params.id, {
    include: [withCategoria],
  });
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  return res.json({ success: true, data: serializar(producto) });
};

export const create = async (req, res) => {
  const {
    nombre,
    precio,
    imagen,
    descripcion,
    categoria,
    categoriaId,
    tipo,
  } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({
      success: false,
      error: 'El tipo es obligatorio (PRODUCTO o COMBO)',
    });
  }
  if (
    precio === undefined ||
    Number.isNaN(Number(precio)) ||
    Number(precio) < 0
  ) {
    return res.status(400).json({
      success: false,
      error: 'El precio debe ser un número mayor o igual a 0',
    });
  }
  let categoriaResuelta;
  try {
    categoriaResuelta = await resolverCategoria(categoriaId, categoria);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  const producto = await Producto.create({
    nombre: String(nombre).trim(),
    precio: Number(precio),
    imagen,
    descripcion,
    categoriaId: categoriaResuelta.id,
    activo: true,
    tipo,
  });
  const conCategoria = await Producto.findByPk(producto.id, {
    include: [withCategoria],
  });
  return res
    .status(201)
    .json({ success: true, data: serializar(conCategoria) });
};

export const update = async (req, res) => {
  const {
    nombre,
    precio,
    imagen,
    descripcion,
    categoria,
    categoriaId,
    activo,
    tipo,
  } = req.body;
  const producto = await Producto.findByPk(req.params.id, {
    include: [withCategoria],
  });
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  const cambios = {};
  if (nombre !== undefined) {
    if (!String(nombre).trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'El nombre no puede quedar vacío' });
    }
    cambios.nombre = String(nombre).trim();
  }
  if (precio !== undefined) {
    if (Number.isNaN(Number(precio)) || Number(precio) < 0) {
      return res.status(400).json({
        success: false,
        error: 'El precio debe ser un número mayor o igual a 0',
      });
    }
    cambios.precio = Number(precio);
  }
  if (imagen !== undefined) {
    cambios.imagen = imagen;
  }
  if (descripcion !== undefined) {
    cambios.descripcion = descripcion;
  }
  if (activo !== undefined) {
    cambios.activo = Boolean(activo);
  }
  if (tipo !== undefined) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: 'El tipo debe ser PRODUCTO o COMBO',
      });
    }
    cambios.tipo = tipo;
  }
  if (categoria !== undefined || categoriaId !== undefined) {
    const categoriaActual = producto.Categoria;
    let categoriaResuelta;
    try {
      categoriaResuelta = await resolverCategoria(
        categoriaId,
        categoria ?? (categoriaActual ? categoriaActual.nombre : undefined)
      );
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
    cambios.categoriaId = categoriaResuelta.id;
  }
  await producto.update(cambios);
  const actualizado = await Producto.findByPk(producto.id, {
    include: [withCategoria],
  });
  return res.json({ success: true, data: serializar(actualizado) });
};

export const destroy = async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  await producto.update({ activo: false });
  return res.json({ success: true });
};
