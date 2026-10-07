import db from '../models';
import { sucursalDeSesion } from '../middlewares/auth';
import {
  ajustarStock,
  combosOfrecidos,
  maximoDeCombosPorSucursal,
  maximosDeRecetaPorSucursal,
} from '../services/stock';

const { ComboComponente, Producto, Stock, Sucursal } = db;

/**
 * Controller: stock
 *
 * Traduce HTTP a las reglas del service de stock. Todo es del admin: el stock
 * es de la sucursal y lo define la sucursal.
 */

/**
 * En un combo la `cantidad` guardada es un espejo del máximo que arma su receta,
 * así que se devuelve el valor derivado y no el de la fila. Si se leyera el
 * número crudo, cualquier ajuste de stock hecho por afuera (un script, una
 * corrección manual en la base) se mostraría desactualizado hasta el próximo
 * cambio por la pantalla.
 *
 * @param {object} stock Fila de Stock con `Sucursal` y `Producto` cargados.
 * @param {number} [cantidadDerivada] Máximo según la receta, si es combo.
 */
const serializar = (stock, cantidadDerivada) => ({
  sucursalId: stock.sucursalId,
  sucursal: stock.Sucursal ? stock.Sucursal.nombre : null,
  productoId: stock.productoId,
  producto: stock.Producto ? stock.Producto.nombre : null,
  tipo: stock.Producto ? stock.Producto.tipo : null,
  imagen: stock.Producto ? stock.Producto.imagen : null,
  cantidad:
    stock.Producto?.tipo === 'COMBO' && cantidadDerivada !== undefined
      ? cantidadDerivada
      : stock.cantidad,
  disponible: stock.disponible,
});

/** Resuelve la cantidad derivada de cada fila de combo, en paralelo. */
const cantidadesDerivadas = async (stocks) => {
  const combos = stocks.filter((stock) => stock.Producto?.tipo === 'COMBO');
  const derivados = await Promise.all(
    combos.map(async (stock) => [
      `${stock.sucursalId}-${stock.productoId}`,
      await maximoDeCombosPorSucursal(stock.productoId, stock.sucursalId),
    ])
  );
  return new Map(derivados);
};

const conRelaciones = [
  { model: Sucursal, as: 'Sucursal', attributes: ['id', 'nombre'] },
  {
    model: Producto,
    as: 'Producto',
    attributes: ['id', 'nombre', 'tipo', 'imagen'],
  },
];

/**
 * Convierte un error de base de datos en algo que un admin pueda entender.
 *
 * Los errores de regla de negocio ya salen del service en español y se devuelven
 * tal cual. Lo que llega desde Postgres, en cambio, viene como
 * `new row for relation "Stocks" violates check constraint "stocks_..."`, que no
 * le dice nada a quien está cargando stock. Acá se traduce el caso conocido y,
 * para lo que no se reconoce, se devuelve un mensaje genérico sin filtrar el
 * detalle técnico.
 *
 * @param {Error} error
 * @returns {string} Mensaje para el admin.
 */
function mensajeDeError(error) {
  const crudo = String(error?.message ?? error ?? '');
  if (error?.name === 'ValidationError') {
    const detalle = Object.values(error.errors || {})
      .map((e) => e.message)
      .filter(Boolean)
      .join('. ');
    return detalle || 'Los datos enviados no son válidos';
  }
  const esViolacionDeConstraint =
    crudo.includes('violates check constraint') ||
    crudo.includes('violates foreign key constraint') ||
    crudo.includes('violates unique constraint');
  if (esViolacionDeConstraint) {
    return 'No se pudo guardar el stock: la cantidad cargada no es válida para este producto';
  }
  // Un error de negocio del service ya viene redactado: se respeta.
  if (!crudo.includes('relation') && !crudo.includes('constraint')) {
    return crudo;
  }
  return 'No se pudo guardar el stock. Revisá los datos e intentá de nuevo';
}

const recargar = (sucursalId, productoId) =>
  Stock.findOne({
    where: { sucursalId: Number(sucursalId), productoId: Number(productoId) },
    include: conRelaciones,
  });

/**
 * GET /api/stock?sucursalId=&productoId=
 * Sin filtros devuelve toda la matriz, con filtros se acota.
 */
export const index = async (req, res) => {
  const where = {};
  // Un admin con sucursal asignada sólo ve y opera su propia matriz: el
  // `sucursalId` de la query se ignora para no poder espiar otro local.
  const propia = sucursalDeSesion(req);
  if (propia) {
    where.sucursalId = Number(propia);
  } else if (req.query.sucursalId) {
    where.sucursalId = Number(req.query.sucursalId);
  }
  if (req.query.productoId) {
    where.productoId = Number(req.query.productoId);
  }
  const stocks = await Stock.findAll({
    where,
    include: conRelaciones,
    order: [
      ['sucursalId', 'ASC'],
      ['productoId', 'ASC'],
    ],
  });
  const derivados = await cantidadesDerivadas(stocks);
  return res.json({
    success: true,
    data: stocks.map((stock) =>
      serializar(
        stock,
        derivados.get(`${stock.sucursalId}-${stock.productoId}`)
      )
    ),
  });
};

/**
 * GET /api/stock/:sucursalId/:productoId
 */
export const show = async (req, res) => {
  const stock = await recargar(req.params.sucursalId, req.params.productoId);
  if (!stock) {
    return res.status(404).json({
      success: false,
      error: 'El producto no tiene stock cargado en esa sucursal',
    });
  }
  const derivados = await cantidadesDerivadas([stock]);
  return res.json({
    success: true,
    data: serializar(
      stock,
      derivados.get(`${stock.sucursalId}-${stock.productoId}`)
    ),
  });
};

/**
 * POST /api/stock/maximos-de-combos
 * Body: { componentes: [{productoId, cantidad}] }
 * Máximo de combos que se pueden armar en cada sucursal activa, con el detalle de
 * qué producto frena a cada una. Es lo que muestra el formulario del combo.
 */
export const maximosDeCombos = async (req, res) => {
  const { componentes } = req.body || {};
  const datos = await maximosDeRecetaPorSucursal(componentes);
  if (datos.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        'Pasá los productos del combo con su cantidad para calcular el máximo',
    });
  }
  // Un admin acotado sólo ve el cálculo de su sucursal, no la comparación entre
  // todas: el formulario del combo se arma para su local.
  const propia = sucursalDeSesion(req);
  const acotados = propia
    ? datos.filter((dato) => Number(dato.sucursalId) === Number(propia))
    : datos;
  return res.json({ success: true, data: acotados });
};

/**
 * PUT /api/stock/:sucursalId/:productoId
 * Body: { cantidad?, disponible? }
 * En un combo la cantidad se ignora: sale del stock de sus componentes. Sólo se
 * puede cambiar si el combo se ofrece o no.
 */
export const update = async (req, res) => {
  const { sucursalId, productoId } = req.params;
  try {
    const producto = await Producto.findByPk(Number(productoId));
    if (!producto) {
      return res
        .status(404)
        .json({ success: false, error: 'Producto no encontrado' });
    }
    await ajustarStock(productoId, sucursalId, req.body || {});
    const stock = await recargar(sucursalId, productoId);
    return res.json({ success: true, data: stock ? serializar(stock) : null });
  } catch (error) {
    return res
      .status(400)
      .json({ success: false, error: mensajeDeError(error) });
  }
};

/**
 * POST /api/stock/:sucursalId/:productoId
 * Crea (o deja como estaba) la fila de stock de un producto en una sucursal.
 */
export const create = async (req, res) => {
  const { sucursalId, productoId } = req.params;
  const sucursal = await Sucursal.findByPk(Number(sucursalId));
  if (!sucursal || !sucursal.activa) {
    return res
      .status(400)
      .json({ success: false, error: 'La sucursal no existe o está inactiva' });
  }
  const producto = await Producto.findByPk(Number(productoId));
  if (!producto || !producto.activo) {
    return res.status(400).json({
      success: false,
      error: 'El producto no existe o está dado de baja',
    });
  }
  try {
    await Stock.findOrCreate({
      where: {
        sucursalId: Number(sucursalId),
        productoId: Number(productoId),
      },
      defaults: { cantidad: 0, disponible: true },
    });
  } catch (error) {
    return res
      .status(400)
      .json({ success: false, error: mensajeDeError(error) });
  }
  const stock = await recargar(sucursalId, productoId);
  return res.status(201).json({ success: true, data: serializar(stock) });
};

/**
 * DELETE /api/stock/:sucursalId/:productoId
 * Saca el producto del catálogo de la sucursal.
 */
export const destroy = async (req, res) => {
  const borrado = await Stock.destroy({
    where: {
      sucursalId: Number(req.params.sucursalId),
      productoId: Number(req.params.productoId),
    },
  });
  if (borrado === 0) {
    return res.status(404).json({
      success: false,
      error: 'El producto no tiene stock cargado en esa sucursal',
    });
  }
  return res.json({ success: true });
};

/**
 * GET /api/stock/:sucursalId/:productoId/disponibilidad
 *
 * Siempre devuelve los mismos cuatro campos para combo y para producto simple:
 *
 * - `cantidad`: las unidades que hay. En un combo son los combos que se pueden
 *   armar con la receta, no un tope que carga el admin.
 * - `maximoPorComponentes`: lo mismo que `cantidad` en un combo (se conserva
 *   porque el formulario del combo lo pide para mostrar la receta). `null` en un
 *   producto simple, que no tiene receta.
 * - `disponibles`: lo que se vende de verdad. Es 0 si la fila no existe o está
 *   marcada como no disponible.
 * - `componentes`: la receta con el stock que hay de cada uno. Vacía en un
 *   producto simple.
 */
export const disponibilidad = async (req, res) => {
  const { sucursalId, productoId } = req.params;
  const producto = await Producto.findByPk(Number(productoId));
  if (!producto) {
    return res
      .status(404)
      .json({ success: false, error: 'Producto no encontrado' });
  }
  if (producto.tipo === 'COMBO') {
    const [componentes, maximo, disponibles] = await Promise.all([
      ComboComponente.findAll({
        where: { comboId: producto.id },
        order: [['id', 'ASC']],
      }),
      maximoDeCombosPorSucursal(producto.id, Number(sucursalId)),
      // El service es el que sabe cruzar la cantidad cargada con el stock de la
      // receta y tener en cuenta si la fila está disponible.
      combosOfrecidos(producto.id, Number(sucursalId)),
    ]);
    const stock = await recargar(sucursalId, productoId);
    const stockComponentes = await Stock.findAll({
      where: {
        sucursalId: Number(sucursalId),
        productoId: componentes.map((c) => c.productoId),
      },
    });
    const stockPorProducto = new Map(
      stockComponentes.map((s) => [s.productoId, s.cantidad])
    );
    return res.json({
      success: true,
      data: {
        productoId: producto.id,
        tipo: producto.tipo,
        sucursalId: Number(sucursalId),
        cantidad: stock
          ? producto.tipo === 'COMBO'
            ? maximo
            : stock.cantidad
          : 0,
        disponible: Boolean(stock && stock.disponible),
        maximoPorComponentes: maximo,
        disponibles,
        componentes: componentes.map((c) => ({
          productoId: c.productoId,
          cantidad: c.cantidad,
          hay: stockPorProducto.get(c.productoId) ?? 0,
        })),
      },
    });
  }
  const stock = await recargar(sucursalId, productoId);
  if (!stock) {
    return res.status(404).json({
      success: false,
      error: 'El producto no tiene stock cargado en esa sucursal',
    });
  }
  return res.json({
    success: true,
    data: {
      productoId: producto.id,
      tipo: producto.tipo,
      sucursalId: Number(sucursalId),
      cantidad: stock.cantidad,
      disponible: Boolean(stock.disponible),
      maximoPorComponentes: null,
      // Sin receta no hay mínimo que cruzar: sale lo que ofrece la fila.
      disponibles: stock.disponible ? stock.cantidad : 0,
      componentes: [],
    },
  });
};
