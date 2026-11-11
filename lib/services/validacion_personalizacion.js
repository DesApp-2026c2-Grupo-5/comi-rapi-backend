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
 * Si el producto no tiene elementos configurados, se validan las plantillas
 * de categoría (`PersonalizacionCategoria`) como fallback.
 *
 * VALIDACIONES AGREGADAS:
 * - Existencia: cada opción seleccionada debe existir en la BD (por ID o nombre)
 * - Estado activo: la opción no debe estar desactivada (`activo: false`)
 * - Precios vigentes: los precios se re-calculan con los valores actuales de la BD,
 *   ignorando lo que envía el frontend
 * - Correspondencia: la opción debe pertenecer al producto (o a su categoría)
 */
import db from '../models';

const { PersonalizacionElemento, PersonalizacionCategoria, Producto } = db;

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
 * Busca un elemento de personalización en una lista por ID o nombre.
 * @param {Array} lista - Elementos (PersonalizacionElemento o PersonalizacionCategoria)
 * @param {string|number} id - ID buscado
 * @param {string} [nombre] - Nombre buscado (fallback si no hay ID)
 * @returns {object|null} Elemento encontrado o null
 */
function buscarElemento(lista, id, nombre) {
  const idStr = id !== undefined && id !== null ? String(id) : null;
  const nombreNorm = nombre ? String(nombre).trim().toLowerCase() : null;

  return (
    lista.find((e) => {
      if (idStr && String(e.id) === idStr) return true;
      if (nombreNorm && e.nombre) {
        return String(e.nombre).trim().toLowerCase() === nombreNorm;
      }
      return false;
    }) || null
  );
}

/**
 * Normaliza la lista de seleccionados según el tipo.
 * 'sin' (personalizar) viene como array de strings: ['Cebolla', 'Tomate']
 * Los demás vienen como array de objetos: [{ id, nombre, cantidad, precio }]
 * @returns Array de objetos normalizados { nombre, cantidad }
 */
function normalizarSeleccionados(seleccionados, tipo) {
  if (tipo === 'personalizar') {
    return (seleccionados || []).map((s) => ({
      nombre: typeof s === 'string' ? s : (s?.nombre ?? s?.id ?? ''),
      cantidad: typeof s === 'string' ? 1 : (s?.cantidad ?? 1),
    }));
  }
  return seleccionados || [];
}

/**
 * Valida una lista de seleccionados contra los elementos válidos de un tipo.
 * Recalcula el precio usando los valores de la BD (no confía en el frontend).
 * @param {Array} seleccionados - Opciones enviadas por el frontend
 * @param {Array} elementosValidos - Elementos de la BD (activos)
 * @param {string} tipo - 'extra' | 'acompanar' | 'condimento' | 'personalizar'
 * @param {string} etiqueta - Nombre del producto para mensajes de error
 * @returns {{ cantidad: number, precioTotal: number, errores: string[] }}
 */
function validarSeleccionados(seleccionados, elementosValidos, tipo, etiqueta) {
  const errores = [];
  let cantidadTotal = 0;
  let precioTotal = 0;

  // Normalizar seleccionados (maneja 'sin' como array de strings)
  const seleccionadosNorm = normalizarSeleccionados(seleccionados, tipo);

  // Si no hay elementos válidos configurados (ni propios ni plantillas),
  // no se valida ese tipo: se permite cualquier selección (compatibilidad).
  if (!elementosValidos || elementosValidos.length === 0) {
    for (const sel of seleccionadosNorm) {
      const cantidad = Number(sel.cantidad ?? 1);
      if (Number.isFinite(cantidad) && cantidad > 0) {
        cantidadTotal += cantidad;
        // Precio desde el frontend como fallback (solo si no hay config en BD)
        if (tipo === 'extra' || tipo === 'acompanar') {
          const precio = Number(sel.precio ?? sel.precioAdicional ?? 0);
          if (!Number.isNaN(precio) && precio >= 0) {
            precioTotal += precio * cantidad;
          }
        }
      }
    }
    return { cantidad: cantidadTotal, precioTotal, errores };
  }

  for (const sel of seleccionadosNorm) {
    const elemento = buscarElemento(elementosValidos, sel.id, sel.nombre);
    if (!elemento) {
      errores.push(
        `Opción "${sel.nombre || sel.id || 'desconocida'}" no existe o no está disponible para "${etiqueta}" (tipo ${tipo})`
      );
      continue;
    }
    if (elemento.activo === false) {
      errores.push(`"${elemento.nombre}" en "${etiqueta}" ya no está disponible`);
      continue;
    }

    const cantidad = Number(sel.cantidad ?? 1);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    cantidadTotal += cantidad;

    // Precio SIEMPRE desde la BD (no se confía en el frontend)
    // 'personalizar' y 'condimento' no tienen precio
    if (tipo === 'extra' || tipo === 'acompanar') {
      const precio = Number(elemento.precio ?? 0);
      if (Number.isNaN(precio) || precio < 0) {
        errores.push(`Precio inválido para "${elemento.nombre}"`);
      } else {
        precioTotal += precio * cantidad;
      }
    }

    // 'personalizar' (quitar ingrediente) no maneja cantidades: no se valida min/max
    if (tipo !== 'personalizar') {
      if (cantidad > elemento.maximo) {
        errores.push(
          `"${elemento.nombre}" en "${etiqueta}" permite como máximo ${elemento.maximo}`
        );
      }
      if (cantidad < elemento.minimo) {
        errores.push(
          `"${elemento.nombre}" en "${etiqueta}" requiere al menos ${elemento.minimo}`
        );
      }
    }
  }

  return { cantidad: cantidadTotal, precioTotal, errores };
}

/**
 * Obtiene los elementos válidos para un producto, combinando:
 * 1. PersonalizacionElemento propios del producto (activos)
 * 2. PersonalizacionCategoria de la categoría del producto (activos) como fallback
 *    SOLO para tipos donde el producto NO tiene elementos propios.
 *
 * @param {number} productoId
 * @param {object} [transaction]
 * @returns {Promise<{ extra: [], acompanar: [], condimento: [], personalizar: [] }>}
 */
async function obtenerElementosValidos(productoId, transaction) {
  // 1. Elementos propios del producto
  const propios = await PersonalizacionElemento.findAll({
    where: { productoId, activo: true },
    transaction,
  });

  // 2. Si el producto existe, obtener su categoría para plantillas
  let plantillas = [];
  const producto = await Producto.findByPk(productoId, { transaction });
  if (producto && producto.categoriaId) {
    plantillas = await PersonalizacionCategoria.findAll({
      where: { categoriaId: producto.categoriaId, activo: true },
      transaction,
    });
  }

  // Agrupar por tipo
  const porTipo = (tipo) => propios.filter((e) => e.tipo === tipo);
  const plantillasPorTipo = (tipo) => plantillas.filter((e) => e.tipo === tipo);

  // Para cada tipo: si el producto tiene elementos propios, SOLO usa esos.
  // Si NO tiene, usa plantillas de categoría.
  const tipos = ['extra', 'personalizar', 'acompanar', 'condimento'];
  const resultado = {};
  for (const tipo of tipos) {
    const tienePropios = porTipo(tipo).length > 0;
    resultado[tipo] = tienePropios ? porTipo(tipo) : plantillasPorTipo(tipo);
  }
  return resultado;
}

/**
 * Valida la personalización de todas las líneas de un pedido.
 * Recalcula precios con valores vigentes de la BD.
 * @param {Array} items - Líneas crudas del body (con `productoId` y `personalizacion`).
 * @param {object} [transaction] - Transacción Sequelize opcional.
 * @throws {PersonalizacionInvalidaError}
 */
export async function validarPersonalizacionDeItems(items, transaction) {
  const todosErrores = [];

  for (const item of items || []) {
    const productoId = item && item.productoId;
    if (!productoId) continue;

    const elementosValidos = await obtenerElementosValidos(productoId, transaction);

    const personalizacion = item.personalizacion || {};
    const etiqueta = item.nombreProducto || item.nombre || `producto ${productoId}`;

    // Validar extras
    const rExtra = validarSeleccionados(
      personalizacion.extras || item.extras || [],
      elementosValidos.extra,
      'extra',
      etiqueta
    );
    // Validar acompañamientos
    const rAcompanar = validarSeleccionados(
      personalizacion.acompanamientos || item.acompanamientos || [],
      elementosValidos.acompanar,
      'acompanar',
      etiqueta
    );
    // Validar condimentos
    const rCondimento = validarSeleccionados(
      personalizacion.condimentos || item.condimentos || [],
      elementosValidos.condimento,
      'condimento',
      etiqueta
    );
    // Validar personalizar (sin ingredientes) - solo existencia/activo, sin min/max de cantidad
    const rPersonalizar = validarSeleccionados(
      personalizacion.sin || item.sin || [],
      elementosValidos.personalizar,
      'personalizar',
      etiqueta
    );

    todosErrores.push(...rExtra.errores, ...rAcompanar.errores, ...rCondimento.errores, ...rPersonalizar.errores);
  }

  if (todosErrores.length > 0) {
    throw new PersonalizacionInvalidaError(todosErrores.join('; '));
  }
}

/**
 * Recalcula el precio unitario y subtotal de una línea usando SOLO precios de la BD.
 * Útil para que el controller de pedidos no confíe en el precio enviado por el frontend.
 * @param {number} precioBase - Precio base del producto (de la BD)
 * @param {Array} extras - Extras seleccionados (con id/nombre)
 * @param {Array} acompanamientos - Acompañamientos seleccionados (con id/nombre)
 * @param {number} cantidad - Cantidad de unidades
 * @param {number} productoId
 * @param {object} [transaction]
 * @returns {Promise<{ precioUnitario: number, subtotal: number }>}
 */
export async function recalcularPrecioConValidacion(
  precioBase,
  extras,
  acompanamientos,
  cantidad,
  productoId,
  transaction
) {
  const elementosValidos = await obtenerElementosValidos(productoId, transaction);

  let extraTotal = 0;
  for (const e of extras || []) {
    const elem = buscarElemento(elementosValidos.extra, e.id, e.nombre);
    if (elem && elem.activo !== false) {
      extraTotal += Number(elem.precio ?? 0) * Number(e.cantidad ?? 1);
    }
  }

  let acompTotal = 0;
  for (const a of acompanamientos || []) {
    const elem = buscarElemento(elementosValidos.acompanar, a.id, a.nombre);
    if (elem && elem.activo !== false) {
      acompTotal += Number(elem.precio ?? 0) * Number(a.cantidad ?? 1);
    }
  }

  const base = Number(precioBase);
  const precioUnitario = base + extraTotal + acompTotal;

  return { precioUnitario, subtotal: precioUnitario * cantidad };
}
