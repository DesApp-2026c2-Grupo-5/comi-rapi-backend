/**
 * Service: notas_pedido
 *
 * Regla de negocio: la nota para cocina es un texto libre y opcional que el
 * cliente deja en cada ítem del carrito ("sin sal", "bien cocida").
 *
 * Se persiste en `PedidoItems.nota`, una columna propia: `PedidoItems.observacion`
 * guarda el snapshot de la personalización como JSON y de ahí lo lee
 * `lib/services/stock.js` para descontar insumos.
 */

/**
 * Normaliza la nota de una línea del pedido: colapsa espacios y saltos de
 * línea, y devuelve `null` cuando no hay contenido útil.
 * @param {unknown} valor - Valor crudo recibido del cliente.
 * @returns {string|null} Nota lista para persistir.
 */
export function normalizarNota(valor) {
  if (typeof valor !== 'string') return null;
  const nota = valor.replace(/\s+/g, ' ').trim();
  return nota || null;
}
