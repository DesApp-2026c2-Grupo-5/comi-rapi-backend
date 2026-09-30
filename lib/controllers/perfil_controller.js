/**
 * Controller del perfil del usuario.
 *
 * Solo traduce HTTP ↔ dominio; las reglas viven en perfil_service (ver
 * AGENTS.md: Routes → Middlewares → Controllers → Services).
 *
 * El usuario siempre se resuelve de la sesión (req.usuario.id); nunca se acepta
 * un id/usuarioId del body. Los campos protegidos (id, rol, activo, password,
 * nombre, apellido) se rechazan explícitamente si llegan.
 *
 * `nombre` y `apellido` son parte de la identidad de la cuenta y quedan fuera de
 * la edición: el identificador del cliente en sus pedidos y el nombre que aparece
 * en la interfaz no deberían cambiar desde la pantalla de perfil. Editarlos, si
 * hiciera falta, es una tarea administrativa.
 *
 * Errores con intención: los conflictos de email único se responden con el
 * mensaje genérico (como en registro), para no revelar con qué emails existen
 * cuentas. Un error en el formato de entrada usa el mismo texto genérico de la
 * API.
 */
import {
  obtenerPerfil,
  actualizarDatosPerfil,
  cambiarPassword,
  guardarFotoPerfil,
  eliminarFotoPerfil,
  normalizarEmail,
  EmailEnUsoError,
  PasswordActualIncorrectaError,
} from '../services/perfil_service';

const ERROR_OPERACION = 'No se pudo completar la operación';
const MENSAJE_NO_COINCIDE = 'Las contraseñas no coinciden.';
const MENSAJE_PASSWORD_ACTUAL = 'La contraseña actual es incorrecta.';
const MENSAJE_CAMBIADO = 'Contraseña actualizada correctamente.';

const formaEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const formaFecha = /^\d{4}-\d{2}-\d{2}$/;

// Campos que este endpoint nunca modifica. Si llegan, se rechaza el PUT completo
// (400) en lugar de ignorarlos: ignorados en silencio, el cliente creería que
// guardó algo que no guardó.
const CAMPOS_PROHIBIDOS = [
  'id',
  'usuarioId',
  'rol',
  'activo',
  'password',
  'nombre',
  'apellido',
];

const esEmailValido = (email) => formaEmail.test(email);
const esPasswordValido = (password) =>
  typeof password === 'string' && password.length >= 6;
const esFechaValida = (valor) =>
  typeof valor === 'string' &&
  formaFecha.test(valor) &&
  !Number.isNaN(new Date(`${valor}T00:00:00Z`).getTime());

/**
 * GET /perfil → datos del perfil del usuario autenticado.
 */
export const mostrar = async (req, res) => {
  const perfil = await obtenerPerfil(req.usuario.id);
  return res.json({ success: true, data: perfil });
};

/**
 * PUT /perfil → edita los datos personales del usuario autenticado.
 *
 * Solo se modifican email, telefono y fechaNacimiento. Los campos protegidos se
 * rechazan con 400 (mismo patrón que las direcciones) y nombre/apellido están
 * entre ellos porque la identidad de la cuenta no se cambia desde acá.
 */
export const actualizar = async (req, res) => {
  const body = req.body || {};

  for (const campo of CAMPOS_PROHIBIDOS) {
    if (body[campo] !== undefined) {
      return res.status(400).json({
        success: false,
        error: `${campo} no puede modificarse en este endpoint`,
      });
    }
  }

  const cambios = {};

  if (body.email !== undefined) {
    const email = normalizarEmail(body.email);
    if (!esEmailValido(email)) {
      return res.status(400).json({ success: false, error: ERROR_OPERACION });
    }
    cambios.email = email;
  }

  if (body.telefono !== undefined) {
    cambios.telefono = String(body.telefono).trim() || null;
  }

  if (body.fechaNacimiento !== undefined) {
    const valor = body.fechaNacimiento;
    if (valor === null || valor === '') {
      cambios.fechaNacimiento = null;
    } else if (esFechaValida(valor)) {
      cambios.fechaNacimiento = valor;
    } else {
      return res.status(400).json({ success: false, error: ERROR_OPERACION });
    }
  }

  // Un PUT sin campos editables no altera nada: se responde el perfil actual.
  if (Object.keys(cambios).length === 0) {
    const perfil = await obtenerPerfil(req.usuario.id);
    return res.json({ success: true, data: perfil });
  }

  try {
    const perfil = await actualizarDatosPerfil(req.usuario.id, cambios);
    return res.json({ success: true, data: perfil });
  } catch (error) {
    if (error instanceof EmailEnUsoError) {
      return res.status(400).json({ success: false, error: ERROR_OPERACION });
    }
    throw error;
  }
};

/**
 * POST /perfil/foto → sube la foto de perfil (multipart, campo "imagen").
 */
export const subirFoto = async (req, res) => {
  const archivo = req.file;
  if (!archivo) {
    return res
      .status(400)
      .json({ success: false, error: 'No se recibió ninguna imagen' });
  }

  let resultado;
  try {
    resultado = await guardarFotoPerfil(req.usuario.id, archivo);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return res.status(201).json({ success: true, data: { url: resultado.url } });
};

/**
 * DELETE /perfil/foto → elimina la foto de perfil del usuario autenticado.
 * Responde el perfil completo con fotoPerfilUrl en null, igual que el PUT.
 */
export const quitarFoto = async (req, res) => {
  const perfil = await eliminarFotoPerfil(req.usuario.id);
  return res.json({ success: true, data: perfil });
};

/**
 * POST /perfil/cambiar-password → cambia la contraseña con la actual.
 */
export const cambiarContrasena = async (req, res) => {
  const { passwordActual, password, confirmPassword } = req.body || {};
  const nuevaPassword = String(password || '');

  if (String(confirmPassword || '') !== nuevaPassword) {
    return res.status(400).json({ success: false, error: MENSAJE_NO_COINCIDE });
  }
  if (!esPasswordValido(nuevaPassword)) {
    return res.status(400).json({ success: false, error: ERROR_OPERACION });
  }

  try {
    await cambiarPassword(req.usuario.id, {
      passwordActual: String(passwordActual || ''),
      nuevaPassword,
      sessionId: req.session.id,
    });
  } catch (error) {
    if (error instanceof PasswordActualIncorrectaError) {
      return res
        .status(400)
        .json({ success: false, error: MENSAJE_PASSWORD_ACTUAL });
    }
    throw error;
  }

  return res.json({ success: true, data: { message: MENSAJE_CAMBIADO } });
};
