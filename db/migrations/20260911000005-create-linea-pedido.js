'use strict';

/**
 * MIGRACIÓN PLACEHOLDER - Tabla: LineasPedido
 *
 * Al implementar, crear la tabla con la siguiente estructura (espejo de lib/models/linea_pedido.js):
 *   - id: INTEGER, autoIncrement, primaryKey
 *   - pedidoId: INTEGER, notNull, references Pedidos.id (onDelete CASCADE)
 *   - productoId: INTEGER, nullable, references Productos.id
 *   - nombre: STRING, notNull
 *   - cantidad: INTEGER, notNull, default 1
 *   - precio: DECIMAL, notNull
 *   - personalizacion: JSONB, nullable
 *   - precioUnitarioPersonalizado: DECIMAL, nullable
 *   - createdAt: DATE, notNull
 *   - updatedAt: DATE, notNull
 *
 * up:   queryInterface.createTable('LineasPedido', {...})
 * down: queryInterface.dropTable('LineasPedido')
 */
