'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: Direcciones
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/direccion.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - clienteId: INTEGER, notNull, references Usuarios.id (onDelete CASCADE)
 *   - nombre: STRING, notNull
 *   - direccion: STRING, notNull
 *   - ciudad: STRING, nullable
 *   - codigoPostal: STRING, nullable
 *   - referencia: STRING, nullable
 *   - esPrincipal: BOOLEAN, notNull, default false
 *   - estado: STRING, notNull, default 'activo'
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * Regla: solo UNA dirección principal activa por cliente (validar a nivel de
 * controller/service; si se desea, índice parcial en Postgres).
 *
 * up:   queryInterface.createTable('Direcciones', {...})
 * down: queryInterface.dropTable('Direcciones')
 */
