/**
 * Service: personalizacion_categorias
 *
 * Reglas compartidas entre las plantillas de personalización por categoría y su
 * copia a los productos nuevos.
 */
import db from '../models';
import { InsumoInvalidoError } from './insumos';

export const TIPOS_VALIDOS = [
  'extra',
  'personalizar',
  'acompanar',
  'condimento',
];

export const normalizarTipo = (tipo) => String(tipo || '').toLowerCase();

export const TIPOS_CON_STOCK = ['extra', 'condimento'];

/**
 * Resuelve y valida el insumo de un elemento de personalización (producto o
 * plantilla de categoría).
 *
 * - Sólo `extra` y `condimento` pueden tener insumo.
 * - El tipo del insumo tiene que coincidir con el del elemento.
 * - Al editar se permite conservar un insumo dado de baja (si no, no se podría
 *   guardar un cambio de precio de un elemento viejo).
 */
export async function resolverInsumoDeElemento(
  insumoId,
  tipo,
  { permitirInactivo = false } = {}
) {
  if (!TIPOS_CON_STOCK.includes(tipo)) {
    if (insumoId !== null && insumoId !== undefined && insumoId !== '') {
      throw new InsumoInvalidoError(
        'Sólo los extras y condimentos pueden vincularse a un insumo'
      );
    }
    return null;
  }
  if (insumoId === null || insumoId === undefined || insumoId === '') {
    return null;
  }
  const insumo = await db.Insumo.findByPk(insumoId);
  if (!insumo) {
    throw new InsumoInvalidoError('El insumo no existe');
  }
  if (!insumo.activo && !permitirInactivo) {
    throw new InsumoInvalidoError('El insumo está dado de baja');
  }
  if (insumo.tipo !== tipo) {
    throw new InsumoInvalidoError(
      'El tipo del insumo no coincide con el del elemento'
    );
  }
  return insumo;
}

export const validarPrecioSegunTipo = (tipo, precio) => {
  const tipoNormalizado = normalizarTipo(tipo);
  const requierePrecio =
    tipoNormalizado === 'extra' || tipoNormalizado === 'acompanar';
  if (!requierePrecio) return null;
  const precioNumerico = Number(precio);
  if (
    precio === null ||
    precio === undefined ||
    Number.isNaN(precioNumerico) ||
    precioNumerico < 0
  ) {
    return 'El precio es obligatorio para tipo extra/acompanar';
  }
  return null;
};

// Normaliza minimo/maximo a enteros. Valores ausentes usan el default
// (mínimo 0, máximo 1) para no romper compatibilidad con clientes viejos.
export const normalizarCantidad = (valor, porDefecto) => {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  return Number(valor);
};

export const validarCantidades = (minimo, maximo) => {
  if (!Number.isInteger(minimo) || minimo < 0) {
    return 'El mínimo debe ser un entero mayor o igual a 0';
  }
  if (!Number.isInteger(maximo) || maximo < 1) {
    return 'El máximo debe ser un entero mayor o igual a 1';
  }
  if (maximo < minimo) {
    return 'El máximo no puede ser menor que el mínimo';
  }
  return null;
};

/**
 * Busca un duplicado dentro de la misma categoría.
 *
 * Para `acompanar` la identidad es el producto ofrecido; para el resto, el
 * nombre (sin distinguir mayúsculas).
 */
export const buscarDuplicado = (elementos, tipo, datos, idExcluir = null) =>
  elementos.find((e) => {
    if (idExcluir && String(e.id) === String(idExcluir)) return false;
    if (e.tipo !== tipo) return false;
    if (tipo === 'acompanar') {
      return (
        String(e.productoReferenciaId) === String(datos.productoReferenciaId)
      );
    }
    // Si la plantilla apunta a un insumo, la identidad es el insumo: dos
    // plantillas de la misma categoría no pueden descontar dos veces el mismo.
    if (datos.insumoId) {
      return String(e.insumoId) === String(datos.insumoId);
    }
    return (
      (e.nombre || '').toLowerCase() === (datos.nombre || '').toLowerCase()
    );
  });

/**
 * Tipos de plantilla que NO se heredan.
 *
 * `personalizar` son los ingredientes del producto y ahora se cargan desde el
 * formulario del producto (opcionales). Heredarlos de la categoría hacía que un
 * producto nuevo naciera con ingredientes genéricos que nadie configuró.
 */
const TIPOS_NO_HEREDADOS = ['personalizar'];

/**
 * Copia las plantillas activas de una categoría al producto recién creado.
 *
 * Se ejecuta dentro de la transacción del alta: si falla, el producto no queda
 * con una personalización a medias. Los acompañamientos se copian sólo si
 * apuntan a un producto de referencia válido y distinto del nuevo.
 *
 * @param {object} opciones
 * @param {number} opciones.productoId - Producto destino.
 * @param {number} opciones.categoriaId - Categoría del producto.
 * @param {object} [opciones.transaction] - Transacción Sequelize.
 * @returns {Promise<Array>} Filas creadas.
 */
export async function copiarPlantillasAProducto({
  productoId,
  categoriaId,
  transaction,
}) {
  const plantillas = await db.PersonalizacionCategoria.findAll({
    where: { categoriaId, activo: true },
    transaction,
  });
  if (plantillas.length === 0) return [];

  const filas = plantillas
    .filter((p) => !TIPOS_NO_HEREDADOS.includes(p.tipo))
    .filter(
      (p) =>
        p.tipo !== 'acompanar' ||
        (p.productoReferenciaId &&
          String(p.productoReferenciaId) !== String(productoId))
    )
    .map((p) => ({
      productoId,
      tipo: p.tipo,
      nombre: p.nombre,
      precio: p.precio,
      productoReferenciaId:
        p.tipo === 'acompanar' ? p.productoReferenciaId : null,
      insumoId: p.insumoId,
      minimo: p.minimo,
      maximo: p.maximo,
      activo: p.activo,
    }));

  if (filas.length === 0) return [];
  return db.PersonalizacionElemento.bulkCreate(filas, { transaction });
}
