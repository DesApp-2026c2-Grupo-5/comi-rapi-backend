'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: HistorialEstadosPedido
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/historial_estado_pedido.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - pedidoId: INTEGER, notNull, references Pedidos.id (onDelete CASCADE)
 *   - estado: STRING, notNull
 *   - fecha: DATE, notNull, default NOW
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('HistorialEstadosPedido', {...})
 * down: queryInterface.dropTable('HistorialEstadosPedido')
 */
