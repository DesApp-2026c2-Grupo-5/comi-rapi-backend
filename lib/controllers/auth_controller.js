/**
 * Controller de autenticación: registro, login, logout y sesión actual.
 *
 * Reglas de seguridad:
 * - Nunca se devuelve el hash de la contraseña (se usa usuario.datosPublicos()).
 * - Mensajes de error genéricos: no se revela si un email existe.
 * - El email se normaliza (trim + lowercase) y la entrada se valida/sanitiza.
 * - La sesión se regenera al autenticar (anti session-fixation).
 */
import db from '../models';

const ERROR_OPERACION = 'No se pudo completar la operación';
const ERROR_CREDENCIALES = 'Credenciales inválidas';

const ROLES_VALIDOS = ['CLIENTE', 'ADMINISTRADOR'];

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
  const rol =
    body.rol !== undefined && ROLES_VALIDOS.includes(body.rol)
      ? body.rol
      : 'CLIENTE';
  const fechaNacimiento = body.fechaNacimiento
    ? esFechaValida(body.fechaNacimiento)
      ? body.fechaNacimiento
      : null
    : null;

  if (!validarEmail(email) || !validarPassword(password) || !nombre) {
    return null;
  }
  return { email, password, nombre, apellido, telefono, rol, fechaNacimiento };
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
      data: usuario.datosPublicos(),
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
    data: usuario.datosPublicos(),
  });
};

export const logout = (req, res) => {
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.clearCookie('comirapi.sid');
  return res.json({ success: true, data: { message: 'Sesión cerrada' } });
};

export const me = (req, res) => {
  return res.json({ success: true, data: req.usuario });
};
