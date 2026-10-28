'use strict';

/**
 * Vincula la personalización existente con el catálogo de insumos.
 *
 * Pasos:
 *  1. Agrega `insumoId` (nullable) a `PersonalizacionElementos` y a
 *     `PersonalizacionCategorias`. Sólo se usa en `extra` y `condimento`.
 *  2. Crea un insumo por cada combinación (nombre, tipo) que ya exista en la
 *     personalización, con el mayor precio conocido para los extras.
 *  3. Linkea los elementos y plantillas existentes con su insumo.
 *  4. Deja 150 unidades en cada sucursal activa, para que los extras y
 *     condimentos que ya se vendían sigan funcionando. Los insumos nuevos
 *     arrancan en 0 y el admin carga la cantidad desde Stock.
 *
 * Es idempotente: `ON CONFLICT DO NOTHING` y los UPDATE sólo tocan filas con
 * `insumoId IS NULL`.
 */

const TIPOS_CON_STOCK = "'extra', 'condimento'";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const referencia = {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Insumos',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };

    // La migración es idempotente: si un intento anterior falló después de
    // agregar una columna, se puede volver a correr sin romper.
    const columnasElementos = await queryInterface.describeTable(
      'PersonalizacionElementos'
    );
    if (!columnasElementos.insumoId) {
      await queryInterface.addColumn(
        'PersonalizacionElementos',
        'insumoId',
        referencia
      );
    }
    const columnasCategorias = await queryInterface.describeTable(
      'PersonalizacionCategorias'
    );
    if (!columnasCategorias.insumoId) {
      await queryInterface.addColumn(
        'PersonalizacionCategorias',
        'insumoId',
        referencia
      );
    }

    const indicesElementos = await queryInterface.showIndex(
      'PersonalizacionElementos'
    );
    if (
      !indicesElementos.some(
        (indice) => indice.name === 'personalizacion_elementos_insumo_id'
      )
    ) {
      await queryInterface.addIndex('PersonalizacionElementos', ['insumoId'], {
        name: 'personalizacion_elementos_insumo_id',
      });
    }
    const indicesCategorias = await queryInterface.showIndex(
      'PersonalizacionCategorias'
    );
    if (
      !indicesCategorias.some(
        (indice) => indice.name === 'personalizacion_categorias_insumo_id'
      )
    ) {
      await queryInterface.addIndex('PersonalizacionCategorias', ['insumoId'], {
        name: 'personalizacion_categorias_insumo_id',
      });
    }

    // Un insumo por (nombre, tipo). El precio de referencia de un extra es el
    // mayor que ya estuviera configurado; cada elemento conserva su propio
    // precio y puede pisarlo.
    await queryInterface.sequelize.query(`
      INSERT INTO "Insumos" ("nombre", "tipo", "precio", "activo", "createdAt", "updatedAt")
      SELECT origen."nombre",
             origen."tipo"::"enum_Insumos_tipo",
             CASE WHEN origen."tipo" = 'extra' THEN MAX(origen."precio") ELSE NULL END,
             true,
             NOW(),
             NOW()
      FROM (
        SELECT "nombre", "tipo"::text AS "tipo", "precio"
        FROM "PersonalizacionElementos"
        WHERE "tipo" IN (${TIPOS_CON_STOCK})
          AND "nombre" IS NOT NULL
          AND btrim("nombre") <> ''
        UNION ALL
        SELECT "nombre", "tipo"::text AS "tipo", "precio"
        FROM "PersonalizacionCategorias"
        WHERE "tipo" IN (${TIPOS_CON_STOCK})
          AND "nombre" IS NOT NULL
          AND btrim("nombre") <> ''
      ) AS origen
      GROUP BY origen."nombre", origen."tipo"
      ON CONFLICT ("nombre", "tipo") DO NOTHING;
    `);

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

    await queryInterface.sequelize.query(`
      INSERT INTO "InsumoStocks" ("sucursalId", "insumoId", "cantidad", "disponible", "createdAt", "updatedAt")
      SELECT s."id", i."id", 150, true, NOW(), NOW()
      FROM "Sucursales" AS s
      CROSS JOIN "Insumos" AS i
      WHERE s."activa" = true
      ON CONFLICT ("sucursalId", "insumoId") DO NOTHING;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      'PersonalizacionCategorias',
      'personalizacion_categorias_insumo_id'
    );
    await queryInterface.removeIndex(
      'PersonalizacionElementos',
      'personalizacion_elementos_insumo_id'
    );
    await queryInterface.removeColumn('PersonalizacionCategorias', 'insumoId');
    await queryInterface.removeColumn('PersonalizacionElementos', 'insumoId');
  },
};
