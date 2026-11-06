/**
 * Service: ingredientes
 *
 * Sincroniza los ingredientes informativos del producto con su receta.
 *
 * Los ingredientes del detalle y las opciones "Sin X" se guardan como
 * `PersonalizacionElemento` de tipo `personalizar`, pero ya no se cargan a
 * mano: se generan desde `ProductoIngrediente`. Sólo los ingredientes con
 * `permiteQuitar = true` aparecen como "Sin X"; todos los de la receta se
 * muestran en el detalle.
 *
 * El campo viejo `ingredientes` de la API se ignora a propósito.
 */
import db from '../models';

const { Ingrediente, PersonalizacionElemento } = db;

export const TIPO_INGREDIENTE = 'personalizar';

/**
 * Reemplaza las opciones `personalizar` de un producto a partir de su receta.
 *
 * Borra las filas anteriores (los pedidos guardan su propio snapshot) y crea
 * una por cada ingrediente con `permiteQuitar`. No toca los elementos `extra`,
 * `acompanar` ni `condimento`.
 *
 * @param {number} productoId
 * @param {Array<{ingredienteId: number, permiteQuitar?: boolean}>} receta
 * @param {object} [opciones]
 * @returns {Promise<Array>} Filas creadas.
 */
export async function reemplazarIngredientes(
  productoId,
  receta,
  { transaction } = {}
) {
  await PersonalizacionElemento.destroy({
    where: { productoId, tipo: TIPO_INGREDIENTE },
    transaction,
  });

  const quitables = (receta || []).filter(
    (fila) => fila.permiteQuitar !== false
  );
  if (quitables.length === 0) return [];

  const ingredientes = await Ingrediente.findAll({
    where: { id: quitables.map((fila) => fila.ingredienteId) },
    transaction,
  });
  const porId = new Map(
    ingredientes.map((ingrediente) => [Number(ingrediente.id), ingrediente])
  );

  return PersonalizacionElemento.bulkCreate(
    quitables.map((fila) => {
      const ingrediente = porId.get(Number(fila.ingredienteId));
      return {
        productoId,
        tipo: TIPO_INGREDIENTE,
        nombre: ingrediente ? ingrediente.nombre : undefined,
        precio: null,
        productoReferenciaId: null,
        ingredienteId: Number(fila.ingredienteId),
        minimo: 0,
        maximo: 1,
        activo: true,
      };
    }),
    { transaction }
  );
}
