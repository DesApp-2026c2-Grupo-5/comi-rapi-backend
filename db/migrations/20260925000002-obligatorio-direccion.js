'use strict';

// Obligatoriedad de los datos de ubicación en `Direccion` (preparación para la
// futura funcionalidad de geolocalización, que calculará latitud/longitud a
// partir de estos datos ingresados).
//
// Antes: `ciudad`, `altura` y `codigoPostal` eran opcionales; no existía `provincia`.
//
// Después:
//   - `ciudad` pasa a llamarse `localidad` (renombrado, preserva los datos).
//   - Nueva columna `provincia`.
//   - `calle`, `altura`, `provincia`, `localidad` y `codigoPostal` son NOT NULL
//     (la obligatoriedad también se valida a nivel de modelo y API).
//   - `latitud`/`longitud` siguen siendo opcionales (a futuro las calcula un
//     servicio de geolocalización; no se ingresan manualmente).
//
// NOTA: si la tabla tiene filas con `provincia`/`localidad`/`codigoPostal`/`altura`
// nulos, esta migración falla. En ese caso aplicar el reset completo documentado
// en `docs/reset-db.md` (los datos se recrean con los seeders).
//
// down(): inverso completo, preservando los datos.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.renameColumn('Direcciones', 'ciudad', 'localidad');

    await queryInterface.addColumn('Direcciones', 'provincia', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "altura" SET NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "codigoPostal" SET NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "localidad" SET NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "provincia" SET NOT NULL`
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "provincia" DROP NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "localidad" DROP NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "codigoPostal" DROP NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "altura" DROP NOT NULL`
    );

    await queryInterface.removeColumn('Direcciones', 'provincia');

    await queryInterface.renameColumn('Direcciones', 'localidad', 'ciudad');
  },
};
