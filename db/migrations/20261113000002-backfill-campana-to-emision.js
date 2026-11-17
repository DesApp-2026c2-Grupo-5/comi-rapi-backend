'use strict';

// Migracion 2 de 3: backfill de Campanas/CampanaEjecuciones a CuponEmisiones.
//
// - Para cada CampanaEjecucion crea una CuponEmisiones con la configuracion
//   congelada.
// - Para cada Campana sin ejecuciones crea una CuponEmisiones vacia
//   (auditoria de la configuracion sin cupones emitidos).
// - Vincula cada Cupon existente a su CuponEmisiones via emisionId:
//   * Si el cupon tiene ejecucionId -> vincula a la emision de esa ejecucion.
//   * Si el cupon solo tiene campanaId y la campaña tuvo varias ejecuciones,
//     deja emisionId = NULL (nunca asignar una ejecucion arbitrariamente).
//   * Si el cupon solo tiene campanaId y la campaña tuvo una sola ejecucion,
//     vincula a esa unica ejecucion.
//
// Todo se ejecuta dentro de una transacion y es idempotente: si se reejecuta
// despues de una interrupcion, no duplica emisiones ni altera vinculos correctos.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { Op } = Sequelize;
    const sequelize = queryInterface.sequelize;

    // Verificar que las tablas de origen existen.
    const tablas = await sequelize.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = CURRENT_SCHEMA()
         AND table_name IN ('Campanas','CampanaEjecuciones','Cupones')`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const nombresTablas = new Set(tablas.map((t) => t.table_name));
    if (!nombresTablas.has('Campanas') && !nombresTablas.has('Cupones')) {
      // No hay datos legacy que migrar: salir temprano.
      return;
    }

    const ahora = new Date();

    // ---------------------------------------------------------------
    // Todo el backfill corre en una transaccion para garantizar
    // atomicidad ante interrupciones.
    // ---------------------------------------------------------------
    const transaction = await sequelize.transaction();
    try {
      // ---------------------------------------------------------------
      // 1. Mapear campanas id -> configuracion para uso en backfill.
      // ---------------------------------------------------------------
      let campanas = [];
      if (nombresTablas.has('Campanas')) {
        campanas = await sequelize.query(
          `SELECT id, nombre, descripcion, tipo_descuento AS "tipoDescuento",
                  valor_descuento AS "valorDescuento", compra_minima AS "compraMinima",
                  descuento_maximo AS "descuentoMaximo", fecha_inicio AS "fechaInicio",
                  fecha_fin AS "fechaFin", usos_por_cupon AS "usosPorCupon",
                  activa, criterio_periodo_dias AS "criterioPeriodoDias"
           FROM "Campanas"`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );
      }
      const campanaPorId = new Map();
      for (const c of campanas) {
        campanaPorId.set(Number(c.id), c);
      }

      // ---------------------------------------------------------------
      // 2. Contar ejecuciones por campaña (para detectar campañas con
      //    múltiples ejecuciones y no asignar arbitrariamente).
      // ---------------------------------------------------------------
      const ejecucionesPorCampana = new Map();
      if (nombresTablas.has('CampanaEjecuciones')) {
        const conteos = await sequelize.query(
          `SELECT campana_id AS "campanaId", count(*) AS "cantidad"
           FROM "CampanaEjecuciones"
           GROUP BY campana_id`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );
        for (const c of conteos) {
          ejecucionesPorCampana.set(Number(c.campanaId), Number(c.cantidad));
        }
      }

      // ---------------------------------------------------------------
      // 3. Crear CuponEmisiones por cada CampanaEjecucion (idempotente).
      // ---------------------------------------------------------------
      const emisionPorEjecucion = new Map();
      if (nombresTablas.has('CampanaEjecuciones')) {
        const ejecuciones = await sequelize.query(
          `SELECT id, campana_id AS "campanaId", ejecutada_por_usuario_id AS "ejecutadaPorUsuarioId",
                  fecha_ejecucion AS "fechaEjecucion", configuracion_snapshot AS "configuracionSnapshot",
                  cantidad_elegibles AS "cantidadElegibles", cantidad_cupones AS "cantidadCupones",
                  cantidad_enviados AS "cantidadEnviados", cantidad_fallidos AS "cantidadFallidos",
                  estado, bloqueo_token AS "bloqueoToken", bloqueo_expira_en AS "bloqueoExpiraEn",
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM "CampanaEjecuciones"`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );

        for (const ej of ejecuciones) {
          const campana = campanaPorId.get(Number(ej.campanaId)) || {};
          const snapshotOrig = ej.configuracionSnapshot || {};

          const alcance = { global: true };
          if (
            snapshotOrig &&
            snapshotOrig.alcance &&
            snapshotOrig.alcance.productoIdsResueltos
          ) {
            alcance.productoIdsResueltos =
              snapshotOrig.alcance.productoIdsResueltos;
          }

          const configuracionSnapshot = {
            nombre: campana.nombre || '',
            descripcion: campana.descripcion || null,
            descuento: {
              tipo: campana.tipoDescuento || 'PORCENTAJE',
              valor: Number(campana.valorDescuento) || 0,
              maximo:
                campana.descuentoMaximo === null ||
                campana.descuentoMaximo === undefined
                  ? null
                  : Number(campana.descuentoMaximo),
              compraMinima: Number(campana.compraMinima) || 0,
            },
            fechaInicio: campana.fechaInicio,
            fechaFin: campana.fechaFin,
            usosPermitidos: Number(campana.usosPorCupon) || 1,
            alcance,
            seleccion: {
              periodoAnalisisDias:
                campana.criterioPeriodoDias !== null &&
                campana.criterioPeriodoDias !== undefined
                  ? Number(campana.criterioPeriodoDias)
                  : null,
              estadoPedido: 'ENTREGADO',
              criterio: 'unidades de productos alcanzados, descendente',
            },
            origen: { tipo: 'campana', campanaId: Number(ej.campanaId) },
            ejecutadoEn: ej.fechaEjecucion,
          };
          if (snapshotOrig && snapshotOrig.destinatariosIds) {
            configuracionSnapshot.destinatariosIds =
              snapshotOrig.destinatariosIds;
          }

          // Idempotencia: verificar si ya existe una emision para esta ejecucion.
          // Se busca por el origen en configuracionSnapshot para evitar duplicar
          // si la migracion se reejecuta tras una interrupcion parcial.
          const existente = await sequelize.query(
            `SELECT id FROM "CuponEmisiones"
             WHERE "configuracionSnapshot"->'origen'->>'tipo' = 'campana'
               AND "configuracionSnapshot"->'origen'->>'campanaId' = :campanaId
               AND "configuracionSnapshot"->'ejecutadoEn' = :ejecutadoEn
             LIMIT 1`,
            {
              replacements: {
                campanaId: String(Number(ej.campanaId)),
                ejecutadoEn: ej.fechaEjecucion,
              },
              type: sequelize.QueryTypes.SELECT,
              transaction,
            }
          );

          let emisionId;
          if (existente.length > 0) {
            emisionId = Number(existente[0].id);
          } else {
            const [resultado] = await sequelize.query(
              `INSERT INTO "CuponEmisiones" (
                "creadaPorUsuarioId", nombre, descripcion, "tipoDescuento",
                "valorDescuento", "compraMinima", "descuentoMaximo",
                "fechaInicio", "fechaFin", "maxDestinatarios",
                "periodoAnalisisDias", "cantidadElegibles", "cantidadCupones",
                "cantidadEnviados", "cantidadFallidos", estado,
                "configuracionSnapshot", "bloqueoToken", "bloqueoExpiraEn",
                "createdAt", "updatedAt"
              ) VALUES (
                :creadaPorUsuarioId, :nombre, :descripcion, :tipoDescuento,
                :valorDescuento, :compraMinima, :descuentoMaximo,
                :fechaInicio, :fechaFin, NULL,
                :periodoAnalisisDias, :cantidadElegibles, :cantidadCupones,
                :cantidadEnviados, :cantidadFallidos, :estado,
                :configuracionSnapshot, :bloqueoToken, :bloqueoExpiraEn,
                :createdAt, :updatedAt
              ) RETURNING id`,
              {
                replacements: {
                  creadaPorUsuarioId: Number(ej.ejecutadaPorUsuarioId),
                  nombre: campana.nombre || `Emision migrada ${ej.campanaId}`,
                  descripcion: campana.descripcion || null,
                  tipoDescuento: campana.tipoDescuento || 'PORCENTAJE',
                  valorDescuento: Number(campana.valorDescuento) || 0,
                  compraMinima: Number(campana.compraMinima) || 0,
                  descuentoMaximo:
                    campana.descuentoMaximo === null ||
                    campana.descuentoMaximo === undefined
                      ? null
                      : Number(campana.descuentoMaximo),
                  fechaInicio: campana.fechaInicio || ahora,
                  fechaFin: campana.fechaFin || ahora,
                  periodoAnalisisDias:
                    campana.criterioPeriodoDias !== null &&
                    campana.criterioPeriodoDias !== undefined
                      ? Number(campana.criterioPeriodoDias)
                      : null,
                  cantidadElegibles: Number(ej.cantidadElegibles) || 0,
                  cantidadCupones: Number(ej.cantidadCupones) || 0,
                  cantidadEnviados: Number(ej.cantidadEnviados) || 0,
                  cantidadFallidos: Number(ej.cantidadFallidos) || 0,
                  estado: ej.estado || 'COMPLETADA',
                  configuracionSnapshot: JSON.stringify(configuracionSnapshot),
                  bloqueoToken: ej.bloqueoToken || null,
                  bloqueoExpiraEn: ej.bloqueoExpiraEn || null,
                  createdAt: ej.createdAt || ahora,
                  updatedAt: ej.updatedAt || ahora,
                },
                type: sequelize.QueryTypes.INSERT,
                transaction,
              }
            );
            emisionId = Number(resultado[0].id);
          }
          emisionPorEjecucion.set(Number(ej.id), emisionId);
        }
      }

      // ---------------------------------------------------------------
      // 4. Campañas sin ejecuciones: crear CuponEmisiones vacia (idempotente).
      // ---------------------------------------------------------------
      const ejecucionCampanaIds = new Set();
      if (nombresTablas.has('CampanaEjecuciones')) {
        const ejecuciones = await sequelize.query(
          `SELECT id, campana_id AS "campanaId" FROM "CampanaEjecuciones"`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );
        for (const ej of ejecuciones) {
          ejecucionCampanaIds.add(Number(ej.campanaId));
        }
      }

      for (const [campanaId, campana] of campanaPorId) {
        if (ejecucionCampanaIds.has(campanaId)) continue;

        const configuracionSnapshot = {
          nombre: campana.nombre || '',
          descripcion: campana.descripcion || null,
          descuento: {
            tipo: campana.tipoDescuento || 'PORCENTAJE',
            valor: Number(campana.valorDescuento) || 0,
            maximo:
              campana.descuentoMaximo === null ||
              campana.descuentoMaximo === undefined
                ? null
                : Number(campana.descuentoMaximo),
            compraMinima: Number(campana.compraMinima) || 0,
          },
          fechaInicio: campana.fechaInicio,
          fechaFin: campana.fechaFin,
          usosPermitidos: Number(campana.usosPorCupon) || 1,
          alcance: { global: true },
          seleccion: {
            periodoAnalisisDias:
              campana.criterioPeriodoDias !== null &&
              campana.criterioPeriodoDias !== undefined
                ? Number(campana.criterioPeriodoDias)
                : null,
            estadoPedido: 'ENTREGADO',
            criterio: 'unidades de productos alcanzados, descendente',
          },
          origen: { tipo: 'campana_sin_ejecucion', campanaId },
          ejecutadoEn: null,
        };

        // Idempotencia: verificar si ya existe una emision vacia para esta campaña.
        const existente = await sequelize.query(
          `SELECT id FROM "CuponEmisiones"
           WHERE "configuracionSnapshot"->'origen'->>'tipo' = 'campana_sin_ejecucion'
             AND "configuracionSnapshot"->'origen'->>'campanaId' = :campanaId
             AND "configuracionSnapshot"->>'ejecutadoEn' IS NULL
           LIMIT 1`,
          {
            replacements: { campanaId: String(campanaId) },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          }
        );

        if (existente.length > 0) continue;

        await sequelize.query(
          `INSERT INTO "CuponEmisiones" (
            "creadaPorUsuarioId", nombre, descripcion, "tipoDescuento",
            "valorDescuento", "compraMinima", "descuentoMaximo",
            "fechaInicio", "fechaFin", "maxDestinatarios",
            "periodoAnalisisDias", "cantidadElegibles", "cantidadCupones",
            "cantidadEnviados", "cantidadFallidos", estado,
            "configuracionSnapshot", "createdAt", "updatedAt"
          ) VALUES (
            1, :nombre, :descripcion, :tipoDescuento,
            :valorDescuento, :compraMinima, :descuentoMaximo,
            :fechaInicio, :fechaFin, NULL,
            :periodoAnalisisDias, 0, 0, 0, 0, 'COMPLETADA',
            :configuracionSnapshot, :ahora, :ahora
          )`,
          {
            replacements: {
              nombre: campana.nombre || `Emision migrada ${campanaId}`,
              descripcion: campana.descripcion || null,
              tipoDescuento: campana.tipoDescuento || 'PORCENTAJE',
              valorDescuento: Number(campana.valorDescuento) || 0,
              compraMinima: Number(campana.compraMinima) || 0,
              descuentoMaximo:
                campana.descuentoMaximo === null ||
                campana.descuentoMaximo === undefined
                  ? null
                  : Number(campana.descuentoMaximo),
              fechaInicio: campana.fechaInicio || ahora,
              fechaFin: campana.fechaFin || ahora,
              periodoAnalisisDias:
                campana.criterioPeriodoDias !== null &&
                campana.criterioPeriodoDias !== undefined
                  ? Number(campana.criterioPeriodoDias)
                  : null,
              configuracionSnapshot: JSON.stringify(configuracionSnapshot),
              ahora,
            },
            type: sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
      }

      // ---------------------------------------------------------------
      // 5. Vincular cada Cupon a su CuponEmisiones via emisionId.
      //    - Con ejecucionId -> emision exacta de esa ejecucion.
      //    - Solo campanaId y una sola ejecucion -> esa unica ejecucion.
      //    - Solo campanaId y varias ejecuciones -> emisionId = NULL
      //      (nunca asignar arbitrariamente; conservar trazabilidad original).
      // ---------------------------------------------------------------
      if (nombresTablas.has('Cupones')) {
        // Construir mapa campanaId -> emisionId unica (solo si hay una ejecucion).
        const campanaPorEmisionUnica = new Map();
        if (nombresTablas.has('CampanaEjecuciones')) {
          const ejecuciones = await sequelize.query(
            `SELECT id, campana_id AS "campanaId" FROM "CampanaEjecuciones"`,
            { type: sequelize.QueryTypes.SELECT, transaction }
          );
          for (const ej of ejecuciones) {
            const emisionId = emisionPorEjecucion.get(Number(ej.id));
            const campanaId = Number(ej.campanaId);
            const ejecsCampana = ejecucionesPorCampana.get(campanaId) || 0;
            // Solo mapear si la campaña tiene exactamente una ejecucion.
            if (emisionId && ejecsCampana === 1) {
              campanaPorEmisionUnica.set(campanaId, emisionId);
            }
          }
        }

        const cupones = await sequelize.query(
          `SELECT id, campana_id AS "campanaId", ejecucion_id AS "ejecucionId" FROM "Cupones"`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );

        for (const cupon of cupones) {
          let emisionId = null;
          if (cupon.ejecucionId) {
            emisionId = emisionPorEjecucion.get(Number(cupon.ejecucionId));
          } else if (cupon.campanaId) {
            // Solo campanaId: vincular solo si la campaña tiene una sola ejecucion.
            emisionId =
              campanaPorEmisionUnica.get(Number(cupon.campanaId)) || null;
          }
          // Si no hay emisionId, dejar NULL (trazabilidad original conservada).

          if (emisionId !== null) {
            await sequelize.query(
              `UPDATE "Cupones" SET "emisionId" = :emisionId WHERE id = :id`,
              {
                replacements: { emisionId, id: Number(cupon.id) },
                type: sequelize.QueryTypes.UPDATE,
                transaction,
              }
            );
          }
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    // No hay down razonable para una migracion de datos sin perder historial.
    // Se deja vacio: se revierte restaurando un backup.
  },
};
