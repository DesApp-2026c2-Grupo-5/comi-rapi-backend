'use strict';

/**
 * Crea (si no existe) el primer SUPERADMINISTRADOR del sistema.
 *
 * No hay un POST público que cree roles privilegiados (el registro siempre arma
 * un CLIENTE y `POST /api/usuarios` exige sesión de SUPERADMIN), así que el
 * primer superadmin se da de alta desde la consola.
 *
 * Idempotente: si ya existe un SUPERADMINISTRADOR con ese email no toca nada.
 * Si el email existe con otro rol, avisa y no lo reemplaza (no se pisa un
 * usuario real ni se reasigna de rol implícitamente).
 *
 * Uso:
 *   npm run crear:superadmin
 *   SUPERADMIN_EMAIL=quien@comirapi.com SUPERADMIN_PASSWORD=clave npm run crear:superadmin
 *
 * Credenciales por variables de entorno (con defaults solo para desarrollo y
 * la demo, igual que los seeders). La contraseña NUNCA se imprime.
 *
 * Respeta `NODE_ENV`: con `NODE_ENV=test` escribe en `SQL_TEST_DATABASE`. La
 * config se toma de `lib/config/config.js` para no duplicarla.
 */

const argon2 = require('argon2');
const config = require('../lib/config/config');
const { Sequelize } = require('sequelize');

const EMAIL_POR_DEFECTO = 'superadmin@test.com';
const PASSWORD_POR_DEFECTO = '123456';
const NOMBRE_POR_DEFECTO = 'Superadmin';

const sequelize = new Sequelize(config.db);

/**
 * @param {{email?: string, password?: string, nombre?: string, apellido?: string}} [parametros]
 * @returns {Promise<{creado: boolean, id?: number, email: string, motivo?: string}>}
 */
async function crearSuperadmin({
  email = process.env.SUPERADMIN_EMAIL || EMAIL_POR_DEFECTO,
  password = process.env.SUPERADMIN_PASSWORD || PASSWORD_POR_DEFECTO,
  nombre = process.env.SUPERADMIN_NOMBRE || NOMBRE_POR_DEFECTO,
  apellido = process.env.SUPERADMIN_APELLIDO || null,
} = {}) {
  const emailNormalizado = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
    throw new Error('El email del superadmin no es válido.');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('La contraseña tiene que tener 6 caracteres o más.');
  }

  const [
    existentes,
  ] = await sequelize.query(
    `SELECT id, rol FROM "Usuarios" WHERE lower(email) = lower(:email)`,
    { replacements: { email: emailNormalizado } }
  );

  if (existentes.length > 0) {
    const { id, rol } = existentes[0];
    if (rol === 'SUPERADMINISTRADOR') {
      return { creado: false, id, email: emailNormalizado };
    }
    return {
      creado: false,
      id,
      email: emailNormalizado,
      motivo: `ese email ya existe con el rol ${rol}; no se reemplaza`,
    };
  }

  const hash = await argon2.hash(password, config.argon2);
  const [creados] = await sequelize.query(
    `INSERT INTO "Usuarios" ("email", "password", "nombre", "apellido", "rol", "activo", "createdAt", "updatedAt")
     VALUES (:email, :password, :nombre, :apellido, 'SUPERADMINISTRADOR', true, NOW(), NOW())
     RETURNING id`,
    {
      replacements: {
        email: emailNormalizado,
        password: hash,
        nombre: String(nombre).trim(),
        apellido: apellido ? String(apellido).trim() : null,
      },
    }
  );

  return { creado: true, id: creados[0].id, email: emailNormalizado };
}

async function main(parametros = {}) {
  const resultado = await crearSuperadmin(parametros);
  if (resultado.creado) {
    console.log(
      `SUPERADMINISTRADOR creado: ${resultado.email} (id ${resultado.id}).`
    );
    console.log(
      'No se muestra la contraseña. Si la olvidaste, volvé a correr este script.'
    );
  } else if (resultado.motivo) {
    console.log(
      `No se creó ${resultado.email}: ${resultado.motivo} (id ${resultado.id}).`
    );
  } else {
    console.log(
      `Ya existe un SUPERADMINISTRADOR con ${resultado.email} (id ${resultado.id}). No se tocó nada.`
    );
  }
}

module.exports = { main, crearSuperadmin, sequelize, EMAIL_POR_DEFECTO };

/* Solo se autoejecuta cuando se lo invoca como script: los tests lo importan. */
if (require.main === module) {
  main()
    .then(() => sequelize.close())
    .catch(async (error) => {
      console.error(`No se pudo crear el superadmin: ${error.message}`);
      await sequelize.close();
      process.exit(1);
    });
}
