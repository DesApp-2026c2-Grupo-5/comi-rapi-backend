'use strict';

// Iteración 1-geo (direcciones y geolocalización): modelo territorial de
// `Direccion` alineado con Georef Argentina.
//
// Cambios y motivos (diseño aprobado en la iteración 1, ver
// `docs/informe-iteracion1-geo-direcciones.md`):
//   - Nueva columna `departamento`: unidad territorial intermedia que usa
//     Georef (partido en Buenos Aires, comuna en CABA, departamento en el
//     resto del país). Permite desambiguar direcciones como
//     "General Villegas 5329" (existen en Avellaneda y en Tres de Febrero).
//     Nullable: las filas existentes no la tienen; se completa al editar la
//     dirección o mediante un backfill futuro.
//   - Nueva columna `nomenclatura`: dirección completa normalizada por
//     Georef, para confirmación del usuario y auditoría.
//   - `codigoPostal` pasa a ser opcional: Georef NO provee el código postal
//     (verificado contra su API), así que el sistema deja de exigirlo al
//     usuario en lugar de incorporar otro proveedor externo.
//   - `localidad` pasa a ser opcional a nivel de persistencia: el backend la
//     determina a partir de la `localidad_censal` que devuelve Georef al
//     geocodificar (la validación condicional vive en `direccion_service`).
//
// down(): inverso completo (se pierden los datos de las columnas nuevas, como
// las coordenadas en migraciones anteriores del proyecto).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Direcciones', 'departamento', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('Direcciones', 'nomenclatura', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "codigoPostal" DROP NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "localidad" DROP NOT NULL`
    );
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `UPDATE "Direcciones" SET "codigoPostal" = '' WHERE "codigoPostal" IS NULL`
    );
    await queryInterface.sequelize.query(
      `UPDATE "Direcciones" SET "localidad" = '' WHERE "localidad" IS NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "localidad" SET NOT NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "Direcciones" ALTER COLUMN "codigoPostal" SET NOT NULL`
    );
    await queryInterface.removeColumn('Direcciones', 'nomenclatura');
    await queryInterface.removeColumn('Direcciones', 'departamento');
  },
};
