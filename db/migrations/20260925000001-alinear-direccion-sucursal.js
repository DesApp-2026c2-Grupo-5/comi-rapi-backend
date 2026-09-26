'use strict';

// Alineación del modelo Direccion / Sucursal.
//
// Antes: `Sucursales` almacenaba `direccion` (STRING NOT NULL) + `latitud`/`longitud`,
// y `Direcciones` solo podía pertenecer a un usuario (`usuarioId NOT NULL`).
//
// Después: `Direccion` es la única entidad con datos de ubicación; puede pertenecer
// a un Usuario (1:N) o a una Sucursal (1:1), pero no a ambos ni a ninguno
// (CHECK `CK_Direcciones_propietario`).
//
// up():
//   1. Agrega `Direcciones.sucursalId` (FK nullable, onDelete RESTRICT).
//   2. Vuelve `Direcciones.usuarioId` nullable (conserva la FK).
//   3. Backfill: por cada Sucursal crea un registro en Direcciones con sus datos.
//      Si el string termina en número entero (ej. 'Av. Principal 123') se parsea:
//      calle='Av. Principal', altura=123. Si no, el string completo va a `calle`
//      y `altura` queda NULL (no se inventan datos).
//   4. CHECK: exactamente uno de usuarioId/sucursalId NOT NULL.
//   5. Elimina `Sucursales.direccion`, `Sucursales.latitud` y `Sucursales.longitud`.
//
// down(): inverso completo, preservando los datos.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Direcciones', 'sucursalId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Sucursales', key: 'id' },
      onDelete: 'RESTRICT',
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "usuarioId" DROP NOT NULL`
    );

    await queryInterface.sequelize.query(`
      INSERT INTO "Direcciones"
        ("sucursalId", "calle", "altura", "ciudad", "codigoPostal", "referencia",
         "latitud", "longitud", "alias", "activa", "createdAt", "updatedAt")
      SELECT
        s.id,
        CASE
          WHEN s.direccion ~ '^.+\\s+[0-9]+$'
            THEN btrim(regexp_replace(s.direccion, '[0-9]+[ ]*$', ''), ' ')
          ELSE s.direccion
        END,
        CASE
          WHEN s.direccion ~ '^.+\\s+[0-9]+$'
            THEN substring(s.direccion from '[0-9]+$')::INTEGER
          ELSE NULL
        END,
        NULL,
        NULL,
        NULL,
        s.latitud,
        s.longitud,
        NULL,
        TRUE,
        NOW(),
        NOW()
      FROM "Sucursales" s
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "Direcciones" ADD CONSTRAINT "CK_Direcciones_propietario"
      CHECK (
        ("usuarioId" IS NOT NULL)::int + ("sucursalId" IS NOT NULL)::int = 1
      )
    `);

    await queryInterface.removeColumn('Sucursales', 'direccion');
    await queryInterface.removeColumn('Sucursales', 'latitud');
    await queryInterface.removeColumn('Sucursales', 'longitud');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Sucursales', 'direccion', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('Sucursales', 'latitud', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });
    await queryInterface.addColumn('Sucursales', 'longitud', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE "Sucursales" s
      SET
        "direccion" = CASE
          WHEN d.altura IS NOT NULL THEN d.calle || ' ' || d.altura::text
          ELSE d.calle
        END,
        "latitud" = d.latitud,
        "longitud" = d.longitud
      FROM "Direcciones" d
      WHERE d."sucursalId" = s.id
    `);

    await queryInterface.sequelize.query(`
      DELETE FROM "Direcciones" WHERE "sucursalId" IS NOT NULL
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "Direcciones" DROP CONSTRAINT "CK_Direcciones_propietario"
    `);

    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "usuarioId" SET NOT NULL`
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "Sucursales" ALTER COLUMN "direccion" SET NOT NULL`
    );

    await queryInterface.removeColumn('Direcciones', 'sucursalId');
  },
};
