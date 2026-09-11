/**
 * Modelo: HistorialEstadoPedido
 *
 * Registra cada cambio de estado de un pedido (audit trail / timeline).
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - pedidoId (INTEGER, FK → Pedidos.id, NOT NULL)
 *   - estado (STRING, NOT NULL — uno de los valores de ESTADOS_PEDIDO)
 *   - fecha (DATE, default NOW — momento en que se produjo el cambio)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Un HistorialEstadoPedido pertenece a un Pedido (belongsTo)
 *
 * Referencia: frontend src/services/seedData.js → pedidosMock[i].historialEstados
 *   El frontend renderiza una línea de tiempo con [{ estado, fecha }]
 */
