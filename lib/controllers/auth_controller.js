/**
 * Controller de autenticación: registro, login, logout y sesión actual.
 *
 * Reglas de seguridad:
 * - Nunca se devuelve el hash de la contraseña (se usa usuario.datosPublicos()).
 * - Mensajes de error genéricos: no se revela si un email existe.
 * - El email se normaliza (trim + lowercase) y la entrada se valida/sanitiza.
 * - El registro público siempre crea CLIENTE (no se acepta el rol del cliente).
 * - La sesión se regenera al autenticar (anti session-fixation).
 */
import db from '../models';

const ERROR_OPERACION = 'No se pudo completar la operación';
const ERROR_CREDENCIALES = 'Credenciales inválidas';

const normalizarEmail = (valor) =>
  String(valor || '')
    .trim()
    .toLowerCase();
const validarEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validarPassword = (password) =>
  typeof password === 'string' && password.length >= 6;
const esFechaValida = (valor) =>
  typeof valor === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
  !Number.isNaN(new Date(`${valor}T00:00:00Z`).getTime());

function validarRegistro(body) {
  const email = normalizarEmail(body.email);
  const password = String(body.password || '');
  const nombre = String(body.nombre || '').trim();
  const apellido = String(body.apellido || '').trim();
  const telefono = String(body.telefono || '').trim();
  const fechaNacimiento = body.fechaNacimiento
    ? esFechaValida(body.fechaNacimiento)
      ? body.fechaNacimiento
      : null
    : null;

  if (!validarEmail(email) || !validarPassword(password) || !nombre) {
    return null;
  }
  // El registro público NUNCA crea roles privilegiados: se ignora cualquier
  // `body.rol` y el usuario siempre nace como CLIENTE. Los roles
  // ADMINISTRADOR/SUPERADMINISTRADOR se asignan solo desde el panel de
  // superadministración.
  return {
    email,
    password,
    nombre,
    apellido,
    telefono,
    rol: 'CLIENTE',
    fechaNacimiento,
  };
}

function crearSesion(req, usuarioId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        return reject(error);
      }
      req.session.usuarioId = usuarioId;
      return resolve();
    });
  });
}

/**
 * Resuelve la sucursal OPERATIVA del usuario (la asignada del ADMINISTRADOR
 * o el contexto elegido del SUPERADMINISTRADOR) para las respuestas
 * autenticadas. Se expone en registro, login y me: el frontend la lee desde
 * el PRIMER login. Antes solo /auth/me la calculaba y el panel de un admin
 * recién logueado quedaba "sin sucursal" hasta recargar la página (el login
 * respondía datosPublicos sin el campo y nadie re-consultaba /me).
 */
async function resolverSucursalOperativa(req, usuario) {
  let sucursalId = null;
  if (usuario.rol === 'ADMINISTRADOR') {
    sucursalId = usuario.sucursalId;
  } else if (usuario.rol === 'SUPERADMINISTRADOR') {
    sucursalId = req.session && req.session.sucursalOperativaId;
  }
  if (!sucursalId) {
    return null;
  }
  const sucursal = await db.Sucursal.findByPk(Number(sucursalId));
  if (!sucursal) {
    return null;
  }
  return { id: sucursal.id, nombre: sucursal.nombre, activa: sucursal.activa };
}

export const registro = async (req, res) => {
  const datos = validarRegistro(req.body || {});
  if (!datos) {
    return res.status(400).json({ success: false, error: ERROR_OPERACION });
  }
  try {
    const usuario = await db.Usuario.create(datos);
    await crearSesion(req, usuario.id);
    return res.status(201).json({
      success: true,
      data: {
        ...usuario.datosPublicos(),
        sucursalOperativa: await resolverSucursalOperativa(req, usuario),
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: ERROR_OPERACION });
  }
};

export const login = async (req, res) => {
  const email = normalizarEmail((req.body || {}).email);
  const password = String((req.body || {}).password || '');

  if (!validarEmail(email) || !validarPassword(password)) {
    return res.status(401).json({ success: false, error: ERROR_CREDENCIALES });
  }

  const usuario = await db.Usuario.findOne({ where: { email } });
  if (
    !usuario ||
    !usuario.activo ||
    !(await usuario.verificarPassword(password))
  ) {
    return res.status(401).json({ success: false, error: ERROR_CREDENCIALES });
  }

  await crearSesion(req, usuario.id);
  return res.json({
    success: true,
    data: {
      ...usuario.datosPublicos(),
      sucursalOperativa: await resolverSucursalOperativa(req, usuario),
    },
  });
};

export const logout = (req, res) => {
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.clearCookie('comirapi.sid');
  return res.json({ success: true, data: { message: 'Sesión cerrada' } });
};

/**
 * SUCURSAL DE CONTEXTO (solo SUPERADMINISTRADOR).
 *
 * El superadmin elige en qué sucursal operar: el id se guarda en la sesión
 * (`sucursalOperativaId`) y lo consume `sucursalOperativaDeSesion`. Se valida
 * contra la BD al elegirlo (existe y está activa): nunca se confía en un id
 * suelto del request más allá de esta validación. Un ADMINISTRADOR no elige
 * contexto: su sucursal es la asignada.
 */
export const elegirSucursalContexto = async (req, res) => {
  const { sucursalId } = req.body || {};
  const id = Number(sucursalId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Sucursal inválida' });
  }
  const sucursal = await db.Sucursal.findByPk(id);
  if (!sucursal || !sucursal.activa) {
    return res.status(404).json({
      success: false,
      error: 'La sucursal no existe o está inactiva',
    });
  }
  req.session.sucursalOperativaId = id;
  return res.json({
    success: true,
    data: { sucursalOperativa: { id: sucursal.id, nombre: sucursal.nombre } },
  });
};

export const limpiarSucursalContexto = (req, res) => {
  if (req.session) {
    req.session.sucursalOperativaId = null;
  }
  return res.json({ success: true, data: { sucursalOperativa: null } });
};

/**
 * Sesión actual con la sucursal OPERATIVA resuelta:
 * - ADMINISTRADOR → su sucursal asignada.
 * - SUPERADMINISTRADOR → el contexto elegido (o null si no hay).
 * El campo es uniforme en todas las respuestas autenticadas (registro, login
 * y me) para que el frontend tenga una sola fuente ("¿en qué sucursal opera
 * esta sesión?") desde el primer login. Las capacidades globales del
 * superadmin no cambian: solo las rutas operativas usan el contexto.
 */
export const me = async (req, res) => {
  const data = {
    ...req.usuario,
    sucursalOperativa: await resolverSucursalOperativa(req, req.usuario),
  };
  return res.json({ success: true, data });
};
