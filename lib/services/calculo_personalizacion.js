/**
 * Service: calculo_personalizacion
 *
 * Cálculo de precios con personalización de productos (espejo del frontend
 * src/services/personalizacionConfig.js).
 *
 * Reglas:
 *   - tipo 'extra' / 'acompanar' suman precio al producto (precio (requerido) × cantidad).
 *   - tipo 'personalizar' / 'condimento' son gratuitos (precio null).
 *   - Los límites por tipo (frontend): extra 6, personalizar 7, acompanar 3, condimento 2.
 *
 * Funciones esperadas:
 *   - calcularPrecioUnitario(precioBase, extras, acompanamientos) → precio unitario final.
 *   - calcularPrecioPersonalizado(precioBase, extras, acompanamientos, cantidad=1) → total de la línea.
 *
 * Se usa al crear un pedido para calcular el precioUnitarioPersonalizado de cada LineaPedido.
 */
