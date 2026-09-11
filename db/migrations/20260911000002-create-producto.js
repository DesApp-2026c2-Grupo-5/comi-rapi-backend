'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: Productos
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/producto.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - nombre: STRING, notNull
 *   - precio: DECIMAL, notNull
 *   - imagen: STRING, nullable
 *   - descripcion: TEXT, nullable
 *   - categoriaId: INTEGER, notNull, references Categorias.id (onDelete CASCADE)
 *   - activo: BOOLEAN, notNull, default true (borrado lógico)
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('Productos', {...})
 * down: queryInterface.dropTable('Productos')
 */
