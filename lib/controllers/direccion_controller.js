import db from '../models';

const { Direccion } = db;

const esAdministrador = (req) =>
  req.usuario && req.usuario.rol === 'ADMINISTRADOR';

const serializar = (direccion) => {
  const datos = direccion.toJSON();
  datos.latitud = datos.latitud !== null ? Number(datos.latitud) : null;
  datos.longitud = datos.longitud !== null ? Number(datos.longitud) : null;
  datos.altura = datos.altura !== null ? Number(datos.altura) : null;
  return datos;
};

function validarAltura(altura) {
  if (altura === undefined || altura === null || altura === '') {
    return 'La altura es obligatoria';
  }
  const num = Number(altura);
  if (!Number.isInteger(num) || num < 0) {
    return 'La altura debe ser un número entero mayor o igual a 0';
  }
  return null;
}

function validarTextoObligatorio(valor, nombreCampo) {
  if (valor === undefined || valor === null || !String(valor).trim()) {
    return `${nombreCampo} es obligatorio`;
  }
  return null;
}

function validarTextoNoVacio(valor, nombreCampo) {
  if (valor !== undefined && !String(valor ?? '').trim()) {
    return `${nombreCampo} no puede quedar vacío`;
  }
  return null;
}

// latitud/longitud no se ingresan manualmente (ni por admin ni por nadie):
// las calcula el backend mediante un servicio de geolocalización (tarea futura).
function validarCoordenadasNoManuales(body) {
  if (body.latitud !== undefined || body.longitud !== undefined) {
    return 'La latitud y la longitud no se ingresan manualmente: las calcula el backend';
  }
  return null;
}

const alturaNormalizada = (altura) => Number(altura);

export const index = async (req, res) => {
  const esAdmin = esAdministrador(req);
  const where = {};
  if (esAdmin) {
    if (req.query.usuarioId) {
      where.usuarioId = Number(req.query.usuarioId);
    }
    if (req.query.sucursalId) {
      where.sucursalId = Number(req.query.sucursalId);
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
    provincia,
    localidad,
    codigoPostal,
    referencia,
    alias,
  } = req.body;
  if (req.body.sucursalId !== undefined) {
    return res.status(400).json({
      success: false,
      error: 'sucursalId no está permitido en este endpoint',
    });
  }
  const errorCoordenadas = validarCoordenadasNoManuales(req.body);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
  }
  if (!calle || !String(calle).trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'La calle es obligatoria' });
  }
  const errorAltura = validarAltura(altura);
  if (errorAltura) {
    return res.status(400).json({ success: false, error: errorAltura });
  }
  const errorProvincia = validarTextoObligatorio(provincia, 'La provincia');
  if (errorProvincia) {
    return res.status(400).json({ success: false, error: errorProvincia });
  }
  const errorLocalidad = validarTextoObligatorio(localidad, 'La localidad');
  if (errorLocalidad) {
    return res.status(400).json({ success: false, error: errorLocalidad });
  }
  const errorCodigoPostal = validarTextoObligatorio(
    codigoPostal,
    'El código postal'
  );
  if (errorCodigoPostal) {
    return res.status(400).json({ success: false, error: errorCodigoPostal });
  }
  const direccion = await Direccion.create({
    usuarioId: req.usuario.id,
    calle: String(calle).trim(),
    altura: alturaNormalizada(altura),
    provincia: String(provincia).trim(),
    localidad: String(localidad).trim(),
    codigoPostal: String(codigoPostal).trim(),
    referencia: referencia ?? null,
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
    provincia,
    localidad,
    codigoPostal,
    referencia,
    alias,
    activa,
  } = req.body;
  const errorCoordenadas = validarCoordenadasNoManuales(req.body);
  if (errorCoordenadas) {
    return res.status(400).json({ success: false, error: errorCoordenadas });
  }
  if (altura !== undefined) {
    const errorAltura = validarAltura(altura);
    if (errorAltura) {
      return res.status(400).json({ success: false, error: errorAltura });
    }
  }
  const errorProvincia = validarTextoNoVacio(provincia, 'La provincia');
  if (errorProvincia) {
    return res.status(400).json({ success: false, error: errorProvincia });
  }
  const errorLocalidad = validarTextoNoVacio(localidad, 'La localidad');
  if (errorLocalidad) {
    return res.status(400).json({ success: false, error: errorLocalidad });
  }
  const errorCodigoPostal = validarTextoNoVacio(
    codigoPostal,
    'El código postal'
  );
  if (errorCodigoPostal) {
    return res.status(400).json({ success: false, error: errorCodigoPostal });
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
  if (provincia !== undefined) {
    cambios.provincia = String(provincia).trim();
  }
  if (localidad !== undefined) {
    cambios.localidad = String(localidad).trim();
  }
  if (codigoPostal !== undefined) {
    cambios.codigoPostal = String(codigoPostal).trim();
  }
  if (referencia !== undefined) {
    cambios.referencia = referencia || null;
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
