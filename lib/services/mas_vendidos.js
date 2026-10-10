import { fn, col, Op } from 'sequelize';
import db from '../models';

const { Pedido, PedidoItem, Producto, Categoria, EstadoPedido } = db;

/** Cuántos productos muestra la portada. */
const CANTIDAD_POR_DEFECTO = 3;

const conCategoria = {
  model: Categoria,
  as: 'Categoria',
};

/**
 * Ventana del "día" según el reloj del servidor.
 *
 * `Pedido.fechaHora` se guarda como `NOW()` (timestamp sin zona), o sea que
 * "hoy" es hoy en la hora local del servidor, no en UTC. Por eso los límites se
 * arman con `new Date()` y `setHours`, igual que hace el filtro por rango de
 * fechas del listado de pedidos del admin. El fin es exclusivo para que un
 * pedido hecho justo a medianoche entre en un solo día.
 */
function ventanaDeHoy() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);
  return { inicio, fin };
}

/**
 * Productos más vendidos del día.
 *
 * Vendido = suma de `PedidoItems.cantidad` de los pedidos de hoy que no están
 * cancelados. Un pedido cancelado no fue una venta: si contara, un producto que
 * la gente pidió y después canceló aparecería como el más pedido.
 *
 * El desempate por precio se resuelve acá y no en SQL a propósito: la consulta
 * agrupa por producto y trae una fila por producto (los joins son N a 1, así
 * que no multiplican filas), pero ordenar por `precio` exigiría meter
 * `Productos` dentro de la agregación. Con el resultado en memoria el orden es
 * exacto y se lee de una: más unidades primero y, a igual unidades, el más caro.
 *
 * Si hoy se vendió menos de `limite` productos, completa con los activos más
 * caros que todavía no estén en la lista, para que la sección de la portada no
 * quede con huecos.
 *
 * @returns {Promise<Array<{producto: Object, vendidos: number}>>}
 */
export async function obtenerMasVendidosDelDia(limite = CANTIDAD_POR_DEFECTO) {
  const { inicio, fin } = ventanaDeHoy();

  const agregados = await PedidoItem.findAll({
    attributes: ['productoId', [fn('SUM', col('cantidad')), 'vendidos']],
    where: { productoId: { [Op.ne]: null } },
    include: [
      {
        model: Pedido,
        required: true,
        // `attributes: []` porque el pedido y el estado solo están para filtrar.
        // Si se los deja seleccionar, Sequelize agrega `Pedido.id` al SELECT y
        // Postgres lo rechaza: la consulta agrupa por producto, y `Pedido.id`
        // tendría que ir en el GROUP BY, lo que abriría un grupo por pedido y
        // rompería la suma.
        attributes: [],
        where: { fechaHora: { [Op.gte]: inicio, [Op.lt]: fin } },
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

  const unidadesPorProducto = new Map(
    agregados.map((fila) => [fila.productoId, Number(fila.vendidos)])
  );

  // Solo interesan los que siguen en catálogo: un producto dado de baja hoy no
  // tiene que aparecer en la portada.
  const idsVendidos = [...unidadesPorProducto.keys()];
  const productosVendidos = idsVendidos.length
    ? await Producto.findAll({
        where: { id: { [Op.in]: idsVendidos }, activo: true },
        include: [conCategoria],
      })
    : [];

  const ranked = productosVendidos
    .map((producto) => ({
      producto,
      vendidos: unidadesPorProducto.get(producto.id),
    }))
    .sort(
      (a, b) =>
        b.vendidos - a.vendidos ||
        Number(b.producto.precio) - Number(a.producto.precio)
    )
    .slice(0, limite);

  if (ranked.length < limite) {
    const yaElegidos = ranked.map((item) => item.producto.id);
    // El where se arma por partes: en Sequelize 5 una clave con valor
    // `undefined` mezclada con otras condiciones rompe el WHERE ("invalid
    // undefined value"), y sin ventas este es el camino que corre.
    const whereMasCaros = { activo: true };
    if (yaElegidos.length) {
      whereMasCaros.id = { [Op.notIn]: yaElegidos };
    }
    const masCaros = await Producto.findAll({
      where: whereMasCaros,
      include: [conCategoria],
      order: [[col('precio'), 'DESC']],
      limit: limite - ranked.length,
    });
    ranked.push(...masCaros.map((producto) => ({ producto, vendidos: 0 })));
  }

  return ranked;
}

export { CANTIDAD_POR_DEFECTO };
