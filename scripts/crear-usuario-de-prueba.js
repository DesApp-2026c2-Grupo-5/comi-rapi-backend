'use strict';

/**
 * Crea (o repara) un usuario de prueba con un rol privilegiado.
 *
 * El registro público SIEMPRE crea CLIENTE (ver `validarRegistro` en
 * `lib/controllers/auth_controller.js`), así que las verificaciones end-to-end
 * no pueden obtener un SUPERADMINISTRADOR por la API. Sin ese rol no se puede
 * editar el catálogo (`PUT /api/productos/:id` es de superadministración), y
 * sin catálogo no se puede verificar en navegador el evento
 * `catalogo_actualizado`.
 *
 * Es idempotente: si el email ya existe, se le repone password, rol y activo.
 * No borra nada ni toca usuarios ajenos.
 *
 * Uso: node scripts/crear-usuario-de-prueba.js <email> <password> <ROL> [sucursalId] [nombre]
 *      ROL: ADMINISTRADOR | SUPERADMINISTRADOR
 *      sucursalId: solo para ADMINISTRADOR (el de la sucursal que opera).
 *
 * Respeta `NODE_ENV` (misma config que el resto de los scripts).
 */

const argon2 = require('argon2');
const config = require('../lib/config/config');
const { Sequelize } = require('sequelize');

const ROLES_PERMITIDOS = ['ADMINISTRADOR', 'SUPERADMINISTRADOR'];

async function main() {
  const [email, password, rol, sucursalIdCruda, nombre] = process.argv.slice(2);
  if (!email || !password || !ROLES_PERMITIDOS.includes(rol)) {
    console.error(
      'Uso: node scripts/crear-usuario-de-prueba.js <email> <password> <ROL> [sucursalId] [nombre]\n' +
        `  ROL: ${ROLES_PERMITIDOS.join(' | ')}`
    );
    process.exit(1);
  }

  // Un ADMINISTRADOR sin sucursal no puede operar (requiereSucursal); el
  // SUPERADMINISTRADOR no se acota a ninguna. Un valor no numérico se toma
  // como "sin sucursal".
  const sucursalId =
    rol === 'ADMINISTRADOR' && sucursalIdCruda && Number(sucursalIdCruda)
      ? Number(sucursalIdCruda)
      : null;

  const sequelize = new Sequelize(config.db);
  try {
    const hash = await argon2.hash(password, config.argon2);
    await sequelize.query(
      `INSERT INTO "Usuarios" (email, password, nombre, rol, "sucursalId", "activo", "createdAt", "updatedAt")
       VALUES (:email, :hash, :nombre, :rol, :sucursalId, true, now(), now())
       ON CONFLICT (email) DO UPDATE
         SET password = EXCLUDED.password,
             rol = EXCLUDED.rol,
             "sucursalId" = EXCLUDED."sucursalId",
             "activo" = true,
             "updatedAt" = now()`,
      {
        replacements: {
          email,
          hash,
          nombre: nombre || 'Verificacion UI',
          rol,
          sucursalId,
        },
      }
    );
    console.log(
      `Usuario ${email} (${rol}${
        sucursalId ? `, sucursal ${sucursalId}` : ''
      }) listo.`
    );
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  console.error(`No se pudo crear el usuario de prueba: ${error.message}`);
  process.exit(1);
});
