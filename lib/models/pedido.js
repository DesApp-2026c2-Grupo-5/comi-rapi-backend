/**
 * Modelo: Pedido
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - clienteId (INTEGER, FK → Usuarios.id, NOT NULL)
 *   - sucursalId (INTEGER, FK → Sucursales.id, NOT NULL)
 *   - total (DECIMAL, NOT NULL — monto total del pedido)
 *   - estado (STRING, default 'pendiente')
 *     Valores posibles: pendiente, confirmado, en_preparacion,
 *     listo_para_entregar, en_camino, entregado, cancelado
 *   - fecha (DATE, default NOW)
 *   - direccionEntrega (STRING, nullable — dirección textual del cliente)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Un Pedido pertenece a un Usuario (belongsTo, alias: cliente)
 *   - Un Pedido pertenece a una Sucursal (belongsTo)
 *   - Un Pedido tiene muchas LineasPedido (hasMany)
 *   - Un Pedido tiene muchos HistorialEstadosPedido (hasMany)
 *
 * Referencia: frontend src/services/seedData.js → pedidosMock
 *   El frontend muestra 'cliente' como email string y 'sucursal' como objeto embebido.
 *   El backend resuelve esas relaciones via FK y se serializa con include.
 */
