'use strict';

/**
 * Insumos demo (extras y condimentos) con stock para probar el flujo completo.
 *
 * La migración de vínculo (`20261028000002`) ya crea un insumo por cada nombre
 * que exista en la personalización, pero esta seeder deja un catálogo explícito
 * y reproducible aunque se corra sobre una base sin esas plantillas:
 *
 *  - Extras con su precio de referencia.
 *  - Condimentos gratuitos.
 *  - 150 unidades por sucursal activa, como el resto del stock demo.
 *
 * También vuelve a linkear elementos/plantillas que hayan quedado sin insumo
 * (por ejemplo, datos cargados a mano entre migraciones) y asegura `disponible`.
 *
 * Idempotente: upserts por (nombre, tipo) y por la PK compuesta del stock.
 */

const INSUMOS = [
  { nombre: 'Tomate', tipo: 'extra', precio: 1800 },
  { nombre: 'Bacon', tipo: 'extra', precio: 3200 },
  { nombre: 'Queso Cheddar en fetas', tipo: 'extra', precio: 2400 },
  { nombre: 'Muzzarella extra', tipo: 'extra', precio: 2200 },
  { nombre: 'Jamón', tipo: 'extra', precio: 2800 },
  { nombre: 'Cheddar extra', tipo: 'extra', precio: 2400 },
  { nombre: 'Sobre de Ketchup', tipo: 'condimento', precio: null },
  { nombre: 'Sobre de Mayonesa', tipo: 'condimento', precio: null },
  { nombre: 'Sobre de Orégano', tipo: 'condimento', precio: null },
  { nombre: 'Sobre de Ají', tipo: 'condimento', precio: null },
];

const CANTIDAD_BASE = 150;
const TIPOS_CON_STOCK = "'extra', 'condimento'";

async function cargarInsumos(queryInterface) {
  for (const insumo of INSUMOS) {
    await queryInterface.sequelize.query(
      `INSERT INTO "Insumos"
         ("nombre","tipo","precio","activo","createdAt","updatedAt")
       VALUES (:nombre, :tipo::"enum_Insumos_tipo", :precio, TRUE, NOW(), NOW())
       ON CONFLICT ("nombre","tipo") DO UPDATE SET
         "precio" = EXCLUDED."precio",
         "activo" = TRUE,
         "updatedAt" = NOW()`,
      {
        replacements: {
          nombre: insumo.nombre,
          tipo: insumo.tipo,
          precio: insumo.precio,
        },
      }
    );
  }

  // Los elementos/plantillas creados antes de existir el insumo quedan con
  // `insumoId` NULL. Se linkean por (nombre, tipo), la misma regla que usó la
  // migración de vínculo.
  await queryInterface.sequelize.query(`
    UPDATE "PersonalizacionElementos" AS pe
    SET "insumoId" = i."id"
    FROM "Insumos" AS i
    WHERE pe."insumoId" IS NULL
      AND pe."tipo"::text = i."tipo"::text
      AND pe."nombre" = i."nombre"
      AND pe."tipo" IN (${TIPOS_CON_STOCK});
  `);

  await queryInterface.sequelize.query(`
    UPDATE "PersonalizacionCategorias" AS pc
    SET "insumoId" = i."id"
    FROM "Insumos" AS i
    WHERE pc."insumoId" IS NULL
      AND pc."tipo"::text = i."tipo"::text
      AND pc."nombre" = i."nombre"
      AND pc."tipo" IN (${TIPOS_CON_STOCK});
  `);

  // Todos los insumos del catálogo, no sólo los de la lista: la migración pudo
  // haber creado otros a partir de datos existentes.
  const [filas] = await queryInterface.sequelize.query(`
    INSERT INTO "InsumoStocks"
      ("sucursalId","insumoId","cantidad","disponible","createdAt","updatedAt")
    SELECT s."id", i."id", ${CANTIDAD_BASE}, TRUE, NOW(), NOW()
    FROM "Sucursales" AS s
    CROSS JOIN "Insumos" AS i
    WHERE s."activa" = TRUE
    ON CONFLICT ("sucursalId","insumoId") DO UPDATE SET
      "cantidad" = EXCLUDED."cantidad",
      "disponible" = TRUE,
      "updatedAt" = NOW()
    RETURNING 1;
  `);

  return filas.length;
}

module.exports = {
  up: async (queryInterface) => {
    const filas = await cargarInsumos(queryInterface);
    console.log(
      `Insumos demo: ${INSUMOS.length} en el catálogo y ${filas} pares sucursal-insumo en ${CANTIDAD_BASE}.`
    );
  },

  down: async (queryInterface) => {
    // Sólo se quitan los insumos de esta seeder. Los que creó la migración de
    // vínculo se conservan porque no hay forma de distinguirlos.
    await queryInterface.sequelize.query(
      `DELETE FROM "Insumos"
       WHERE ("nombre","tipo") IN (${INSUMOS.map(
         (i) => `('${i.nombre.replace(/'/g, "''")}','${i.tipo}')`
       ).join(', ')});`
    );
  },
};
