'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: PersonalizacionElementos
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/personalizacion_elemento.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - productoId: INTEGER, notNull, references Productos.id (onDelete CASCADE)
 *   - tipo: STRING, notNull   ('extra' | 'personalizar' | 'acompanar' | 'condimento')
 *   - nombre: STRING, nullable
 *   - precio: DECIMAL, nullable  (null = gratuito)
 *   - productoReferenciaId: INTEGER, nullable, references Productos.id (solo tipo 'acompanar')
 *   - activo: BOOLEAN, notNull, default true
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('PersonalizacionElementos', {...})
 * down: queryInterface.dropTable('PersonalizacionElementos')
 */
