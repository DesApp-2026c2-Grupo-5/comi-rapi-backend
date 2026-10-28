/**
 * Service: disponibilidad_insumos
 *
 * Calcula si un extra o condimento está agotado para el cliente.
 *
 * Decisión de negocio: "agotado" = no queda stock en NINGUNA sucursal activa.
 * El cliente no elige sucursal antes de comprar; el backend asigna la más
 * cercana con stock al crear el pedido. Por eso el modal no puede mirar una
 * sucursal puntual: si hay 3 unidades en otra sucursal dentro de cobertura, el
 * extra sigue estando disponible.
 *
 * Una sola consulta agregada por request alcanza para todos los elementos de
 * `GET /api/personalizacion` y de sus plantillas.
 */
import db from '../models';

const { Insumo, InsumoStock, Sucursal } = db;

const TIPOS_CON_STOCK = ['extra', 'condimento'];

/**
 * Totales disponibles por insumo en sucursales activas.
 *
 * @param {Array<number|string>} insumoIds
 * @returns {Promise<Map<number, {total: number, activo: boolean}>>}
 */
export async function totalesDisponiblesPorInsumo(insumoIds = []) {
  const ids = [
    ...new Set(
      insumoIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return new Map();

  const [insumos, filas] = await Promise.all([
    Insumo.findAll({
      where: { id: ids },
      attributes: ['id', 'activo'],
    }),
    InsumoStock.findAll({
      where: { insumoId: ids, disponible: true },
      attributes: ['insumoId', 'cantidad'],
      include: [
        {
          model: Sucursal,
          as: 'sucursal',
          attributes: ['id', 'activa'],
          required: true,
        },
      ],
    }),
  ]);

  const totales = new Map(ids.map((id) => [id, 0]));
  filas.forEach((fila) => {
    if (!fila.sucursal || !fila.sucursal.activa) return;
    const insumoId = Number(fila.insumoId);
    totales.set(
      insumoId,
      (totales.get(insumoId) || 0) + Number(fila.cantidad || 0)
    );
  });

  const activos = new Map(insumos.map((i) => [Number(i.id), i.activo]));
  return new Map(
    ids.map((id) => [
      id,
      {
        total: totales.get(id) || 0,
        activo: activos.get(id) === true,
      },
    ])
  );
}

/**
 * Agrega `stockTotal` y `agotado` a una lista de elementos de personalización.
 * Acepta instancias de Sequelize o plain objects y siempre devuelve plain
 * objects (el controller los serializa tal cual).
 *
 * Los tipos sin insumo (`personalizar`, `acompanar`) quedan con
 * `stockTotal: null` y `agotado: false`: no se controlan contra stock.
 *
 * @param {Array<object>} elementos
 * @returns {Promise<Array<object>>}
 */
export async function marcarDisponibilidad(elementos = []) {
  const lista = (elementos || []).map((elemento) =>
    typeof elemento.toJSON === 'function' ? elemento.toJSON() : { ...elemento }
  );

  const insumoIds = lista
    .filter(
      (elemento) => TIPOS_CON_STOCK.includes(elemento.tipo) && elemento.insumoId
    )
    .map((elemento) => elemento.insumoId);

  const totales = await totalesDisponiblesPorInsumo(insumoIds);

  return lista.map((elemento) => {
    if (!elemento.insumoId) {
      return { ...elemento, stockTotal: null, agotado: false };
    }
    const estado = totales.get(Number(elemento.insumoId)) || {
      total: 0,
      activo: false,
    };
    return {
      ...elemento,
      stockTotal: estado.total,
      agotado: !estado.activo || estado.total <= 0,
    };
  });
}
