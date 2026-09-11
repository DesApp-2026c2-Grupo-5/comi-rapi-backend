'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: Sucursales
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/sucursal.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - nombre: STRING, notNull
 *   - direccion: STRING, notNull
 *   - lat: DECIMAL(10,8), nullable
 *   - lng: DECIMAL(11,8), nullable
 *   - horario: STRING, nullable
 *   - telefono: STRING, nullable
 *   - estado: STRING, notNull, default 'activo'
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('Sucursales', {...})
 * down: queryInterface.dropTable('Sucursales')
 */
