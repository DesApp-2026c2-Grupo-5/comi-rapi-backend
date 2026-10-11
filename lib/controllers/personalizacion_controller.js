import db from '../models';

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
    return (
      (e.nombre || '').toLowerCase() === (datos.nombre || '').toLowerCase()
    );
  });
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
    data: elementos.map((e) => e.toJSON()),
  });
};

export const show = async (req, res) => {
  const elemento = await PersonalizacionElemento.findByPk(req.params.id);
  if (!elemento || (!elemento.activo && !esGestion(req))) {
    return res
      .status(404)
      .json({ success: false, error: 'Elemento no encontrado' });
  }
  return res.json({ success: true, data: elemento.toJSON() });
};

export const create = async (req, res) => {
  const {
    productoId,
    tipo,
    nombre,
    precio,
    productoReferenciaId,
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

  const errorPrecio = validarPrecioSegunTipo(tipoNormalizado, precio);
  if (errorPrecio) {
    return res.status(400).json({ success: false, error: errorPrecio });
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

  const todos = await PersonalizacionElemento.findAll({
    where: { productoId },
  });
  const duplicado = await validarDuplicado(todos, productoId, tipoNormalizado, {
    nombre,
    productoReferenciaId,
  });
  if (duplicado) {
    return res
      .status(400)
      .json({
        success: false,
        error: 'Ya existe un elemento igual para este producto y categoría',
      });
  }

  const elemento = await PersonalizacionElemento.create({
    productoId,
    tipo: tipoNormalizado,
    nombre: nombre || null,
    precio: ['extra', 'acompanar'].includes(tipoNormalizado)
      ? Number(precio)
      : null,
    productoReferenciaId:
      tipoNormalizado === 'acompanar' ? productoReferenciaId : null,
    activo: activo !== undefined ? Boolean(activo) : true,
  });

  return res.status(201).json({ success: true, data: elemento.toJSON() });
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

  const precioFinal = precio !== undefined ? precio : elemento.precio;
  const errorPrecio = validarPrecioSegunTipo(nuevoTipo, precioFinal);
  if (errorPrecio) {
    return res.status(400).json({ success: false, error: errorPrecio });
  }

  if (
    nuevoTipo === 'acompanar' &&
    String(nuevoRef) === String(nuevoProductoId)
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'No podés ofrecer el mismo producto' });
  }

  const todos = await PersonalizacionElemento.findAll({
    where: { productoId: nuevoProductoId },
  });
  const duplicado = await validarDuplicado(
    todos,
    nuevoProductoId,
    nuevoTipo,
    { nombre: nombre ?? elemento.nombre, productoReferenciaId: nuevoRef },
    elemento.id
  );
  if (duplicado) {
    return res
      .status(400)
      .json({
        success: false,
        error: 'Ya existe un elemento igual para este producto y categoría',
      });
  }

  const cambios = {};
  if (productoId !== undefined) cambios.productoId = productoId;
  if (tipo !== undefined) cambios.tipo = nuevoTipo;
  if (nombre !== undefined) cambios.nombre = nombre || null;
  if (precio !== undefined || tipo !== undefined) {
    cambios.precio = ['extra', 'acompanar'].includes(nuevoTipo)
      ? Number(precioFinal)
      : null;
  }
  if (productoReferenciaId !== undefined || tipo !== undefined) {
    cambios.productoReferenciaId =
      nuevoTipo === 'acompanar' ? productoReferenciaId : null;
  }
  if (activo !== undefined) cambios.activo = Boolean(activo);

  await elemento.update(cambios);
  return res.json({ success: true, data: elemento.toJSON() });
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
