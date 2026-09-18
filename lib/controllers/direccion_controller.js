import db from '../models';

const { Direccion } = db;

const esAdministrador = (req) =>
  req.usuario && req.usuario.rol === 'ADMINISTRADOR';

const LIMITES_LAT = { MIN: -90, MAX: 90 };
const LIMITES_LNG = { MIN: -180, MAX: 180 };

const serializar = (direccion) => {
  const datos = direccion.toJSON();
  datos.latitud = datos.latitud !== null ? Number(datos.latitud) : null;
  datos.longitud = datos.longitud !== null ? Number(datos.longitud) : null;
  datos.altura = datos.altura !== null ? Number(datos.altura) : null;
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

function validarAltura(altura) {
  if (altura !== undefined && altura !== null && altura !== '') {
    const num = Number(altura);
    if (!Number.isInteger(num) || num < 0) {
      return 'La altura debe ser un número entero mayor o igual a 0';
    }
  }
  return null;
}

const alturaNormalizada = (altura) =>
  altura !== undefined && altura !== null && altura !== ''
    ? Number(altura)
    : null;

const coordenadaNormalizada = (valor) =>
  valor !== undefined && valor !== null && valor !== '' ? Number(valor) : null;

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const where = {};
  if (esAdmin) {
    if (req.query.usuarioId) {
      where.usuarioId = Number(req.query.usuarioId);
    }
    if (req.query.activa !== 'false') {
      where.activa = true;
    }
  } else {
    where.usuarioId = req.usuario.id;
    where.activa = true;
  }
  const direcciones = await Direccion.findAll({
    where,
    order: [['id', 'ASC']],
  });
  res.json({ success: true, data: direcciones.map(serializar) });
};

export const show = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (!esAdministrador(req) && direccion.usuarioId !== req.usuario.id) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  return res.json({ success: true, data: serializar(direccion) });
};

export const create = async (req, res) => {
  const {
    calle,
    altura,
    ciudad,
    codigoPostal,
    referencia,
    latitud,
    longitud,
    alias,
  } = req.body;
  if (!calle || !String(calle).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'La calle es obligatoria' });
  }
  const errorAltura = validarAltura(altura);
  if (errorAltura) {
    return res.status(400).json({ success: false, error: errorAltura });
  }
  const errorCoordenadas = validarCoordenadas(latitud, longitud);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
  }
  const direccion = await Direccion.create({
    usuarioId: req.usuario.id,
    calle: String(calle).trim(),
    altura: alturaNormalizada(altura),
    ciudad: ciudad ?? null,
    codigoPostal: codigoPostal ?? null,
    referencia: referencia ?? null,
    latitud: coordenadaNormalizada(latitud),
    longitud: coordenadaNormalizada(longitud),
    alias: alias ?? null,
    activa: true,
  });
  return res.status(201).json({ success: true, data: serializar(direccion) });
};

export const update = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (direccion.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  const {
    calle,
    altura,
    ciudad,
    codigoPostal,
    referencia,
    latitud,
    longitud,
    alias,
    activa,
  } = req.body;
  const errorAltura = validarAltura(altura);
  if (errorAltura) {
    return res.status(400).json({ success: false, error: errorAltura });
  }
  const errorCoordenadas = validarCoordenadas(latitud, longitud);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
  }
  const cambios = {};
  if (calle !== undefined) {
    const calleLimpia = String(calle).trim();
    if (!calleLimpia) {
      return res
        .status(400)
        .json({ success: false, error: 'La calle no puede quedar vacía' });
    }
    cambios.calle = calleLimpia;
  }
  if (altura !== undefined) {
    cambios.altura = alturaNormalizada(altura);
  }
  if (ciudad !== undefined) {
    cambios.ciudad = ciudad || null;
  }
  if (codigoPostal !== undefined) {
    cambios.codigoPostal = codigoPostal || null;
  }
  if (referencia !== undefined) {
    cambios.referencia = referencia || null;
  }
  if (latitud !== undefined) {
    cambios.latitud = coordenadaNormalizada(latitud);
  }
  if (longitud !== undefined) {
    cambios.longitud = coordenadaNormalizada(longitud);
  }
  if (alias !== undefined) {
    cambios.alias = alias || null;
  }
  if (activa !== undefined) {
    cambios.activa = Boolean(activa);
  }
  await direccion.update(cambios);
  return res.json({ success: true, data: serializar(direccion) });
};

export const destroy = async (req, res) => {
  const direccion = await Direccion.findByPk(req.params.id);
  if (!direccion) {
    return res
      .status(404)
      .json({ success: false, error: 'Dirección no encontrada' });
  }
  if (direccion.usuarioId !== req.usuario.id) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  await direccion.update({ activa: false });
  return res.json({ success: true });
};
