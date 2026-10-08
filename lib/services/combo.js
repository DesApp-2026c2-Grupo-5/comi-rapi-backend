/**
 * Service: combo
 *
 * Reglas de la receta de un combo (DER §2.6).
 *
 * Un combo es un `Producto` con `tipo = COMBO` armado por dos o más productos
 * simples. La validación vive acá y se usa desde el alta y la edición del
 * producto, para que no haya dos versiones de la misma regla.
 *
 * Lo que se guarda es `cantidad = cuántas unidades del componente lleva una
 * unidad del combo`. El precio del combo es propio (`Producto.precio`) y no se
 * calcula sumando los componentes.
 */

import db from '../models';
import { obtenerValor } from './parametros_service';

const { Producto, ComboComponente } = db;

// Valor por defecto del mínimo de componentes. El valor efectivo es el parámetro
// `minimoComponentesCombo` (editable por el SUPERADMINISTRADOR); esta constante
// se usa como fallback en la validación pura (`normalizarComponentes`).
export const MIN_COMPONENTES = 2;

function esEnteroPositivo(valor) {
  return Number.isInteger(Number(valor)) && Number(valor) > 0;
}

/**
 * Normaliza la forma de la receta y rechaza lo que no tiene sentido: cantidad
 * inválida, producto repetido, combo en sí mismo. No toca la base, así que se
 * puede testear sola.
 *
 * @param {Array<{productoId: number, cantidad: number}>} componentes
 * @param {number} [comboId] el combo que se está armando, si ya existe
 * @param {number} [minimoComponentes] mínimo de componentes exigido
 * @returns {Array<{productoId: number, cantidad: number}>}
 */
export function normalizarComponentes(
  componentes,
  comboId,
  minimoComponentes = MIN_COMPONENTES
) {
  if (!Array.isArray(componentes) || componentes.length === 0) {
    throw new Error('El combo tiene que tener productos seleccionados');
  }
  if (componentes.length < minimoComponentes) {
    throw new Error(
      `El combo tiene que armarse con ${minimoComponentes} o más productos`
    );
  }

  const vistos = new Set();
  return componentes.map((componente) => {
    const productoId = Number(componente?.productoId);
    const cantidad = Number(componente?.cantidad ?? 1);
    if (!esEnteroPositivo(productoId)) {
      throw new Error('Cada componente tiene que referenciar un producto');
    }
    if (!esEnteroPositivo(cantidad)) {
      throw new Error(
        'La cantidad de cada producto del combo tiene que ser 1 o más'
      );
    }
    if (comboId && productoId === Number(comboId)) {
      throw new Error('Un combo no puede ser componente de sí mismo');
    }
    if (vistos.has(productoId)) {
      throw new Error('El mismo producto no se puede repetir en el combo');
    }
    vistos.add(productoId);
    return { productoId, cantidad };
  });
}

/**
 * Valida la receta completa: la forma (`normalizarComponentes`) más lo que solo
 * se puede saber mirando el catálogo — que los productos existan, que no sean
 * combos y que estén activos.
 *
 * `comboId` es opcional (en el alta todavía no existe) y sirve para impedir que
 * un combo se agregue a sí mismo.
 *
 * @param {Array<{productoId: number, cantidad: number}>} componentes
 * @param {{comboId?: number, transaction?: object}} [opciones]
 * @returns {Promise<Array<{productoId: number, cantidad: number}>>}
 */
export async function validarComponentes(
  componentes,
  { comboId, transaction } = {}
) {
  const minimoComponentes = await obtenerValor('minimoComponentesCombo');
  const normalizados = normalizarComponentes(
    componentes,
    comboId,
    minimoComponentes
  );

  const productos = await Producto.findAll({
    where: { id: normalizados.map((c) => c.productoId) },
    transaction,
  });
  if (productos.length !== normalizados.length) {
    const encontrados = new Set(productos.map((p) => p.id));
    const faltante = normalizados.find((c) => !encontrados.has(c.productoId));
    throw new Error(`El producto ${faltante.productoId} no existe`);
  }

  const comboAnidado = productos.find((p) => p.tipo === 'COMBO');
  if (comboAnidado) {
    throw new Error(
      `El combo "${comboAnidado.nombre}" no se puede usar dentro de otro combo`
    );
  }

  const inactivo = productos.find((p) => !p.activo);
  if (inactivo) {
    throw new Error(
      `El producto "${inactivo.nombre}" está dado de baja y no se puede usar en un combo`
    );
  }

  return normalizados;
}

/**
 * Reemplaza la receta de un combo por la lista validada.
 * Va dentro de la transacción del alta/edición del producto.
 */
export async function guardarComponentes(
  comboId,
  componentes,
  { transaction } = {}
) {
  const validados = await validarComponentes(componentes, {
    comboId,
    transaction,
  });
  await ComboComponente.destroy({ where: { comboId }, transaction });
  await ComboComponente.bulkCreate(
    validados.map((componente) => ({ ...componente, comboId })),
    { transaction }
  );
  return validados;
}

/**
 * Elimina la receta de un combo. Un producto que deja de ser combo no puede
 * conservar componentes.
 */
export async function borrarComponentes(comboId, { transaction } = {}) {
  await ComboComponente.destroy({ where: { comboId }, transaction });
}

/**
 * Receta de varios combos en una sola consulta, para no hacer una consulta por
 * combo cuando se arma el catálogo.
 *
 * @returns {Promise<Map<number, Array>>} { comboId: [{productoId, cantidad, nombre, precio, imagen}] }
 */
export async function obtenerComponentesDeCombos(comboIds) {
  const datos = new Map();
  const ids = (comboIds || []).map(Number).filter(Boolean);
  ids.forEach((id) => datos.set(id, []));
  if (ids.length === 0) return datos;
  const componentes = await ComboComponente.findAll({
    where: { comboId: ids },
    include: [
      {
        model: Producto,
        as: 'Producto',
        attributes: ['id', 'nombre', 'precio', 'imagen', 'tipo'],
      },
    ],
    order: [['id', 'ASC']],
  });
  componentes.forEach((componente) => {
    datos.get(componente.comboId).push({
      productoId: componente.productoId,
      cantidad: componente.cantidad,
      nombre: componente.Producto ? componente.Producto.nombre : null,
      precio: componente.Producto ? Number(componente.Producto.precio) : null,
      imagen: componente.Producto ? componente.Producto.imagen : null,
    });
  });
  return datos;
}

/**
 * Receta de un combo con los datos del producto, para mostrar en el catálogo.
 * Devuelve `[]` si el producto no es un combo.
 */
export async function obtenerComponentes(comboId) {
  const datos = await obtenerComponentesDeCombos([comboId]);
  return datos.get(Number(comboId)) ?? [];
}
