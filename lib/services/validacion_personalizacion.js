/**
 * Service: validacion_personalizacion
 *
 * Regla de negocio: al crear un pedido, cada extra/acompañamiento/condimento
 * elegido debe respetar el rango `minimo`/`maximo` configurado por el
 * SUPERADMINISTRADOR para ESE producto (tabla `PersonalizacionElementos`).
 *
 * El modal del cliente ya limita en la UI, pero el backend no confía en el
 * cliente: revalida contra la configuración vigente. Elementos `personalizar`
 * (quitar ingrediente) no manejan cantidades, así que no se validan.
 *
 * Si el producto no tiene elementos configurados no hay nada que validar: el
 * carrito puede venir del catálogo de fallback por categoría del frontend.
 */
import db from '../models';

const { PersonalizacionElemento } = db;

export class PersonalizacionInvalidaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PersonalizacionInvalidaError';
  }
}

// Suma las unidades seleccionadas que corresponden a `elemento`, matcheando por
// id (elementos reales de la base) o por nombre (compatibilidad/condimentos).
export function cantidadSeleccionada(seleccionados, elemento) {
  const id = String(elemento.id);
  const nombre = String(elemento.nombre || '')
    .trim()
    .toLowerCase();
  let total = 0;
  for (const seleccion of seleccionados || []) {
    const mismoId =
      seleccion &&
      seleccion.id !== undefined &&
      seleccion.id !== null &&
      String(seleccion.id) === id;
    const mismoNombre =
      nombre &&
      seleccion &&
      String(seleccion.nombre || '')
        .trim()
        .toLowerCase() === nombre;
    if (!mismoId && !mismoNombre) continue;
    const cantidad = Number(seleccion.cantidad ?? 1);
    if (Number.isFinite(cantidad) && cantidad > 0) total += cantidad;
  }
  return total;
}

/**
 * Valida la personalización de todas las líneas de un pedido.
 * @param {Array} items - Líneas crudas del body (con `productoId` y `personalizacion`).
 * @param {object} [transaction] - Transacción Sequelize opcional.
 * @throws {PersonalizacionInvalidaError}
 */
export async function validarPersonalizacionDeItems(items, transaction) {
  for (const item of items || []) {
    const productoId = item && item.productoId;
    if (!productoId) continue;

    const elementos = await PersonalizacionElemento.findAll({
      where: { productoId, activo: true },
      transaction,
    });
    if (elementos.length === 0) continue;

    const personalizacion = item.personalizacion || {};
    const seleccionPorTipo = {
      extra: personalizacion.extras || item.extras || [],
      acompanar: personalizacion.acompanamientos || item.acompanamientos || [],
      condimento: personalizacion.condimentos || item.condimentos || [],
    };
    const etiqueta =
      item.nombreProducto || item.nombre || `producto ${productoId}`;

    for (const elemento of elementos) {
      const seleccionados = seleccionPorTipo[elemento.tipo];
      if (!seleccionados) continue;

      const cantidad = cantidadSeleccionada(seleccionados, elemento);
      if (cantidad > elemento.maximo) {
        throw new PersonalizacionInvalidaError(
          `"${elemento.nombre}" en "${etiqueta}" permite como máximo ${elemento.maximo}`
        );
      }
      if (cantidad < elemento.minimo) {
        throw new PersonalizacionInvalidaError(
          `"${elemento.nombre}" en "${etiqueta}" requiere al menos ${elemento.minimo}`
        );
      }
    }
  }
}
