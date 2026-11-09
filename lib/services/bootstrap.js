/**
 * Propósito: Service del snapshot público inicial ("bootstrap").
 *
 * Devuelve en una sola lectura los datos que la tienda necesita para pintar la
 * portada y el catálogo sin encadenar cinco peticiones: parámetros de negocio,
 * categorías activas, productos activos (con la receta de los combos), los más
 * vendidos del día y promociones activas con sus productos.
 *
 * Fuera del snapshot a propósito:
 * - stock por sucursal (depende de la sucursal y cambia con cada compra),
 * - personalización, reseñas y precios/stock derivados (se piden en el detalle),
 * - cualquier dato de usuario o de sesión.
 *
 * El frontend lo usa como optimización opcional: si falla, cada pantalla sigue
 * teniendo su propio GET.
 */

import db from '../models';
import { obtenerComponentesDeCombos } from './combo';
import { obtenerMasVendidosDelDia } from './mas_vendidos';
import { obtenerParametros } from './parametros_service';

const { Categoria, Producto, Promocion } = db;

/**
 * Mismo formato que GET /api/productos: `componentes` sólo viaja para combos.
 * @param {object} producto - Instancia con la asociación `Categoria` cargada.
 * @param {Array|undefined} componentes - Receta del combo.
 * @returns {object} Producto serializado para el cliente.
 */
const serializarProducto = (producto, componentes) => ({
  id: producto.id,
  nombre: producto.nombre,
  precio: Number(producto.precio),
  categoria: producto.Categoria ? producto.Categoria.nombre : null,
  categoriaId: producto.categoriaId,
  imagen: producto.imagen,
  descripcion: producto.descripcion,
  activo: producto.activo,
  tipo: producto.tipo,
  ...(componentes ? { componentes } : {}),
});

/**
 * Mismo formato que GET /api/promociones?include=productos.
 * @param {object} promocion - Instancia con la asociación `Productos` cargada.
 * @returns {object} Promoción serializada.
 */
const serializarPromocion = (promocion) => {
  const json = promocion.toJSON();
  const productos = json.Productos || [];
  delete json.Productos;
  return {
    ...json,
    productos: productos.map((producto) => ({
      ...producto,
      precio: Number(producto.precio),
    })),
  };
};

/**
 * Arma el snapshot público inicial.
 * @returns {Promise<{parametros: Array, categorias: Array, productos: Array, masVendidos: Array, promociones: Array}>}
 */
export const obtenerBootstrap = async () => {
  const [
    categorias,
    productos,
    promociones,
    parametros,
    masVendidos,
  ] = await Promise.all([
    Categoria.findAll({
      where: { activa: true },
      order: [['nombre', 'ASC']],
    }),
    Producto.findAll({
      where: { activo: true },
      include: [{ model: Categoria, as: 'Categoria' }],
      order: [['nombre', 'ASC']],
    }),
    Promocion.findAll({
      where: { activa: true },
      order: [['nombre', 'ASC']],
      include: [
        {
          model: Producto,
          as: 'Productos',
          attributes: ['id', 'nombre', 'precio', 'categoriaId'],
          through: { attributes: [] },
        },
      ],
    }),
    obtenerParametros(),
    obtenerMasVendidosDelDia(),
  ]);

  const combos = productos.filter((producto) => producto.tipo === 'COMBO');
  const recetas = await obtenerComponentesDeCombos(combos.map((p) => p.id));

  const serializarConReceta = (producto) =>
    producto.tipo === 'COMBO'
      ? serializarProducto(producto, recetas.get(producto.id) ?? [])
      : serializarProducto(producto);

  return {
    parametros,
    categorias: categorias.map((categoria) => categoria.toJSON()),
    productos: productos.map(serializarConReceta),
    // Los más vendidos salen del mismo catálogo activo, así que sus recetas ya
    // están en `recetas` (no hace falta otra consulta de combos).
    masVendidos: masVendidos.map(({ producto, vendidos }) => ({
      ...serializarConReceta(producto),
      vendidos,
    })),
    promociones: promociones.map(serializarPromocion),
  };
};

export default { obtenerBootstrap };
