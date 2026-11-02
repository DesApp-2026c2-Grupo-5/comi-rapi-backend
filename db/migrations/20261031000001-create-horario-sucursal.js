'use strict';

/**
 * Horarios de atención por sucursal, estructurados por día y franja.
 *
 * Hasta ahora `Sucursales.horarios` era un STRING libre ("Lun-Dom 10:00-23:00")
 * que no se podía evaluar: el backend no sabía si una sucursal estaba abierta.
 * Se reemplaza por una entidad propia, en línea con la revisión que el propio
 * `docs/modelo-dominio.md` habilitaba ("la decisión podrá revisarse si se
 * requiere gestionar horarios de forma estructurada"):
 *
 *  - `HorarioSucursales`: una fila por franja de atención.
 *    `diaSemana` 1 = lunes … 7 = domingo (ISO-8601).
 *    `apertura` y `cierre` son TIME del horario REAL del local (23:00), no del
 *    corte de pedidos: el margen operativo (30 min por defecto) es un parámetro
 *    global y se resta al evaluar (`margenCierreMinutos`).
 *    `cierre <= apertura` significa que la franja cruza la medianoche
 *    (19:00–02:00): pertenece al día de apertura.
 *
 * Sin filas = sucursal cerrada.
 *
 * La migración hace BACKFILL del texto viejo antes de borrar la columna, para
 * no dejar ninguna sucursal existente sin horario (quedaría cerrada siempre):
 * "Lun-Dom 10:00-23:00" / "11:00-00:00" se expanden a los 7 días. Un texto
 * nulo o no reconocible cae al horario por defecto 10:00–23:00 los 7 días.
 */

const HORARIO_POR_DEFECTO = { apertura: '10:00:00', cierre: '23:00:00' };

/**
 * Extrae la primera franja "HH:MM-HH:MM" de un texto libre. Devuelve null si no
 * la encuentra (el llamador usa el horario por defecto).
 */
function parsearHorarioLegacy(texto) {
  const match = String(texto || '').match(
    /(\d{1,2}):(\d{2})\s*[-–a]\s*(\d{1,2}):(\d{2})/i
  );
  if (!match) return null;
  const [, hA, mA, hC, mC] = match;
  const apertura = `${String(Number(hA)).padStart(2, '0')}:${mA}:00`;
  const cierre = `${String(Number(hC)).padStart(2, '0')}:${mC}:00`;
  return { apertura, cierre };
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('HorarioSucursales', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      sucursalId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Sucursales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // 1 = lunes … 7 = domingo (ISO-8601: el mismo criterio que
      // `Intl.DateTimeFormat` con locale en-US en `horarios_service`).
      diaSemana: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      apertura: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      cierre: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('HorarioSucursales', ['sucursalId'], {
      name: 'horarios_sucursal_id',
    });

    // Una sucursal no puede repetir la misma franja el mismo día. Se permiten
    // solapamientos: "abierta" es caer en cualquiera de las franjas.
    await queryInterface.addIndex(
      'HorarioSucursales',
      ['sucursalId', 'diaSemana', 'apertura', 'cierre'],
      { unique: true, name: 'horarios_sucursal_franja_unique' }
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "HorarioSucursales" ADD CONSTRAINT "CK_HorarioSucursales_dia" CHECK ("diaSemana" BETWEEN 1 AND 7)`
    );

    // BACKFILL: el texto viejo se expande a los siete días antes de borrar la
    // columna. Sin esto, toda sucursal existente quedaría cerrada siempre.
    const [sucursales] = await queryInterface.sequelize.query(
      'SELECT id, horarios FROM "Sucursales"'
    );
    const ahora = new Date();
    const filas = [];
    for (const sucursal of sucursales) {
      const franja =
        parsearHorarioLegacy(sucursal.horarios) || HORARIO_POR_DEFECTO;
      for (let diaSemana = 1; diaSemana <= 7; diaSemana += 1) {
        filas.push({
          sucursalId: sucursal.id,
          diaSemana,
          apertura: franja.apertura,
          cierre: franja.cierre,
          createdAt: ahora,
          updatedAt: ahora,
        });
      }
    }
    if (filas.length > 0) {
      await queryInterface.bulkInsert('HorarioSucursales', filas);
    }

    // La fuente de verdad pasa a ser la tabla: se elimina el texto libre para
    // no tener dos lugares que digan cosas distintas.
    await queryInterface.removeColumn('Sucursales', 'horarios');
  },

  down: async (queryInterface, Sequelize) => {
    // Se vuelve al atributo de texto del DER original con un resumen legible.
    await queryInterface.addColumn('Sucursales', 'horarios', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE "Sucursales" s SET horarios = 'Lun-Dom 10:00-23:00'`
    );
    await queryInterface.dropTable('HorarioSucursales');
  },
};
