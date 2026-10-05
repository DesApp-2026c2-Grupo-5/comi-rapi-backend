import db from '../models';
import {
  prepararDireccion,
  persistirDireccionSucursal,
} from '../services/direccion_service';

const { Sucursal, Direccion } = db;

const esAdministrador = (req) =>
  req.usuario && req.usuario.rol === 'ADMINISTRADOR';

const serializar = (sucursal) => {
  const datos = sucursal.toJSON();
  if (datos.direccion) {
    const dir = datos.direccion;
    dir.altura = dir.altura !== null ? Number(dir.altura) : null;
    dir.latitud = dir.latitud !== null ? Number(dir.latitud) : null;
    dir.longitud = dir.longitud !== null ? Number(dir.longitud) : null;
    datos.latitud = dir.latitud;
    datos.longitud = dir.longitud;
  } else {
    datos.latitud = null;
    datos.longitud = null;
  }
  return datos;
};

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const soloActivas = req.query.activa !== 'false' || !esAdmin;
  const where = soloActivas ? { activa: true } : {};
  const sucursales = await Sucursal.findAll({
    where,
    include: 'direccion',
    order: [['nombre', 'ASC']],
  });
  res.json({
    success: true,
    data: sucursales.map(serializar),
  });
};

export const show = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id, {
    include: 'direccion',
  });
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
  return res.json({ success: true, data: serializar(sucursal) });
};

export const create = async (req, res) => {
  const { nombre, direccion, telefono, horarios, activa } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!direccion || typeof direccion !== 'object' || Array.isArray(direccion)) {
    return res
      .status(400)
      .json({ success: false, error: 'La dirección es obligatoria' });
  }
  // Preparación (validación + geocodificación con Georef) ANTES de la
  // transacción: la dirección de sucursal exige coordenadas; los errores
  // tipados se traducen en el error handler (400/422/503).
  const { valores, coordenadas } = await prepararDireccion({
    datos: direccion,
  });
  // Toda la persistencia (sucursal + dirección) dentro de la misma
  // transacción: si falla, rollback y no queda nada parcial.
  const sucursal = await db.sequelize.transaction(async (t) => {
    const nueva = await Sucursal.create(
      {
        nombre: String(nombre).trim(),
        telefono: telefono ?? null,
        horarios: horarios ?? null,
        activa: activa !== undefined ? Boolean(activa) : true,
      },
      { transaction: t }
    );
    await persistirDireccionSucursal({
      sucursalId: nueva.id,
      valores,
      coordenadas,
      transaction: t,
    });
    return nueva;
  });
  const creada = await Sucursal.findByPk(sucursal.id, {
    include: 'direccion',
  });
  return res.status(201).json({ success: true, data: serializar(creada) });
};

export const update = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  const { nombre, direccion, telefono, horarios, activa } = req.body;
  // Preparación ANTES de la transacción: validación parcial, detección de
  // cambios reales contra la dirección persistida y re-geocodificación solo si
  // cambió un campo de ubicación (cambios solo en alias/referencia o payload
  // idéntico no llaman a proveedores).
  let preparada = null;
  let existenteDireccion = null;
  if (direccion !== undefined) {
    if (
      !direccion ||
      typeof direccion !== 'object' ||
      Array.isArray(direccion)
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'La dirección es obligatoria' });
    }
    existenteDireccion = await Direccion.findOne({
      where: { sucursalId: sucursal.id },
    });
    preparada = await prepararDireccion({
      datos: direccion,
      existente: existenteDireccion,
    });
  }
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
  if (telefono !== undefined) {
    cambios.telefono = telefono ?? null;
  }
  if (horarios !== undefined) {
    cambios.horarios = horarios ?? null;
  }
  if (activa !== undefined) {
    cambios.activa = Boolean(activa);
  }
  await db.sequelize.transaction(async (t) => {
    await sucursal.update(cambios, { transaction: t });
    if (preparada) {
      await persistirDireccionSucursal({
        sucursalId: sucursal.id,
        existente: existenteDireccion,
        valores: preparada.valores,
        coordenadas: preparada.coordenadas,
        transaction: t,
      });
    }
  });
  const actualizada = await Sucursal.findByPk(sucursal.id, {
    include: 'direccion',
  });
  return res.json({ success: true, data: serializar(actualizada) });
};

export const destroy = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  await sucursal.update({ activa: false });
  return res.json({ success: true });
};
