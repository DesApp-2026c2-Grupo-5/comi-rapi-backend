'use strict';

/**
 * Consolidación final del módulo de cupones/emisiones.
 *
 * Deja únicamente tres tablas propias del módulo:
 *   - CuponEmisiones
 *   - Cupones
 *   - PedidoCupones
 *
 * Antes de eliminar las tablas auxiliares se traslada la información útil a esas
 * tres tablas:
 *   - El alcance de CuponEmisionCategorias / CuponEmisionProductos se fusiona
 *     en `CuponEmisiones.configuracionSnapshot.alcance` y, cuando el cupón aún
 *     conserva el snapshot global, en `Cupones.alcanceSnapshot`.
 *   - Cada fila de CuponPreviewTokens se convierte en
 *     `CuponEmisiones.previewTokenHash` (UNIQUE) más sus metadatos en
 *     `configuracionSnapshot.previewToken`. Así se conserva el token de un solo
 *     uso sin tabla auxiliar.
 *   - Los ids legacy `campanaId` / `ejecucionId`, si los hubiera, se guardan en
 *     `Cupones.alcanceSnapshot.origenLegacy` antes de soltar las columnas y sus
 *     foreign keys.
 *
 * `up` es idempotente: puede ejecutarse sobre bases donde las tablas auxiliares
 * ya no existen (o donde nunca existieron). `down` reconstruye la estructura
 * auxiliar y devuelve los datos que pueden reconstruirse desde los snapshots.
 */

const AUXILIARES = [
  'CuponEmisionCategorias',
  'CuponEmisionProductos',
  'CuponPreviewTokens',
  'Campanas',
  'CampanaEjecuciones',
  // Auxiliares de la etapa v2, removidas por 20261122000010. Se incluyen para
  // que una instalación que tenga alguna de ellas pendiente también quede limpia.
  'EmisionExclusiones',
  'EmisionDestinatarios',
  'PlantillasSegmento',
  'SegmentoVersiones',
  'Segmentos',
  'MetricasClientes',
];

const CONSTRAINT_PREVIEW = 'cupon_emisiones_preview_token_hash_unique';
const TABLAS_PERMITIDAS = ['CuponEmisiones', 'Cupones', 'PedidoCupones'];

const constNumeros = (valor) =>
  Array.from(
    new Set(
      (Array.isArray(valor) ? valor : [])
        .map(Number)
        .filter((n) => Number.isFinite(n))
    )
  );

const fechaMs = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha.getTime() : null;
};

const citar = (identificador) =>
  `"${String(identificador).replace(/"/g, '""')}"`;

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const sequelize = queryInterface.sequelize;
    const SELECT = Sequelize.QueryTypes.SELECT;
    const transaction = await sequelize.transaction();

    const consultar = (sql, bind = []) =>
      sequelize.query(sql, { bind, type: SELECT, transaction });
    const ejecutar = (sql, bind = []) =>
      sequelize.query(sql, { bind, transaction });
    const existe = async (tabla) => {
      const filas = await consultar(
        `SELECT to_regclass('"' || $1 || '"') IS NOT NULL AS existe`,
        [tabla]
      );
      return Boolean(filas[0] && filas[0].existe);
    };
    const tieneColumna = async (tabla, columna) => {
      const filas = await consultar(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
         LIMIT 1`,
        [tabla, columna]
      );
      return filas.length > 0;
    };

    try {
      if (!(await existe('CuponEmisiones'))) {
        throw new Error(
          'No existe CuponEmisiones: no se puede consolidar el módulo de cupones.'
        );
      }

      // ---------------------------------------------------------------
      // 1. Columna que reemplaza a CuponPreviewTokens.
      // ---------------------------------------------------------------
      await ejecutar(
        `ALTER TABLE "CuponEmisiones"
         ADD COLUMN IF NOT EXISTS "previewTokenHash" VARCHAR(128)`
      );
      const constraintPreview = await consultar(
        'SELECT 1 FROM pg_constraint WHERE conname = $1',
        [CONSTRAINT_PREVIEW]
      );
      if (constraintPreview.length === 0) {
        await ejecutar(
          `ALTER TABLE "CuponEmisiones"
           ADD CONSTRAINT "${CONSTRAINT_PREVIEW}" UNIQUE ("previewTokenHash")`
        );
      }

      // ---------------------------------------------------------------
      // 2. Alcance: tablas auxiliares -> snapshots.
      // ---------------------------------------------------------------
      const alcances = new Map();
      const registrarAlcance = (emisionId, categoriaIds, productoIds) => {
        const id = Number(emisionId);
        if (!Number.isFinite(id)) return;
        const actual = alcances.get(id) || {
          categoriaIds: [],
          productoIds: [],
          productoIdsResueltos: [],
        };
        actual.categoriaIds = constNumeros([
          ...actual.categoriaIds,
          ...categoriaIds,
        ]);
        actual.productoIds = constNumeros([
          ...actual.productoIds,
          ...productoIds,
        ]);
        actual.productoIdsResueltos = constNumeros([
          ...actual.productoIdsResueltos,
          ...productoIds,
        ]);
        alcances.set(id, actual);
      };

      if (await existe('CuponEmisionCategorias')) {
        const filas = await consultar(
          'SELECT "emisionId", "categoriaId" FROM "CuponEmisionCategorias"'
        );
        filas.forEach((f) =>
          registrarAlcance(f.emisionId, [f.categoriaId], [])
        );
      }
      if (await existe('CuponEmisionProductos')) {
        const filas = await consultar(
          'SELECT "emisionId", "productoId" FROM "CuponEmisionProductos"'
        );
        filas.forEach((f) => registrarAlcance(f.emisionId, [], [f.productoId]));
      }

      const emisiones = await consultar(
        'SELECT id, "configuracionSnapshot", "createdAt" FROM "CuponEmisiones" ORDER BY id'
      );
      for (const emision of emisiones) {
        const id = Number(emision.id);
        const aux = alcances.get(id);
        if (!aux) continue;
        const snapshot = emision.configuracionSnapshot || {};
        const alcance = { ...(snapshot.alcance || {}) };
        alcance.categoriaIds = constNumeros([
          ...(alcance.categoriaIds || []),
          ...aux.categoriaIds,
        ]);
        alcance.productoIds = constNumeros([
          ...(alcance.productoIds || []),
          ...aux.productoIds,
        ]);
        alcance.productoIdsResueltos = constNumeros([
          ...(alcance.productoIdsResueltos || []),
          ...aux.productoIdsResueltos,
        ]);
        if (alcance.productoIds.length || alcance.categoriaIds.length) {
          delete alcance.global;
        }
        snapshot.alcance = alcance;
        await ejecutar(
          'UPDATE "CuponEmisiones" SET "configuracionSnapshot" = $2::jsonb WHERE id = $1',
          [id, JSON.stringify(snapshot)]
        );
        alcances.set(id, alcance);
      }

      if (await existe('Cupones')) {
        const cupones = await consultar(
          'SELECT id, "emisionId", "alcanceSnapshot" FROM "Cupones" WHERE "emisionId" IS NOT NULL'
        );
        for (const cupon of cupones) {
          const alcance = alcances.get(Number(cupon.emisionId));
          if (
            !alcance ||
            (!alcance.productoIds.length && !alcance.categoriaIds.length)
          ) {
            continue;
          }
          const snapshot = cupon.alcanceSnapshot || {};
          const actual = {
            categoriaIds: constNumeros(snapshot.categoriaIds),
            productoIds: constNumeros(snapshot.productoIds),
            productoIdsResueltos: constNumeros(snapshot.productoIdsResueltos),
          };
          const fusionado = {
            ...snapshot,
            global: false,
            categoriaIds: constNumeros([
              ...actual.categoriaIds,
              ...alcance.categoriaIds,
            ]),
            productoIds: constNumeros([
              ...actual.productoIds,
              ...alcance.productoIds,
            ]),
            productoIdsResueltos: constNumeros([
              ...actual.productoIdsResueltos,
              ...alcance.productoIdsResueltos,
            ]),
          };
          await ejecutar(
            'UPDATE "Cupones" SET "alcanceSnapshot" = $2::jsonb WHERE id = $1',
            [Number(cupon.id), JSON.stringify(fusionado)]
          );
        }
      }

      // ---------------------------------------------------------------
      // 3. Ids legacy de campaña/ejecución -> snapshot del cupón.
      // ---------------------------------------------------------------
      if (
        (await existe('Cupones')) &&
        ((await tieneColumna('Cupones', 'campanaId')) ||
          (await tieneColumna('Cupones', 'ejecucionId')))
      ) {
        const cupones = await consultar(
          'SELECT id, "campanaId", "ejecucionId", "alcanceSnapshot" FROM "Cupones"'
        );
        for (const cupon of cupones) {
          const campanaId = cupon.campanaId;
          const ejecucionId = cupon.ejecucionId;
          if (campanaId === null && ejecucionId === null) continue;
          const snapshot = { ...(cupon.alcanceSnapshot || {}) };
          snapshot.origenLegacy = {
            ...(snapshot.origenLegacy || {}),
            ...(campanaId !== null ? { campanaId: Number(campanaId) } : {}),
            ...(ejecucionId !== null
              ? { ejecucionId: Number(ejecucionId) }
              : {}),
          };
          await ejecutar(
            'UPDATE "Cupones" SET "alcanceSnapshot" = $2::jsonb WHERE id = $1',
            [Number(cupon.id), JSON.stringify(snapshot)]
          );
        }

        // Quitar primero las FKs (en test hay nombres duplicados) y luego las
        // columnas. La búsqueda por definición cubre ambos nombres.
        if (await existe('Cupones')) {
          const fks = await consultar(`
            SELECT conname FROM pg_constraint
            WHERE conrelid = '"Cupones"'::regclass
              AND contype = 'f'
              AND (
                pg_get_constraintdef(oid) LIKE '%"Campanas"%'
                OR pg_get_constraintdef(oid) LIKE '%"CampanaEjecuciones"%'
              )
          `);
          for (const fk of fks) {
            await ejecutar(
              `ALTER TABLE "Cupones" DROP CONSTRAINT IF EXISTS ${citar(
                fk.conname
              )}`
            );
          }
        }
        if (await tieneColumna('Cupones', 'campanaId')) {
          await ejecutar(
            'ALTER TABLE "Cupones" DROP COLUMN IF EXISTS "campanaId"'
          );
        }
        if (await tieneColumna('Cupones', 'ejecucionId')) {
          await ejecutar(
            'ALTER TABLE "Cupones" DROP COLUMN IF EXISTS "ejecucionId"'
          );
        }
      }

      // ---------------------------------------------------------------
      // 4. Tokens de preview: CuponPreviewTokens -> CuponEmisiones.
      // ---------------------------------------------------------------
      if (await existe('CuponPreviewTokens')) {
        const tokens = await consultar(`
          SELECT * FROM "CuponPreviewTokens"
          ORDER BY COALESCE("usadoEn", "creadoEn") NULLS LAST, id
        `);
        const emisionesParaToken = await consultar(`
          SELECT id, "configuracionSnapshot", "createdAt"
          FROM "CuponEmisiones"
          WHERE "previewTokenHash" IS NULL
          ORDER BY id
        `);
        const candidatas = emisionesParaToken
          .map((e) => {
            const snapshot = e.configuracionSnapshot || {};
            return {
              id: Number(e.id),
              snapshot,
              fecha:
                fechaMs(snapshot.creadoEn) ||
                fechaMs(e.createdAt) ||
                Number.MAX_SAFE_INTEGER,
            };
          })
          .sort((a, b) => a.fecha - b.fecha);
        const usadas = new Set();

        for (const token of tokens) {
          const hash = String(token.tokenHash || '').trim();
          if (!hash) continue;
          const fechaToken =
            fechaMs(token.usadoEn) ||
            fechaMs(token.creadoEn) ||
            fechaMs(token.expiraEn);
          let mejor = null;
          let menorDiferencia = Infinity;
          for (const candidata of candidatas) {
            if (usadas.has(candidata.id)) continue;
            const diferencia = Math.abs(candidata.fecha - fechaToken);
            if (diferencia < menorDiferencia) {
              mejor = candidata;
              menorDiferencia = diferencia;
            }
          }
          // Los tokens históricos se crearon al emitir: si no hay una emisión
          // con fecha cercana, se conserva el hash en la emisión libre más
          // próxima antes de perder la tabla de origen.
          if (!mejor || menorDiferencia > 60 * 60 * 1000) {
            mejor = candidatas.find((c) => !usadas.has(c.id)) || null;
          }
          if (!mejor) continue;
          usadas.add(mejor.id);

          const snapshot = { ...(mejor.snapshot || {}) };
          if (!snapshot.previewToken) {
            snapshot.previewToken = {
              tokenHash: hash,
              usado: Boolean(token.usado),
              creadoEn: token.creadoEn || null,
              expiraEn: token.expiraEn || null,
              usadoEn: token.usadoEn || null,
              migradoDesde: 'CuponPreviewTokens',
              migradoEn: new Date().toISOString(),
            };
          }
          await ejecutar(
            `UPDATE "CuponEmisiones"
             SET "previewTokenHash" = $2, "configuracionSnapshot" = $3::jsonb
             WHERE id = $1 AND "previewTokenHash" IS NULL`,
            [mejor.id, hash, JSON.stringify(snapshot)]
          );
        }
      }

      // ---------------------------------------------------------------
      // 5. Verificación de dependencias y borrado de auxiliares.
      // ---------------------------------------------------------------
      for (const tabla of AUXILIARES) {
        if (!(await existe(tabla))) continue;
        const externas = await consultar(
          `SELECT conrelid::regclass::text AS tabla, conname
           FROM pg_constraint
           WHERE confrelid = ('"' || $1 || '"')::regclass AND contype = 'f'`,
          [tabla]
        );
        const nombreLimpio = (valor) =>
          String(valor).replace(/"/g, '').split('.').pop();
        const ajenas = externas.filter(
          (f) =>
            !AUXILIARES.includes(nombreLimpio(f.tabla)) &&
            !TABLAS_PERMITIDAS.includes(nombreLimpio(f.tabla))
        );
        if (ajenas.length > 0) {
          throw new Error(
            `No se puede eliminar ${tabla}: hay foreign keys desde otras tablas: ` +
              ajenas.map((f) => `${f.tabla}.${f.conname}`).join(', ')
          );
        }
      }
      for (const tabla of AUXILIARES) {
        await ejecutar(`DROP TABLE IF EXISTS "${tabla}" CASCADE`);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const sequelize = queryInterface.sequelize;
    const SELECT = Sequelize.QueryTypes.SELECT;
    const transaction = await sequelize.transaction();
    const consultar = (sql, bind = []) =>
      sequelize.query(sql, { bind, type: SELECT, transaction });
    const ejecutar = (sql, bind = []) =>
      sequelize.query(sql, { bind, transaction });

    try {
      await ejecutar(`
        CREATE TABLE IF NOT EXISTS "CuponEmisionCategorias" (
          id SERIAL PRIMARY KEY,
          "emisionId" INTEGER NOT NULL REFERENCES "CuponEmisiones"(id) ON DELETE CASCADE,
          "categoriaId" INTEGER NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);
      await ejecutar(`
        CREATE TABLE IF NOT EXISTS "CuponEmisionProductos" (
          id SERIAL PRIMARY KEY,
          "emisionId" INTEGER NOT NULL REFERENCES "CuponEmisiones"(id) ON DELETE CASCADE,
          "productoId" INTEGER NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);
      await ejecutar(`
        CREATE TABLE IF NOT EXISTS "CuponPreviewTokens" (
          id SERIAL PRIMARY KEY,
          "tokenHash" VARCHAR(128) NOT NULL,
          usado BOOLEAN NOT NULL DEFAULT false,
          "expiraEn" TIMESTAMP WITH TIME ZONE NOT NULL,
          "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL,
          "usadoEn" TIMESTAMP WITH TIME ZONE
        )
      `);
      const constraintTokens = await consultar(
        'SELECT 1 FROM pg_constraint WHERE conname = $1',
        ['cupon_preview_tokens_token_hash_unique']
      );
      if (constraintTokens.length === 0) {
        await ejecutar(
          `ALTER TABLE "CuponPreviewTokens"
           ADD CONSTRAINT "cupon_preview_tokens_token_hash_unique" UNIQUE ("tokenHash")`
        );
      }
      await ejecutar(`
        CREATE TABLE IF NOT EXISTS "Campanas" (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(160) NOT NULL,
          descripcion TEXT,
          "tipoDescuento" VARCHAR(30) NOT NULL DEFAULT 'PORCENTAJE',
          "valorDescuento" NUMERIC(10,2) NOT NULL DEFAULT 0,
          "compraMinima" NUMERIC(10,2) NOT NULL DEFAULT 0,
          "descuentoMaximo" NUMERIC(10,2),
          "fechaInicio" TIMESTAMP WITH TIME ZONE NOT NULL,
          "fechaFin" TIMESTAMP WITH TIME ZONE NOT NULL,
          "usosPorCupon" INTEGER NOT NULL DEFAULT 1,
          activa BOOLEAN NOT NULL DEFAULT true,
          "criterioComprasMinimas" INTEGER,
          "criterioPeriodoDias" INTEGER,
          "criterioMontoAcumulado" NUMERIC(12,2),
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);
      await ejecutar(`
        CREATE TABLE IF NOT EXISTS "CampanaEjecuciones" (
          id SERIAL PRIMARY KEY,
          "campanaId" INTEGER NOT NULL REFERENCES "Campanas"(id) ON DELETE CASCADE,
          "ejecutadaPorUsuarioId" INTEGER NOT NULL,
          "fechaEjecucion" TIMESTAMP WITH TIME ZONE NOT NULL,
          "configuracionSnapshot" JSONB,
          "cantidadElegibles" INTEGER NOT NULL DEFAULT 0,
          "cantidadCupones" INTEGER NOT NULL DEFAULT 0,
          "cantidadEnviados" INTEGER NOT NULL DEFAULT 0,
          "cantidadFallidos" INTEGER NOT NULL DEFAULT 0,
          estado VARCHAR(30) NOT NULL DEFAULT 'COMPLETADA',
          "bloqueoToken" VARCHAR(64),
          "bloqueoExpiraEn" TIMESTAMP WITH TIME ZONE,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);

      const emisiones = await consultar(
        `SELECT id, "configuracionSnapshot" FROM "CuponEmisiones"`
      );
      for (const emision of emisiones) {
        const snapshot = emision.configuracionSnapshot || {};
        const alcance = snapshot.alcance || {};
        const idsCategoria = constNumeros(alcance.categoriaIds);
        const idsProducto = constNumeros(alcance.productoIdsResueltos);
        for (const categoriaId of idsCategoria) {
          await ejecutar(
            `INSERT INTO "CuponEmisionCategorias"
               ("emisionId", "categoriaId", "createdAt", "updatedAt")
             VALUES ($1, $2, NOW(), NOW())`,
            [Number(emision.id), categoriaId]
          );
        }
        for (const productoId of idsProducto) {
          await ejecutar(
            `INSERT INTO "CuponEmisionProductos"
               ("emisionId", "productoId", "createdAt", "updatedAt")
             VALUES ($1, $2, NOW(), NOW())`,
            [Number(emision.id), productoId]
          );
        }
        const token = snapshot.previewToken;
        if (token && token.tokenHash) {
          await ejecutar(
            `INSERT INTO "CuponPreviewTokens"
               ("tokenHash", usado, "expiraEn", "creadoEn", "usadoEn")
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ("tokenHash") DO NOTHING`,
            [
              String(token.tokenHash),
              Boolean(token.usado),
              token.expiraEn || new Date(),
              token.creadoEn || new Date(),
              token.usadoEn || null,
            ]
          );
        }
      }

      await ejecutar(
        'ALTER TABLE "Cupones" ADD COLUMN IF NOT EXISTS "campanaId" INTEGER'
      );
      await ejecutar(
        'ALTER TABLE "Cupones" ADD COLUMN IF NOT EXISTS "ejecucionId" INTEGER'
      );
      await ejecutar(`
        UPDATE "Cupones"
        SET "campanaId" = ("alcanceSnapshot"->'origenLegacy'->>'campanaId')::int,
            "ejecucionId" = ("alcanceSnapshot"->'origenLegacy'->>'ejecucionId')::int
        WHERE jsonb_exists("alcanceSnapshot", 'origenLegacy')
      `);

      const constraintPreview = await consultar(
        'SELECT 1 FROM pg_constraint WHERE conname = $1',
        [CONSTRAINT_PREVIEW]
      );
      if (constraintPreview.length > 0) {
        await ejecutar(
          `ALTER TABLE "CuponEmisiones" DROP CONSTRAINT "${CONSTRAINT_PREVIEW}"`
        );
      }
      await ejecutar(
        'ALTER TABLE "CuponEmisiones" DROP COLUMN IF EXISTS "previewTokenHash"'
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
