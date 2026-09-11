'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: Categorias
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/categoria.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - nombre: STRING, notNull, unique
 *   - descripcion: TEXT, nullable
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('Categorias', {...})
 * down: queryInterface.dropTable('Categorias')
 *
 * Nota: los archivos de migración deben exportar { up, down }. Este es solo un
 * esqueleto de comentarios que SE DEBE reemplazar por el código real antes de correr
 * `npm run db:migrate`.
 */
