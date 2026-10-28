import db from '../models';
import { marcarDisponibilidad } from '../services/disponibilidad_insumos';
import { InsumoInvalidoError } from '../services/insumos';
import {
  TIPOS_VALIDOS,
  TIPOS_CON_STOCK,
  buscarDuplicado,
  normalizarCantidad,
  normalizarTipo,
  resolverInsumoDeElemento,
  validarCantidades,
  validarPrecioSegunTipo,
} from '../services/personalizacion_categorias';

const { Categoria, PersonalizacionCategoria, Producto } = db;

const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

const existeCategoria = async (categoriaId) =>
  Boolean(await Categoria.findByPk(categoriaId));

const existeProducto = async (productoId) =>
  Boolean(await Producto.findByPk(productoId));

const responderError = (res, error) => {
  if (error instanceof InsumoInvalidoError) {
    return res
      .status(error.status || 400)
      .json({ success: false, error: error.message });
  }
  throw error;
};

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
    data: await marcarDisponibilidad(elementos),
  });
};

export const show = async (req, res) => {
  const elemento = await PersonalizacionCategoria.findByPk(req.params.id);
  if (!elemento || (!elemento.activo && !esGestion(req))) {
    return res
      .status(404)
      .json({ success: false, error: 'Plantilla no encontrada' });
  }
  const [data] = await marcarDisponibilidad([elemento]);
  return res.json({ success: true, data });
};

export const create = async (req, res) => {
  const {
    categoriaId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
    insumoId,
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

  try {
    const insumo = await resolverInsumoDeElemento(insumoId, tipoNormalizado);
    const nombreFinal =
      String(nombre || '').trim() || (insumo ? insumo.nombre : null);
    const precioFinal =
      tipoNormalizado === 'extra' &&
      (precio === undefined || precio === null || precio === '') &&
      insumo
        ? insumo.precio
        : precio;

    const errorPrecio = validarPrecioSegunTipo(tipoNormalizado, precioFinal);
    if (errorPrecio) {
      return res.status(400).json({ success: false, error: errorPrecio });
    }

    const todos = await PersonalizacionCategoria.findAll({
      where: { categoriaId },
    });
    const duplicado = buscarDuplicado(todos, tipoNormalizado, {
      nombre: nombreFinal,
      productoReferenciaId,
      insumoId: insumo ? insumo.id : null,
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
      nombre: nombreFinal,
      precio: ['extra', 'acompanar'].includes(tipoNormalizado)
        ? Number(precioFinal)
        : null,
      productoReferenciaId:
        tipoNormalizado === 'acompanar' ? productoReferenciaId : null,
      insumoId: insumo ? insumo.id : null,
      minimo: minimoFinal,
      maximo: maximoFinal,
      activo: activo !== undefined ? Boolean(activo) : true,
    });

    const [data] = await marcarDisponibilidad([elemento]);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderError(res, error);
  }
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
    insumoId,
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

  try {
    const insumoRecibido =
      insumoId !== undefined
        ? insumoId
        : TIPOS_CON_STOCK.includes(nuevoTipo)
        ? elemento.insumoId
        : null;
    const insumo = await resolverInsumoDeElemento(insumoRecibido, nuevoTipo, {
      permitirInactivo:
        elemento.insumoId !== null &&
        String(insumoRecibido) === String(elemento.insumoId),
    });
    const cambioInsumo =
      insumoId !== undefined &&
      String(insumoRecibido ?? '') !== String(elemento.insumoId ?? '');

    const nombreFinal =
      nombre !== undefined
        ? nombre || null
        : cambioInsumo && insumo
        ? insumo.nombre
        : elemento.nombre;
    const precioFinal =
      nuevoTipo === 'condimento' || nuevoTipo === 'personalizar'
        ? null
        : precio !== undefined
        ? precio
        : nuevoTipo === 'extra' && cambioInsumo && insumo
        ? insumo.precio
        : elemento.precio;

    const errorPrecio = validarPrecioSegunTipo(nuevoTipo, precioFinal);
    if (errorPrecio) {
      return res.status(400).json({ success: false, error: errorPrecio });
    }

    const todos = await PersonalizacionCategoria.findAll({
      where: { categoriaId: nuevaCategoriaId },
    });
    const duplicado = buscarDuplicado(
      todos,
      nuevoTipo,
      {
        nombre: nombreFinal,
        productoReferenciaId: nuevaReferencia,
        insumoId: insumo ? insumo.id : null,
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
    if (nombre !== undefined || cambioInsumo) cambios.nombre = nombreFinal;
    if (precio !== undefined || tipo !== undefined || cambioInsumo) {
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
    if (insumoId !== undefined || tipo !== undefined) {
      cambios.insumoId = insumo ? insumo.id : null;
    }
    if (activo !== undefined) cambios.activo = Boolean(activo);
    if (minimo !== undefined) cambios.minimo = minimoFinal;
    if (maximo !== undefined) cambios.maximo = maximoFinal;

    await elemento.update(cambios);
    const [data] = await marcarDisponibilidad([elemento]);
    return res.json({ success: true, data });
  } catch (error) {
    return responderError(res, error);
  }
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
