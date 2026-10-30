/**
 * Service: notas_pedido
 *
 * Regla de negocio: la nota para cocina es un texto libre y opcional que el
 * cliente deja en cada ítem del carrito ("sin sal", "bien cocida").
 *
 * Se persiste en `PedidoItems.nota`, una columna propia: `PedidoItems.observacion`
 * guarda el snapshot de la personalización como JSON y de ahí lo lee
 * `lib/services/stock.js` para descontar insumos.
 *
 * Normalización (no se confía en el cliente):
 *  - `null`/`undefined`/texto vacío o solo espacios → `null`.
 *  - Espacios repetidos y saltos de línea se colapsan a un espacio.
 *  - Un valor que no sea texto, o que supere `NOTA_MAX_LENGTH`, es entrada
 *    inválida (`NotaInvalidaError` → 400 en el controller).
 */

export const NOTA_MAX_LENGTH = 140;

export class NotaInvalidaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotaInvalidaError';
  }
}

/**
 * Normaliza la nota de una línea del pedido.
 * @param {unknown} valor - Valor crudo recibido del cliente.
 * @returns {string|null} Nota lista para persistir.
 * @throws {NotaInvalidaError} Si no es texto o supera el largo máximo.
 */
export function normalizarNota(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw new NotaInvalidaError('La nota del ítem debe ser texto');
  }
  const nota = valor.replace(/\s+/g, ' ').trim();
  if (!nota) return null;
  if (nota.length > NOTA_MAX_LENGTH) {
    throw new NotaInvalidaError(
      `La nota del ítem no puede superar los ${NOTA_MAX_LENGTH} caracteres`
    );
  }
  return nota;
}
