'use strict';

// Limpieza del esquema v2 (etapas 0-7) del módulo de cupones/emisiones.
//
// Las migraciones 20261122000001..09 crearon tablas y columnas de segmentación,
// versiones, plantillas, snapshots de reglas, métricas auxiliares, auditorías
// técnicas y un campo `formato` en los tokens de preview. El código de esas
// etapas fue retirado: ningún modelo, servicio, controlador ni consulta activa
// las referencia. Sólo quedaban en la base de test, todas vacías; la única
// emisión histórica tiene los valores por defecto (schemaVersion=1, FKs null,
// contadores 0) y su `configuracionSnapshot` no contiene datos v2.
//
// Antes de ejecutar esta migración se generó un respaldo JSON con el esquema
// afectado, las filas de esas tablas y los valores de esas columnas:
//   C:/Users/ferna/AppData/Local/Temp/opencode/respaldo-esquema-v2-*.json
//
// Esta migración NO es la consolidación final: sólo retira las estructuras de
// segmentación v2. Las auxiliares anteriores (CuponEmisionCategorias,
// CuponEmisionProductos y CuponPreviewTokens) se conservan acá porque todavía
// podían contener datos historicos. La migración 20261123000001 las migra a las
// tres tablas permitidas y las elimina definitivamente.
//
// `up` es idempotente (IF EXISTS) para poder ejecutarse tanto en la base de
// test (donde las migraciones v2 están aplicadas) como en desarrollo (donde no
// lo están). `down` reconstruye la estructura v2, pero no los datos (eran
// vacíos/default).

const TABLAS_V2 = [
  'EmisionExclusiones',
  'EmisionDestinatarios',
  'PlantillasSegmento',
  'SegmentoVersiones',
  'Segmentos',
  'MetricasClientes',
];

const COLUMNAS_EMISION_V2 = [
  'schemaVersion',
  'segmentoVersionId',
  'plantillaId',
  'reglasSnapshot',
  'reglasHash',
  'evaluadoEn',
  'cantidadExcluidos',
  'cantidadRecortados',
  'origenSegmentacion',
];

module.exports = {
  up: async (queryInterface) => {
    const sql = (texto) => queryInterface.sequelize.query(texto);

    for (const columna of COLUMNAS_EMISION_V2) {
      await sql(
        `ALTER TABLE "CuponEmisiones" DROP COLUMN IF EXISTS "${columna}"`
      );
    }
    await sql(
      `ALTER TABLE "CuponPreviewTokens" DROP COLUMN IF EXISTS "formato"`
    );

    // Las FKs de CuponEmisiones ya se fueron con las columnas; el resto de las
    // relaciones viven dentro de estas tablas y desaparecen con ellas.
    for (const tabla of TABLAS_V2) {
      await sql(`DROP TABLE IF EXISTS "${tabla}"`);
    }

    // El trigger se elimina junto a SegmentoVersiones; la función queda suelta.
    await sql('DROP FUNCTION IF EXISTS "segmento_versiones_inmutables"()');
    await sql('DROP TYPE IF EXISTS "enum_EmisionDestinatarios_estado"');
    await sql('DROP TYPE IF EXISTS "enum_Segmentos_estado"');
  },

  down: async (queryInterface, Sequelize) => {
    const sql = (texto) => queryInterface.sequelize.query(texto);

    // --- 20261122000002: MetricasClientes ---------------------------------
    await queryInterface.createTable('MetricasClientes', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      fechaCalculo: { type: Sequelize.DATE, allowNull: false },
      ventanaDias: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 90,
      },
      gastoTotal: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      gasto30d: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      gasto90d: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      pedidosTotales: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      pedidosEntregados: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      unidadesCompradas: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      ticketPromedio: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      recenciaDias: { type: Sequelize.INTEGER, allowNull: true },
      frecuenciaMensual: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      ultimaCompraEn: { type: Sequelize.DATE, allowNull: true },
      hashFuentes: { type: Sequelize.STRING(64), allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('MetricasClientes', {
      fields: ['usuarioId'],
      type: 'unique',
      name: 'metricas_clientes_usuario_unique',
    });
    await queryInterface.addIndex('MetricasClientes', ['fechaCalculo'], {
      name: 'metricas_clientes_fecha_calculo_idx',
    });

    // --- 20261122000003: Segmentos ----------------------------------------
    await queryInterface.createTable('Segmentos', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      nombre: { type: Sequelize.STRING(120), allowNull: false },
      descripcion: { type: Sequelize.TEXT, allowNull: true },
      estado: {
        type: Sequelize.ENUM('ACTIVO', 'INACTIVO', 'ARCHIVADO'),
        allowNull: false,
        defaultValue: 'ACTIVO',
      },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      versionActual: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      creadoPorUsuarioId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await sql(`ALTER TABLE "Segmentos" ADD CONSTRAINT "segmentos_estado_valido"
      CHECK ("estado" IN ('ACTIVO', 'INACTIVO', 'ARCHIVADO'))`);
    await sql(`ALTER TABLE "Segmentos" ADD CONSTRAINT "segmentos_estado_activo_coherente"
      CHECK (("estado" = 'ACTIVO' AND "activo" = true)
          OR ("estado" <> 'ACTIVO' AND "activo" = false))`);
    await queryInterface.addIndex('Segmentos', ['estado'], {
      name: 'segmentos_estado_idx',
    });
    await queryInterface.addIndex('Segmentos', ['creadoPorUsuarioId'], {
      name: 'segmentos_creador_idx',
    });

    // --- 20261122000004: SegmentoVersiones --------------------------------
    await queryInterface.createTable('SegmentoVersiones', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      segmentoId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Segmentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      version: { type: Sequelize.INTEGER, allowNull: false },
      reglas: { type: Sequelize.JSONB, allowNull: false },
      hashReglas: { type: Sequelize.STRING(64), allowNull: false },
      creadoPorUsuarioId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      creadoEn: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('SegmentoVersiones', {
      fields: ['segmentoId', 'version'],
      type: 'unique',
      name: 'segmento_versiones_segmento_version_unique',
    });
    await queryInterface.addIndex('SegmentoVersiones', ['hashReglas'], {
      name: 'segmento_versiones_hash_idx',
    });
    await sql(`
      CREATE OR REPLACE FUNCTION "segmento_versiones_inmutables"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'SegmentoVersiones es inmutable: no se permite %', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await sql(`
      CREATE TRIGGER "segmento_versiones_inmutables"
      BEFORE UPDATE OR DELETE ON "SegmentoVersiones"
      FOR EACH ROW EXECUTE PROCEDURE "segmento_versiones_inmutables"()
    `);

    // --- 20261122000005: PlantillasSegmento -------------------------------
    await queryInterface.createTable('PlantillasSegmento', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      slug: { type: Sequelize.STRING(100), allowNull: false },
      nombre: { type: Sequelize.STRING(120), allowNull: false },
      objetivo: { type: Sequelize.TEXT, allowNull: true },
      descripcion: { type: Sequelize.TEXT, allowNull: true },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      reglas: { type: Sequelize.JSONB, allowNull: false },
      hashReglas: { type: Sequelize.STRING(64), allowNull: false },
      activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      creadoPorUsuarioId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('PlantillasSegmento', {
      fields: ['slug', 'version'],
      type: 'unique',
      name: 'plantillas_segmento_slug_version_unique',
    });
    await queryInterface.addIndex('PlantillasSegmento', ['slug'], {
      name: 'plantillas_segmento_slug_idx',
    });
    await queryInterface.addIndex('PlantillasSegmento', ['activa'], {
      name: 'plantillas_segmento_activa_idx',
    });
    await sql(`ALTER TABLE "PlantillasSegmento" ADD CONSTRAINT "plantillas_segmento_version_valida"
      CHECK ("version" > 0)`);

    // --- 20261122000006: EmisionDestinatarios -----------------------------
    await queryInterface.createTable('EmisionDestinatarios', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      emisionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CuponEmisiones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      estado: {
        type: Sequelize.ENUM('SELECCIONADO', 'EXCLUIDO', 'RECORTADO'),
        allowNull: false,
      },
      motivoCodigo: { type: Sequelize.STRING(80), allowNull: true },
      motivoDetalle: { type: Sequelize.TEXT, allowNull: true },
      posicionRanking: { type: Sequelize.INTEGER, allowNull: true },
      puntaje: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      metricasSnapshot: { type: Sequelize.JSONB, allowNull: true },
      reglasAplicadas: { type: Sequelize.JSONB, allowNull: true },
      origen: { type: Sequelize.STRING(20), allowNull: true },
      evaluadoEn: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('EmisionDestinatarios', {
      fields: ['emisionId', 'usuarioId'],
      type: 'unique',
      name: 'emision_destinatarios_emision_usuario_unique',
    });
    await queryInterface.addIndex(
      'EmisionDestinatarios',
      ['emisionId', 'estado'],
      {
        name: 'emision_destinatarios_emision_estado_idx',
      }
    );

    // --- 20261122000007: EmisionExclusiones -------------------------------
    await queryInterface.createTable('EmisionExclusiones', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      emisionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CuponEmisiones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuarioId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      motivo: { type: Sequelize.STRING(120), allowNull: false },
      creadoPorUsuarioId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('EmisionExclusiones', {
      fields: ['emisionId', 'usuarioId'],
      type: 'unique',
      name: 'emision_exclusiones_emision_usuario_unique',
    });

    // --- 20261122000001, 08, 09: columnas ---------------------------------
    await queryInterface.addColumn('CuponEmisiones', 'schemaVersion', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await queryInterface.addColumn('CuponEmisiones', 'segmentoVersionId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'SegmentoVersiones', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('CuponEmisiones', 'plantillaId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'PlantillasSegmento', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('CuponEmisiones', 'reglasSnapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('CuponEmisiones', 'reglasHash', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('CuponEmisiones', 'evaluadoEn', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('CuponEmisiones', 'cantidadExcluidos', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('CuponEmisiones', 'cantidadRecortados', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('CuponEmisiones', 'origenSegmentacion', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('CuponPreviewTokens', 'formato', {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: 'v1',
    });
  },
};
