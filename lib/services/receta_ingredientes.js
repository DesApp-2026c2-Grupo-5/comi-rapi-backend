/**
 * Service: receta_ingredientes
 *
 * Reglas de la receta de un producto simple (modelo-dominio §5.8.3).
 *
 * - La receta es obligatoria para todo `Producto` `tipo = PRODUCTO`.
 * - Cada fila referencia un ingrediente activo y lleva una cantidad > 0.
 * - No se repite el mismo ingrediente en la receta.
 * - `permiteQuitar` define qué ingredientes generan la opción "Sin X".
 *
 * La receta también es la fuente de los ingredientes informativos del detalle:
 * al guardarla se sincronizan los `PersonalizacionElemento` de tipo
 * `personalizar` (ver `lib/services/ingredientes.js`).
 */
import db from '../models';
import { reemplazarIngredientes } from './ingredientes';

const { Ingrediente, ProductoIngrediente } = db;

export class RecetaInvalidaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RecetaInvalidaError';
    this.status = status;
  }
}

const redondearCantidad = (cantidad) =>
  Math.round(Number(cantidad) * 1000) / 1000;

/**
 * Normaliza y valida la forma de la receta. Devuelve `null` cuando el campo no
 * vino en el request (para distinguir "no tocar" de "dejarla vacía").
 *
 * @param {*} valor
 * @returns {Array<{ingredienteId: number, cantidad: number, permiteQuitar: boolean}>|null}
 */
export function normalizarRecetaIngredientes(valor) {
  if (valor === undefined) return null;
  if (!Array.isArray(valor)) {
    throw new RecetaInvalidaError(
      'La receta debe ser una lista de ingredientes'
    );
  }

  const vistos = new Set();
  return valor.map((item) => {
    const ingredienteId = Number(item?.ingredienteId);
    if (!Number.isInteger(ingredienteId) || ingredienteId <= 0) {
      throw new RecetaInvalidaError(
        'Cada ingrediente de la receta debe tener un ingredienteId válido'
      );
    }
    if (vistos.has(ingredienteId)) {
      throw new RecetaInvalidaError(
        'El mismo ingrediente no se puede repetir en la receta'
      );
    }
    vistos.add(ingredienteId);

    const cantidad = Number(item?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new RecetaInvalidaError(
        'La cantidad de cada ingrediente debe ser mayor a 0'
      );
    }

    return {
      ingredienteId,
      cantidad: redondearCantidad(cantidad),
      permiteQuitar:
        item?.permiteQuitar === undefined ? true : Boolean(item.permiteQuitar),
    };
  });
}

/** Valida que todos los ingredientes existan y estén activos. */
export async function validarIngredientesDeReceta(
  receta,
  { transaction } = {}
) {
  if (!receta || receta.length === 0) return [];
  const ids = receta.map((fila) => fila.ingredienteId);
  const ingredientes = await Ingrediente.findAll({
    where: { id: ids },
    transaction,
  });

  const encontrados = new Map(
    ingredientes.map((ingrediente) => [Number(ingrediente.id), ingrediente])
  );
  for (const fila of receta) {
    const ingrediente = encontrados.get(fila.ingredienteId);
    if (!ingrediente) {
      throw new RecetaInvalidaError(
        `El ingrediente ${fila.ingredienteId} no existe`
      );
    }
    if (!ingrediente.activo) {
      throw new RecetaInvalidaError(
        `El ingrediente "${ingrediente.nombre}" está dado de baja`
      );
    }
  }

  return ingredientes;
}

/**
 * Reemplaza la receta completa de un producto y sincroniza las opciones
 * "Sin X". Debe ejecutarse dentro de la transacción del alta/edición.
 */
export async function reemplazarReceta(
  productoId,
  receta,
  { transaction } = {}
) {
  if (receta === null) return null;

  await validarIngredientesDeReceta(receta, { transaction });
  await ProductoIngrediente.destroy({
    where: { productoId },
    transaction,
  });
  if (receta.length > 0) {
    await ProductoIngrediente.bulkCreate(
      receta.map((fila) => ({ ...fila, productoId })),
      { transaction }
    );
  }

  await reemplazarIngredientes(productoId, receta, { transaction });
  return receta;
}

/** Cantidad de ingredientes que tiene cargados un producto. */
export async function contarReceta(productoId, { transaction } = {}) {
  return ProductoIngrediente.count({ where: { productoId }, transaction });
}

/** Borra la receta y las opciones "Sin X" (un producto que deja de ser simple). */
export async function borrarReceta(productoId, { transaction } = {}) {
  await ProductoIngrediente.destroy({ where: { productoId }, transaction });
  await reemplazarIngredientes(productoId, [], { transaction });
}

/**
 * Serializa las filas de receta con el nombre y la unidad del ingrediente.
 * El shape es el que consume el formulario del superadmin y el detalle.
 */
export function serializarReceta(filas) {
  return (filas || []).map((fila) => ({
    ingredienteId: Number(fila.ingredienteId),
    nombre: fila.ingrediente ? fila.ingrediente.nombre : undefined,
    unidadMedida: fila.ingrediente ? fila.ingrediente.unidadMedida : undefined,
    cantidad: Number(fila.cantidad),
    permiteQuitar: Boolean(fila.permiteQuitar),
  }));
}

/** Receta de un producto, lista para devolver por API. */
export async function obtenerRecetaDeProducto(
  productoId,
  { transaction } = {}
) {
  const filas = await ProductoIngrediente.findAll({
    where: { productoId },
    include: [{ model: Ingrediente, as: 'ingrediente' }],
    order: [['ingredienteId', 'ASC']],
    transaction,
  });
  return serializarReceta(filas);
}

/**
 * Recetas de varios productos en una sola consulta.
 *
 * @returns {Promise<Map<number, Array>>}
 */
export async function obtenerRecetasDeProductos(
  productoIds,
  { transaction } = {}
) {
  const ids = [...new Set((productoIds || []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0
  );
  if (ids.length === 0) return new Map();

  const filas = await ProductoIngrediente.findAll({
    where: { productoId: ids },
    include: [{ model: Ingrediente, as: 'ingrediente' }],
    order: [['ingredienteId', 'ASC']],
    transaction,
  });

  const porProducto = new Map(ids.map((id) => [id, []]));
  for (const fila of filas) {
    porProducto.get(Number(fila.productoId)).push(fila);
  }
  for (const [id, receta] of porProducto) {
    porProducto.set(id, serializarReceta(receta));
  }
  return porProducto;
}
