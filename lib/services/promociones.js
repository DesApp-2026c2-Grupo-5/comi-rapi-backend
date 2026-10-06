/**
 * Service: promociones
 *
 * Cálculo de descuentos de promociones (motor usado por POST /pedidos).
 * Espejo del frontend src/utils/calculoPromociones.js: ambos deben aplicar
 * las mismas reglas (docs/promociones.md).
 *
 * - DESCUENTO_PORCENTUAL: `valor`% sobre el subtotal de las líneas alcanzadas.
 * - DOS_POR_UNO: 2x1 literal por producto alcanzado; por cada par de unidades
 *   una es gratis (floor(cantidad / 2) * precioUnitario). `valor` se ignora.
 * - Si varias promociones alcanzan la misma línea, gana la de mayor descuento
 *   (sin doble descuento).
 *
 * Entrada:
 *   lineas: [{ productoId, precioUnitario, cantidad }]
 *   promociones: [{ id, tipo, valor, productoIds: [ids alcanzados] }]
 * Salida:
 *   { descuentoTotal, porPromocion: [{ promocionId, descuento }] }
 *   (solo promociones con descuento > 0)
 */

export function calcularDescuento(lineas, promociones) {
  const lineasValidas = (Array.isArray(lineas) ? lineas : []).filter(
    (linea) =>
      linea &&
      Number.isInteger(Number(linea.cantidad)) &&
      Number(linea.cantidad) > 0 &&
      !Number.isNaN(Number(linea.precioUnitario)) &&
      Number(linea.precioUnitario) >= 0
  );
  const promos = Array.isArray(promociones) ? promociones : [];

  // Mejor descuento por línea: { indiceLinea: { promocionId, descuento } }
  const mejorPorLinea = new Map();

  const descuentoLinea = (linea, promocion) => {
    if (linea?.tipo === 'COMBO') return 0;
    const alcanzada = (promocion.productoIds || []).some(
      (id) => String(id) === String(linea.productoId)
    );
    if (!alcanzada) return 0;
    const precioUnitario = Number(linea.precioUnitario);
    const cantidad = Number(linea.cantidad);
    const tope = precioUnitario * cantidad;
    if (promocion.tipo === 'DOS_POR_UNO') {
      return Math.min(Math.floor(cantidad / 2) * precioUnitario, tope);
    }
    if (promocion.tipo === 'DESCUENTO_PORCENTUAL') {
      const tasa = Number(promocion.valor);
      if (Number.isNaN(tasa) || tasa <= 0) return 0;
      return Math.min(precioUnitario * cantidad * (tasa / 100), tope);
    }
    return 0;
  };

  lineasValidas.forEach((linea, indice) => {
    let mejor = null;
    for (const promocion of promos) {
      const descuento = descuentoLinea(linea, promocion);
      if (descuento > 0 && (!mejor || descuento > mejor.descuento)) {
        mejor = { promocionId: promocion.id, descuento };
      }
    }
    if (mejor) mejorPorLinea.set(indice, mejor);
  });

  const porPromocionMap = new Map();
  for (const { promocionId, descuento } of mejorPorLinea.values()) {
    porPromocionMap.set(
      promocionId,
      (porPromocionMap.get(promocionId) || 0) + descuento
    );
  }
  const porPromocion = [
    ...porPromocionMap.entries(),
  ].map(([promocionId, descuento]) => ({ promocionId, descuento }));
  const descuentoTotal = porPromocion.reduce(
    (acc, item) => acc + item.descuento,
    0
  );
  return { descuentoTotal, porPromocion };
}
