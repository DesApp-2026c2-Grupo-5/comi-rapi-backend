'use strict';

/**
 * El recibo muestra el nombre del cupón en lugar de su código. Ese nombre es el
 * de la emisión (`CuponEmisiones.nombre`) y se guarda como snapshot en
 * `PedidoCupones`, junto al código y las condiciones de descuento, para que el
 * comprobante siga siendo reconstruible aunque cambie la emisión.
 *
 * Los usos anteriores se completan desde su emisión para que también muestren
 * el nombre en recibos ya emitidos.
 */
module.exports = {
  up: async (queryInterface) => {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      'ALTER TABLE "PedidoCupones" ADD COLUMN IF NOT EXISTS "nombre" VARCHAR(160)'
    );
    await sequelize.query(`
      UPDATE "PedidoCupones" uso
      SET "nombre" = emision."nombre"
      FROM "Cupones" cupon
      JOIN "CuponEmisiones" emision ON emision."id" = cupon."emisionId"
      WHERE uso."cuponId" = cupon."id" AND uso."nombre" IS NULL
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE "PedidoCupones" DROP COLUMN IF EXISTS "nombre"'
    );
  },
};
