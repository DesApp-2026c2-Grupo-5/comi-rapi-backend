/**
 * Modelo: LineaPedido
 *
 * Representa cada ítem dentro de un pedido (producto + cantidad + precio al momento de compra).
 *
 * Campos:
 *   - id (INTEGER, PK, autoincrement)
 *   - pedidoId (INTEGER, FK → Pedidos.id, NOT NULL)
 *   - productoId (INTEGER, FK → Productos.id, nullable — puede ser null si el producto fue borrado)
 *   - nombre (STRING, NOT NULL — snapshot del nombre al momento del pedido)
 *   - cantidad (INTEGER, NOT NULL, default 1)
 *   - precio (DECIMAL, NOT NULL — precio unitario al momento del pedido)
 *   - personalizacion (JSONB, nullable — objeto con { extras, sin, acompanamientos, condimentos })
 *   - precioUnitarioPersonalizado (DECIMAL, nullable — precio final unitario con personalización)
 *   - createdAt, updatedAt (DATE)
 *
 * Asociaciones:
 *   - Una LineaPedido pertenece a un Pedido (belongsTo)
 *   - Una LineaPedido puede pertenecer a un Producto (belongsTo, nullable)
 *
 * Referencia: frontend src/services/seedData.js → pedidosMock[i].productos
 *   El frontend envía { nombre, cantidad, precio, personalizacion? }
 */
