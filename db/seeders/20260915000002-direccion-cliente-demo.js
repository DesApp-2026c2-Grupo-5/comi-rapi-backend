'use strict';

const { geocodificarDireccion } = require('./utils/utils-georef');

// Direcciones de ejemplo para el cliente de la seeder de usuarios (`cliente@test.com`).
//
// Por qué un seeder propio y no tocar `usuarios-proceres.js`: la dirección es otra
// entidad del DER (Direcciones) y ya hay un seeder dedicado por entidad
// (`promociones-demo.js`, `pedidos-ejemplo.js`).
//
// Idempotente: borra la dirección de demo anterior (por usuario + alias) antes
// de insertar, así se puede re-ejecutar sin duplicar.
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
// - "Casa" (AV GDOR VERGARA 1593, Hurlingham) queda a 1.641 m por ruta de
//   Sucursal Oeste y a 2.717 m de Sucursal Vergara (AV GDOR VERGARA 3547): DOS
//   sucursales en rango, para probar el flujo real de reasignación (si la más
//   cercana pierde stock, el pedido pasa a la otra).
// - "Trabajo" (Av. Santa Fe 3700) queda a 588 m de Sucursal Palermo, única en
//   cobertura: el flujo normal de pedido con una sola sucursal posible.

const DIRECCIONES = [
  {
    alias: 'Casa',
    calle: 'AV GDOR VERGARA',
    altura: 1593,
    provincia: 'Buenos Aires',
    departamento: 'Hurlingham',
    localidad: 'Hurlingham',
    codigoPostal: '1688',
    referencia: 'Casa reja verde',
  },
  {
    alias: 'Trabajo',
    calle: 'Av. Santa Fe',
    altura: 3700,
    provincia: 'Ciudad Autónoma de Buenos Aires',
    localidad: 'Palermo',
    codigoPostal: '1425',
    referencia: 'Piso 4, timbre A',
  },
];

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

    const inserts = [];
    for (const direccion of DIRECCIONES) {
      await queryInterface.sequelize.query(
        `DELETE FROM "Direcciones" WHERE "usuarioId" = :usuarioId AND alias = :alias`,
        { replacements: { usuarioId, alias: direccion.alias } }
      );

      const geo = await geocodificarDireccion(direccion);

      inserts.push({
        usuarioId,
        sucursalId: null,
        calle: direccion.calle,
        altura: direccion.altura,
        provincia: direccion.provincia,
        // Iteración 1-geo: datos territoriales persistidos NORMALIZADOS
        // por Georef (partido/comuna, localidad censal, nomenclatura),
        // igual que hace el ABM (direccion_service).
        departamento: geo.normalizada.departamento,
        localidad: geo.normalizada.localidad,
        nomenclatura: geo.nomenclatura,
        codigoPostal: direccion.codigoPostal,
        referencia: direccion.referencia,
        alias: direccion.alias,
        latitud: geo.latitud,
        longitud: geo.longitud,
        activa: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await queryInterface.bulkInsert('Direcciones', inserts);
  },

  down: async (queryInterface) => {
    const [usuarios] = await queryInterface.sequelize.query(
      `SELECT id FROM "Usuarios" WHERE email = 'cliente@test.com' LIMIT 1`
    );
    if (!usuarios.length) return;
    const aliases = DIRECCIONES.map((d) => d.alias);
    await queryInterface.sequelize.query(
      `DELETE FROM "Direcciones" WHERE "usuarioId" = :usuarioId AND alias IN (:aliases)`,
      { replacements: { usuarioId: usuarios[0].id, aliases } }
    );
  },
};
