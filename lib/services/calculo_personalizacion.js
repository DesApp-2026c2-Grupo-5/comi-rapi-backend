/**
 * Service: calculo_personalizacion
 *
 * Cálculo de precios con personalización (espejo del frontend
 * src/services/personalizacionConfig.js).
 * - 'extra' / 'acompanar' suman precio × cantidad.
 * - 'personalizar' / 'condimento' son gratuitos.
 */

function sumarAdicionales(lista) {
  return (lista || []).reduce((acc, item) => {
    const precio = Number(item?.precio ?? item?.precioAdicional ?? 0);
    const cantidad = Number(item?.cantidad ?? 1);
    if (Number.isNaN(precio) || precio < 0) return acc;
    return acc + precio * cantidad;
  }, 0);
}

export function calcularPrecioUnitario(
  precioBase,
  extras = [],
  acompanamientos = []
) {
  const base = Number(precioBase);
  if (Number.isNaN(base) || base < 0) throw new Error('Precio base inválido');
  return base + sumarAdicionales(extras) + sumarAdicionales(acompanamientos);
}

export function calcularPrecioPersonalizado(
  precioBase,
  extras = [],
  acompanamientos = [],
  cantidad = 1
) {
  const cant = Number(cantidad);
  if (!Number.isInteger(cant) || cant <= 0)
    throw new Error('Cantidad inválida');
  return calcularPrecioUnitario(precioBase, extras, acompanamientos) * cant;
}
