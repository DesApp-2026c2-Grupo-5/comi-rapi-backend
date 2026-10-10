'use strict';

const { geocodificarDireccion } = require('./utils/utils-georef');

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
//
// Coordenadas: NO se cargan a mano. Se geocodifica en `up` con el MISMO servicio
// que usa la app (geolocation_service, Georef Argentina, vía el build
// transpilado — ver ./utils/utils-georef.js). Si Georef no encuentra la dirección,
// devuelve resultados ambiguos o falla, el seeder se detiene con el error tipado
// y no se inserta nada (sin coordenadas de respaldo).
//
// Cobertura (verificada en vivo con ORS al definir el seed, no validada acá):
// Av. Santa Fe 3700 queda a 588 m por ruta de Sucursal Palermo (Alto Palermo,
// Av. Santa Fe 3253) y a 2.970 m de Sucursal Recoleta (Av. Las Heras 1800): la
// dirección demo queda cubierta por DOS sucursales, para poder probar el flujo
// real de reasignación al pagar (si la más cercana no tiene stock, el pedido
// pasa a la otra). Sucursal Oeste (Plaza Oeste, Morón) sigue a 26.824 m, fuera
// del radio, y sirve para el caso contrario.

const ALIAS = 'Casa';

const DIRECCION = {
  calle: 'Av. Santa Fe',
  altura: 3700,
  provincia: 'Ciudad Autónoma de Buenos Aires',
  localidad: 'Palermo',
  codigoPostal: '1425',
  referencia: 'Piso 4, timbre A',
};

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

    const geo = await geocodificarDireccion(DIRECCION);

    await queryInterface.bulkInsert('Direcciones', [
      {
        usuarioId,
        sucursalId: null,
        calle: DIRECCION.calle,
        altura: DIRECCION.altura,
        provincia: DIRECCION.provincia,
        // Iteración 1-geo: datos territoriales persistidos NORMALIZADOS
        // por Georef (partido/comuna, localidad censal, nomenclatura),
        // igual que hace el ABM (direccion_service).
        departamento: geo.normalizada.departamento,
        localidad: geo.normalizada.localidad,
        nomenclatura: geo.nomenclatura,
        codigoPostal: DIRECCION.codigoPostal,
        referencia: DIRECCION.referencia,
        alias: ALIAS,
        latitud: geo.latitud,
        longitud: geo.longitud,
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
