import db from '../models';

const { Sucursal } = db;

const esAdministrador = (req) =>
  req.usuario && req.usuario.rol === 'ADMINISTRADOR';

const LIMITES_LAT = { MIN: -90, MAX: 90 };
const LIMITES_LNG = { MIN: -180, MAX: 180 };

const serializar = (sucursal) => {
  const datos = sucursal.toJSON();
  datos.latitud = datos.latitud !== null ? Number(datos.latitud) : null;
  datos.longitud = datos.longitud !== null ? Number(datos.longitud) : null;
  return datos;
};

function validarCoordenadas(latitud, longitud) {
  if (latitud !== undefined && latitud !== null && latitud !== '') {
    const lat = Number(latitud);
    if (Number.isNaN(lat) || lat < LIMITES_LAT.MIN || lat > LIMITES_LAT.MAX) {
      return `La latitud debe estar entre ${LIMITES_LAT.MIN} y ${LIMITES_LAT.MAX}`;
    }
  }
  if (longitud !== undefined && longitud !== null && longitud !== '') {
    const lng = Number(longitud);
    if (Number.isNaN(lng) || lng < LIMITES_LNG.MIN || lng > LIMITES_LNG.MAX) {
      return `La longitud debe estar entre ${LIMITES_LNG.MIN} y ${LIMITES_LNG.MAX}`;
    }
  }
  return null;
}

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const soloActivas = req.query.activa !== 'false' || !esAdmin;
  const where = soloActivas ? { activa: true } : {};
  const sucursales = await Sucursal.findAll({
    where,
    order: [['nombre', 'ASC']],
  });
  res.json({
    success: true,
    data: sucursales.map(serializar),
  });
};

export const show = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
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
  const {
    nombre,
    direccion,
    latitud,
    longitud,
    telefono,
    horarios,
    activa,
  } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'El nombre es obligatorio' });
  }
  if (!direccion || !String(direccion).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'La dirección es obligatoria' });
  }
  const errorCoordenadas = validarCoordenadas(latitud, longitud);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
  }
  const sucursal = await Sucursal.create({
    nombre: String(nombre).trim(),
    direccion: String(direccion).trim(),
    latitud: latitud !== undefined && latitud !== '' ? Number(latitud) : null,
    longitud:
      longitud !== undefined && longitud !== '' ? Number(longitud) : null,
    telefono: telefono ?? null,
    horarios: horarios ?? null,
    activa: activa !== undefined ? Boolean(activa) : true,
  });
  return res.status(201).json({ success: true, data: serializar(sucursal) });
};

export const update = async (req, res) => {
  const sucursal = await Sucursal.findByPk(req.params.id);
  if (!sucursal) {
    return res
      .status(404)
      .json({ success: false, error: 'Sucursal no encontrada' });
  }
  const {
    nombre,
    direccion,
    latitud,
    longitud,
    telefono,
    horarios,
    activa,
  } = req.body;
  const errorCoordenadas = validarCoordenadas(latitud, longitud);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
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
  if (direccion !== undefined) {
    const direccionLimpia = String(direccion).trim();
    if (!direccionLimpia) {
      return res
        .status(400)
        .json({ success: false, error: 'La dirección no puede quedar vacía' });
    }
    cambios.direccion = direccionLimpia;
  }
  if (latitud !== undefined) {
    cambios.latitud = String(latitud).trim() === '' ? null : Number(latitud);
  }
  if (longitud !== undefined) {
    cambios.longitud = String(longitud).trim() === '' ? null : Number(longitud);
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
  await sucursal.update(cambios);
  const actualizada = await Sucursal.findByPk(sucursal.id);
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
