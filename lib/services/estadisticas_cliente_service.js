/**
 * Service: qué compró un cliente — productos y categorías más pedidos.
 *
 * Es la ficha del cliente vista desde los paneles de gestión: no es un reporte
 * global (eso es `metricas_service.js`) ni una portada de productos
 * (`mas_vendidos.js`), sino el ranking de UN usuario.
 *
 * La regla de negocio acá es una sola y conviene no dispersarla: un pedido
 * cancelado no fue una compra, así que no suma unidades. Es la misma definición
 * que usa `mas_vendidos` ("si contara, un producto que la gente pidió y después
 * canceló aparecería como el más pedido").
 *
 * El alcance lo decide quien llama: con `sucursalId` sólo cuentan los pedidos de
 * esa sucursal (el administrador ve a sus clientes como cliente de SU local) y
 * sin él cuentan todos (el superadmin).
 *
 * El agregado sale de dos consultas y se ordena en memoria a propósito: los
 * rankings son chicos (un puñado de productos) y el orden exacto en JavaScript
 * se lee mejor que meter un ORDER BY dentro de un GROUP BY.
 */

import { fn, col, Op } from 'sequelize';
import db from '../models';

const { Categoria, EstadoPedido, Pedido, PedidoItem, Producto } = db;

/** Cuántos productos y categorías devuelve el ranking. */
const LIMITE_POR_DEFECTO = 5;

const conCategoria = { model: Categoria, as: 'Categoria' };

/**
 * Productos y categorías que más compró un cliente.
 *
 * Los ítems con `productoId` nulo o con un producto ya borrado de la tabla
 * pierden el vínculo con el catálogo actual, pero el `PedidoItem` conserva
 * `nombreProducto` (snapshot obligatorio, ver AGENTS.md): se usa como respaldo
 * para que sus unidades no desaparezcan del total.
 *
 * @param {number} usuarioId
 * @param {{sucursalId?: number|null, limite?: number}} [opciones]
 * @returns {Promise<{
 *   productos: Array<{productoId: number|null, nombre: string, categoriaId: number|null, categoria: string, unidades: number}>,
 *   categorias: Array<{categoriaId: number|null, nombre: string, unidades: number}>,
 *   totalUnidades: number
 * }>}
 */
export async function productosYCategoriasMasComprados(
  usuarioId,
  { sucursalId = null, limite = LIMITE_POR_DEFECTO } = {}
) {
  const wherePedido = { usuarioId };
  if (sucursalId) wherePedido.sucursalId = sucursalId;

  const agregados = await PedidoItem.findAll({
    attributes: [
      'productoId',
      [fn('SUM', col('PedidoItem.cantidad')), 'unidades'],
      // Respaldo histórico: el nombre con el que se compró.
      [fn('MIN', col('PedidoItem.nombreProducto')), 'nombreHistorico'],
    ],
    where: { productoId: { [Op.ne]: null } },
    include: [
      {
        model: Pedido,
        required: true,
        // `attributes: []`: el pedido sólo está para filtrar. Si se lo deja
        // seleccionar, Sequelize agrega `Pedido.id` al SELECT y Postgres lo
        // rechaza al agrupar (mismo detalle que en `mas_vendidos`).
        attributes: [],
        where: wherePedido,
        include: [
          {
            model: EstadoPedido,
            as: 'estadoActual',
            required: true,
            attributes: [],
            where: { nombre: { [Op.ne]: 'cancelado' } },
          },
        ],
      },
    ],
    group: ['PedidoItem.productoId'],
    raw: true,
  });

  if (agregados.length === 0) {
    return { productos: [], categorias: [], totalUnidades: 0 };
  }

  const unidadesPorProducto = new Map(
    agregados.map((fila) => [Number(fila.productoId), Number(fila.unidades)])
  );
  const totalUnidades = [...unidadesPorProducto.values()].reduce(
    (suma, n) => suma + n,
    0
  );

  const productos = await Producto.findAll({
    where: { id: { [Op.in]: [...unidadesPorProducto.keys()] } },
    include: [conCategoria],
  });
  const porId = new Map(productos.map((p) => [Number(p.id), p]));

  const productosRanking = agregados
    .map((fila) => {
      const id = Number(fila.productoId);
      const producto = porId.get(id);
      return {
        productoId: id,
        nombre: producto
          ? producto.nombre
          : fila.nombreHistorico || 'Producto no disponible',
        categoriaId: producto?.Categoria ? Number(producto.Categoria.id) : null,
        categoria: producto?.Categoria
          ? producto.Categoria.nombre
          : 'Sin categoría',
        unidades: Number(fila.unidades),
      };
    })
    // Más unidades primero; a igual cantidad, alfabético para que el orden sea
    // estable entre corridas.
    .sort(
      (a, b) =>
        b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, 'es')
    );

  // Las categorías se suman sobre TODOS los productos comprados y no sobre el
  // top recortado: si no, una categoría quedaría afuera por no tener el producto
  // más pedido dentro del ranking.
  const unidadesPorCategoria = new Map();
  const nombrePorCategoria = new Map();
  for (const item of productosRanking) {
    const clave = item.categoriaId;
    unidadesPorCategoria.set(
      clave,
      (unidadesPorCategoria.get(clave) || 0) + item.unidades
    );
    if (!nombrePorCategoria.has(clave))
      nombrePorCategoria.set(clave, item.categoria);
  }

  const categoriasRanking = [...unidadesPorCategoria.entries()]
    .map(([categoriaId, unidades]) => ({
      categoriaId,
      nombre: nombrePorCategoria.get(categoriaId),
      unidades,
    }))
    .sort(
      (a, b) =>
        b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, 'es')
    );

  return {
    productos: productosRanking.slice(0, limite),
    categorias: categoriasRanking.slice(0, limite),
    totalUnidades,
  };
}

export { LIMITE_POR_DEFECTO };
