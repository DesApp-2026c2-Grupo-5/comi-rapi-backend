/**
 * Validación de entrada compartida por los proveedores de routing (A1-2).
 *
 * El contrato exige coordenadas presentes, numéricas y en rango ANTES de
 * llamar a cualquier API externa: ambos proveedores (ORS, Geoapify) validan
 * exactamente lo mismo para que el comportamiento de entrada sea idéntico
 * sin importar el proveedor activo.
 */

const LIMITES_LAT = { MIN: -90, MAX: 90 };
const LIMITES_LNG = { MIN: -180, MAX: 180 };

/**
 * Valida que las coordenadas estén presentes, sean numéricas y estén en rango.
 * @param {string} nombre - "origen" o "destino".
 * @param {object} punto - { latitud, longitud }.
 * @throws {Error} Coordenadas ausentes, inválidas o fuera de rango.
 */
export function validarPunto(nombre, punto) {
  if (!punto || typeof punto !== 'object') {
    throw new Error(`El punto ${nombre} es obligatorio`);
  }
  const { latitud, longitud } = punto;
  if (latitud === undefined || latitud === null || latitud === '') {
    throw new Error(`La latitud del punto ${nombre} es obligatoria`);
  }
  if (longitud === undefined || longitud === null || longitud === '') {
    throw new Error(`La longitud del punto ${nombre} es obligatoria`);
  }
  const lat = Number(latitud);
  const lng = Number(longitud);
  if (Number.isNaN(lat) || lat < LIMITES_LAT.MIN || lat > LIMITES_LAT.MAX) {
    throw new Error(
      `La latitud del punto ${nombre} debe estar entre ${LIMITES_LAT.MIN} y ${LIMITES_LAT.MAX}`
    );
  }
  if (Number.isNaN(lng) || lng < LIMITES_LNG.MIN || lng > LIMITES_LNG.MAX) {
    throw new Error(
      `La longitud del punto ${nombre} debe estar entre ${LIMITES_LNG.MIN} y ${LIMITES_LNG.MAX}`
    );
  }
}

/**
 * Valida origen y destino de una ruta.
 * @param {object} datos - { origen, destino }.
 * @throws {Error} Puntos ausentes o inválidos.
 */
export function validarDatosRuta({ origen, destino }) {
  validarPunto('origen', origen);
  validarPunto('destino', destino);
}
