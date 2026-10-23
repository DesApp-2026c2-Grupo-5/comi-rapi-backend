import db from '../models';
import {
  TIPOS_VALIDOS,
  buscarDuplicado,
  normalizarCantidad,
  normalizarTipo,
  validarCantidades,
  validarPrecioSegunTipo,
} from '../services/personalizacion_categorias';

const { Categoria, PersonalizacionCategoria, Producto } = db;

const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

const serializar = (elemento) => elemento.toJSON();

const existeCategoria = async (categoriaId) =>
  Boolean(await Categoria.findByPk(categoriaId));

const existeProducto = async (productoId) =>
  Boolean(await Producto.findByPk(productoId));

export const index = async (req, res) => {
  const where = {};
  if (req.query.categoriaId) {
    const categoriaId = Number(req.query.categoriaId);
    if (!Number.isInteger(categoriaId)) {
      return res
        .status(400)
        .json({ success: false, error: 'categoriaId inválido' });
    }
    where.categoriaId = categoriaId;
  }
  // El listado público (fallback del cliente) sólo ve plantillas activas.
  if (req.query.activa !== 'false' || !esGestion(req)) {
    where.activo = true;
  }
  const elementos = await PersonalizacionCategoria.findAll({
    where,
    order: [
      ['categoriaId', 'ASC'],
      ['tipo', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  res.json({
    success: true,
    data: elementos.map(serializar),
  });
};

export const show = async (req, res) => {
  const elemento = await PersonalizacionCategoria.findByPk(req.params.id);
  if (!elemento || (!elemento.activo && !esGestion(req))) {
    return res
      .status(404)
      .json({ success: false, error: 'Plantilla no encontrada' });
  }
  return res.json({ success: true, data: serializar(elemento) });
};

export const create = async (req, res) => {
  const {
    categoriaId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
    minimo,
    maximo,
    activo,
  } = req.body;

  if (!categoriaId) {
    return res
      .status(400)
      .json({ success: false, error: 'La categoría es obligatoria' });
  }
  if (!(await existeCategoria(categoriaId))) {
    return res
      .status(400)
      .json({ success: false, error: 'La categoría no existe' });
  }

  const tipoNormalizado = normalizarTipo(tipo);
  if (!TIPOS_VALIDOS.includes(tipoNormalizado)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  const errorPrecio = validarPrecioSegunTipo(tipoNormalizado, precio);
  if (errorPrecio) {
    return res.status(400).json({ success: false, error: errorPrecio });
  }

  const minimoFinal = normalizarCantidad(minimo, 0);
  const maximoFinal = normalizarCantidad(maximo, 1);
  const errorCantidades = validarCantidades(minimoFinal, maximoFinal);
  if (errorCantidades) {
    return res.status(400).json({ success: false, error: errorCantidades });
  }

  if (tipoNormalizado === 'acompanar') {
    if (!productoReferenciaId) {
      return res.status(400).json({
        success: false,
        error: 'El producto a ofrecer es obligatorio para tipo acompanar',
      });
    }
    if (!(await existeProducto(productoReferenciaId))) {
      return res.status(400).json({
        success: false,
        error: 'El producto de referencia no existe',
      });
    }
  }

  const todos = await PersonalizacionCategoria.findAll({
    where: { categoriaId },
  });
  const duplicado = buscarDuplicado(todos, tipoNormalizado, {
    nombre,
    productoReferenciaId,
  });
  if (duplicado) {
    return res.status(400).json({
      success: false,
      error: 'Ya existe una plantilla igual para esta categoría y tipo',
    });
  }

  const elemento = await PersonalizacionCategoria.create({
    categoriaId,
    tipo: tipoNormalizado,
    nombre: nombre || null,
    precio: ['extra', 'acompanar'].includes(tipoNormalizado)
      ? Number(precio)
      : null,
    productoReferenciaId:
      tipoNormalizado === 'acompanar' ? productoReferenciaId : null,
    minimo: minimoFinal,
    maximo: maximoFinal,
    activo: activo !== undefined ? Boolean(activo) : true,
  });

  return res.status(201).json({ success: true, data: serializar(elemento) });
};

export const update = async (req, res) => {
  const elemento = await PersonalizacionCategoria.findByPk(req.params.id);
  if (!elemento) {
    return res
      .status(404)
      .json({ success: false, error: 'Plantilla no encontrada' });
  }

  const {
    categoriaId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
    minimo,
    maximo,
    activo,
  } = req.body;

  const nuevaCategoriaId =
    categoriaId !== undefined ? categoriaId : elemento.categoriaId;
  if (!(await existeCategoria(nuevaCategoriaId))) {
    return res
      .status(400)
      .json({ success: false, error: 'La categoría no existe' });
  }

  const nuevoTipo = tipo !== undefined ? normalizarTipo(tipo) : elemento.tipo;
  if (!TIPOS_VALIDOS.includes(nuevoTipo)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  const precioFinal = precio !== undefined ? precio : elemento.precio;
  const errorPrecio = validarPrecioSegunTipo(nuevoTipo, precioFinal);
  if (errorPrecio) {
    return res.status(400).json({ success: false, error: errorPrecio });
  }

  const minimoFinal =
    minimo !== undefined
      ? normalizarCantidad(minimo, elemento.minimo)
      : elemento.minimo;
  const maximoFinal =
    maximo !== undefined
      ? normalizarCantidad(maximo, elemento.maximo)
      : elemento.maximo;
  const errorCantidades = validarCantidades(minimoFinal, maximoFinal);
  if (errorCantidades) {
    return res.status(400).json({ success: false, error: errorCantidades });
  }

  const nuevaReferencia =
    productoReferenciaId !== undefined
      ? productoReferenciaId
      : elemento.productoReferenciaId;
  if (nuevoTipo === 'acompanar') {
    if (!nuevaReferencia) {
      return res.status(400).json({
        success: false,
        error: 'El producto a ofrecer es obligatorio para tipo acompanar',
      });
    }
    if (!(await existeProducto(nuevaReferencia))) {
      return res.status(400).json({
        success: false,
        error: 'El producto de referencia no existe',
      });
    }
  }

  const todos = await PersonalizacionCategoria.findAll({
    where: { categoriaId: nuevaCategoriaId },
  });
  const duplicado = buscarDuplicado(
    todos,
    nuevoTipo,
    {
      nombre: nombre ?? elemento.nombre,
      productoReferenciaId: nuevaReferencia,
    },
    elemento.id
  );
  if (duplicado) {
    return res.status(400).json({
      success: false,
      error: 'Ya existe una plantilla igual para esta categoría y tipo',
    });
  }

  const cambios = {};
  if (categoriaId !== undefined) cambios.categoriaId = categoriaId;
  if (tipo !== undefined) cambios.tipo = nuevoTipo;
  if (nombre !== undefined) cambios.nombre = nombre || null;
  if (precio !== undefined || tipo !== undefined) {
    cambios.precio = ['extra', 'acompanar'].includes(nuevoTipo)
      ? Number(precioFinal)
      : null;
  }
  if (productoReferenciaId !== undefined || tipo !== undefined) {
    // Al cambiar a acompanar sin reenviar la referencia, conservar la que ya
    // tenía la plantilla en lugar de dejarla en null.
    cambios.productoReferenciaId =
      nuevoTipo === 'acompanar' ? nuevaReferencia : null;
  }
  if (activo !== undefined) cambios.activo = Boolean(activo);
  if (minimo !== undefined) cambios.minimo = minimoFinal;
  if (maximo !== undefined) cambios.maximo = maximoFinal;

  await elemento.update(cambios);
  return res.json({ success: true, data: serializar(elemento) });
};

export const destroy = async (req, res) => {
  const elemento = await PersonalizacionCategoria.findByPk(req.params.id);
  if (!elemento) {
    return res
      .status(404)
      .json({ success: false, error: 'Plantilla no encontrada' });
  }
  await elemento.update({ activo: false });
  return res.json({ success: true });
};
