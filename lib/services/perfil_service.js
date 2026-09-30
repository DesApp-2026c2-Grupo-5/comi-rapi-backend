/**
 * Servicio del perfil del usuario: consulta y edición de los propios datos,
 * cambio de contraseña (con la actual) y gestión de la foto de perfil.
 *
 * Reglas de alcance:
 * - Los cambios se aplican SIEMPRE sobre la sesión autenticada (usuarioId) y
 *   nunca aceptan un id del body: es el controller el que pasa req.usuario.id.
 * - Campos protegidos (id, rol, activo, password) no son editables desde acá.
 * - Email único: si el nuevo email pertenece a otra cuenta, se lanza
 *   EmailEnUsoError (el controller lo traduce a un mensaje genérico para no
 *   permitir enumerar registros).
 * - Al cambiar la contraseña se invalidan las sesiones EXCEPTO la actual
 *   (exceptoSid), ya que el usuario acaba de autenticarse con la contraseña
 *   correcta.
 * - La foto se guarda con el servicio compartido de imágenes y la anterior se
 *   borra del disco solo después de persistir la nueva URL en la base.
 */
import { Op } from 'sequelize';
import db from '../models';
import config from '../config/config';
import {
  guardarImagenPerfil,
  eliminarImagenEnCarpeta,
} from './imagen_upload_service';
import { eliminarSesiones } from './sesion_service';

/** Error de dominio: la contraseña actual no coincide con la almacenada. */
export class PasswordActualIncorrectaError extends Error {
  constructor() {
    super('La contraseña actual no es correcta');
    this.name = 'PasswordActualIncorrectaError';
  }
}

/** Error de dominio: el email ya pertenece a otra cuenta. */
export class EmailEnUsoError extends Error {
  constructor() {
    super('El email ya está en uso por otra cuenta');
    this.name = 'EmailEnUsoError';
  }
}

/**
 * Normaliza el email con la convención del proyecto (trim + lowercase).
 * @param {*} valor
 * @returns {string}
 */
export function normalizarEmail(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase();
}

/**
 * Devuelve los datos del perfil de un usuario.
 * @param {number} usuarioId
 * @returns {Promise<object>} Datos serializados con datosDePerfil().
 */
export async function obtenerPerfil(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) {
    throw new Error('Usuario inexistente');
  }
  return usuario.datosDePerfil();
}

/**
 * Aplica los cambios de datos personales permitidos.
 *
 * La validación de formato se hace en el controller; acá solo queda la regla
 * de negocio de unicidad de email y la persistencia por instancia (dispara el
 * hook beforeSave de Argon2id si hubiera password, aunque no corresponde).
 *
 * @param {number} usuarioId
 * @param {object} cambios - Solo campos editables (nombre, apellido, email,
 *   telefono, fechaNacimiento) ya normalizados por el controller.
 * @returns {Promise<object>} Perfil actualizado.
 * @throws {EmailEnUsoError} Si el email pertenece a otra cuenta.
 */
export async function actualizarDatosPerfil(usuarioId, cambios) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) {
    throw new Error('Usuario inexistente');
  }

  if (cambios.email) {
    const existente = await db.Usuario.findOne({
      where: { email: cambios.email, id: { [Op.ne]: usuarioId } },
    });
    if (existente) {
      throw new EmailEnUsoError();
    }
  }

  await usuario.update(cambios);
  return usuario.datosDePerfil();
}

/**
 * Cambia la contraseña verificando primero la actual y conservando la sesión
 * vigente (invalida las demás).
 *
 * @param {number} usuarioId
 * @param {object} params
 * @param {string} params.passwordActual
 * @param {string} params.nuevaPassword
 * @param {string} [params.sessionId] - sid de la sesión actual a conservar.
 * @returns {Promise<void>}
 * @throws {PasswordActualIncorrectaError} Si passwordActual no coincide.
 */
export async function cambiarPassword(
  usuarioId,
  { passwordActual, nuevaPassword, sessionId }
) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) {
    throw new Error('Usuario inexistente');
  }

  const coincide = await usuario.verificarPassword(passwordActual);
  if (!coincide) {
    throw new PasswordActualIncorrectaError();
  }

  // update() por instancia: dispara beforeSave y aplica Argon2id (un update
  // masivo la guardaría en texto plano, igual que en password_reset_service).
  await usuario.update({ password: nuevaPassword });
  await eliminarSesiones(usuarioId, { exceptoSid: sessionId });
}

/**
 * Guarda la foto de perfil del usuario y borra la anterior del disco.
 * @param {number} usuarioId
 * @param {object} archivo - req.file (buffer, originalname, mimetype).
 * @returns {Promise<{url: string}>} Ruta relativa de la nueva imagen.
 */
export async function guardarFotoPerfil(usuarioId, archivo) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) {
    throw new Error('Usuario inexistente');
  }

  const anteriorUrl = usuario.fotoPerfilUrl;
  const resultado = await guardarImagenPerfil({
    buffer: archivo.buffer,
    nombreOriginal: archivo.originalname,
    mimetype: archivo.mimetype,
  });

  await usuario.update({ fotoPerfilUrl: resultado.url });

  if (anteriorUrl && anteriorUrl !== resultado.url) {
    try {
      eliminarImagenEnCarpeta(config.imagenes.perfilesDir, anteriorUrl);
    } catch (error) {
      // Borrar la anterior es un desperdicio de disco, no un error de negocio:
      // no debe impedir la respuesta de éxito.
      console.warn(
        '[perfil] no se pudo borrar la foto anterior:',
        error.message
      );
    }
  }

  return { url: resultado.url };
}

/**
 * Elimina la foto de perfil del usuario (respeta el archivo si ya no existía).
 * @param {number} usuarioId
 * @returns {Promise<object>} Perfil actualizado, con fotoPerfilUrl en null.
 */
export async function eliminarFotoPerfil(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) {
    throw new Error('Usuario inexistente');
  }

  const url = usuario.fotoPerfilUrl;
  await usuario.update({ fotoPerfilUrl: null });

  if (url) {
    try {
      eliminarImagenEnCarpeta(config.imagenes.perfilesDir, url);
    } catch (error) {
      console.warn('[perfil] no se pudo borrar la foto:', error.message);
    }
  }

  return usuario.datosDePerfil();
}
