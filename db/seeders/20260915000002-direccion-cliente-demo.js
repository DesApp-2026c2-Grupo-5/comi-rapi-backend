'use strict';

// Dirección de ejemplo para el cliente de la seeder de usuarios (`cliente@test.com`).
//
// Por qué un seeder propio y no tocar `usuarios-proceres.js`: la dirección es otra
// entidad del DER (Direcciones) y ya hay un seeder dedicado por entidad
// (`promociones-demo.js`, `pedidos-ejemplo.js`).
//
// Idempotente: borra la dirección de demo anterior antes de insertar, así se puede
// re-ejecutar sin duplicar.
//
// Ojo con `sucursalId`: la tabla tiene el CHECK `CK_Direcciones_propietario`, que
// exige exactamente un propietario (usuario XOR sucursal). Por eso va en NULL.
// `latitud`/`longitud` quedan en NULL a propósito: no se ingresan a mano, las calcula
// el backend con el servicio de geolocalización (tarea pendiente).

const ALIAS = 'Casa';

module.exports = {
  up: async (queryInterface) => {
    const [usuarios] = await queryInterface.sequelize.query(
      `SELECT id FROM "Usuarios" WHERE email = 'cliente@test.com' LIMIT 1`
    );
    if (!usuarios.length) {
      throw new Error(
        "Seeder de dirección: no se encontró el usuario 'cliente@test.com'. Ejecutar los seeders previos."
      );
    }
    const usuarioId = usuarios[0].id;

    await queryInterface.sequelize.query(
      `DELETE FROM "Direcciones" WHERE "usuarioId" = :usuarioId AND alias = :alias`,
      { replacements: { usuarioId, alias: ALIAS } }
    );

    await queryInterface.bulkInsert('Direcciones', [
      {
        usuarioId,
        sucursalId: null,
        calle: 'Av. Corrientes',
        altura: 2450,
        provincia: 'Buenos Aires',
        localidad: 'CABA',
        codigoPostal: 'C1193',
        referencia: 'Piso 4, timbre A',
        alias: ALIAS,
        activa: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface) => {
    const [usuarios] = await queryInterface.sequelize.query(
      `SELECT id FROM "Usuarios" WHERE email = 'cliente@test.com' LIMIT 1`
    );
    if (!usuarios.length) return;
    await queryInterface.sequelize.query(
      `DELETE FROM "Direcciones" WHERE "usuarioId" = :usuarioId AND alias = :alias`,
      { replacements: { usuarioId: usuarios[0].id, alias: ALIAS } }
    );
  },
};
