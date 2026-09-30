import db from '../models';
import {
  borrarComponentes,
  guardarComponentes,
  obtenerComponentesDeCombos,
} from '../services/combo';

const { Categoria, Producto } = db;

const TIPOS_VALIDOS = ['PRODUCTO', 'COMBO'];

const serializar = (producto, componentes) => ({
  id: producto.id,
  nombre: producto.nombre,
  precio: Number(producto.precio),
  categoria: producto.Categoria ? producto.Categoria.nombre : null,
  categoriaId: producto.categoriaId,
  imagen: producto.imagen,
  descripcion: producto.descripcion,
  activo: producto.activo,
  tipo: producto.tipo,
  ...(componentes ? { componentes } : {}),
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
  const recetas = await obtenerComponentesDeCombos(
    productos.filter((p) => p.tipo === 'COMBO').map((p) => p.id)
  );
  res.json({
    success: true,
    data: productos.map((producto) =>
      producto.tipo === 'COMBO'
        ? serializar(producto, recetas.get(producto.id) ?? [])
        : serializar(producto)
    ),
  });
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
  const recetas = await obtenerComponentesDeCombos([producto.id]);
  return res.json({
    success: true,
    data:
      producto.tipo === 'COMBO'
        ? serializar(producto, recetas.get(producto.id) ?? [])
        : serializar(producto),
  });
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
    componentes,
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
  if (tipo === 'PRODUCTO' && componentes !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'Solo un combo puede tener componentes',
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
  // Producto y receta van juntos: si la receta es inválida no queda un combo
  // guardado a medias.
  const id = await db.sequelize.transaction(async (t) => {
    const producto = await Producto.create(
      {
        nombre: String(nombre).trim(),
        precio: Number(precio),
        imagen,
        descripcion,
        categoriaId: categoriaResuelta.id,
        activo: true,
        tipo,
      },
      { transaction: t }
    );
    if (tipo === 'COMBO') {
      await guardarComponentes(producto.id, componentes, { transaction: t });
    }
    return producto.id;
  });
  const conCategoria = await Producto.findByPk(id, {
    include: [withCategoria],
  });
  const recetas = await obtenerComponentesDeCombos([id]);
  return res.status(201).json({
    success: true,
    data:
      tipo === 'COMBO'
        ? serializar(conCategoria, recetas.get(id) ?? [])
        : serializar(conCategoria),
  });
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
    componentes,
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
  const tipoFinal = tipo !== undefined ? tipo : producto.tipo;
  if (tipo !== undefined) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: 'El tipo debe ser PRODUCTO o COMBO',
      });
    }
    cambios.tipo = tipo;
  }
  if (tipoFinal === 'PRODUCTO' && componentes !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'Solo un combo puede tener componentes',
    });
  }
  // Pasar a COMBO exige receta: un combo sin componentes no se puede vender ni
  // calcular su disponibilidad.
  if (
    producto.tipo === 'PRODUCTO' &&
    tipoFinal === 'COMBO' &&
    componentes === undefined
  ) {
    return res.status(400).json({
      success: false,
      error:
        'Para convertir el producto en combo hay que pasar sus componentes',
    });
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
  // Cambios de datos y receta en la misma transacción: un combo no queda con
  // datos nuevos y receta vieja (o al revés).
  await db.sequelize.transaction(async (t) => {
    await producto.update(cambios, { transaction: t });
    if (tipoFinal === 'COMBO' && componentes !== undefined) {
      await guardarComponentes(producto.id, componentes, { transaction: t });
    } else if (tipoFinal === 'PRODUCTO') {
      // Dejó de ser combo: su receta ya no significa nada.
      await borrarComponentes(producto.id, { transaction: t });
    }
  });
  const actualizado = await Producto.findByPk(producto.id, {
    include: [withCategoria],
  });
  const recetas = await obtenerComponentesDeCombos([producto.id]);
  return res.json({
    success: true,
    data:
      tipoFinal === 'COMBO'
        ? serializar(actualizado, recetas.get(producto.id) ?? [])
        : serializar(actualizado),
  });
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
