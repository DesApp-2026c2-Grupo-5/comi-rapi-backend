import db from '../models';

const { Promocion, PromocionProducto, Producto } = db;

const TIPOS_VALIDOS = ['DESCUENTO_PORCENTUAL', 'DOS_POR_UNO'];

// Sesión de gestión (ADMIN o SUPERADMIN): ve también las inactivas. El público
// y el cliente no.
const esGestion = (req) =>
  req.usuario &&
  ['ADMINISTRADOR', 'SUPERADMINISTRADOR'].includes(req.usuario.rol);

function validarTipo(tipo) {
  return TIPOS_VALIDOS.includes(tipo);
}

function validarValor(tipo, valor) {
  const n = Number(valor);
  if (valor === undefined || valor === null || Number.isNaN(n) || n < 0) {
    return 'El valor debe ser un número mayor o igual a 0';
  }
  if (tipo === 'DESCUENTO_PORCENTUAL' && n > 100) {
    return 'El descuento porcentual no puede superar 100';
  }
  return null;
}

function validarFechas(fechaInicio, fechaFin) {
  if (fechaInicio === undefined && fechaFin === undefined) return null;
  const inicio =
    fechaInicio !== undefined && fechaInicio !== null
      ? new Date(fechaInicio)
      : null;
  const fin =
    fechaFin !== undefined && fechaFin !== null ? new Date(fechaFin) : null;
  if (inicio && Number.isNaN(inicio.getTime())) {
    return 'La fecha de inicio es inválida';
  }
  if (fin && Number.isNaN(fin.getTime())) {
    return 'La fecha de fin es inválida';
  }
  if (inicio && fin && fin < inicio) {
    return 'La fecha de fin no puede ser anterior a la de inicio';
  }
  return null;
}

/**
 * Un combo es un `Producto` con `tipo = COMBO` y su precio ya es una
 * promoción respecto de sus componentes, así que no puede ser alcanzado por
 * otra: hacerlo no tendría efecto en el total.
 */
function validarProductoAlcanzable(producto) {
  if (producto.tipo !== 'COMBO') return null;
  return 'Un combo no puede ser alcanzado por una promoción: el combo ya es la promoción';
}

export const index = async (req, res) => {
  const esAdmin = esGestion(req);
  const soloActivas = req.query.activa !== 'false' || !esAdmin;
  const where = soloActivas ? { activa: true } : {};
  const promociones = await Promocion.findAll({
    where,
    order: [['nombre', 'ASC']],
  });
  res.json({
    success: true,
    data: promociones.map((promocion) => promocion.toJSON()),
  });
};

export const show = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id);
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  if (!promocion.activa && !esGestion(req)) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  return res.json({ success: true, data: promocion.toJSON() });
};

export const create = async (req, res) => {
  const { nombre, descripcion, tipo, valor, fechaInicio, fechaFin } =
    req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!validarTipo(tipo)) {
    return res
      .status(400)
      .json({ success: false, error: 'Tipo de promoción inválido' });
  }
  const errorValor = validarValor(tipo, valor);
  if (errorValor) {
    return res.status(400).json({ success: false, error: errorValor });
  }
  const errorFechas = validarFechas(fechaInicio, fechaFin);
  if (errorFechas) {
    return res.status(400).json({ success: false, error: errorFechas });
  }
  const promocion = await Promocion.create({
    nombre: String(nombre).trim(),
    descripcion: descripcion ?? null,
    tipo,
    valor: Number(valor),
    fechaInicio: fechaInicio ?? null,
    fechaFin: fechaFin ?? null,
  });
  return res.status(201).json({ success: true, data: promocion.toJSON() });
};

export const update = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id);
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  const { nombre, descripcion, tipo, valor, fechaInicio, fechaFin, activa } =
    req.body || {};
  const cambios = {};
  if (nombre !== undefined) {
    const nombreLimpio = String(nombre).trim();
    if (!nombreLimpio) {
      return res
        .status(400)
        .json({ success: false, error: 'El nombre no puede quedar vacío' });
    }
    cambios.nombre = nombreLimpio;
  }
  if (descripcion !== undefined) {
    cambios.descripcion = descripcion;
  }
  const tipoFinal = tipo !== undefined ? tipo : promocion.tipo;
  if (tipo !== undefined) {
    if (!validarTipo(tipo)) {
      return res
        .status(400)
        .json({ success: false, error: 'Tipo de promoción inválido' });
    }
    cambios.tipo = tipo;
  }
  if (valor !== undefined) {
    const errorValor = validarValor(tipoFinal, valor);
    if (errorValor) {
      return res.status(400).json({ success: false, error: errorValor });
    }
    cambios.valor = Number(valor);
  } else if (tipo !== undefined) {
    // El tipo cambió pero el valor no: revalidar el valor vigente.
    const errorValor = validarValor(tipoFinal, promocion.valor);
    if (errorValor) {
      return res.status(400).json({ success: false, error: errorValor });
    }
  }
  const fechaInicioFinal =
    fechaInicio !== undefined ? fechaInicio : promocion.fechaInicio;
  const fechaFinFinal = fechaFin !== undefined ? fechaFin : promocion.fechaFin;
  const errorFechas = validarFechas(fechaInicioFinal, fechaFinFinal);
  if (errorFechas) {
    return res.status(400).json({ success: false, error: errorFechas });
  }
  if (fechaInicio !== undefined) {
    cambios.fechaInicio = fechaInicio;
  }
  if (fechaFin !== undefined) {
    cambios.fechaFin = fechaFin;
  }
  if (activa !== undefined) {
    cambios.activa = Boolean(activa);
  }
  await promocion.update(cambios);
  return res.json({ success: true, data: promocion.toJSON() });
};

export const destroy = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id);
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  await promocion.update({ activa: false });
  return res.json({ success: true });
};

export const listarProductos = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id, {
    include: [
      {
        model: Producto,
        as: 'Productos',
        attributes: ['id', 'nombre', 'precio'],
        through: { attributes: [] },
      },
    ],
  });
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  if (!promocion.activa && !esGestion(req)) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  return res.json({
    success: true,
    data: (promocion.Productos || []).map((p) => ({
      ...p.toJSON(),
      precio: Number(p.precio),
    })),
  });
};

export const asignarProducto = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id);
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  const { productoId } = req.body || {};
  if (productoId === undefined || productoId === null) {
    return res
      .status(400)
      .json({ success: false, error: 'El producto es obligatorio' });
  }
  const producto = await Producto.findByPk(productoId);
  if (!producto || !producto.activo) {
    return res
      .status(400)
      .json({ success: false, error: `Producto ${productoId} no disponible` });
  }
  const errorCombo = validarProductoAlcanzable(producto);
  if (errorCombo) {
    return res.status(400).json({ success: false, error: errorCombo });
  }
  try {
    const vinculo = await PromocionProducto.create({
      promocionId: promocion.id,
      productoId: producto.id,
    });
    return res.status(201).json({ success: true, data: vinculo.toJSON() });
  } catch (error) {
    if (error && error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        error: 'El producto ya está asignado a la promoción',
      });
    }
    throw error;
  }
};

export const quitarProducto = async (req, res) => {
  const promocion = await Promocion.findByPk(req.params.id);
  if (!promocion) {
    return res
      .status(404)
      .json({ success: false, error: 'Promoción no encontrada' });
  }
  const vinculo = await PromocionProducto.findOne({
    where: { promocionId: promocion.id, productoId: req.params.productoId },
  });
  if (!vinculo) {
    return res
      .status(404)
      .json({ success: false, error: 'El producto no está en la promoción' });
  }
  await vinculo.destroy();
  return res.json({ success: true });
};
