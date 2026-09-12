'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: Pedidos
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/pedido.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - clienteId: INTEGER, notNull, references Usuarios.id
 *   - sucursalId: INTEGER, notNull, references Sucursales.id
 *   - total: DECIMAL, notNull
 *   - estado: STRING, notNull, default 'pendiente'
 *   - fecha: DATE, notNull, default NOW
 *   - direccionEntrega: STRING, nullable
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('Pedidos', {...})
 * down: queryInterface.dropTable('Pedidos')
 */
