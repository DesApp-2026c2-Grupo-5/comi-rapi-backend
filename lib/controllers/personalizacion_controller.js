import db from '../models';
import { marcarDisponibilidad } from '../services/disponibilidad_insumos';
import { InsumoInvalidoError } from '../services/insumos';
import {
  TIPOS_CON_STOCK,
  resolverInsumoDeElemento,
} from '../services/personalizacion_categorias';

const { PersonalizacionElemento } = db;

const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

const validarPrecioSegunTipo = (tipo, precio) => {
  const tipoNormalizado = String(tipo || '').toLowerCase();
  const requierePrecio =
    tipoNormalizado === 'extra' || tipoNormalizado === 'acompanar';
  const precioNumerico = Number(precio);
  if (requierePrecio) {
    if (
      precio === null ||
      precio === undefined ||
      Number.isNaN(precioNumerico) ||
      precioNumerico < 0
    ) {
      return 'El precio es obligatorio para tipo extra/acompanar';
    }
  } else {
    return null;
  }
  return null;
};

// Normaliza minimo/maximo a enteros. Valores ausentes usan el default
// (mínimo 0, máximo 1) para no romper compatibilidad con clientes viejos.
const normalizarCantidad = (valor, porDefecto) => {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  return Number(valor);
};

const validarCantidades = (minimo, maximo) => {
  if (!Number.isInteger(minimo) || minimo < 0) {
    return 'El mínimo debe ser un entero mayor o igual a 0';
  }
  if (!Number.isInteger(maximo) || maximo < 1) {
    return 'El máximo debe ser un entero mayor o igual a 1';
  }
  if (maximo < minimo) {
    return 'El máximo no puede ser menor que el mínimo';
  }
  return null;
};

const validarDuplicado = async (
  elementos,
  productoId,
  tipo,
  datos,
  idExcluir = null
) => {
  return elementos.find((e) => {
    if (idExcluir && String(e.id) === String(idExcluir)) return false;
    if (String(e.productoId) !== String(productoId)) return false;
    if (e.tipo !== tipo) return false;
    if (tipo === 'acompanar') {
      return (
        String(e.productoReferenciaId) === String(datos.productoReferenciaId)
      );
    }
    // Si el elemento apunta a un insumo, la identidad es el insumo: dos
    // elementos del mismo producto no pueden descontar dos veces el mismo.
    if (datos.insumoId) {
      return String(e.insumoId) === String(datos.insumoId);
    }
    return (
      (e.nombre || '').toLowerCase() === (datos.nombre || '').toLowerCase()
    );
  });
};

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
  if (req.query.productoId) {
    where.productoId = Number(req.query.productoId);
  }
  if (req.query.activa !== 'false' || !esGestion(req)) {
    where.activo = true;
  }
  const elementos = await PersonalizacionElemento.findAll({
    where,
    order: [
      ['productoId', 'ASC'],
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
  const elemento = await PersonalizacionElemento.findByPk(req.params.id);
  if (!elemento || (!elemento.activo && !esGestion(req))) {
    return res
      .status(404)
      .json({ success: false, error: 'Elemento no encontrado' });
  }
  const [data] = await marcarDisponibilidad([elemento]);
  return res.json({ success: true, data });
};

export const create = async (req, res) => {
  const {
    productoId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
    insumoId,
    minimo,
    maximo,
    activo,
  } = req.body;

  if (!productoId) {
    return res
      .status(400)
      .json({ success: false, error: 'El productoId es obligatorio' });
  }
  const tipoNormalizado = String(tipo || '').toLowerCase();
  if (
    !['extra', 'personalizar', 'acompanar', 'condimento'].includes(
      tipoNormalizado
    )
  ) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  const minimoFinal = normalizarCantidad(minimo, 0);
  const maximoFinal = normalizarCantidad(maximo, 1);
  const errorCantidades = validarCantidades(minimoFinal, maximoFinal);
  if (errorCantidades) {
    return res.status(400).json({ success: false, error: errorCantidades });
  }

  if (
    tipoNormalizado === 'acompanar' &&
    String(productoReferenciaId) === String(productoId)
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'No podés ofrecer el mismo producto' });
  }

  const productoExiste = await db.Producto.findByPk(productoId);
  if (!productoExiste) {
    return res
      .status(400)
      .json({ success: false, error: 'El producto no existe' });
  }

  if (tipoNormalizado === 'acompanar' && productoReferenciaId) {
    const refExiste = await db.Producto.findByPk(productoReferenciaId);
    if (!refExiste) {
      return res
        .status(400)
        .json({ success: false, error: 'El producto de referencia no existe' });
    }
  }

  try {
    const insumo = await resolverInsumoDeElemento(insumoId, tipoNormalizado);
    const nombreFinal =
      String(nombre || '').trim() || (insumo ? insumo.nombre : null);
    // El insumo define un precio de referencia; si el formulario no manda uno,
    // se usa ese. El elemento puede pisarlo.
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

    const todos = await PersonalizacionElemento.findAll({
      where: { productoId },
    });
    const duplicado = await validarDuplicado(
      todos,
      productoId,
      tipoNormalizado,
      {
        nombre: nombreFinal,
        productoReferenciaId,
        insumoId: insumo ? insumo.id : null,
      }
    );
    if (duplicado) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un elemento igual para este producto y categoría',
      });
    }

    const elemento = await PersonalizacionElemento.create({
      productoId,
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
  const elemento = await PersonalizacionElemento.findByPk(req.params.id);
  if (!elemento) {
    return res
      .status(404)
      .json({ success: false, error: 'Elemento no encontrado' });
  }

  const {
    productoId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
    insumoId,
    minimo,
    maximo,
    activo,
  } = req.body;
  const nuevoTipo =
    tipo !== undefined ? String(tipo).toLowerCase() : elemento.tipo;
  const nuevoProductoId =
    productoId !== undefined ? productoId : elemento.productoId;
  const nuevoRef =
    productoReferenciaId !== undefined
      ? productoReferenciaId
      : elemento.productoReferenciaId;

  if (
    !['extra', 'personalizar', 'acompanar', 'condimento'].includes(nuevoTipo)
  ) {
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

  if (
    nuevoTipo === 'acompanar' &&
    String(nuevoRef) === String(nuevoProductoId)
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'No podés ofrecer el mismo producto' });
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

    const todos = await PersonalizacionElemento.findAll({
      where: { productoId: nuevoProductoId },
    });
    const duplicado = await validarDuplicado(
      todos,
      nuevoProductoId,
      nuevoTipo,
      {
        nombre: nombreFinal,
        productoReferenciaId: nuevoRef,
        insumoId: insumo ? insumo.id : null,
      },
      elemento.id
    );
    if (duplicado) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un elemento igual para este producto y categoría',
      });
    }

    const cambios = {};
    if (productoId !== undefined) cambios.productoId = productoId;
    if (tipo !== undefined) cambios.tipo = nuevoTipo;
    if (nombre !== undefined || cambioInsumo) cambios.nombre = nombreFinal;
    if (precio !== undefined || tipo !== undefined || cambioInsumo) {
      cambios.precio = ['extra', 'acompanar'].includes(nuevoTipo)
        ? Number(precioFinal)
        : null;
    }
    if (productoReferenciaId !== undefined || tipo !== undefined) {
      cambios.productoReferenciaId =
        nuevoTipo === 'acompanar' ? productoReferenciaId : null;
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
  const elemento = await PersonalizacionElemento.findByPk(req.params.id);
  if (!elemento) {
    return res
      .status(404)
      .json({ success: false, error: 'Elemento no encontrado' });
  }
  await elemento.update({ activo: false });
  return res.json({ success: true });
};
