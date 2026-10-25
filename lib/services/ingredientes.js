/**
 * Service: ingredientes
 *
 * Los ingredientes de un producto se guardan como elementos de personalización
 * de tipo `personalizar`: el detalle del producto los lista y el cliente puede
 * pedir que se los quiten. Son datos propios de cada producto, no se heredan de
 * la categoría (las plantillas `personalizar` ya no se copian).
 */
import db from '../models';

const { PersonalizacionElemento } = db;

export const TIPO_INGREDIENTE = 'personalizar';
export const MAX_INGREDIENTES = 50;
export const MAX_LARGO_NOMBRE = 80;

/**
 * Normaliza la lista de ingredientes que llega del formulario.
 *
 * Devuelve `null` cuando el campo no vino en el request: así se distingue
 * "no tocar los ingredientes" (clientes viejos) de "dejarlos vacíos" (`[]`).
 *
 * @param {*} valor - Lista de nombres.
 * @returns {string[]|null}
 * @throws {Error} Si el formato es inválido.
 */
export function normalizarIngredientes(valor) {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) {
    throw new Error('Los ingredientes deben ser una lista de nombres');
  }
  const vistos = new Set();
  const limpios = [];
  for (const item of valor) {
    if (typeof item !== 'string') {
      throw new Error('Cada ingrediente debe ser un texto');
    }
    const nombre = item.trim();
    if (!nombre) continue;
    if (nombre.length > MAX_LARGO_NOMBRE) {
      throw new Error(
        `Cada ingrediente puede tener hasta ${MAX_LARGO_NOMBRE} caracteres`
      );
    }
    // Sin distinguir mayúsculas: "Queso" y "queso" son el mismo ingrediente.
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    limpios.push(nombre);
  }
  if (limpios.length > MAX_INGREDIENTES) {
    throw new Error(
      `Un producto puede tener hasta ${MAX_INGREDIENTES} ingredientes`
    );
  }
  return limpios;
}

/**
 * Reemplaza los ingredientes de un producto.
 *
 * Borra los elementos `personalizar` anteriores (no hay pedidos que apunten a
 * ellos: `PedidoItemOpcion` guarda un snapshot) y crea los nuevos. Una lista
 * vacía deja al producto sin ingredientes configurados.
 *
 * @param {number} productoId
 * @param {string[]} ingredientes
 * @param {object} [opciones]
 * @param {object} [opciones.transaction]
 * @returns {Promise<Array>} Filas creadas.
 */
export async function reemplazarIngredientes(
  productoId,
  ingredientes,
  { transaction } = {}
) {
  await PersonalizacionElemento.destroy({
    where: { productoId, tipo: TIPO_INGREDIENTE },
    transaction,
  });
  if (!ingredientes || ingredientes.length === 0) return [];
  return PersonalizacionElemento.bulkCreate(
    ingredientes.map((nombre) => ({
      productoId,
      tipo: TIPO_INGREDIENTE,
      nombre,
      precio: null,
      productoReferenciaId: null,
      minimo: 0,
      maximo: 1,
      activo: true,
    })),
    { transaction }
  );
}
