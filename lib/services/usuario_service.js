/**
 * Servicio de gestión de usuarios (panel de superadministración).
 *
 * Reglas de negocio:
 * - Se crean/editan CLIENTE, ADMINISTRADOR y SUPERADMINISTRADOR (solo el actor
 *   SUPERADMINISTRADOR; no puede tocar su propio rol).
 * - Un ADMINISTRADOR debe tener una sucursal válida; CLIENTE y SUPERADMINISTRADOR
 *   no llevan sucursal (el CHECK de la base también lo impone).
 * - El email es único (normalizado) y la contraseña se hashea en el hook del
 *   modelo (siempre `create`/`save` por instancia, nunca update masivo).
 *
 * - No se puede desactivar ni cambiar el rol del último SUPERADMINISTRADOR
 *   activo: la verificación corre dentro de una transacción con lock.
 *
 * Los controllers traducen estos errores tipados a HTTP (400 y 409).
 */
import { Op } from 'sequelize';
import db from '../models';
import { normalizarEmail } from './perfil_service';

const ROLES_GESTIONABLES = ['CLIENTE', 'ADMINISTRADOR', 'SUPERADMINISTRADOR'];

/** Error de dominio: la entrada no cumple una regla de negocio de usuarios. */
export class ErrorValidacionUsuario extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacionUsuario';
  }
}

/** Error de dominio: el usuario a editar no existe (HTTP 404). */
export class UsuarioNoEncontradoError extends Error {
  constructor(id) {
    super(`No se encontró un usuario con id ${id}`);
    this.name = 'UsuarioNoEncontradoError';
  }
}

/**
 * Error de dominio: la operación dejaría al sistema sin ningún
 * SUPERADMINISTRADOR activo (HTTP 409). Se dispara al desactivar al último o
 * al cambiarle el rol.
 */
export class UltimoSuperadminError extends Error {
  constructor() {
    super(
      'No se puede desactivar ni cambiar el rol del último superadministrador activo'
    );
    this.name = 'UltimoSuperadminError';
  }
}

const validarEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validarPassword = (password) =>
  typeof password === 'string' && password.length >= 6;

/**
 * Resuelve la sucursal asignada según el rol.
 *
 * Un ADMINISTRADOR necesita una sucursal existente; el resto de los roles no
 * llevan sucursal (devuelve null).
 *
 * @param {string} rol
 * @param {number|string|null} sucursalId
 * @param {object} [opciones]
 * @param {import('sequelize').Transaction} [opciones.transaction] - Transacción
 *   en curso, para que la lectura participe del mismo snapshot/bloqueo.
 * @returns {Promise<number|null>}
 */
async function resolverSucursal(rol, sucursalId, { transaction } = {}) {
  if (rol !== 'ADMINISTRADOR') {
    return null;
  }
  const id = Number(sucursalId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorValidacionUsuario(
      'Un administrador debe tener una sucursal asignada'
    );
  }
  const sucursal = await db.Sucursal.findByPk(id, { transaction });
  if (!sucursal) {
    throw new ErrorValidacionUsuario(`No se encontró la sucursal ${id}`);
  }
  return id;
}

/**
 * Crea un usuario (CLIENTE, ADMINISTRADOR o SUPERADMINISTRADOR) desde el panel.
 *
 * @param {object} datos - nombre, email, password y (rol/sucursalId/apellido/
 *   telefono/activo opcionales).
 * @returns {Promise<object>} Usuario en formato administración.
 * @throws {ErrorValidacionUsuario} Si la entrada es inválida o el email ya existe.
 */
export async function crearUsuario(datos) {
  const email = normalizarEmail(datos.email);
  const nombre = String(datos.nombre || '').trim();
  const rol = datos.rol || 'CLIENTE';

  if (!validarEmail(email)) {
    throw new ErrorValidacionUsuario('El email no es válido');
  }
  if (!validarPassword(datos.password)) {
    throw new ErrorValidacionUsuario(
      'La contraseña debe tener al menos 6 caracteres'
    );
  }
  if (!nombre) {
    throw new ErrorValidacionUsuario('El nombre es obligatorio');
  }
  if (!ROLES_GESTIONABLES.includes(rol)) {
    throw new ErrorValidacionUsuario('El rol indicado no es válido');
  }

  const sucursalId = await resolverSucursal(rol, datos.sucursalId);

  const existente = await db.Usuario.findOne({ where: { email } });
  if (existente) {
    throw new ErrorValidacionUsuario('El email ya está en uso');
  }

  const usuario = await db.Usuario.create({
    nombre,
    apellido: String(datos.apellido || '').trim(),
    email,
    password: datos.password,
    telefono: String(datos.telefono || '').trim() || null,
    rol,
    sucursalId,
    activo: datos.activo === undefined ? true : Boolean(datos.activo),
  });

  return usuario.datosAdministracion(0);
}

/**
 * Actualiza los datos gestionables de un usuario (datos, rol, sucursal, estado).
 *
 * Corre dentro de una transacción con bloqueo (`FOR UPDATE`) sobre el conjunto
 * de SUPERADMINISTRADORES activos, que es la PRIMERA consulta de la transacción.
 * Ese lock serializa las ediciones que podrían vaciar ese conjunto: si dos
 * peticiones intentan desactivar (o degradar) a los dos últimos superadmins a la
 * vez, una entra primero y la segunda reevalúa el conjunto ya actualizado, ve
 * que quedaría vacío y responde 409. Bloquear el conjunto antes que la fila
 * objetivo también evita deadlocks entre dos ediciones cruzadas.
 *
 * Nota para el futuro: si se agrega `DELETE /api/usuarios/:id`, debe reutilizar
 * esta misma verificación (borrar al último superadmin activo también debe
 * responder 409).
 *
 * @param {number} id - Id del usuario a editar.
 * @param {object} cambios - Subconjunto de nombre, apellido, email, telefono,
 *   rol, sucursalId, activo.
 * @param {object} [opciones]
 * @param {number} [opciones.actorId] - Id del superadmin que ejecuta (para
 *   impedir que se cambie su propio rol y se autobloquea).
 * @returns {Promise<object>} Usuario actualizado en formato administración.
 * @throws {ErrorValidacionUsuario}
 * @throws {UsuarioNoEncontradoError}
 * @throws {UltimoSuperadminError}
 */
export async function actualizarUsuario(id, cambios, { actorId } = {}) {
  return db.sequelize.transaction(async (transaction) => {
    // Primera consulta de la transacción: bloquea a los superadmins activos.
    const supersActivos = await db.Usuario.findAll({
      where: { rol: 'SUPERADMINISTRADOR', activo: true },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    const usuario = await db.Usuario.findByPk(id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!usuario) {
      throw new UsuarioNoEncontradoError(id);
    }

    const rol = cambios.rol || usuario.rol;
    if (!ROLES_GESTIONABLES.includes(rol)) {
      throw new ErrorValidacionUsuario('El rol indicado no es válido');
    }
    if (actorId === usuario.id && rol !== usuario.rol) {
      throw new ErrorValidacionUsuario('No podés cambiar tu propio rol');
    }

    // ¿La edición saca a este usuario del conjunto de superadmins activos?
    const activoFinal =
      cambios.activo !== undefined ? Boolean(cambios.activo) : usuario.activo;
    const saleDelConjunto =
      usuario.rol === 'SUPERADMINISTRADOR' &&
      usuario.activo &&
      (rol !== 'SUPERADMINISTRADOR' || !activoFinal);
    if (saleDelConjunto) {
      const quedanActivos = supersActivos.filter(
        (superadmin) => String(superadmin.id) !== String(usuario.id)
      ).length;
      if (quedanActivos === 0) {
        throw new UltimoSuperadminError();
      }
    }

    if (cambios.email !== undefined) {
      const email = normalizarEmail(cambios.email);
      if (!validarEmail(email)) {
        throw new ErrorValidacionUsuario('El email no es válido');
      }
      const existente = await db.Usuario.findOne({
        where: { email, id: { [Op.ne]: usuario.id } },
        transaction,
      });
      if (existente) {
        throw new ErrorValidacionUsuario('El email ya está en uso');
      }
      usuario.email = email;
    }

    if (cambios.nombre !== undefined) {
      const nombre = String(cambios.nombre).trim();
      if (!nombre) {
        throw new ErrorValidacionUsuario('El nombre es obligatorio');
      }
      usuario.nombre = nombre;
    }
    if (cambios.apellido !== undefined) {
      usuario.apellido = String(cambios.apellido).trim();
    }
    if (cambios.telefono !== undefined) {
      usuario.telefono = String(cambios.telefono).trim() || null;
    }
    if (cambios.activo !== undefined) {
      usuario.activo = Boolean(cambios.activo);
    }

    if (cambios.rol !== undefined || cambios.sucursalId !== undefined) {
      const sucursalId = await resolverSucursal(
        rol,
        cambios.sucursalId !== undefined
          ? cambios.sucursalId
          : usuario.sucursalId,
        { transaction }
      );
      usuario.rol = rol;
      usuario.sucursalId = sucursalId;
    }

    await usuario.save({ transaction });

    const cantidadPedidos = await db.Pedido.count({
      where: { usuarioId: usuario.id },
      transaction,
    });
    return usuario.datosAdministracion(cantidadPedidos);
  });
}
