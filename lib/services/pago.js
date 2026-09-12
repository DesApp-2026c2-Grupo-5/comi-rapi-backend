/**
 * Service: pago
 *
 * Simulación del proceso de pago (espejo del frontend src/services/simuladorPago.js).
 *
 * Función esperada:
 *   - procesarPago({ total, metodo }) →
 *       { estado: 'aprobado', transaccionId: 'TXN-<timestamp>', fecha, monto, metodoPago }
 *
 * El frontend únicamente consume este flujo en la página de Pago y siempre asume
 * resultado 'aprobado' (mock). Si en el futuro hay un gateway real de pago,
 * este servicio es el punto de integración.
 */
