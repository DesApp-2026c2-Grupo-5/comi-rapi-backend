import db from '../models';

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

// latitud/longitud no se ingresan manualmente (ni por admin ni por nadie):
// las calcula el backend mediante un servicio de geolocalización (tarea futura).
function validarCoordenadasNoManuales(datos) {
  if (datos.latitud !== undefined || datos.longitud !== undefined) {
    return 'La latitud y la longitud no se ingresan manualmente: las calcula el backend';
  }
  return null;
}

function validarDireccion(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return 'La dirección es obligatoria';
  }
  const errorCoordenadas = validarCoordenadasNoManuales(datos);
  if (errorCoordenadas) return errorCoordenadas;
  if (!datos.calle || !String(datos.calle).trim()) {
    return 'La calle es obligatoria';
  }
  const errorAltura = validarAltura(datos.altura);
  if (errorAltura) return errorAltura;
  const errorProvincia = validarTextoObligatorio(
    datos.provincia,
    'La provincia'
  );
  if (errorProvincia) return errorProvincia;
  const errorLocalidad = validarTextoObligatorio(
    datos.localidad,
    'La localidad'
  );
  if (errorLocalidad) return errorLocalidad;
  const errorCodigoPostal = validarTextoObligatorio(
    datos.codigoPostal,
    'El código postal'
  );
  if (errorCodigoPostal) return errorCodigoPostal;
  return null;
}

const alturaNormalizada = (altura) => Number(altura);

const valoresDireccion = (datos) => ({
  calle: String(datos.calle).trim(),
  altura: alturaNormalizada(datos.altura),
  provincia: String(datos.provincia).trim(),
  localidad: String(datos.localidad).trim(),
  codigoPostal: String(datos.codigoPostal).trim(),
  referencia: datos.referencia ?? null,
});

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
  const errorDireccion = validarDireccion(direccion);
  if (errorDireccion) {
    return res.status(400).json({ success: false, error: errorDireccion });
  }
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
    await Direccion.create(
      { ...valoresDireccion(direccion), sucursalId: nueva.id, activa: true },
      { transaction: t }
    );
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
  if (direccion !== undefined) {
    const errorDireccion = validarDireccion(direccion);
    if (errorDireccion) {
      return res.status(400).json({ success: false, error: errorDireccion });
    }
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
    if (direccion !== undefined) {
      const valores = valoresDireccion(direccion);
      const existente = await Direccion.findOne({
        where: { sucursalId: sucursal.id },
        transaction: t,
      });
      if (existente) {
        await existente.update(valores, { transaction: t });
      } else {
        await Direccion.create(
          { ...valores, sucursalId: sucursal.id, activa: true },
          { transaction: t }
        );
      }
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
