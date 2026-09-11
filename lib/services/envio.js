/**
 * Service: envio
 *
 * Reglas de cálculo del costo de envío (espejo del frontend src/services/envio.js).
 *
 * Constantes:
 *   - ENVIO_GRATIS_DESDE = 10000  (monto mínimo para envío gratis)
 *   - COSTO_ENVIO_FIJO = 350      (costo si no llega al mínimo)
 *
 * Funciones esperadas:
 *   - calcularCostoEnvio(subtotal) → 0 si subtotal >= ENVIO_GRATIS_DESDE, si no COSTO_ENVIO_FIJO.
 *   - calcularTotalConEnvio(subtotal) → subtotal + calcularCostoEnvio(subtotal).
 *
 * Se usa en pedido_controller al crear un pedido (cálculo del total final).
 */
