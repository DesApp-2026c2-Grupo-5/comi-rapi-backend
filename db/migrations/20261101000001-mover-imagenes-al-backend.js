'use strict';

/**
 * Mueve las imágenes del frontend al backend.
 *
 * Antes los archivos vivían en `comi-rapi-fronted/public/imagenes` y se
 * servían desde Vite con rutas `/imagenes/...`. Ahora viven en
 * `comi-rapi-backend/public/imagenes` y Express las publica en
 * `/api/imagenes/...`.
 *
 * La migración reescribe las rutas ya guardadas. Es idempotente: sólo toca
 * filas que todavía empiezan con el prefijo viejo.
 */

const PREFIJO_VIEJO = '/imagenes/';
const PREFIJO_NUEVO = '/api/imagenes/';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Productos"
       SET "imagen" = REPLACE("imagen", '${PREFIJO_VIEJO}', '${PREFIJO_NUEVO}')
       WHERE "imagen" LIKE '${PREFIJO_VIEJO}%';`
    );
    await queryInterface.sequelize.query(
      `UPDATE "Categorias"
       SET "imagen" = REPLACE("imagen", '${PREFIJO_VIEJO}', '${PREFIJO_NUEVO}')
       WHERE "imagen" LIKE '${PREFIJO_VIEJO}%';`
    );
    await queryInterface.sequelize.query(
      `UPDATE "Usuarios"
       SET "fotoPerfilUrl" = REPLACE("fotoPerfilUrl", '${PREFIJO_VIEJO}', '${PREFIJO_NUEVO}')
       WHERE "fotoPerfilUrl" LIKE '${PREFIJO_VIEJO}%';`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Productos"
       SET "imagen" = REPLACE("imagen", '${PREFIJO_NUEVO}', '${PREFIJO_VIEJO}')
       WHERE "imagen" LIKE '${PREFIJO_NUEVO}%';`
    );
    await queryInterface.sequelize.query(
      `UPDATE "Categorias"
       SET "imagen" = REPLACE("imagen", '${PREFIJO_NUEVO}', '${PREFIJO_VIEJO}')
       WHERE "imagen" LIKE '${PREFIJO_NUEVO}%';`
    );
    await queryInterface.sequelize.query(
      `UPDATE "Usuarios"
       SET "fotoPerfilUrl" = REPLACE("fotoPerfilUrl", '${PREFIJO_NUEVO}', '${PREFIJO_VIEJO}')
       WHERE "fotoPerfilUrl" LIKE '${PREFIJO_NUEVO}%';`
    );
  },
};
